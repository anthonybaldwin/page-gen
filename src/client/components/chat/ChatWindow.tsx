import { useEffect, useRef, useState } from "react";
import { MessageList } from "./MessageList.tsx";
import { MessageInput } from "./MessageInput.tsx";
import { AgentThinkingMessage } from "./AgentThinkingMessage.tsx";
import { LimitsSettings } from "../billing/LimitsSettings.tsx";
import { useChatStore } from "../../stores/chatStore.ts";
import { useAgentThinkingStore, type ThinkingBlock } from "../../stores/agentThinkingStore.ts";
import { useUsageStore } from "../../stores/usageStore.ts";
import { api } from "../../lib/api.ts";
import { connectWebSocket, onWsMessage } from "../../lib/ws.ts";
import type { Message, TestDetail } from "../../../shared/types.ts";
import { nanoid } from "nanoid";

export function ChatWindow() {
  const { activeChat, messages, setMessages, addMessage, renameChat } = useChatStore();
  const { blocks, reset: resetThinking, stopAll, handleThinking, addTestResults, updateTestResults, toggleExpanded } = useAgentThinkingStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const [costLimitInterrupt, setCostLimitInterrupt] = useState(false);
  const [showLimitsInline, setShowLimitsInline] = useState(false);

  // Track whether we've created an incremental test results block
  const hasStreamingTestBlock = useRef(false);
  // Track whether the current run is a resume (don't wipe thinking blocks)
  const isResuming = useRef(false);

  useEffect(() => {
    if (!activeChat) return;
    setError(null);
    setThinking(false);
    setInterrupted(false);
    setCostLimitInterrupt(false);
    setShowLimitsInline(false);
    hasStreamingTestBlock.current = false;
    resetThinking();
    api
      .get<Message[]>(`/messages?chatId=${activeChat.id}`)
      .then(setMessages)
      .catch((err) => {
        console.error("[chat] Failed to load messages:", err);
        setError("Failed to load messages. Is the backend server running?");
      });

    // Check if orchestration is still running and restore thinking blocks
    api
      .get<{
        running: boolean;
        executions: Array<{ agentName: string; status: string; error?: string | null; output: string | null; startedAt: number }>;
        interruptedPipelineId?: string | null;
      }>(`/agents/status?chatId=${activeChat.id}`)
      .then(({ running, executions, interruptedPipelineId }) => {
        if (running) setThinking(true);
        // Reconstruct thinking blocks from execution history
        if (executions && executions.length > 0) {
          useAgentThinkingStore.getState().loadFromExecutions(executions);
          // Detect interrupted pipeline (server restart) — prefer DB pipeline_runs signal
          const wasInterrupted = interruptedPipelineId || (!running && executions.some(
            (e) => e.status === "failed" && e.error === "Server restarted — pipeline interrupted"
          ));
          if (wasInterrupted) setInterrupted(true);
        }
      })
      .catch(() => {});
  }, [activeChat, setMessages, resetThinking]);

  // Listen for agent messages and status updates via WebSocket
  useEffect(() => {
    connectWebSocket();

    const unsub = onWsMessage((msg) => {
      if (!activeChat) return;

      // Strict filter — only process messages for THIS chat
      const msgChatId = (msg.payload as { chatId?: string }).chatId;
      if (msgChatId !== activeChat.id) return;

      // Agent completed and produced a chat message
      if (msg.type === "chat_message") {
        const payload = msg.payload as { chatId: string; agentName: string; content: string };
        addMessage({
          id: nanoid(),
          chatId: payload.chatId,
          role: "assistant",
          content: payload.content,
          agentName: payload.agentName,
          metadata: null,
          createdAt: Date.now(),
        });
      }

      // Incremental test results (streaming one-by-one) — inline as thinking block
      if (msg.type === "test_result_incremental") {
        const payload = msg.payload as unknown as TestDetail;
        const store = useAgentThinkingStore.getState();
        const existingBlocks = store.blocks;
        const lastTestBlock = existingBlocks.findLast((b) => b.blockType === "test-results");

        if (!lastTestBlock || !lastTestBlock.testResults?.streaming) {
          // First incremental result — create a new test results block
          hasStreamingTestBlock.current = true;
          const details = [payload];
          const passed = details.filter((d) => d.status === "passed").length;
          const failed = details.filter((d) => d.status === "failed").length;
          addTestResults({
            passed,
            failed,
            total: details.length,
            duration: 0,
            failures: details.filter((d) => d.status === "failed").map((d) => ({ name: d.name, error: d.error || "" })),
            testDetails: details,
            streaming: true,
          });
        } else {
          // Subsequent results — update existing streaming block
          const prev = lastTestBlock.testResults!;
          const details = [...(prev.testDetails || []), payload];
          const passed = details.filter((d) => d.status === "passed").length;
          const failed = details.filter((d) => d.status === "failed").length;
          updateTestResults({
            passed,
            failed,
            total: details.length,
            duration: 0,
            failures: details.filter((d) => d.status === "failed").map((d) => ({ name: d.name, error: d.error || "" })),
            testDetails: details,
            streaming: true,
          });
        }
      }

      // Final test results — update the streaming block or create new
      if (msg.type === "test_results") {
        const payload = msg.payload as {
          passed: number; failed: number; total: number; duration: number;
          failures: Array<{ name: string; error: string }>;
          testDetails?: TestDetail[];
        };
        if (hasStreamingTestBlock.current) {
          updateTestResults({ ...payload, streaming: false });
          hasStreamingTestBlock.current = false;
        } else {
          addTestResults({ ...payload, streaming: false });
        }
      }

      // Orchestrator status changes
      if (msg.type === "agent_status") {
        const { agentName, status } = msg.payload as { agentName: string; status: string };
        if (agentName === "orchestrator") {
          if (status === "running") {
            if (isResuming.current) {
              // Resume — keep existing blocks, just clear the flag
              isResuming.current = false;
            } else {
              resetThinking();
            }
            hasStreamingTestBlock.current = false;
          }
          if (status === "completed" || status === "failed") {
            setThinking(false);
          }
          if (status === "stopped") {
            setThinking(false);
            stopAll();
          }
        }
      }

      // Pipeline interrupted — show interruption UI immediately (no refresh needed)
      if (msg.type === "pipeline_interrupted") {
        const payload = msg.payload as { reason?: string };
        setInterrupted(true);
        if (payload.reason === "cost_limit") {
          setCostLimitInterrupt(true);
        }
        setThinking(false);
      }

      // Agent error — stop thinking and show error
      if (msg.type === "agent_error") {
        const { agentName, error: errMsg, errorType } = msg.payload as { agentName: string; error: string; errorType?: string };
        if (agentName === "orchestrator") {
          setThinking(false);
          if (errorType === "cost_limit") {
            setCostLimitInterrupt(true);
            setInterrupted(true);
          } else {
            setError(errMsg);
          }
        }
      }

      // Agent thinking events
      if (msg.type === "agent_thinking") {
        handleThinking(
          msg.payload as {
            agentName: string;
            displayName: string;
            status: "started" | "streaming" | "completed" | "failed";
            chunk?: string;
            summary?: string;
            toolCall?: { toolName: string; input: Record<string, unknown> };
          }
        );
      }

      // Chat auto-title event
      if (msg.type === "chat_renamed") {
        const { chatId: renamedChatId, title } = msg.payload as { chatId: string; title: string };
        renameChat(renamedChatId, title);
      }

      // Token usage events
      if (msg.type === "token_usage") {
        const payload = msg.payload as {
          chatId: string;
          agentName: string;
          provider: string;
          model: string;
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
          costEstimate: number;
        };
        useUsageStore.getState().addFromWs(payload);
      }
    });

    return unsub;
  }, [activeChat, addMessage, renameChat, resetThinking, stopAll, handleThinking, addTestResults, updateTestResults]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking, blocks]);

  async function handleResume() {
    if (!activeChat || !messages.length) return;
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;
    setInterrupted(false);
    setError(null);
    setThinking(true);
    isResuming.current = true;
    // Don't resetThinking() — keep existing blocks from completed agents
    try {
      await api.post("/agents/run", {
        chatId: activeChat.id,
        message: lastUserMsg.content,
        resume: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Agent orchestration failed";
      setError(msg);
      setThinking(false);
    }
  }

  async function handleRetryFresh() {
    if (!activeChat || !messages.length) return;
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;
    setInterrupted(false);
    setError(null);
    setThinking(true);
    resetThinking();
    try {
      await api.post("/agents/run", {
        chatId: activeChat.id,
        message: lastUserMsg.content,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Agent orchestration failed";
      setError(msg);
      setThinking(false);
    }
  }

  async function handleSend(content: string) {
    if (!activeChat) return;
    setError(null);
    setInterrupted(false);
    setCostLimitInterrupt(false);
    setShowLimitsInline(false);

    // Optimistic: show the message immediately before API call
    const optimisticMsg: Message = {
      id: nanoid(),
      chatId: activeChat.id,
      role: "user",
      content,
      agentName: null,
      metadata: null,
      createdAt: Date.now(),
    };
    addMessage(optimisticMsg);
    setThinking(true);

    // Persist message + trigger orchestration in a single API call
    try {
      await api.post("/messages/send", {
        chatId: activeChat.id,
        content,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send message";
      console.error("[chat] Send failed:", err);
      setError(msg);
      setThinking(false);
    }
  }

  async function handleStop() {
    if (!activeChat) return;
    try {
      await api.post("/agents/stop", { chatId: activeChat.id });
    } catch (err) {
      console.error("[chat] Failed to stop agents:", err);
    }
  }

  if (!activeChat) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-zinc-500 text-sm">Select or create a chat to get started.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {error && (
        <div className="px-4 py-2 bg-red-900/30 border-b border-red-800 text-red-300 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-200 ml-2">
            Dismiss
          </button>
        </div>
      )}
      {interrupted && !thinking && (
        <div className="px-4 py-2 bg-amber-900/30 border-b border-amber-800 text-amber-300 text-xs flex items-center justify-between">
          <span>Pipeline was interrupted by a server restart.</span>
          <div className="flex items-center gap-3">
            <button
              onClick={handleResume}
              className="rounded bg-amber-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-amber-500 transition-colors"
            >
              Resume
            </button>
            <button
              onClick={handleRetryFresh}
              className="text-amber-400/70 hover:text-amber-200 text-xs underline underline-offset-2"
            >
              Retry from scratch
            </button>
            <button onClick={() => setInterrupted(false)} className="text-amber-400 hover:text-amber-200">
              Dismiss
            </button>
          </div>
        </div>
      )}
      {costLimitInterrupt && !thinking && (
        <div className="border-b border-amber-800 bg-amber-900/30">
          <div className="px-4 py-2 text-amber-300 text-xs flex items-center justify-between">
            <span>Token limit reached. Pipeline paused.</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowLimitsInline((v) => !v)}
                className="rounded bg-amber-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-amber-500 transition-colors"
              >
                {showLimitsInline ? "Hide limits" : "Increase limit & resume"}
              </button>
              <button
                onClick={() => { setCostLimitInterrupt(false); setShowLimitsInline(false); }}
                className="text-amber-400 hover:text-amber-200"
              >
                Dismiss
              </button>
            </div>
          </div>
          {showLimitsInline && (
            <div className="px-4 pb-3 pt-1 border-t border-amber-800/50">
              <LimitsSettings />
              <button
                onClick={() => { setCostLimitInterrupt(false); setShowLimitsInline(false); handleResume(); }}
                className="mt-3 rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500 transition-colors"
              >
                Resume pipeline
              </button>
            </div>
          )}
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        <MergedTimeline
          messages={messages}
          blocks={blocks}
          thinking={thinking}
          onToggle={toggleExpanded}
        />
        <div ref={messagesEndRef} />
      </div>
      <MessageInput onSend={handleSend} disabled={thinking} onStop={handleStop} />
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex justify-start p-4">
      <div className="bg-zinc-800 rounded-lg px-4 py-3 flex items-center gap-2">
        <div className="flex gap-1">
          <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
        <span className="text-xs text-zinc-400 ml-1">Agents working...</span>
      </div>
    </div>
  );
}

/**
 * Merged timeline: interleaves messages and thinking blocks chronologically.
 * Ensures assistant messages (e.g., orchestrator summary) appear AFTER the
 * agent thinking blocks they relate to, not above them.
 */
function MergedTimeline({
  messages,
  blocks,
  thinking,
  onToggle,
}: {
  messages: Message[];
  blocks: ThinkingBlock[];
  thinking: boolean;
  onToggle: (id: string) => void;
}) {
  // If no blocks, just render messages normally
  if (blocks.length === 0) {
    return (
      <>
        <MessageList messages={messages} />
        {thinking && <ThinkingIndicator />}
      </>
    );
  }

  // Find the timestamp boundary: first thinking block marks where agents started
  const firstBlockTime = Math.min(...blocks.map((b) => b.startedAt));

  // Split messages: before agents started vs after
  const beforeBlocks: Message[] = [];
  const afterBlocks: Message[] = [];
  for (const msg of messages) {
    // Agent output messages are hidden (shown as thinking blocks)
    if (msg.metadata) {
      try {
        const meta = typeof msg.metadata === "string" ? JSON.parse(msg.metadata) : msg.metadata;
        if (meta?.type === "agent_output") continue;
      } catch { /* skip */ }
    }
    if (msg.createdAt < firstBlockTime) {
      beforeBlocks.push(msg);
    } else {
      afterBlocks.push(msg);
    }
  }

  return (
    <>
      {beforeBlocks.length > 0 && <MessageList messages={beforeBlocks} />}
      {blocks.map((block) => (
        <AgentThinkingMessage
          key={block.id}
          block={block}
          onToggle={() => onToggle(block.id)}
        />
      ))}
      {thinking && blocks.length === 0 && <ThinkingIndicator />}
      {afterBlocks.length > 0 && <MessageList messages={afterBlocks} />}
    </>
  );
}
