import { generateText } from "ai";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { AgentName } from "../../shared/types.ts";
import type { ProviderInstance } from "../providers/registry.ts";
import { getAgentConfig } from "./registry.ts";
import { runAgent, type AgentInput, type AgentOutput } from "./base.ts";
import { trackTokenUsage } from "../services/token-tracker.ts";
import { checkCostLimit } from "../services/cost-limiter.ts";
import { broadcastAgentStatus, broadcastAgentError, broadcastTokenUsage, broadcastFilesChanged } from "../ws.ts";
import { broadcast } from "../ws.ts";
import { writeFile } from "../tools/file-ops.ts";

const MAX_RETRIES = 3;

// Abort registry — keyed by chatId
const abortControllers = new Map<string, AbortController>();

export function abortOrchestration(chatId: string) {
  const controller = abortControllers.get(chatId);
  if (controller) {
    controller.abort();
    abortControllers.delete(chatId);
  }
}

export function isOrchestrationRunning(chatId: string): boolean {
  return abortControllers.has(chatId);
}

interface OrchestratorInput {
  chatId: string;
  projectId: string;
  projectPath: string;
  userMessage: string;
  providers: ProviderInstance;
  apiKeys: Record<string, string>;
}

interface ExecutionPlan {
  steps: Array<{
    agentName: AgentName;
    input: string;
    dependsOn?: AgentName[];
  }>;
}

export async function runOrchestration(input: OrchestratorInput): Promise<void> {
  const { chatId, projectId, projectPath, userMessage, providers, apiKeys } = input;

  // Create abort controller for this orchestration
  const controller = new AbortController();
  abortControllers.set(chatId, controller);
  const { signal } = controller;

  // Check cost limits before starting
  const costCheck = checkCostLimit(chatId);
  if (!costCheck.allowed) {
    abortControllers.delete(chatId);
    broadcast({
      type: "agent_error",
      payload: {
        agentName: "orchestrator",
        error: `Token limit reached (${costCheck.currentTokens}/${costCheck.limit}). Please increase your limit to continue.`,
      },
    });
    return;
  }

  if (costCheck.warning) {
    broadcast({
      type: "agent_status",
      payload: {
        agentName: "orchestrator",
        status: "warning",
        message: `Token usage at ${Math.round(costCheck.percentUsed * 100)}% of limit`,
      },
    });
  }

  // Load project name and chat title for billing ledger
  const projectRow = await db.select({ name: schema.projects.name }).from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  const chatRow = await db.select({ title: schema.chats.title }).from(schema.chats).where(eq(schema.chats.id, chatId)).get();
  const projectName = projectRow?.name || "Unknown";
  const chatTitle = chatRow?.title || "Unknown";

  // Load chat history
  const chatMessages = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.chatId, chatId))
    .all();

  const chatHistory = chatMessages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Build execution plan
  const plan = buildExecutionPlan(userMessage);

  broadcastAgentStatus("orchestrator", "running");

  // Collect agent outputs internally — only the final summary is shown to user
  const agentResults = new Map<string, string>();
  const completedAgents: string[] = [];

  // Execute each step sequentially
  for (const step of plan.steps) {
    // Check if aborted before starting each agent
    if (signal.aborted) {
      await db.insert(schema.messages).values({
        id: nanoid(),
        chatId,
        role: "system",
        content: `Pipeline stopped by user. Completed agents: ${completedAgents.join(", ") || "none"}.`,
        agentName: "orchestrator",
        metadata: null,
        createdAt: Date.now(),
      });
      broadcastAgentStatus("orchestrator", "stopped");
      abortControllers.delete(chatId);
      return;
    }

    const config = getAgentConfig(step.agentName);
    if (!config) {
      broadcastAgentError("orchestrator", `Unknown agent: ${step.agentName}`);
      abortControllers.delete(chatId);
      return;
    }

    // Create execution record
    const executionId = nanoid();
    const execution = {
      id: executionId,
      chatId,
      agentName: step.agentName,
      status: "running",
      input: JSON.stringify({ message: step.input }),
      output: null,
      error: null,
      retryCount: 0,
      startedAt: Date.now(),
      completedAt: null,
    };
    await db.insert(schema.agentExecutions).values(execution);

    // Run with retry
    let result: AgentOutput | null = null;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Check abort inside retry loop too
      if (signal.aborted) break;

      try {
        const agentInput: AgentInput = {
          userMessage: step.input,
          chatHistory,
          projectPath,
          context: {
            projectId,
            originalRequest: userMessage,
            upstreamOutputs: Object.fromEntries(agentResults),
          },
        };

        result = await runAgent(config, providers, agentInput, undefined, signal);

        // Track token usage
        if (result.tokenUsage) {
          const providerKey = apiKeys[config.provider];
          if (providerKey) {
            const record = trackTokenUsage({
              executionId,
              chatId,
              agentName: step.agentName,
              provider: config.provider,
              model: config.model,
              apiKey: providerKey,
              inputTokens: result.tokenUsage.inputTokens,
              outputTokens: result.tokenUsage.outputTokens,
              projectId,
              projectName,
              chatTitle,
            });

            // Broadcast token usage to client
            broadcastTokenUsage({
              chatId,
              agentName: step.agentName,
              provider: config.provider,
              model: config.model,
              inputTokens: result.tokenUsage.inputTokens,
              outputTokens: result.tokenUsage.outputTokens,
              totalTokens: result.tokenUsage.totalTokens,
              costEstimate: record.costEstimate,
            });
          }
        }

        // Update execution record
        await db
          .update(schema.agentExecutions)
          .set({
            status: "completed",
            output: JSON.stringify(result),
            completedAt: Date.now(),
          })
          .where(eq(schema.agentExecutions.id, executionId));

        // Collect output internally
        agentResults.set(step.agentName, result.content);
        completedAgents.push(step.agentName);

        // Extract and write files from agent output
        extractAndWriteFiles(step.agentName, result.content, projectPath, projectId);

        break; // Success — exit retry loop
      } catch (err) {
        // Handle abort gracefully
        if (signal.aborted) break;

        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt < MAX_RETRIES) {
          // Update status to retrying
          await db
            .update(schema.agentExecutions)
            .set({ status: "retrying", retryCount: attempt + 1 })
            .where(eq(schema.agentExecutions.id, executionId));

          broadcastAgentStatus(step.agentName, "retrying", { attempt: attempt + 1 });
        }
      }
    }

    // Check if aborted after agent run
    if (signal.aborted) {
      await db.insert(schema.messages).values({
        id: nanoid(),
        chatId,
        role: "system",
        content: `Pipeline stopped by user. Completed agents: ${completedAgents.join(", ") || "none"}.`,
        agentName: "orchestrator",
        metadata: null,
        createdAt: Date.now(),
      });
      broadcastAgentStatus("orchestrator", "stopped");
      abortControllers.delete(chatId);
      return;
    }

    if (!result) {
      // All retries failed — HALT the orchestration chain
      const errorMsg = lastError?.message || "Unknown error";

      await db
        .update(schema.agentExecutions)
        .set({
          status: "failed",
          error: errorMsg,
          completedAt: Date.now(),
        })
        .where(eq(schema.agentExecutions.id, executionId));

      broadcastAgentError(step.agentName, errorMsg);
      broadcastAgentError("orchestrator", `Pipeline halted: ${step.agentName} failed after ${MAX_RETRIES} retries`);

      // Save error as system message
      await db.insert(schema.messages).values({
        id: nanoid(),
        chatId,
        role: "system",
        content: `Agent ${step.agentName} failed: ${errorMsg}`,
        agentName: step.agentName,
        metadata: null,
        createdAt: Date.now(),
      });

      abortControllers.delete(chatId);
      return; // HALT — do not continue to next step
    }

    // Check cost between steps
    const midCheck = checkCostLimit(chatId);
    if (!midCheck.allowed) {
      broadcastAgentStatus("orchestrator", "paused");
      broadcast({
        type: "agent_error",
        payload: {
          agentName: "orchestrator",
          error: `Token limit reached mid-pipeline. Completed through ${step.agentName}.`,
        },
      });
      abortControllers.delete(chatId);
      return;
    }
  }

  // --- Remediation pass (max 1 cycle) ---
  const findings = detectIssues(agentResults);
  if (findings.hasIssues && !signal.aborted) {
    const remediationCostCheck = checkCostLimit(chatId);
    if (remediationCostCheck.allowed) {
      const remediationAgent = "frontend-dev" as AgentName;
      const config = getAgentConfig(remediationAgent);

      if (config) {
        const parts: string[] = [];
        parts.push(`Fix the following issues found during review of: ${userMessage}`);
        if (findings.qaFindings) {
          parts.push(`\n## QA Findings\n${findings.qaFindings}`);
        }
        if (findings.securityFindings) {
          parts.push(`\n## Security Findings\n${findings.securityFindings}`);
        }
        parts.push(`\nReview the original code in Previous Agent Outputs and output corrected versions of any files with issues.`);
        const remediationInput = parts.join("\n");

        broadcastAgentStatus(remediationAgent, "running", { phase: "remediation" });

        const executionId = nanoid();
        await db.insert(schema.agentExecutions).values({
          id: executionId,
          chatId,
          agentName: remediationAgent,
          status: "running",
          input: JSON.stringify({ message: remediationInput, phase: "remediation" }),
          output: null,
          error: null,
          retryCount: 0,
          startedAt: Date.now(),
          completedAt: null,
        });

        try {
          const agentInput: AgentInput = {
            userMessage: remediationInput,
            chatHistory,
            projectPath,
            context: {
              projectId,
              originalRequest: userMessage,
              upstreamOutputs: Object.fromEntries(agentResults),
              phase: "remediation",
            },
          };

          const result = await runAgent(config, providers, agentInput, undefined, signal);

          if (result.tokenUsage) {
            const providerKey = apiKeys[config.provider];
            if (providerKey) {
              const record = trackTokenUsage({
                executionId,
                chatId,
                agentName: remediationAgent,
                provider: config.provider,
                model: config.model,
                apiKey: providerKey,
                inputTokens: result.tokenUsage.inputTokens,
                outputTokens: result.tokenUsage.outputTokens,
                projectId,
                projectName,
                chatTitle,
              });
              broadcastTokenUsage({
                chatId,
                agentName: remediationAgent,
                provider: config.provider,
                model: config.model,
                inputTokens: result.tokenUsage.inputTokens,
                outputTokens: result.tokenUsage.outputTokens,
                totalTokens: result.tokenUsage.totalTokens,
                costEstimate: record.costEstimate,
              });
            }
          }

          await db.update(schema.agentExecutions)
            .set({ status: "completed", output: JSON.stringify(result), completedAt: Date.now() })
            .where(eq(schema.agentExecutions.id, executionId));

          agentResults.set("frontend-dev-remediation", result.content);
          completedAgents.push("frontend-dev (remediation)");

          // Extract and write remediated files
          extractAndWriteFiles("frontend-dev", result.content, projectPath, projectId);

        } catch (err) {
          if (!signal.aborted) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            await db.update(schema.agentExecutions)
              .set({ status: "failed", error: errorMsg, completedAt: Date.now() })
              .where(eq(schema.agentExecutions.id, executionId));
            broadcastAgentError(remediationAgent, `Remediation failed: ${errorMsg}`);
          }
        }
      }
    }
  }

  // Generate a single summary from all agent outputs
  const summary = await generateSummary({
    userMessage,
    agentResults,
    chatId,
    projectId,
    projectName,
    chatTitle,
    providers,
    apiKeys,
  });

  // Save only the orchestrator summary as the chat message
  await db.insert(schema.messages).values({
    id: nanoid(),
    chatId,
    role: "assistant",
    content: summary,
    agentName: "orchestrator",
    metadata: null,
    createdAt: Date.now(),
  });

  broadcast({
    type: "chat_message",
    payload: {
      chatId,
      agentName: "orchestrator",
      content: summary,
    },
  });

  broadcastAgentStatus("orchestrator", "completed");
  abortControllers.delete(chatId);
}

const SUMMARY_SYSTEM_PROMPT = `You are the orchestrator for a page builder. Present the finished result to the user.
Write a clean, confident, conversational markdown response. Include:
- What was built (brief overview of the working product)
- Key files created or modified
- How to use it or interact with it
Keep it concise — 2-5 short paragraphs max. Use headings, bullet points, and code references where helpful.

IMPORTANT rules:
- Present the work as DONE, not as a draft with open issues.
- Do NOT expose internal QA findings, security scan details, or agent-level diagnostics to the user.
- Do NOT list "Suggested Next Steps" or "Issues Found" — the agents already handled those internally.
- Do NOT include raw JSON, tool calls, or internal agent data.
- If QA or security flagged minor issues, silently note them as areas for future improvement at most — never as a prominent section.
- The tone should be: "Here's what we built for you" — not "Here's a report of what went wrong."`;

interface SummaryInput {
  userMessage: string;
  agentResults: Map<string, string>;
  chatId: string;
  projectId: string;
  projectName: string;
  chatTitle: string;
  providers: ProviderInstance;
  apiKeys: Record<string, string>;
}

async function generateSummary(input: SummaryInput): Promise<string> {
  const { userMessage, agentResults, chatId, projectId, projectName, chatTitle, providers, apiKeys } = input;

  const orchestratorConfig = getAgentConfig("orchestrator");
  if (!orchestratorConfig) {
    // Fallback: concatenate results if orchestrator config is missing
    return Array.from(agentResults.entries())
      .map(([agent, output]) => `**${agent}:** ${output}`)
      .join("\n\n");
  }

  // Build digest of agent outputs
  const digest = Array.from(agentResults.entries())
    .map(([agent, output]) => `### ${agent}\n${output}`)
    .join("\n\n");

  const prompt = `## User Request\n${userMessage}\n\n## Agent Outputs\n${digest}`;

  // Get the orchestrator's model
  const model = providers.anthropic?.(orchestratorConfig.model);
  if (!model) {
    // Fallback if no Anthropic provider
    return Array.from(agentResults.entries())
      .map(([agent, output]) => `**${agent}:** ${output}`)
      .join("\n\n");
  }

  const result = await generateText({
    model,
    system: SUMMARY_SYSTEM_PROMPT,
    prompt,
  });

  // Track token usage for the summary call
  if (result.usage) {
    const providerKey = apiKeys[orchestratorConfig.provider];
    if (providerKey) {
      const inputTokens = result.usage.inputTokens || 0;
      const outputTokens = result.usage.outputTokens || 0;

      // Create a real execution record so the FK constraint is satisfied
      const summaryExecId = nanoid();
      db.insert(schema.agentExecutions).values({
        id: summaryExecId,
        chatId,
        agentName: "orchestrator",
        status: "completed",
        input: JSON.stringify({ type: "summary", userMessage }),
        output: JSON.stringify({ summary: result.text }),
        error: null,
        retryCount: 0,
        startedAt: Date.now(),
        completedAt: Date.now(),
      }).run();

      const record = trackTokenUsage({
        executionId: summaryExecId,
        chatId,
        agentName: "orchestrator",
        provider: orchestratorConfig.provider,
        model: orchestratorConfig.model,
        apiKey: providerKey,
        inputTokens,
        outputTokens,
        projectId,
        projectName,
        chatTitle,
      });

      broadcastTokenUsage({
        chatId,
        agentName: "orchestrator",
        provider: orchestratorConfig.provider,
        model: orchestratorConfig.model,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        costEstimate: record.costEstimate,
      });
    }
  }

  return result.text;
}

interface ReviewFindings {
  hasIssues: boolean;
  qaFindings: string | null;
  securityFindings: string | null;
}

function detectIssues(agentResults: Map<string, string>): ReviewFindings {
  const qaOutput = agentResults.get("qa") || "";
  const securityOutput = agentResults.get("security") || "";

  // QA agent outputs "QA Review: Pass" when no issues found (see qa.md prompt)
  const qaClean = qaOutput.includes("QA Review: Pass") || qaOutput.trim() === "";

  // Security agent outputs "status": "pass" when no issues found (see security.md prompt)
  const securityClean =
    securityOutput.includes('"status": "pass"') ||
    securityOutput.includes('"status":"pass"') ||
    securityOutput.includes("Passed with no issues") ||
    securityOutput.trim() === "";

  return {
    hasIssues: !qaClean || !securityClean,
    qaFindings: qaClean ? null : qaOutput,
    securityFindings: securityClean ? null : securityOutput,
  };
}

function buildExecutionPlan(userMessage: string): ExecutionPlan {
  return {
    steps: [
      {
        agentName: "research",
        input: `Analyze this request and produce structured requirements: ${userMessage}`,
      },
      {
        agentName: "architect",
        input: `Design the component architecture based on the research agent's requirements (provided in Previous Agent Outputs). Original request: ${userMessage}`,
        dependsOn: ["research"],
      },
      {
        agentName: "frontend-dev",
        input: `Implement the React components defined in the architect's plan (provided in Previous Agent Outputs). Original request: ${userMessage}`,
        dependsOn: ["architect"],
      },
      {
        agentName: "styling",
        input: `Apply design polish to the components created by frontend-dev, using the research requirements for design intent (both provided in Previous Agent Outputs). Original request: ${userMessage}`,
        dependsOn: ["frontend-dev"],
      },
      {
        agentName: "qa",
        input: `Review and fix all code generated by frontend-dev and styling agents (provided in Previous Agent Outputs). Original request: ${userMessage}`,
        dependsOn: ["styling"],
      },
      {
        agentName: "security",
        input: `Security review all code generated by the dev agents (provided in Previous Agent Outputs). Original request: ${userMessage}`,
        dependsOn: ["qa"],
      },
    ],
  };
}

// Agents whose output may contain file code blocks
const FILE_PRODUCING_AGENTS = new Set<string>(["frontend-dev", "backend-dev", "styling", "qa", "security"]);

/**
 * Extract files from agent text output. Agents primarily use:
 *   <tool_call>{"name":"write_file","parameters":{"path":"...","content":"..."}}</tool_call>
 * Fallback patterns for markdown-style output also supported.
 */
function extractFilesFromOutput(agentOutput: string): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];
  const seen = new Set<string>();

  function addFile(filePath: string, content: string) {
    const normalized = filePath.replace(/^\.\//, "");
    if (normalized && content && !seen.has(normalized)) {
      seen.add(normalized);
      files.push({ path: normalized, content });
    }
  }

  // Primary pattern: <tool_call>{"name":"write_file","parameters":{"path":"...","content":"..."}}</tool_call>
  const toolCallRegex = /<tool_call>\s*\n?([\s\S]*?)\n?\s*<\/tool_call>/g;
  let match: RegExpExecArray | null;
  while ((match = toolCallRegex.exec(agentOutput)) !== null) {
    try {
      const json = JSON.parse(match[1]!.trim());
      if (json.name === "write_file" && json.parameters?.path && json.parameters?.content) {
        addFile(json.parameters.path, json.parameters.content);
      }
    } catch {
      // JSON parse might fail if content has nested tags; try to extract path/content manually
      const rawBlock = match[1]!;
      if (rawBlock.includes("write_file")) {
        const pathMatch = rawBlock.match(/"path"\s*:\s*"([^"]+)"/);
        const contentMatch = rawBlock.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
        if (pathMatch?.[1] && contentMatch?.[1]) {
          try {
            const content = JSON.parse('"' + contentMatch[1] + '"');
            addFile(pathMatch[1], content);
          } catch {
            // skip unparseable
          }
        }
      }
    }
  }

  // Fallback: ```lang\n// filepath\n...code...\n```
  const codeBlockRegex = /```[\w]*\n\/\/\s*((?:src\/|\.\/)?[\w./-]+\.\w+)\n([\s\S]*?)```/g;
  while ((match = codeBlockRegex.exec(agentOutput)) !== null) {
    addFile(match[1]!, match[2]!.trimEnd());
  }

  // Fallback: ### filepath (or **filepath**) followed by ```...```
  const headingBlockRegex = /(?:###\s+|[*]{2}|`)(\S+\.(?:tsx?|jsx?|css|html|json|md))(?:[*]{2}|`)?[\s\S]*?```[\w]*\n([\s\S]*?)```/g;
  while ((match = headingBlockRegex.exec(agentOutput)) !== null) {
    addFile(match[1]!, match[2]!.trimEnd());
  }

  return files;
}

function extractAndWriteFiles(
  agentName: string,
  agentOutput: string,
  projectPath: string,
  projectId: string
): string[] {
  if (!FILE_PRODUCING_AGENTS.has(agentName)) return [];

  const files = extractFilesFromOutput(agentOutput);
  if (files.length === 0) return [];

  const written: string[] = [];
  for (const file of files) {
    try {
      writeFile(projectPath, file.path, file.content);
      written.push(file.path);
    } catch (err) {
      console.error(`[orchestrator] Failed to write ${file.path}:`, err);
    }
  }

  if (written.length > 0) {
    broadcastFilesChanged(projectId, written);
  }

  return written;
}
