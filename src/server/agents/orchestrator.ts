import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { AgentName, AgentExecution } from "../../shared/types.ts";
import type { ProviderInstance } from "../providers/registry.ts";
import { getAgentConfig, AGENT_ROSTER } from "./registry.ts";
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

        // Save agent response as message
        await db.insert(schema.messages).values({
          id: nanoid(),
          chatId,
          role: "assistant",
          content: result.content,
          agentName: step.agentName,
          metadata: null,
          createdAt: Date.now(),
        });

        broadcast({
          type: "chat_message",
          payload: {
            chatId,
            agentName: step.agentName,
            content: result.content,
          },
        });

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

  broadcastAgentStatus("orchestrator", "completed");
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
