import { generateText } from "ai";
import { join } from "path";
import { db, schema } from "../db/index.ts";
import { eq, inArray, and, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { AgentName, IntentClassification, OrchestratorIntent, IntentScope } from "../../shared/types.ts";
import type { ProviderInstance } from "../providers/registry.ts";
import { getAgentConfigResolved, getAgentTools } from "./registry.ts";
import { runAgent, type AgentInput, type AgentOutput } from "./base.ts";
import { trackTokenUsage } from "../services/token-tracker.ts";
import { checkCostLimit, getMaxAgentCalls, checkDailyCostLimit, checkProjectCostLimit } from "../services/cost-limiter.ts";
import { broadcastAgentStatus, broadcastAgentError, broadcastTokenUsage, broadcastFilesChanged, broadcastAgentThinking, broadcastTestResults, broadcastTestResultIncremental } from "../ws.ts";
import { broadcast } from "../ws.ts";
import { existsSync, writeFileSync, readdirSync } from "fs";
import { writeFile, listFiles, readFile } from "../tools/file-ops.ts";
import { prepareProjectForPreview, invalidateProjectDeps } from "../preview/vite-server.ts";
import { createAgentTools } from "./tools.ts";

const MAX_RETRIES = 3;

/** Resolve a provider model instance from a config, respecting the configured provider. */
function resolveProviderModel(config: { provider: string; model: string }, providers: ProviderInstance) {
  switch (config.provider) {
    case "anthropic": return providers.anthropic?.(config.model);
    case "openai": return providers.openai?.(config.model);
    case "google": return providers.google?.(config.model);
    default: return null;
  }
}

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

/**
 * Mark all "running" and "retrying" agent executions as "failed" on server startup.
 * This handles the case where the server was restarted mid-pipeline — those executions
 * will never complete because in-memory state (abortControllers) was lost.
 * Also inserts a system message into each affected chat so the user knows what happened.
 */
export async function cleanupStaleExecutions(): Promise<number> {
  const staleStatuses = ["running", "retrying"];
  const now = Date.now();

  // Find all stale executions
  const stale = await db
    .select({ id: schema.agentExecutions.id, chatId: schema.agentExecutions.chatId })
    .from(schema.agentExecutions)
    .where(inArray(schema.agentExecutions.status, staleStatuses))
    .all();

  if (stale.length === 0) return 0;

  // Mark them all as failed
  await db
    .update(schema.agentExecutions)
    .set({
      status: "failed",
      error: "Server restarted — pipeline interrupted",
      completedAt: now,
    })
    .where(inArray(schema.agentExecutions.status, staleStatuses));

  // Insert a system message into each affected chat (deduplicated)
  const affectedChats = [...new Set(stale.map((s) => s.chatId))];
  for (const chatId of affectedChats) {
    await db.insert(schema.messages).values({
      id: nanoid(),
      chatId,
      role: "system",
      content: "Pipeline was interrupted by a server restart. You can retry your last message.",
      agentName: "orchestrator",
      metadata: null,
      createdAt: now,
    });
  }

  // Also mark any running pipeline_runs as interrupted
  await db
    .update(schema.pipelineRuns)
    .set({
      status: "interrupted",
      completedAt: now,
    })
    .where(eq(schema.pipelineRuns.status, "running"));

  console.log(`[orchestrator] Cleaned up ${stale.length} stale executions across ${affectedChats.length} chats`);
  return stale.length;
}

export interface OrchestratorInput {
  chatId: string;
  projectId: string;
  projectPath: string;
  userMessage: string;
  providers: ProviderInstance;
  apiKeys: Record<string, string>;
}

export interface ExecutionPlan {
  steps: Array<{
    agentName: AgentName;
    input: string;
    dependsOn?: string[];
    instanceId?: string;
  }>;
}

// Shared mutable counter — passed by reference so all call sites share the same count
interface CallCounter { value: number; }

interface PipelineStepContext {
  step: { agentName: AgentName; input: string; instanceId?: string };
  chatId: string;
  projectId: string;
  projectPath: string;
  projectName: string;
  chatTitle: string;
  userMessage: string;
  chatHistory: Array<{ role: string; content: string }>;
  agentResults: Map<string, string>;
  completedAgents: string[];
  callCounter: CallCounter;
  providers: ProviderInstance;
  apiKeys: Record<string, string>;
  signal: AbortSignal;
}

/**
 * Execute a single pipeline step with retries, token tracking, file extraction,
 * and build checks. Returns the agent's output content, or null on failure/abort.
 */
async function runPipelineStep(ctx: PipelineStepContext): Promise<string | null> {
  const { step, chatId, projectId, projectPath, projectName, chatTitle,
    userMessage, chatHistory, agentResults, completedAgents, callCounter,
    providers, apiKeys, signal } = ctx;

  // Use instanceId for keying/broadcasting, base agentName for config lookup
  const stepKey = step.instanceId ?? step.agentName;

  if (signal.aborted) return null;

  // Hard cap — prevent runaway costs
  const maxCalls = getMaxAgentCalls();
  if (callCounter.value >= maxCalls) {
    broadcastAgentError(chatId, "orchestrator", `Agent call limit reached (${maxCalls}). Stopping to prevent runaway costs.`);
    return null;
  }
  callCounter.value++;

  const config = getAgentConfigResolved(step.agentName);
  if (!config) {
    broadcastAgentError(chatId, "orchestrator", `Unknown agent: ${step.agentName}`);
    return null;
  }

  const executionId = nanoid();
  await db.insert(schema.agentExecutions).values({
    id: executionId,
    chatId,
    agentName: stepKey,
    status: "running",
    input: JSON.stringify({ message: step.input }),
    output: null,
    error: null,
    retryCount: 0,
    startedAt: Date.now(),
    completedAt: null,
  });

  let result: AgentOutput | null = null;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
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

      // Create native tools based on agent's tool config
      const enabledToolNames = getAgentTools(step.agentName);
      let agentTools: ReturnType<typeof createAgentTools> | undefined;
      if (enabledToolNames.length > 0) {
        agentTools = createAgentTools(projectPath, projectId);
      }
      const toolSubset = agentTools
        ? Object.fromEntries(
            enabledToolNames
              .filter((t) => t in agentTools!.tools)
              .map((t) => [t, agentTools!.tools[t as keyof typeof agentTools.tools]])
          )
        : undefined;

      result = await runAgent(config, providers, agentInput, toolSubset, signal, chatId, step.instanceId);

      if (result.tokenUsage) {
        const providerKey = apiKeys[config.provider];
        if (providerKey) {
          const record = trackTokenUsage({
            executionId, chatId,
            agentName: stepKey,
            provider: config.provider,
            model: config.model,
            apiKey: providerKey,
            inputTokens: result.tokenUsage.inputTokens,
            outputTokens: result.tokenUsage.outputTokens,
            projectId, projectName, chatTitle,
          });
          broadcastTokenUsage({
            chatId,
            agentName: stepKey,
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

      agentResults.set(stepKey, result.content);
      completedAgents.push(stepKey);

      // Hybrid file tracking: native tools write files mid-stream,
      // fallback extraction catches models that don't use tools properly
      const nativeFiles = result.filesWritten || [];
      const alreadyWritten = new Set(nativeFiles);
      const fallbackFiles = extractAndWriteFiles(step.agentName, result.content, projectPath, projectId, alreadyWritten);
      if (fallbackFiles.length > 0) {
        console.warn(`[orchestrator] ${step.agentName} used text fallback for ${fallbackFiles.length} files`);
      }
      const filesWritten = [...nativeFiles, ...fallbackFiles];

      if (filesWritten.length > 0 && agentHasFileTools(step.agentName) && !signal.aborted) {
        // All file-producing agents get build check
        const buildErrors = await checkProjectBuild(projectPath);
        if (buildErrors && !signal.aborted) {
          const fixResult = await runBuildFix({
            buildErrors, chatId, projectId, projectPath, projectName, chatTitle,
            userMessage, chatHistory, agentResults, callCounter, providers, apiKeys, signal,
          });
          if (fixResult) {
            agentResults.set(`${stepKey}-build-fix`, fixResult);
            completedAgents.push(`${stepKey} (build fix)`);
          }
          const recheckErrors = await checkProjectBuild(projectPath);
          if (!recheckErrors) {
            broadcast({ type: "preview_ready", payload: { projectId } });
          }
        } else {
          broadcast({ type: "preview_ready", payload: { projectId } });
        }

        // After dev agents (not testing itself), run tests if test files exist
        if (step.agentName !== "testing" && !signal.aborted) {
          const hasTestFiles = testFilesExist(projectPath);
          if (hasTestFiles) {
            const testResult = await runProjectTests(projectPath, chatId, projectId);
            if (testResult && testResult.failed > 0 && !signal.aborted) {
              // Route test failures to dev agent for one fix attempt
              const testFixResult = await runBuildFix({
                buildErrors: `Test failures:\n${testResult.failures.map((f) => `- ${f.name}: ${f.error}`).join("\n")}`,
                chatId, projectId, projectPath, projectName, chatTitle,
                userMessage, chatHistory, agentResults, callCounter, providers, apiKeys, signal,
              });
              if (testFixResult) {
                agentResults.set(`${stepKey}-test-fix`, testFixResult);
                completedAgents.push(`${stepKey} (test fix)`);
              }
              // Re-run tests once after fix
              if (!signal.aborted) {
                await runProjectTests(projectPath, chatId, projectId);
              }
            }
          }
        }
      }

      break;
    } catch (err) {
      if (signal.aborted) break;
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        await db.update(schema.agentExecutions)
          .set({ status: "retrying", retryCount: attempt + 1 })
          .where(eq(schema.agentExecutions.id, executionId));
        broadcastAgentStatus(chatId, stepKey, "retrying", { attempt: attempt + 1 });
      }
    }
  }

  if (signal.aborted) return null;

  if (!result) {
    const errorMsg = lastError?.message || "Unknown error";
    await db.update(schema.agentExecutions)
      .set({ status: "failed", error: errorMsg, completedAt: Date.now() })
      .where(eq(schema.agentExecutions.id, executionId));
    broadcastAgentError(chatId, stepKey, errorMsg);
    broadcastAgentError(chatId, "orchestrator", `Pipeline halted: ${stepKey} failed after ${MAX_RETRIES} retries`);
    await db.insert(schema.messages).values({
      id: nanoid(), chatId, role: "system",
      content: `Agent ${stepKey} failed: ${errorMsg}`,
      agentName: stepKey, metadata: null, createdAt: Date.now(),
    });
    return null;
  }

  return result.content;
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
    broadcastAgentError(chatId, "orchestrator", `Token limit reached (${costCheck.currentTokens}/${costCheck.limit}). Please increase your limit to continue.`);
    return;
  }

  if (costCheck.warning) {
    broadcastAgentStatus(chatId, "orchestrator", "warning", {
      message: `Token usage at ${Math.round(costCheck.percentUsed * 100)}% of limit`,
    });
  }

  // Check daily cost limit
  const dailyCheck = checkDailyCostLimit();
  if (!dailyCheck.allowed) {
    abortControllers.delete(chatId);
    broadcastAgentError(chatId, "orchestrator", `Daily cost limit reached ($${dailyCheck.currentCost.toFixed(2)}/$${dailyCheck.limit.toFixed(2)}). Adjust your daily limit in Settings to continue.`);
    return;
  }

  // Check per-project cost limit
  const projectCheck = checkProjectCostLimit(projectId);
  if (!projectCheck.allowed) {
    abortControllers.delete(chatId);
    broadcastAgentError(chatId, "orchestrator", `Project cost limit reached ($${projectCheck.currentCost.toFixed(2)}/$${projectCheck.limit.toFixed(2)}). Adjust your project limit in Settings to continue.`);
    return;
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

  broadcastAgentStatus(chatId, "orchestrator", "running");

  // Collect agent outputs internally — only the final summary is shown to user
  const agentResults = new Map<string, string>();
  const completedAgents: string[] = [];
  const callCounter: CallCounter = { value: 0 };

  // --- Intent classification ---
  const hasFiles = projectHasFiles(projectPath);
  const classification = await classifyIntent(userMessage, hasFiles, providers);
  console.log(`[orchestrator] Intent: ${classification.intent} (scope: ${classification.scope}) — ${classification.reasoning}`);

  // --- Question mode: direct answer, no pipeline ---
  if (classification.intent === "question") {
    broadcast({
      type: "pipeline_plan",
      payload: { chatId, agents: [] },
    });

    const answer = await handleQuestion({
      chatId, projectId, projectPath, projectName, chatTitle,
      userMessage, chatHistory, providers, apiKeys,
    });

    await db.insert(schema.messages).values({
      id: nanoid(), chatId, role: "assistant",
      content: answer,
      agentName: "orchestrator", metadata: null, createdAt: Date.now(),
    });

    broadcast({
      type: "chat_message",
      payload: { chatId, agentName: "orchestrator", content: answer },
    });

    broadcastAgentStatus(chatId, "orchestrator", "completed");
    abortControllers.delete(chatId);
    return;
  }

  // --- Fix mode: skip research/architect, inject project source ---
  if (classification.intent === "fix") {
    const projectSource = readProjectSource(projectPath);
    if (projectSource) {
      agentResults.set("project-source", projectSource);
    }

    const plan = buildExecutionPlan(userMessage, undefined, "fix", classification.scope);

    // Persist pipeline run
    const pipelineRunId = nanoid();
    await db.insert(schema.pipelineRuns).values({
      id: pipelineRunId,
      chatId,
      intent: "fix",
      scope: classification.scope,
      userMessage,
      plannedAgents: JSON.stringify(plan.steps.map((s) => s.agentName)),
      status: "running",
      startedAt: Date.now(),
      completedAt: null,
    });

    // Broadcast pipeline plan so client knows which agents to display
    broadcast({
      type: "pipeline_plan",
      payload: { chatId, agents: plan.steps.map((s) => s.agentName) },
    });

    // Execute fix pipeline
    const pipelineOk = await executePipelineSteps({
      plan, chatId, projectId, projectPath, projectName, chatTitle,
      userMessage, chatHistory, agentResults, completedAgents, callCounter,
      providers, apiKeys, signal,
    });
    if (!pipelineOk) {
      const postCheck = checkCostLimit(chatId);
      const pipelineStatus = !postCheck.allowed ? "interrupted" : "failed";
      await db.update(schema.pipelineRuns).set({ status: pipelineStatus, completedAt: Date.now() }).where(eq(schema.pipelineRuns.id, pipelineRunId));
      abortControllers.delete(chatId);
      return;
    }

    // Remediation + final build + summary (shared with build mode)
    await finishPipeline({
      chatId, projectId, projectPath, projectName, chatTitle,
      userMessage, chatHistory, agentResults, completedAgents, callCounter,
      providers, apiKeys, signal,
    });

    await db.update(schema.pipelineRuns).set({ status: "completed", completedAt: Date.now() }).where(eq(schema.pipelineRuns.id, pipelineRunId));
    abortControllers.delete(chatId);
    return;
  }

  // --- Build mode: full pipeline (research → architect → parallel dev → styling → review) ---

  // Phase 1: Run research agent standalone
  const researchResult = await runPipelineStep({
    step: {
      agentName: "research",
      input: `Analyze this request and produce structured requirements: ${userMessage}`,
    },
    chatId, projectId, projectPath, projectName, chatTitle,
    userMessage, chatHistory, agentResults, completedAgents, callCounter,
    providers, apiKeys, signal,
  });
  if (!researchResult || signal.aborted) {
    if (signal.aborted) {
      await db.insert(schema.messages).values({
        id: nanoid(), chatId, role: "system",
        content: `Pipeline stopped by user. Completed agents: ${completedAgents.join(", ") || "none"}.`,
        agentName: "orchestrator", metadata: null, createdAt: Date.now(),
      });
      broadcastAgentStatus(chatId, "orchestrator", "stopped");
    }
    abortControllers.delete(chatId);
    return;
  }

  // Phase 2: Run architect standalone (so we can parse its file_plan before building the rest of the pipeline)
  const researchOutput = agentResults.get("research") || "";
  const architectResult = await runPipelineStep({
    step: {
      agentName: "architect",
      input: `Design the component architecture and test plan based on the research agent's requirements (provided in Previous Agent Outputs). Original request: ${userMessage}`,
    },
    chatId, projectId, projectPath, projectName, chatTitle,
    userMessage, chatHistory, agentResults, completedAgents, callCounter,
    providers, apiKeys, signal,
  });
  if (!architectResult || signal.aborted) {
    if (signal.aborted) {
      await db.insert(schema.messages).values({
        id: nanoid(), chatId, role: "system",
        content: `Pipeline stopped by user. Completed agents: ${completedAgents.join(", ") || "none"}.`,
        agentName: "orchestrator", metadata: null, createdAt: Date.now(),
      });
      broadcastAgentStatus(chatId, "orchestrator", "stopped");
    }
    abortControllers.delete(chatId);
    return;
  }

  // Phase 3: Parse architect output and build parallel dev steps (or fall back to single frontend-dev)
  const architectOutput = agentResults.get("architect") || "";
  const groupedPlan = parseArchitectFilePlan(architectOutput);

  const includeBackend = classification.scope === "frontend" || classification.scope === "styling"
    ? false
    : researchOutput ? needsBackend(researchOutput) : false;

  let plan: ExecutionPlan;
  if (groupedPlan && (groupedPlan.components.length + groupedPlan.shared.length + groupedPlan.app.length) > 0) {
    // Parallel dev pipeline
    const devSteps = buildParallelDevSteps(groupedPlan, architectOutput, userMessage);
    const lastDevId = devSteps[devSteps.length - 1]?.instanceId ?? "frontend-dev";

    const postDevSteps: ExecutionPlan["steps"] = [];

    if (includeBackend) {
      postDevSteps.push({
        agentName: "backend-dev",
        input: `Implement the backend API routes and server logic defined in the architect's plan (provided in Previous Agent Outputs). A test plan is included in the architect's output — write test files alongside your server code following the plan. Original request: ${userMessage}`,
        dependsOn: [lastDevId],
      });
    }

    const stylingDeps = includeBackend ? [lastDevId, "backend-dev"] : [lastDevId];
    postDevSteps.push(
      {
        agentName: "styling",
        input: `Apply design polish to the components created by frontend-dev, using the research requirements for design intent (both provided in Previous Agent Outputs). Original request: ${userMessage}`,
        dependsOn: stylingDeps,
      },
      {
        agentName: "code-review",
        input: `Review and fix all code generated by dev and styling agents (provided in Previous Agent Outputs). Original request: ${userMessage}`,
        dependsOn: ["styling"],
      },
      {
        agentName: "security",
        input: `Security review all code generated by the dev agents (provided in Previous Agent Outputs). Original request: ${userMessage}`,
        dependsOn: ["styling"],
      },
      {
        agentName: "qa",
        input: `Validate the implementation against the research requirements (both provided in Previous Agent Outputs). Original request: ${userMessage}`,
        dependsOn: ["styling"],
      },
    );

    plan = { steps: [...devSteps, ...postDevSteps] };
    console.log(`[orchestrator] Parallel dev pipeline: ${devSteps.length} frontend-dev instances (${groupedPlan.components.length} component files)`);
  } else {
    // Fallback: single frontend-dev (current behavior)
    console.log(`[orchestrator] Using single frontend-dev (architect file_plan not parseable or empty)`);
    plan = buildExecutionPlan(userMessage, researchOutput, "build", classification.scope);
    // Remove architect step since it already ran
    plan.steps = plan.steps.filter((s) => s.agentName !== "architect");
    // Rewrite deps that pointed to "architect" to point to nothing (already completed)
    for (const step of plan.steps) {
      if (step.dependsOn) {
        step.dependsOn = step.dependsOn.filter((d) => d !== "architect");
      }
    }
  }

  // Persist pipeline run
  const pipelineRunId = nanoid();
  const allStepIds = plan.steps.map((s) => s.instanceId ?? s.agentName);
  await db.insert(schema.pipelineRuns).values({
    id: pipelineRunId,
    chatId,
    intent: "build",
    scope: classification.scope,
    userMessage,
    plannedAgents: JSON.stringify(["research", "architect", ...allStepIds]),
    status: "running",
    startedAt: Date.now(),
    completedAt: null,
  });

  broadcast({
    type: "pipeline_plan",
    payload: { chatId, agents: ["research", "architect", ...allStepIds] },
  });

  // Execute build pipeline (research + architect already completed)
  const pipelineOk = await executePipelineSteps({
    plan, chatId, projectId, projectPath, projectName, chatTitle,
    userMessage, chatHistory, agentResults, completedAgents, callCounter,
    providers, apiKeys, signal,
  });
  if (!pipelineOk) {
    const postCheck = checkCostLimit(chatId);
    const pipelineStatus = !postCheck.allowed ? "interrupted" : "failed";
    await db.update(schema.pipelineRuns).set({ status: pipelineStatus, completedAt: Date.now() }).where(eq(schema.pipelineRuns.id, pipelineRunId));
    abortControllers.delete(chatId);
    return;
  }

  // Remediation + final build + summary
  await finishPipeline({
    chatId, projectId, projectPath, projectName, chatTitle,
    userMessage, chatHistory, agentResults, completedAgents, callCounter,
    providers, apiKeys, signal,
  });

  await db.update(schema.pipelineRuns).set({ status: "completed", completedAt: Date.now() }).where(eq(schema.pipelineRuns.id, pipelineRunId));
  abortControllers.delete(chatId);
}

/**
 * Resume a previously interrupted pipeline from the last completed step.
 * Reconstructs agentResults from DB, filters the execution plan to skip
 * completed agents, then continues from where it left off.
 */
export async function resumeOrchestration(input: OrchestratorInput & { pipelineRunId: string }): Promise<void> {
  const { chatId, projectId, projectPath, userMessage, providers, apiKeys, pipelineRunId } = input;

  // Load the pipeline run
  const pipelineRun = await db.select().from(schema.pipelineRuns).where(eq(schema.pipelineRuns.id, pipelineRunId)).get();
  if (!pipelineRun) {
    broadcastAgentError(chatId, "orchestrator", "Pipeline run not found — starting fresh.");
    return runOrchestration(input);
  }

  const controller = new AbortController();
  abortControllers.set(chatId, controller);
  const { signal } = controller;

  // Check cost limits — if still over limit after resume, abort with clear message
  const costCheck = checkCostLimit(chatId);
  if (!costCheck.allowed) {
    abortControllers.delete(chatId);
    broadcast({
      type: "agent_error",
      payload: {
        chatId,
        agentName: "orchestrator",
        error: `Token limit still exceeded (${costCheck.currentTokens}/${costCheck.limit}). Increase your limit in Settings before resuming.`,
        errorType: "cost_limit",
      },
    });
    return;
  }

  // Load project name and chat title
  const projectRow = await db.select({ name: schema.projects.name }).from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  const chatRow = await db.select({ title: schema.chats.title }).from(schema.chats).where(eq(schema.chats.id, chatId)).get();
  const projectName = projectRow?.name || "Unknown";
  const chatTitle = chatRow?.title || "Unknown";

  // Load chat history
  const chatMessages = await db.select().from(schema.messages).where(eq(schema.messages.chatId, chatId)).all();
  const chatHistory = chatMessages.map((m) => ({ role: m.role, content: m.content }));

  // Reconstruct agentResults from completed executions
  const agentResults = new Map<string, string>();
  const completedAgents: string[] = [];
  const callCounter: CallCounter = { value: 0 };

  const completedExecs = await db.select()
    .from(schema.agentExecutions)
    .where(and(eq(schema.agentExecutions.chatId, chatId), eq(schema.agentExecutions.status, "completed")))
    .all();

  for (const exec of completedExecs) {
    if (exec.output) {
      try {
        const parsed = JSON.parse(exec.output);
        if (parsed.content) {
          agentResults.set(exec.agentName, parsed.content);
          completedAgents.push(exec.agentName);
        }
      } catch {
        // skip unparseable
      }
    }
  }

  const intent = pipelineRun.intent as OrchestratorIntent;
  const scope = pipelineRun.scope as IntentScope;
  const originalMessage = pipelineRun.userMessage;

  broadcastAgentStatus(chatId, "orchestrator", "running");

  // Mark pipeline as running again
  await db.update(schema.pipelineRuns).set({ status: "running" }).where(eq(schema.pipelineRuns.id, pipelineRunId));

  // For fix mode, inject project source if not already in results
  if (intent === "fix" && !agentResults.has("project-source")) {
    const projectSource = readProjectSource(projectPath);
    if (projectSource) agentResults.set("project-source", projectSource);
  }

  // Rebuild execution plan
  const researchOutput = agentResults.get("research") || "";

  // For build mode, if research hasn't completed, we can't resume — start fresh
  if (intent === "build" && !agentResults.has("research")) {
    console.log("[orchestrator] Research not completed — cannot resume, starting fresh");
    await db.update(schema.pipelineRuns).set({ status: "failed", completedAt: Date.now() }).where(eq(schema.pipelineRuns.id, pipelineRunId));
    abortControllers.delete(chatId);
    return runOrchestration(input);
  }

  let plan: ExecutionPlan;
  if (intent === "fix") {
    plan = buildExecutionPlan(originalMessage, undefined, "fix", scope);
  } else {
    // Build mode: try parallel dev if architect completed
    const architectOutput = agentResults.get("architect") || "";
    const groupedPlan = architectOutput ? parseArchitectFilePlan(architectOutput) : null;
    const includeBackend = scope === "frontend" || scope === "styling"
      ? false : researchOutput ? needsBackend(researchOutput) : false;

    if (groupedPlan && (groupedPlan.components.length + groupedPlan.shared.length + groupedPlan.app.length) > 0) {
      const devSteps = buildParallelDevSteps(groupedPlan, architectOutput, originalMessage);
      const lastDevId = devSteps[devSteps.length - 1]?.instanceId ?? "frontend-dev";
      const postDevSteps: ExecutionPlan["steps"] = [];
      if (includeBackend) {
        postDevSteps.push({
          agentName: "backend-dev",
          input: `Implement the backend API routes and server logic defined in the architect's plan. Original request: ${originalMessage}`,
          dependsOn: [lastDevId],
        });
      }
      const stylingDeps = includeBackend ? [lastDevId, "backend-dev"] : [lastDevId];
      postDevSteps.push(
        { agentName: "styling", input: `Apply design polish. Original request: ${originalMessage}`, dependsOn: stylingDeps },
        { agentName: "code-review", input: `Review all code. Original request: ${originalMessage}`, dependsOn: ["styling"] },
        { agentName: "security", input: `Security review. Original request: ${originalMessage}`, dependsOn: ["styling"] },
        { agentName: "qa", input: `Validate implementation. Original request: ${originalMessage}`, dependsOn: ["styling"] },
      );
      plan = { steps: [...devSteps, ...postDevSteps] };
    } else {
      plan = buildExecutionPlan(originalMessage, researchOutput, "build", scope);
      // Remove architect step since it already ran
      plan.steps = plan.steps.filter((s) => s.agentName !== "architect");
      for (const step of plan.steps) {
        if (step.dependsOn) step.dependsOn = step.dependsOn.filter((d) => d !== "architect");
      }
    }
  }

  // Filter plan to only remaining steps (using instanceId for matching)
  const completedAgentNames = new Set(completedAgents);
  const remainingSteps = plan.steps.filter((s) => !completedAgentNames.has(s.instanceId ?? s.agentName));

  if (remainingSteps.length === 0) {
    // All agents completed — just run finish pipeline
    console.log("[orchestrator] All agents already completed — running finish pipeline");
  } else {
    // Broadcast pipeline plan showing all agents (completed + remaining)
    const allStepIds = plan.steps.map((s) => s.instanceId ?? s.agentName);
    const allAgentNames = intent === "build"
      ? ["research", "architect", ...allStepIds]
      : allStepIds;
    broadcast({ type: "pipeline_plan", payload: { chatId, agents: allAgentNames } });

    // Broadcast completed status for already-done agents
    for (const name of completedAgents) {
      broadcastAgentStatus(chatId, name, "completed");
    }

    // Execute remaining steps
    const remainingPlan: ExecutionPlan = { steps: remainingSteps };
    const pipelineOk = await executePipelineSteps({
      plan: remainingPlan, chatId, projectId, projectPath, projectName, chatTitle,
      userMessage: originalMessage, chatHistory, agentResults, completedAgents, callCounter,
      providers, apiKeys, signal,
    });
    if (!pipelineOk) {
      await db.update(schema.pipelineRuns).set({ status: "failed", completedAt: Date.now() }).where(eq(schema.pipelineRuns.id, pipelineRunId));
      abortControllers.delete(chatId);
      return;
    }
  }

  // Remediation + final build + summary
  await finishPipeline({
    chatId, projectId, projectPath, projectName, chatTitle,
    userMessage: originalMessage, chatHistory, agentResults, completedAgents, callCounter,
    providers, apiKeys, signal,
  });

  await db.update(schema.pipelineRuns).set({ status: "completed", completedAt: Date.now() }).where(eq(schema.pipelineRuns.id, pipelineRunId));
  abortControllers.delete(chatId);
}

/**
 * Find the most recent interrupted pipeline run for a chat.
 * Returns the pipeline run ID, or null if none found.
 */
export function findInterruptedPipelineRun(chatId: string): string | null {
  const row = db.select({ id: schema.pipelineRuns.id })
    .from(schema.pipelineRuns)
    .where(and(eq(schema.pipelineRuns.chatId, chatId), eq(schema.pipelineRuns.status, "interrupted")))
    .orderBy(desc(schema.pipelineRuns.startedAt))
    .get();
  return row?.id || null;
}

/**
 * Execute pipeline steps with dependency-aware parallelism.
 * Steps whose `dependsOn` are all in the completed set run concurrently as a batch.
 * Halts on first failure. Checks cost limit after each batch.
 */
async function executePipelineSteps(ctx: {
  plan: ExecutionPlan;
  chatId: string;
  projectId: string;
  projectPath: string;
  projectName: string;
  chatTitle: string;
  userMessage: string;
  chatHistory: Array<{ role: string; content: string }>;
  agentResults: Map<string, string>;
  completedAgents: string[];
  callCounter: CallCounter;
  providers: ProviderInstance;
  apiKeys: Record<string, string>;
  signal: AbortSignal;
}): Promise<boolean> {
  const { plan, chatId, projectId, projectPath, projectName, chatTitle,
    userMessage, chatHistory, agentResults, completedAgents, callCounter,
    providers, apiKeys, signal } = ctx;

  const completedSet = new Set<string>(
    agentResults.keys()
  );
  const remaining = [...plan.steps];

  while (remaining.length > 0) {
    if (signal.aborted) {
      await db.insert(schema.messages).values({
        id: nanoid(), chatId, role: "system",
        content: `Pipeline stopped by user. Completed agents: ${completedAgents.join(", ") || "none"}.`,
        agentName: "orchestrator", metadata: null, createdAt: Date.now(),
      });
      broadcastAgentStatus(chatId, "orchestrator", "stopped");
      return false;
    }

    // Find steps whose dependencies are all satisfied
    const ready: typeof remaining = [];
    const notReady: typeof remaining = [];
    for (const step of remaining) {
      const deps = step.dependsOn || [];
      if (deps.every((d) => completedSet.has(d))) {
        ready.push(step);
      } else {
        notReady.push(step);
      }
    }

    if (ready.length === 0) {
      // Deadlock — remaining steps have unmet deps that will never resolve
      broadcastAgentError(chatId, "orchestrator", `Pipeline deadlock: ${remaining.map((s) => s.instanceId ?? s.agentName).join(", ")} have unmet dependencies`);
      return false;
    }

    // Run all ready steps concurrently
    const results = await Promise.all(
      ready.map((step) =>
        runPipelineStep({
          step, chatId, projectId, projectPath, projectName, chatTitle,
          userMessage, chatHistory, agentResults, completedAgents, callCounter,
          providers, apiKeys, signal,
        }).then((result) => ({ stepKey: step.instanceId ?? step.agentName, result }))
      )
    );

    if (signal.aborted) {
      await db.insert(schema.messages).values({
        id: nanoid(), chatId, role: "system",
        content: `Pipeline stopped by user. Completed agents: ${completedAgents.join(", ") || "none"}.`,
        agentName: "orchestrator", metadata: null, createdAt: Date.now(),
      });
      broadcastAgentStatus(chatId, "orchestrator", "stopped");
      return false;
    }

    // Check for failures
    const failed = results.find((r) => !r.result);
    if (failed) {
      return false; // HALT — runPipelineStep already handled error broadcasting
    }

    // Mark completed
    for (const r of results) {
      completedSet.add(r.stepKey);
    }

    // Cost check after each batch
    const midCheck = checkCostLimit(chatId);
    if (!midCheck.allowed) {
      broadcastAgentStatus(chatId, "orchestrator", "paused");
      broadcast({
        type: "agent_error",
        payload: {
          chatId,
          agentName: "orchestrator",
          error: `Token limit reached mid-pipeline. Completed through batch: ${ready.map((s) => s.instanceId ?? s.agentName).join(", ")}.`,
          errorType: "cost_limit",
        },
      });
      return false;
    }

    // Continue with remaining steps
    remaining.length = 0;
    remaining.push(...notReady);
  }

  return true;
}

/**
 * Shared pipeline finish: remediation loop, final build check, summary generation.
 * Used by both build and fix modes.
 */
async function finishPipeline(ctx: {
  chatId: string;
  projectId: string;
  projectPath: string;
  projectName: string;
  chatTitle: string;
  userMessage: string;
  chatHistory: Array<{ role: string; content: string }>;
  agentResults: Map<string, string>;
  completedAgents: string[];
  callCounter: CallCounter;
  providers: ProviderInstance;
  apiKeys: Record<string, string>;
  signal: AbortSignal;
}): Promise<void> {
  const { chatId, projectId, projectPath, projectName, chatTitle,
    userMessage, chatHistory, agentResults, completedAgents, callCounter,
    providers, apiKeys, signal } = ctx;

  // Remediation loop
  if (!signal.aborted) {
    await runRemediationLoop({
      chatId, projectId, projectPath, projectName, chatTitle,
      userMessage, chatHistory, agentResults, completedAgents, callCounter,
      providers, apiKeys, signal,
    });
  }

  // Final build check
  if (!signal.aborted) {
    const finalBuildErrors = await checkProjectBuild(projectPath);
    if (finalBuildErrors && !signal.aborted) {
      const fixResult = await runBuildFix({
        buildErrors: finalBuildErrors, chatId, projectId, projectPath, projectName, chatTitle,
        userMessage, chatHistory, agentResults, callCounter, providers, apiKeys, signal,
      });
      if (fixResult) {
        agentResults.set("final-build-fix", fixResult);
        completedAgents.push("frontend-dev (final build fix)");
      }
      const finalRecheck = await checkProjectBuild(projectPath);
      if (!finalRecheck) {
        broadcast({ type: "preview_ready", payload: { projectId } });
      }
    } else {
      broadcast({ type: "preview_ready", payload: { projectId } });
    }
  }

  // Generate summary
  const summary = await generateSummary({
    userMessage, agentResults, chatId, projectId, projectName, chatTitle, providers, apiKeys,
  });

  await db.insert(schema.messages).values({
    id: nanoid(), chatId, role: "assistant",
    content: summary,
    agentName: "orchestrator", metadata: null, createdAt: Date.now(),
  });

  broadcast({
    type: "chat_message",
    payload: { chatId, agentName: "orchestrator", content: summary },
  });

  broadcastAgentStatus(chatId, "orchestrator", "completed");
}

const QUESTION_SYSTEM_PROMPT = `You are a helpful assistant for a page builder app. The user is asking a question about their project.
Answer their question based on the project source code provided. Be concise and helpful.
If the project has no files yet, let the user know and suggest they describe what they'd like to build.`;

/**
 * Handle a "question" intent by answering directly with the orchestrator model.
 * No agent pipeline — just one Opus call with project context.
 */
async function handleQuestion(ctx: {
  chatId: string;
  projectId: string;
  projectPath: string;
  projectName: string;
  chatTitle: string;
  userMessage: string;
  chatHistory: Array<{ role: string; content: string }>;
  providers: ProviderInstance;
  apiKeys: Record<string, string>;
}): Promise<string> {
  const { chatId, projectId, projectPath, projectName, chatTitle,
    userMessage, chatHistory, providers, apiKeys } = ctx;

  const orchestratorConfig = getAgentConfigResolved("orchestrator");
  if (!orchestratorConfig) return "I couldn't process your question. Please try again.";

  const model = resolveProviderModel(orchestratorConfig, providers);
  if (!model) return "No model available to answer questions. Please check your API keys.";

  const projectSource = readProjectSource(projectPath);
  const prompt = projectSource
    ? `## Project Source\n${projectSource}\n\n## Question\n${userMessage}`
    : `## Question\n${userMessage}\n\n(This project has no files yet.)`;

  try {
    const result = await generateText({
      model,
      system: QUESTION_SYSTEM_PROMPT,
      prompt,
    });

    // Track token usage
    if (result.usage) {
      const providerKey = apiKeys[orchestratorConfig.provider];
      if (providerKey) {
        const execId = nanoid();
        db.insert(schema.agentExecutions).values({
          id: execId, chatId,
          agentName: "orchestrator",
          status: "completed",
          input: JSON.stringify({ type: "question", userMessage }),
          output: JSON.stringify({ answer: result.text }),
          error: null, retryCount: 0,
          startedAt: Date.now(), completedAt: Date.now(),
        }).run();

        const record = trackTokenUsage({
          executionId: execId, chatId,
          agentName: "orchestrator",
          provider: orchestratorConfig.provider,
          model: orchestratorConfig.model,
          apiKey: providerKey,
          inputTokens: result.usage.inputTokens || 0,
          outputTokens: result.usage.outputTokens || 0,
          projectId, projectName, chatTitle,
        });

        broadcastTokenUsage({
          chatId, agentName: "orchestrator",
          provider: orchestratorConfig.provider,
          model: orchestratorConfig.model,
          inputTokens: result.usage.inputTokens || 0,
          outputTokens: result.usage.outputTokens || 0,
          totalTokens: (result.usage.inputTokens || 0) + (result.usage.outputTokens || 0),
          costEstimate: record.costEstimate,
        });
      }
    }

    return result.text;
  } catch (err) {
    console.error("[orchestrator] Question handling failed:", err);
    return "I encountered an error processing your question. Please try again.";
  }
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

  const orchestratorConfig = getAgentConfigResolved("orchestrator");
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
  const model = resolveProviderModel(orchestratorConfig, providers);
  if (!model) {
    // Fallback if no provider available
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

export interface ReviewFindings {
  hasIssues: boolean;
  codeReviewFindings: string | null;
  qaFindings: string | null;
  securityFindings: string | null;
  routingHints: {
    frontendIssues: boolean;
    backendIssues: boolean;
    stylingIssues: boolean;
  };
}

export function detectIssues(agentResults: Map<string, string>): ReviewFindings {
  const codeReviewOutput = agentResults.get("code-review") || "";
  const qaOutput = agentResults.get("qa") || "";
  const securityOutput = agentResults.get("security") || "";

  // All three review agents are report-only — check for pass signals.
  const codeReviewClean =
    codeReviewOutput.includes('"status": "pass"') ||
    codeReviewOutput.includes('"status":"pass"') ||
    codeReviewOutput.includes("Code Review: Pass") ||
    codeReviewOutput.trim() === "";

  const qaClean =
    qaOutput.includes('"status": "pass"') ||
    qaOutput.includes('"status":"pass"') ||
    qaOutput.includes("QA Review: Pass") ||
    qaOutput.trim() === "";

  const securityClean =
    securityOutput.includes('"status": "pass"') ||
    securityOutput.includes('"status":"pass"') ||
    securityOutput.includes("Passed with no issues") ||
    securityOutput.includes("zero security vulnerabilities") ||
    securityOutput.includes("safe for production") ||
    securityOutput.trim() === "";

  // Parse routing hints from code-review and QA findings
  const allFindings = codeReviewOutput + "\n" + qaOutput;
  const routingHints = {
    frontendIssues: /\[frontend\]/i.test(allFindings),
    backendIssues: /\[backend\]/i.test(allFindings),
    stylingIssues: /\[styling\]/i.test(allFindings),
  };

  return {
    hasIssues: !codeReviewClean || !qaClean || !securityClean,
    codeReviewFindings: codeReviewClean ? null : codeReviewOutput,
    qaFindings: qaClean ? null : qaOutput,
    securityFindings: securityClean ? null : securityOutput,
    routingHints,
  };
}

/**
 * Determine which dev agents should fix the identified issues.
 * Routes based on [frontend]/[backend]/[styling] tags from code-review and QA findings.
 * Defaults to frontend-dev when no clear routing (backward compatible).
 */
export function determineFixAgents(findings: ReviewFindings): AgentName[] {
  const agents: AgentName[] = [];
  const { routingHints } = findings;

  if (routingHints.frontendIssues) agents.push("frontend-dev");
  if (routingHints.backendIssues) agents.push("backend-dev");
  if (routingHints.stylingIssues) agents.push("styling");

  // Default to frontend-dev if no clear routing
  if (agents.length === 0) agents.push("frontend-dev");

  return agents;
}

/**
 * Determine which agent should fix build errors based on error content.
 * Routes to backend-dev if errors reference server files, otherwise frontend-dev.
 */
export function determineBuildFixAgent(buildErrors: string): AgentName {
  if (/server\/|api\/|backend\/|\.server\.|routes\//i.test(buildErrors)) {
    return "backend-dev";
  }
  return "frontend-dev";
}

// --- Remediation loop helpers ---

interface RemediationContext {
  chatId: string;
  projectId: string;
  projectPath: string;
  projectName: string;
  chatTitle: string;
  userMessage: string;
  chatHistory: Array<{ role: string; content: string }>;
  agentResults: Map<string, string>;
  completedAgents: string[];
  callCounter: CallCounter;
  providers: ProviderInstance;
  apiKeys: Record<string, string>;
  signal: AbortSignal;
}

const MAX_REMEDIATION_CYCLES = 2;

/**
 * Iterative remediation loop: detects code-review/QA/security issues,
 * routes fixes to the correct dev agent(s) based on finding categories,
 * then re-runs code-review, security, and QA to verify. Repeats up to
 * MAX_REMEDIATION_CYCLES times or until all issues are resolved.
 */
async function runRemediationLoop(ctx: RemediationContext): Promise<void> {
  let previousIssueCount = Infinity;

  for (let cycle = 0; cycle < MAX_REMEDIATION_CYCLES; cycle++) {
    if (ctx.signal.aborted) return;

    // 1. Check for issues in current code-review/QA/security output
    const findings = detectIssues(ctx.agentResults);
    if (!findings.hasIssues) return; // All clean — exit loop

    // Count current issues — break if not improving (prevents ping-pong loops)
    const currentIssueCount =
      (findings.codeReviewFindings ? 1 : 0) +
      (findings.qaFindings ? 1 : 0) +
      (findings.securityFindings ? 1 : 0);
    if (currentIssueCount >= previousIssueCount) {
      console.log(`[orchestrator] Remediation not improving (${currentIssueCount} >= ${previousIssueCount}). Breaking loop.`);
      return;
    }
    previousIssueCount = currentIssueCount;

    // 2. Check cost limit before each cycle
    const costCheck = checkCostLimit(ctx.chatId);
    if (!costCheck.allowed) return;

    const cycleLabel = cycle + 1;

    // 3. Determine which agent(s) should fix the findings
    const fixAgents = determineFixAgents(findings);

    // 4. Run each fix agent
    for (const fixAgentName of fixAgents) {
      if (ctx.signal.aborted) return;

      const fixResult = await runFixAgent(fixAgentName, cycleLabel, findings, ctx);
      if (!fixResult) return; // Fix agent failed — can't continue
    }

    if (ctx.signal.aborted) return;

    // 5. Re-run code-review, security, and QA in parallel on updated code
    const reviewResults = await Promise.all([
      runReviewAgent("code-review", cycleLabel, ctx),
      runReviewAgent("security", cycleLabel, ctx),
      runReviewAgent("qa", cycleLabel, ctx),
    ]);
    if (reviewResults.some((r) => !r) || ctx.signal.aborted) return;

    // Loop continues — detectIssues() at top checks the fresh output
  }
}

/**
 * Run a dev agent to fix remediation findings.
 * Returns the agent's output content, or null on failure.
 */
async function runFixAgent(
  agentName: AgentName,
  cycle: number,
  findings: ReviewFindings,
  ctx: RemediationContext,
): Promise<string | null> {
  const maxCallsRem = getMaxAgentCalls();
  if (ctx.callCounter.value >= maxCallsRem) {
    broadcastAgentError(ctx.chatId, "orchestrator", `Agent call limit reached (${maxCallsRem}). Stopping remediation.`);
    return null;
  }
  ctx.callCounter.value++;

  const config = getAgentConfigResolved(agentName);
  if (!config) return null;

  const displayConfig = {
    ...config,
    displayName: `${config.displayName} (remediation${cycle > 1 ? ` #${cycle}` : ""})`,
  };

  broadcastAgentStatus(ctx.chatId, agentName, "running", { phase: "remediation", cycle });

  const executionId = nanoid();
  await db.insert(schema.agentExecutions).values({
    id: executionId,
    chatId: ctx.chatId,
    agentName,
    status: "running",
    input: JSON.stringify({ phase: "remediation", cycle }),
    output: null,
    error: null,
    retryCount: 0,
    startedAt: Date.now(),
    completedAt: null,
  });

  const parts: string[] = [];
  parts.push(`Fix the following issues found during review of: ${ctx.userMessage}`);
  if (findings.codeReviewFindings) parts.push(`\n## Code Review Findings\n${findings.codeReviewFindings}`);
  if (findings.qaFindings) parts.push(`\n## QA Findings\n${findings.qaFindings}`);
  if (findings.securityFindings) parts.push(`\n## Security Findings\n${findings.securityFindings}`);
  parts.push(`\nReview the original code in Previous Agent Outputs and output corrected versions of any files with issues.`);
  parts.push(`\nIMPORTANT: Only reference and modify files that exist in Previous Agent Outputs. Do not create new files unless necessary to fix the issue.`);

  try {
    const agentInput: AgentInput = {
      userMessage: parts.join("\n"),
      chatHistory: ctx.chatHistory,
      projectPath: ctx.projectPath,
      context: {
        projectId: ctx.projectId,
        originalRequest: ctx.userMessage,
        upstreamOutputs: Object.fromEntries(ctx.agentResults),
        phase: "remediation",
        cycle,
      },
    };

    const remediationTools = createAgentTools(ctx.projectPath, ctx.projectId);
    const result = await runAgent(displayConfig, ctx.providers, agentInput, remediationTools.tools, ctx.signal, ctx.chatId);

    if (result.tokenUsage) {
      const providerKey = ctx.apiKeys[config.provider];
      if (providerKey) {
        const record = trackTokenUsage({
          executionId,
          chatId: ctx.chatId,
          agentName,
          provider: config.provider,
          model: config.model,
          apiKey: providerKey,
          inputTokens: result.tokenUsage.inputTokens,
          outputTokens: result.tokenUsage.outputTokens,
          projectId: ctx.projectId,
          projectName: ctx.projectName,
          chatTitle: ctx.chatTitle,
        });
        broadcastTokenUsage({
          chatId: ctx.chatId,
          agentName,
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

    ctx.agentResults.set(`${agentName}-remediation`, result.content);
    ctx.completedAgents.push(`${agentName} (remediation #${cycle})`);

    // Extract and write remediated files (hybrid: native + fallback)
    const nativeRemediation = result.filesWritten || [];
    extractAndWriteFiles(agentName, result.content, ctx.projectPath, ctx.projectId, new Set(nativeRemediation));

    return result.content;
  } catch (err) {
    if (!ctx.signal.aborted) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await db.update(schema.agentExecutions)
        .set({ status: "failed", error: errorMsg, completedAt: Date.now() })
        .where(eq(schema.agentExecutions.id, executionId));
      broadcastAgentError(ctx.chatId, agentName, `Remediation failed: ${errorMsg}`);
    }
    return null;
  }
}

/**
 * Re-run a review agent (code-review, QA, or Security) on updated code after remediation.
 * Overwrites the agent's entry in agentResults so detectIssues() checks fresh output.
 */
async function runReviewAgent(
  agentName: "code-review" | "qa" | "security",
  cycle: number,
  ctx: RemediationContext,
): Promise<string | null> {
  const maxCallsReview = getMaxAgentCalls();
  if (ctx.callCounter.value >= maxCallsReview) {
    broadcastAgentError(ctx.chatId, "orchestrator", `Agent call limit reached (${maxCallsReview}). Stopping re-review.`);
    return null;
  }
  ctx.callCounter.value++;

  const config = getAgentConfigResolved(agentName);
  if (!config) return null;

  const costCheck = checkCostLimit(ctx.chatId);
  if (!costCheck.allowed) return null;

  const displayConfig = { ...config, displayName: `${config.displayName} (re-review #${cycle})` };

  broadcastAgentStatus(ctx.chatId, agentName, "running", { phase: "re-review", cycle });

  const executionId = nanoid();
  await db.insert(schema.agentExecutions).values({
    id: executionId,
    chatId: ctx.chatId,
    agentName,
    status: "running",
    input: JSON.stringify({ phase: "re-review", cycle }),
    output: null,
    error: null,
    retryCount: 0,
    startedAt: Date.now(),
    completedAt: null,
  });

  const reviewPrompts: Record<string, string> = {
    "code-review": `Re-review all code after remediation cycle #${cycle}. Dev agents have attempted to fix the issues you previously identified. Check if the fixes are correct and report any remaining issues. Original request: ${ctx.userMessage}`,
    qa: `Re-validate the implementation after remediation cycle #${cycle}. Dev agents have attempted to fix the issues you previously identified. Check if requirements are now met and report any remaining gaps. Original request: ${ctx.userMessage}`,
    security: `Re-scan all code after remediation cycle #${cycle}. Dev agents have attempted to fix the security issues you previously identified. Check if the fixes are correct and scan for any new vulnerabilities. Original request: ${ctx.userMessage}`,
  };

  try {
    const agentInput: AgentInput = {
      userMessage: reviewPrompts[agentName]!,
      chatHistory: ctx.chatHistory,
      projectPath: ctx.projectPath,
      context: {
        projectId: ctx.projectId,
        originalRequest: ctx.userMessage,
        upstreamOutputs: Object.fromEntries(ctx.agentResults),
        phase: "re-review",
        cycle,
      },
    };

    const result = await runAgent(displayConfig, ctx.providers, agentInput, undefined, ctx.signal, ctx.chatId);

    if (result.tokenUsage) {
      const providerKey = ctx.apiKeys[config.provider];
      if (providerKey) {
        const record = trackTokenUsage({
          executionId,
          chatId: ctx.chatId,
          agentName,
          provider: config.provider,
          model: config.model,
          apiKey: providerKey,
          inputTokens: result.tokenUsage.inputTokens,
          outputTokens: result.tokenUsage.outputTokens,
          projectId: ctx.projectId,
          projectName: ctx.projectName,
          chatTitle: ctx.chatTitle,
        });
        broadcastTokenUsage({
          chatId: ctx.chatId,
          agentName,
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

    // Overwrite the agent's entry so detectIssues() checks fresh output next cycle
    ctx.agentResults.set(agentName, result.content);
    ctx.completedAgents.push(`${agentName} (re-review #${cycle})`);

    return result.content;
  } catch (err) {
    if (!ctx.signal.aborted) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await db.update(schema.agentExecutions)
        .set({ status: "failed", error: errorMsg, completedAt: Date.now() })
        .where(eq(schema.agentExecutions.id, executionId));
      broadcastAgentError(ctx.chatId, agentName, `Re-review failed: ${errorMsg}`);
    }
    return null;
  }
}

/**
 * Check if the research output indicates backend requirements.
 * Parses JSON for `requires_backend: true` features, falls back to regex heuristic.
 */
export function needsBackend(researchOutput: string): boolean {
  try {
    const parsed = JSON.parse(researchOutput);
    if (parsed.features && Array.isArray(parsed.features)) {
      return parsed.features.some((f: { requires_backend?: boolean }) => f.requires_backend === true);
    }
  } catch {
    // JSON parse failed — fall back to heuristic
  }
  // Regex heuristic: look for backend-related keywords (avoid broad terms like "backend" or "endpoint" that cause false positives)
  return /requires_backend['":\s]+true|api\s*route|server[\s-]*side|database|express/i.test(researchOutput);
}

// --- Intent classification ---

const INTENT_SYSTEM_PROMPT = `You classify user messages for a page builder app.
Respond with ONLY a JSON object: {"intent":"build"|"fix"|"question","scope":"frontend"|"backend"|"styling"|"full","reasoning":"<one sentence>"}

Rules:
- "build": New feature, new page, new project, or adding something that doesn't exist yet
- "fix": Changing, fixing, or updating something that already exists in the project
- "question": Asking about the project, how something works, or a non-code request
- scope "frontend": UI components, React, layout, HTML
- scope "backend": API routes, server logic, database
- scope "styling": CSS, colors, fonts, spacing, visual polish
- scope "full": Multiple areas or unclear`;

/**
 * Classify the user's intent using the orchestrator model.
 * Fast-path: if no existing files, always returns "build" (skip API call).
 * Fallback: any error returns "build" (safe default).
 */
export async function classifyIntent(
  userMessage: string,
  hasExistingFiles: boolean,
  providers: ProviderInstance
): Promise<IntentClassification> {
  // Fast path: empty project → always build
  if (!hasExistingFiles) {
    return { intent: "build", scope: "full", reasoning: "New project with no existing files" };
  }

  const orchestratorConfig = getAgentConfigResolved("orchestrator");
  if (!orchestratorConfig) {
    return { intent: "build", scope: "full", reasoning: "Fallback: no orchestrator config" };
  }

  const model = resolveProviderModel(orchestratorConfig, providers);
  if (!model) {
    return { intent: "build", scope: "full", reasoning: "Fallback: no model available" };
  }

  try {
    const result = await generateText({
      model,
      system: INTENT_SYSTEM_PROMPT,
      prompt: userMessage,
      maxOutputTokens: 100,
    });

    const parsed = JSON.parse(result.text.trim());
    const intent: OrchestratorIntent = ["build", "fix", "question"].includes(parsed.intent) ? parsed.intent : "build";
    const scope: IntentScope = ["frontend", "backend", "styling", "full"].includes(parsed.scope) ? parsed.scope : "full";

    return { intent, scope, reasoning: parsed.reasoning || "" };
  } catch (err) {
    console.error("[orchestrator] Intent classification failed, defaulting to build:", err);
    return { intent: "build", scope: "full", reasoning: "Fallback: classification error" };
  }
}

const READ_EXCLUDE_PATTERNS = /node_modules|dist|\.git|bun\.lockb|package-lock\.json|\.png|\.jpg|\.jpeg|\.gif|\.svg|\.ico|\.woff|\.ttf|\.eot/;
const MAX_SOURCE_SIZE = 100_000; // 100KB cap

/**
 * Read all source files from a project directory into a formatted string.
 * Excludes node_modules, dist, .git, lockfiles, and binary files.
 * Returns empty string if project has no readable files.
 */
export function readProjectSource(projectPath: string): string {
  const files = listFiles(projectPath);
  if (files.length === 0) return "";

  const parts: string[] = [];
  let totalSize = 0;

  function walkFiles(nodes: typeof files, prefix = "") {
    for (const node of nodes) {
      if (totalSize >= MAX_SOURCE_SIZE) return;
      if (READ_EXCLUDE_PATTERNS.test(node.path)) continue;

      if (node.type === "directory" && node.children) {
        walkFiles(node.children, node.path);
      } else if (node.type === "file") {
        try {
          const content = readFile(projectPath, node.path);
          if (totalSize + content.length > MAX_SOURCE_SIZE) return;
          parts.push(`### ${node.path}\n\`\`\`\n${content}\n\`\`\``);
          totalSize += content.length;
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  walkFiles(files);
  return parts.join("\n\n");
}

/**
 * Check whether a project has any existing source files.
 */
export function projectHasFiles(projectPath: string): boolean {
  const files = listFiles(projectPath);
  return files.length > 0;
}

// --- Parallel frontend-dev helpers ---

export interface FilePlanEntry {
  action: string;
  path: string;
  description?: string;
}

export interface GroupedFilePlan {
  shared: FilePlanEntry[];
  components: FilePlanEntry[];
  app: FilePlanEntry[];
}

/**
 * Parse the architect's file_plan from its output.
 * Extracts the JSON block, separates files into shared/components/app groups.
 * Returns null if parsing fails (caller should fall back to single frontend-dev).
 */
export function parseArchitectFilePlan(architectOutput: string): GroupedFilePlan | null {
  let parsed: { file_plan?: FilePlanEntry[] };
  try {
    parsed = JSON.parse(architectOutput);
  } catch {
    // Try extracting JSON from markdown code block
    const jsonMatch = architectOutput.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
    if (!jsonMatch) return null;
    try {
      parsed = JSON.parse(jsonMatch[1]!);
    } catch {
      return null;
    }
  }

  const filePlan = parsed?.file_plan;
  if (!Array.isArray(filePlan) || filePlan.length === 0) return null;

  const shared: FilePlanEntry[] = [];
  const components: FilePlanEntry[] = [];
  const app: FilePlanEntry[] = [];

  const SHARED_PATTERNS = /^src\/(hooks|utils|types|lib|helpers|constants|context)\//i;
  const APP_PATTERN = /^src\/App\.tsx$/i;

  for (const entry of filePlan) {
    if (!entry.path) continue;
    const path = entry.path.replace(/^\.\//, "");

    if (APP_PATTERN.test(path)) {
      app.push({ ...entry, path });
    } else if (SHARED_PATTERNS.test(path)) {
      shared.push({ ...entry, path });
    } else {
      components.push({ ...entry, path });
    }
  }

  return { shared, components, app };
}

/**
 * Build parallel frontend-dev steps from a parsed file plan.
 * Uses a parallelism heuristic based on component count.
 * Returns steps with instanceIds and proper dependency chains.
 */
export function buildParallelDevSteps(
  groupedPlan: GroupedFilePlan,
  architectOutput: string,
  userMessage: string,
): ExecutionPlan["steps"] {
  const steps: ExecutionPlan["steps"] = [];
  const componentDeps: string[] = [];

  // Step 1: Shared files (hooks, utils, types) — if any
  if (groupedPlan.shared.length > 0) {
    const fileList = groupedPlan.shared.map((f) => f.path).join(", ");
    steps.push({
      agentName: "frontend-dev",
      instanceId: "frontend-dev-shared",
      input: `Implement ONLY these shared utility/hook files from the architect's plan (provided in Previous Agent Outputs): ${fileList}. Do NOT create component files or App.tsx. Original request: ${userMessage}`,
      dependsOn: ["architect"],
    });
    componentDeps.push("frontend-dev-shared");
  }

  // Step 2: Component files — split into parallel batches
  const componentFiles = groupedPlan.components;
  const batchCount = componentFiles.length <= 4 ? 1
    : componentFiles.length <= 8 ? 2
    : componentFiles.length <= 14 ? 3
    : 4;

  if (componentFiles.length > 0) {
    const batches: FilePlanEntry[][] = Array.from({ length: batchCount }, () => []);
    for (let i = 0; i < componentFiles.length; i++) {
      batches[i % batchCount]!.push(componentFiles[i]!);
    }

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]!;
      if (batch.length === 0) continue;

      const instanceId = batchCount === 1 ? "frontend-dev-components" : `frontend-dev-${i + 1}`;
      const fileList = batch.map((f) => f.path).join(", ");
      const deps: string[] = ["architect"];
      if (groupedPlan.shared.length > 0) deps.push("frontend-dev-shared");

      steps.push({
        agentName: "frontend-dev",
        instanceId,
        input: `Implement ONLY these component files from the architect's plan (provided in Previous Agent Outputs): ${fileList}. Do NOT create App.tsx or shared utility files. Each component should export its default component and any needed types. Original request: ${userMessage}`,
        dependsOn: deps,
      });
      componentDeps.push(instanceId);
    }
  }

  // Step 3: App.tsx — depends on ALL above
  const allPriorIds = steps.map((s) => s.instanceId!);
  if (allPriorIds.length === 0) allPriorIds.push("architect");

  steps.push({
    agentName: "frontend-dev",
    instanceId: "frontend-dev-app",
    input: `Implement ONLY src/App.tsx: import and compose all components created by other dev agents (their files are listed in Previous Agent Outputs). Wire up routing if needed. Original request: ${userMessage}`,
    dependsOn: allPriorIds,
  });

  return steps;
}

export function buildExecutionPlan(
  userMessage: string,
  researchOutput?: string,
  intent: OrchestratorIntent = "build",
  scope: IntentScope = "full"
): ExecutionPlan {
  // --- Fix mode: TDD — testing first, then dev agents ---
  if (intent === "fix") {
    const steps: ExecutionPlan["steps"] = [];

    // Testing comes first: create a test plan for the fix
    steps.push({
      agentName: "testing",
      input: `Create a test plan that defines the expected behavior for the fix: ${userMessage}. The existing code is in Previous Agent Outputs as "project-source". Output a JSON test plan — dev agents will write the actual test files.`,
    });

    // Route to dev agent(s) based on scope
    if (scope === "frontend" || scope === "full") {
      steps.push({
        agentName: "frontend-dev",
        input: `Fix the following issue in the existing code (provided in Previous Agent Outputs as "project-source"). A test plan has been created — write or update test files following the plan. Original request: ${userMessage}`,
        dependsOn: ["testing"],
      });
    }
    if (scope === "backend" || scope === "full") {
      const backendDeps: AgentName[] = scope === "full" ? ["frontend-dev"] : ["testing"];
      steps.push({
        agentName: "backend-dev",
        input: `Fix the following issue in the existing code (provided in Previous Agent Outputs as "project-source"). A test plan has been created — write or update test files following the plan. Original request: ${userMessage}`,
        dependsOn: backendDeps,
      });
    }
    if (scope === "styling") {
      steps.push({
        agentName: "styling",
        input: `Fix the following styling issue in the existing code (provided in Previous Agent Outputs as "project-source"). A test plan has been created — write or update test files following the plan. Original request: ${userMessage}`,
        dependsOn: ["testing"],
      });
    }

    // Always append reviewers — all depend on the last dev agent(s), run in parallel
    const lastDevAgent = steps[steps.length - 1]!.agentName;
    const reviewDeps = [lastDevAgent];

    steps.push(
      {
        agentName: "code-review",
        input: `Review all code changes made by dev agents (provided in Previous Agent Outputs). Original request: ${userMessage}`,
        dependsOn: reviewDeps,
      },
      {
        agentName: "security",
        input: `Security review all code changes (provided in Previous Agent Outputs). Original request: ${userMessage}`,
        dependsOn: reviewDeps,
      },
      {
        agentName: "qa",
        input: `Validate the fix against the original request (both provided in Previous Agent Outputs). Original request: ${userMessage}`,
        dependsOn: reviewDeps,
      },
    );

    return { steps };
  }

  // --- Build mode: architect (with test plan) → dev → styling → review ---
  const includeBackend = scope === "frontend" || scope === "styling"
    ? false  // Classifier said frontend/styling-only — skip backend
    : researchOutput ? needsBackend(researchOutput) : false;

  const steps: ExecutionPlan["steps"] = [
    {
      agentName: "architect",
      input: `Design the component architecture and test plan based on the research agent's requirements (provided in Previous Agent Outputs). Original request: ${userMessage}`,
      dependsOn: ["research"],
    },
    {
      agentName: "frontend-dev",
      input: `Implement the React components defined in the architect's plan (provided in Previous Agent Outputs). A test plan is included in the architect's output — write test files alongside your components following the plan. Original request: ${userMessage}`,
      dependsOn: ["architect"],
    },
  ];

  if (includeBackend) {
    steps.push({
      agentName: "backend-dev",
      input: `Implement the backend API routes and server logic defined in the architect's plan (provided in Previous Agent Outputs). A test plan is included in the architect's output — write test files alongside your server code following the plan. Original request: ${userMessage}`,
      dependsOn: ["frontend-dev"],
    });
  }

  // Styling depends on all dev agents (waits for both if backend included)
  const stylingDeps: AgentName[] = includeBackend ? ["frontend-dev", "backend-dev"] : ["frontend-dev"];

  steps.push(
    {
      agentName: "styling",
      input: `Apply design polish to the components created by frontend-dev, using the research requirements for design intent (both provided in Previous Agent Outputs). Original request: ${userMessage}`,
      dependsOn: stylingDeps,
    },
    // Review agents all depend on styling — they run in parallel with each other
    {
      agentName: "code-review",
      input: `Review and fix all code generated by dev and styling agents (provided in Previous Agent Outputs). Original request: ${userMessage}`,
      dependsOn: ["styling"],
    },
    {
      agentName: "security",
      input: `Security review all code generated by the dev agents (provided in Previous Agent Outputs). Original request: ${userMessage}`,
      dependsOn: ["styling"],
    },
    {
      agentName: "qa",
      input: `Validate the implementation against the research requirements (both provided in Previous Agent Outputs). Original request: ${userMessage}`,
      dependsOn: ["styling"],
    },
  );

  return { steps };
}

/** Check whether an agent has the write_file tool enabled. */
export function agentHasFileTools(name: string): boolean {
  const tools = getAgentTools(name as import("../../shared/types.ts").AgentName);
  return tools.includes("write_file");
}

/** Check if the project has any test files on disk (.test.tsx/.test.ts in src/) */
function testFilesExist(projectPath: string): boolean {
  const fullPath = projectPath.startsWith("/") || projectPath.includes(":\\")
    ? projectPath
    : join(process.cwd(), projectPath);
  const srcTestDir = join(fullPath, "src", "__tests__");
  if (existsSync(srcTestDir)) return true;
  const srcDir = join(fullPath, "src");
  if (!existsSync(srcDir)) return false;
  try {
    const files = readdirSync(srcDir);
    return files.some((f) => /\.test\.(tsx?|jsx?)$/.test(f));
  } catch {
    return false;
  }
}

/**
 * Sanitize a file path from agent output.
 * Strips leading/trailing quotes, backticks, whitespace, and normalizes separators.
 */
export function sanitizeFilePath(raw: string): string {
  return raw
    .trim()
    .replace(/^['"` ]+|['"` ]+$/g, "") // strip leading/trailing quotes, backticks, spaces
    .replace(/^\.\//, "")               // strip ./
    .replace(/\\/g, "/");               // normalize Windows paths
}

/**
 * Extract files from agent text output. Agents primarily use:
 *   <tool_call>{"name":"write_file","parameters":{"path":"...","content":"..."}}</tool_call>
 * Fallback patterns for markdown-style output also supported.
 */
export function extractFilesFromOutput(agentOutput: string): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];
  const seen = new Set<string>();

  function addFile(filePath: string, content: string) {
    const normalized = sanitizeFilePath(filePath);
    if (normalized && content && !seen.has(normalized)) {
      seen.add(normalized);
      const clean = content.replace(/\uFEFF/g, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      files.push({ path: normalized, content: clean });
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
      // JSON parse failed — try repairing the raw block before regex fallback
      const rawBlock = match[1]!;
      if (rawBlock.includes("write_file")) {
        // Repair step: fix common JSON encoding issues
        let repaired = false;
        try {
          const repairedJson = rawBlock
            .replace(/\uFEFF/g, "")           // strip BOM
            .replace(/(?<!\\)\n/g, "\\n")      // escape literal newlines
            .replace(/(?<!\\)\r/g, "\\r")      // escape literal CRs
            .replace(/(?<!\\)\t/g, "\\t");     // escape literal tabs
          const parsed = JSON.parse(repairedJson.trim());
          if (parsed.name === "write_file" && parsed.parameters?.path && parsed.parameters?.content) {
            console.warn(`[extractFiles] JSON repaired for ${parsed.parameters.path}`);
            addFile(parsed.parameters.path, parsed.parameters.content);
            repaired = true;
          }
        } catch {
          // Repair also failed — fall through to regex
        }

        if (!repaired) {
          // Regex fallback
          const pathMatch = rawBlock.match(/"path"\s*:\s*"([^"]+)"/);
          const contentMatch = rawBlock.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
          if (pathMatch?.[1] && contentMatch?.[1]) {
            try {
              const content = JSON.parse('"' + contentMatch[1] + '"');
              console.warn(`[extractFiles] Regex fallback used for ${pathMatch[1]} (${content.length} chars)`);
              addFile(pathMatch[1], content);
            } catch {
              console.warn(`[extractFiles] Failed to extract file from tool_call block`);
            }
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

// Track which orchestrations have already triggered preview prep
const previewPrepStarted = new Set<string>();

function extractAndWriteFiles(
  agentName: string,
  agentOutput: string,
  projectPath: string,
  projectId: string,
  alreadyWritten?: Set<string>
): string[] {
  if (!agentHasFileTools(agentName)) return [];

  const files = extractFilesFromOutput(agentOutput);
  if (files.length === 0) return [];

  const written: string[] = [];
  const hasPackageJson = files.some((f) => f.path === "package.json" || f.path.endsWith("/package.json"));

  for (const file of files) {
    // Skip files already written by native tools
    if (alreadyWritten?.has(file.path)) continue;
    try {
      writeFile(projectPath, file.path, file.content);
      written.push(file.path);
    } catch (err) {
      console.error(`[orchestrator] Failed to write ${file.path}:`, err);
    }
  }

  if (written.length > 0) {
    broadcastFilesChanged(projectId, written);

    // If the agent wrote a package.json, invalidate cached deps
    if (hasPackageJson) {
      invalidateProjectDeps(projectPath);
    }

    // After the first file-producing agent writes files, prepare project for preview
    // This runs in the background — doesn't block the pipeline
    // NOTE: preview_ready is NOT broadcast here — it's only sent after a successful build check
    if (!previewPrepStarted.has(projectId)) {
      previewPrepStarted.add(projectId);
      prepareProjectForPreview(projectPath)
        .then(() => {
          console.log(`[orchestrator] Project ${projectId} scaffolded for preview (waiting for build check)`);
        })
        .catch((err) => {
          console.error(`[orchestrator] Preview preparation failed:`, err);
        });
    }
  }

  return written;
}

/**
 * Run a Vite build check on the project to detect compile errors.
 * Returns error output string if there are errors, null if build succeeds.
 */
async function checkProjectBuild(projectPath: string): Promise<string | null> {
  const fullPath = projectPath.startsWith("/") || projectPath.includes(":\\")
    ? projectPath
    : join(process.cwd(), projectPath);

  // Wait for any pending preview prep (which includes bun install)
  await prepareProjectForPreview(projectPath);

  console.log(`[orchestrator] Running build check in ${fullPath}...`);

  try {
    const proc = Bun.spawn(["bunx", "vite", "build", "--mode", "development"], {
      cwd: fullPath,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "development" },
    });

    const exitCode = await proc.exited;
    if (exitCode === 0) {
      console.log(`[orchestrator] Build check passed`);
      return null;
    }

    const stderr = await new Response(proc.stderr).text();
    const stdout = await new Response(proc.stdout).text();
    const combined = (stderr + "\n" + stdout).trim();

    // Extract just the error lines, skip noise
    const errorLines = combined
      .split("\n")
      .filter((line) => /error|Error|ERR_|SyntaxError|TypeError|not found|does not provide/i.test(line))
      .join("\n");

    const errors = errorLines || combined.slice(0, 2000);
    console.log(`[orchestrator] Build check failed:\n${errors}`);
    return errors;
  } catch (err) {
    console.error(`[orchestrator] Build check process error:`, err);
    return null; // Don't block pipeline on check failure
  }
}

/**
 * Run a dev agent to fix build errors. Routes to backend-dev if errors
 * reference server files, otherwise defaults to frontend-dev.
 * Returns the agent's output content, or null on failure.
 */
async function runBuildFix(params: {
  buildErrors: string;
  chatId: string;
  projectId: string;
  projectPath: string;
  projectName: string;
  chatTitle: string;
  userMessage: string;
  chatHistory: Array<{ role: string; content: string }>;
  agentResults: Map<string, string>;
  callCounter: CallCounter;
  providers: ProviderInstance;
  apiKeys: Record<string, string>;
  signal: AbortSignal;
}): Promise<string | null> {
  const { buildErrors, chatId, projectId, projectPath, projectName, chatTitle,
    userMessage, chatHistory, agentResults, callCounter, providers, apiKeys, signal } = params;

  const maxCallsBuild = getMaxAgentCalls();
  if (callCounter.value >= maxCallsBuild) {
    broadcastAgentError(chatId, "orchestrator", `Agent call limit reached (${maxCallsBuild}). Skipping build fix.`);
    return null;
  }
  callCounter.value++;

  const costCheck = checkCostLimit(chatId);
  if (!costCheck.allowed) return null;

  const fixAgent = determineBuildFixAgent(buildErrors);
  const config = getAgentConfigResolved(fixAgent);
  if (!config) return null;

  broadcastAgentStatus(chatId, fixAgent, "running", { phase: "build-fix" });
  broadcastAgentThinking(chatId, fixAgent, config.displayName, "started");

  const execId = nanoid();
  await db.insert(schema.agentExecutions).values({
    id: execId,
    chatId,
    agentName: fixAgent,
    status: "running",
    input: JSON.stringify({ phase: "build-fix", errors: buildErrors }),
    output: null,
    error: null,
    retryCount: 0,
    startedAt: Date.now(),
    completedAt: null,
  });

  const fixPrompt = `The project has build errors that MUST be fixed before it can run. Here are the Vite build errors:\n\n\`\`\`\n${buildErrors}\n\`\`\`\n\nFix ALL the errors above. Output corrected versions of the files that need changes. The original code is in Previous Agent Outputs. Make sure all exports and imports match correctly.`;

  try {
    const fixInput: AgentInput = {
      userMessage: fixPrompt,
      chatHistory,
      projectPath,
      context: {
        projectId,
        originalRequest: userMessage,
        upstreamOutputs: Object.fromEntries(agentResults),
        phase: "build-fix",
      },
    };

    const fixTools = createAgentTools(projectPath, projectId);
    const result = await runAgent(config, providers, fixInput, fixTools.tools, signal, chatId);

    if (result.tokenUsage) {
      const providerKey = apiKeys[config.provider];
      if (providerKey) {
        const record = trackTokenUsage({
          executionId: execId,
          chatId,
          agentName: fixAgent,
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
          agentName: fixAgent,
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
      .where(eq(schema.agentExecutions.id, execId));

    const nativeFix = result.filesWritten || [];
    extractAndWriteFiles(fixAgent, result.content, projectPath, projectId, new Set(nativeFix));

    broadcastAgentStatus(chatId, fixAgent, "completed", { phase: "build-fix" });
    return result.content;
  } catch (err) {
    if (!signal.aborted) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await db.update(schema.agentExecutions)
        .set({ status: "failed", error: errorMsg, completedAt: Date.now() })
        .where(eq(schema.agentExecutions.id, execId));
      broadcastAgentError(chatId, fixAgent, `Build fix failed: ${errorMsg}`);
    }
    broadcastAgentStatus(chatId, fixAgent, "failed", { phase: "build-fix" });
    return null;
  }
}

export interface TestRunResult {
  passed: number;
  failed: number;
  total: number;
  duration: number;
  failures: Array<{ name: string; error: string }>;
  testDetails?: Array<{ suite: string; name: string; status: "passed" | "failed" | "skipped"; error?: string; duration?: number }>;
}

/**
 * Parse vitest JSON reporter output into structured test results.
 * Detects suite collection errors (status: "failed" with empty assertionResults)
 * which occur when corrupted source files prevent test collection.
 */
export function parseVitestOutput(stdout: string, stderr: string, exitCode: number): TestRunResult {
  try {
    const jsonOutput = JSON.parse(stdout);
    let passed = jsonOutput.numPassedTests ?? 0;
    let failed = jsonOutput.numFailedTests ?? 0;
    let total = jsonOutput.numTotalTests ?? (passed + failed);
    const duration = jsonOutput.startTime
      ? Date.now() - jsonOutput.startTime
      : 0;

    const failures: Array<{ name: string; error: string }> = [];
    const testDetails: TestRunResult["testDetails"] = [];

    if (jsonOutput.testResults) {
      for (const suite of jsonOutput.testResults) {
        const suiteName = suite.name || suite.testFilePath || "unknown suite";

        // Detect suite collection errors: suite failed but has no assertion results
        if (suite.status === "failed" && (!suite.assertionResults || suite.assertionResults.length === 0)) {
          const errorMsg = (suite.message || suite.failureMessage || "Suite failed to collect").slice(0, 500);
          failures.push({
            name: `[Collection Error] ${suiteName}`,
            error: errorMsg,
          });
          testDetails.push({
            suite: suiteName,
            name: "[Collection Error]",
            status: "failed",
            error: errorMsg,
          });
          failed++;
          total++;
          continue;
        }

        if (suite.assertionResults) {
          for (const test of suite.assertionResults) {
            const testName = test.fullName || test.title || "unknown test";
            const testStatus = test.status === "passed" ? "passed"
              : test.status === "failed" ? "failed"
              : "skipped";
            const testError = test.status === "failed"
              ? (test.failureMessages || []).join("\n").slice(0, 500)
              : undefined;

            testDetails.push({
              suite: suiteName,
              name: testName,
              status: testStatus,
              error: testError,
              duration: test.duration,
            });

            if (test.status === "failed") {
              failures.push({
                name: testName,
                error: testError || "",
              });
            }
          }
        }
      }
    }

    return { passed, failed, total, duration, failures, testDetails };
  } catch {
    // JSON parsing failed — create result from exit code
    if (exitCode === 0) {
      return { passed: 1, failed: 0, total: 1, duration: 0, failures: [] };
    } else {
      const errorSnippet = (stderr + "\n" + stdout).trim().slice(0, 500);
      return {
        passed: 0,
        failed: 1,
        total: 1,
        duration: 0,
        failures: [{ name: "Test suite", error: errorSnippet }],
      };
    }
  }
}

/**
 * Run vitest tests in the project directory.
 * Parses JSON output for structured results and broadcasts them via WebSocket.
 * Returns structured results, or null if tests couldn't be run.
 */
export async function runProjectTests(
  projectPath: string,
  chatId: string,
  projectId: string
): Promise<TestRunResult | null> {
  const fullPath = projectPath.startsWith("/") || projectPath.includes(":\\")
    ? projectPath
    : join(process.cwd(), projectPath);

  // Ensure vitest config + deps are installed (handled by prepareProjectForPreview)
  await prepareProjectForPreview(projectPath);

  console.log(`[orchestrator] Running tests in ${fullPath}...`);

  try {
    const jsonOutputFile = join(fullPath, "vitest-results.json");
    const proc = Bun.spawn(
      ["bunx", "vitest", "run", "--reporter=verbose", "--reporter=json", "--outputFile", jsonOutputFile],
      {
        cwd: fullPath,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, NODE_ENV: "test" },
      },
    );

    // Stream verbose output line-by-line for incremental results
    const verboseStdout = await new Response(proc.stdout).text();
    const lines = verboseStdout.split("\n");
    for (const line of lines) {
      // Vitest verbose format: " ✓ Suite > test name 3ms" or " × Suite > test name"
      const passMatch = line.match(/^\s*[✓✔]\s+(.+?)\s+>\s+(.+?)(?:\s+(\d+)ms)?$/);
      const failMatch = line.match(/^\s*[×✗]\s+(.+?)\s+>\s+(.+?)(?:\s+(\d+)ms)?$/);
      if (passMatch) {
        broadcastTestResultIncremental({
          chatId, projectId,
          suite: passMatch[1]!.trim(),
          name: passMatch[2]!.trim(),
          status: "passed",
          duration: passMatch[3] ? parseInt(passMatch[3]) : undefined,
        });
      } else if (failMatch) {
        broadcastTestResultIncremental({
          chatId, projectId,
          suite: failMatch[1]!.trim(),
          name: failMatch[2]!.trim(),
          status: "failed",
          duration: failMatch[3] ? parseInt(failMatch[3]) : undefined,
        });
      }
    }

    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    if (stderr.trim()) {
      console.log("[orchestrator] Test stderr:", stderr.trim().slice(0, 2000));
    }

    // Read JSON output from file (json reporter writes to outputFile)
    let jsonStdout = "";
    try {
      jsonStdout = await Bun.file(jsonOutputFile).text();
    } catch {
      // JSON file might not exist if vitest failed early — use verbose output
      jsonStdout = verboseStdout;
    }

    const result = parseVitestOutput(jsonStdout, stderr, exitCode);

    broadcastTestResults({
      chatId,
      projectId,
      ...result,
    });

    console.log(`[orchestrator] Tests: ${result.passed}/${result.total} passed, ${result.failed} failed`);
    return result;
  } catch (err) {
    console.error(`[orchestrator] Test runner error:`, err);
    return null;
  }
}
