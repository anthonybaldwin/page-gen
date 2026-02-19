import { useEffect, useRef, useState } from "react";
import { MessageList } from "./MessageList.tsx";
import { MessageInput } from "./MessageInput.tsx";
import { AgentThinkingMessage } from "./AgentThinkingMessage.tsx";
import { TestResultsBanner } from "./TestResultsBanner.tsx";
import { useChatStore } from "../../stores/chatStore.ts";
import { useAgentThinkingStore } from "../../stores/agentThinkingStore.ts";
import { useUsageStore } from "../../stores/usageStore.ts";
import { api } from "../../lib/api.ts";
import { connectWebSocket, onWsMessage } from "../../lib/ws.ts";
import type { Message } from "../../../shared/types.ts";
import { nanoid } from "nanoid";

export function ChatWindow() {
  const { activeChat, messages, setMessages, addMessage } = useChatStore();
  const { blocks, reset: resetThinking, stopAll, handleThinking, toggleExpanded } = useAgentThinkingStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const [testResults, setTestResults] = useState<{
    passed: number; failed: number; total: number; duration: number;
    failures: Array<{ name: string; error: string }>;
  } | null>(null);

  useEffect(() => {
    if (!activeChat) return;
    setError(null);
    setThinking(false);
    setInterrupted(false);
    setTestResults(null);
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

      // Test results from test runner
      if (msg.type === "test_results") {
        const payload = msg.payload as {
          passed: number; failed: number; total: number; duration: number;
          failures: Array<{ name: string; error: string }>;
        };
        setTestResults(payload);
      }

      // Orchestrator status changes
      if (msg.type === "agent_status") {
        const { agentName, status } = msg.payload as { agentName: string; status: string };
        if (agentName === "orchestrator") {
          if (status === "running") {
            resetThinking();
            setTestResults(null);
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

      // Agent error — stop thinking and show error
      if (msg.type === "agent_error") {
        const { agentName, error: errMsg } = msg.payload as { agentName: string; error: string };
        if (agentName === "orchestrator") {
          setThinking(false);
          setError(errMsg);
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
          }
        );
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
  }, [activeChat, addMessage, resetThinking, stopAll, handleThinking]);

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
    resetThinking();
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

    // Persist to backend
    try {
      await api.post<Message>("/messages", {
        chatId: activeChat.id,
        role: "user",
        content,
      });
    } catch (err) {
      console.error("[chat] Failed to save message:", err);
      setError("Failed to save message. Check that the backend server is running (bun run dev).");
      setThinking(false);
      return;
    }

    // Trigger agent orchestration
    try {
      await api.post("/agents/run", {
        chatId: activeChat.id,
        message: content,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Agent orchestration failed";
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
      <div className="flex-1 overflow-y-auto">
        <MessageList messages={messages} />
        {blocks.map((block, i) => (
          <AgentThinkingMessage
            key={`${block.agentName}-${i}`}
            block={block}
            onToggle={() => toggleExpanded(block.agentName)}
          />
        ))}
        {testResults && <TestResultsBanner results={testResults} />}
        {thinking && blocks.length === 0 && <ThinkingIndicator />}
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
