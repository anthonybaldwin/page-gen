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
import { broadcastAgentStatus, broadcastAgentError } from "../ws.ts";
import { broadcast } from "../ws.ts";

const MAX_RETRIES = 3;

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

  // Check cost limits before starting
  const costCheck = checkCostLimit(chatId);
  if (!costCheck.allowed) {
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

  // Execute each step sequentially
  for (const step of plan.steps) {
    const config = getAgentConfig(step.agentName);
    if (!config) {
      broadcastAgentError("orchestrator", `Unknown agent: ${step.agentName}`);
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
      try {
        const agentInput: AgentInput = {
          userMessage: step.input,
          chatHistory,
          projectPath,
          context: { projectId, originalRequest: userMessage },
        };

        result = await runAgent(config, providers, agentInput);

        // Track token usage
        if (result.tokenUsage) {
          const providerKey = apiKeys[config.provider];
          if (providerKey) {
            trackTokenUsage({
              executionId,
              chatId,
              agentName: step.agentName,
              provider: config.provider,
              model: config.model,
              apiKey: providerKey,
              inputTokens: result.tokenUsage.inputTokens,
              outputTokens: result.tokenUsage.outputTokens,
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

        // Collect output internally — no per-agent message to user
        agentResults.set(step.agentName, result.content);

        break; // Success — exit retry loop
      } catch (err) {
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
      return;
    }
  }

  // Generate a single summary from all agent outputs
  const summary = await generateSummary({
    userMessage,
    agentResults,
    chatId,
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
}

const SUMMARY_SYSTEM_PROMPT = `You are the orchestrator for a page builder. Summarize what the team of agents just built for the user.
Write a clean, conversational markdown response. Include:
- What was built (brief overview)
- Key files created or modified
- Any issues found by QA or security review
- Suggested next steps
Keep it concise — 3-8 short paragraphs max. Use headings, bullet points, and code references where helpful.
Do NOT include raw JSON, tool calls, or internal agent data.`;

interface SummaryInput {
  userMessage: string;
  agentResults: Map<string, string>;
  chatId: string;
  providers: ProviderInstance;
  apiKeys: Record<string, string>;
}

async function generateSummary(input: SummaryInput): Promise<string> {
  const { userMessage, agentResults, chatId, providers, apiKeys } = input;

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

  broadcastAgentStatus("orchestrator", "running");

  const result = await generateText({
    model,
    system: SUMMARY_SYSTEM_PROMPT,
    prompt,
  });

  // Track token usage for the summary call
  if (result.usage) {
    const providerKey = apiKeys[orchestratorConfig.provider];
    if (providerKey) {
      trackTokenUsage({
        executionId: `summary-${chatId}-${Date.now()}`,
        chatId,
        agentName: "orchestrator",
        provider: orchestratorConfig.provider,
        model: orchestratorConfig.model,
        apiKey: providerKey,
        inputTokens: result.usage.inputTokens || 0,
        outputTokens: result.usage.outputTokens || 0,
      });
    }
  }

  return result.text;
}

function buildExecutionPlan(userMessage: string): ExecutionPlan {
  // Default plan for a page build request
  // In a real implementation, the orchestrator LLM would generate this plan
  return {
    steps: [
      {
        agentName: "research",
        input: `Analyze this request and produce structured requirements: ${userMessage}`,
      },
      {
        agentName: "architect",
        input: `Design the component architecture for: ${userMessage}`,
        dependsOn: ["research"],
      },
      {
        agentName: "frontend-dev",
        input: `Generate the React components and code for: ${userMessage}`,
        dependsOn: ["architect"],
      },
      {
        agentName: "styling",
        input: `Apply design polish and responsive styling for: ${userMessage}`,
        dependsOn: ["frontend-dev"],
      },
      {
        agentName: "qa",
        input: `Review all generated code for: ${userMessage}`,
        dependsOn: ["styling"],
      },
      {
        agentName: "security",
        input: `Security review all generated code for: ${userMessage}`,
        dependsOn: ["qa"],
      },
    ],
  };
}
