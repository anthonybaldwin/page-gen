import { useEffect, useRef, useState } from "react";
import { MessageList, ChatMessageItem, isVisibleChatMessage } from "./MessageList.tsx";
import { MessageInput } from "./MessageInput.tsx";
import { AgentThinkingMessage } from "./AgentThinkingMessage.tsx";
import { LimitsSettings } from "../billing/LimitsSettings.tsx";
import { Button } from "../ui/button.tsx";
import { Alert, AlertDescription } from "../ui/alert.tsx";
import { useChatStore } from "../../stores/chatStore.ts";
import { useAgentThinkingStore, type ThinkingBlock } from "../../stores/agentThinkingStore.ts";
import { useUsageStore } from "../../stores/usageStore.ts";
import { useProjectStore } from "../../stores/projectStore.ts";
import { VibeIntake } from "./VibeIntake.tsx";
import { CheckpointCard } from "./CheckpointCard.tsx";
import { api } from "../../lib/api.ts";
import { connectWebSocket, onWsMessage } from "../../lib/ws.ts";
import type { Message, TestDetail, VibeBrief, DesignOption } from "../../../shared/types.ts";
import { nanoid } from "nanoid";
import { AlertCircle, AlertTriangle, X } from "lucide-react";

export function ChatWindow() {
  const { activeChat, messages, setMessages, addMessage, renameChat } = useChatStore();
  const { blocks, reset: resetThinking, stopAll, handleThinking, addTestResults, updateTestResults, toggleExpanded } = useAgentThinkingStore();
  const { activeProject, updateProject } = useProjectStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const [costLimitInterrupt, setCostLimitInterrupt] = useState(false);
  const [showLimitsInline, setShowLimitsInline] = useState(false);
  const [showVibeIntake, setShowVibeIntake] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [checkpoint, setCheckpoint] = useState<{
    checkpointId: string;
    label: string;
    message: string;
    checkpointType: "approve" | "design_direction";
    options: DesignOption[];
    resolved?: { selectedIndex: number; timedOut?: boolean };
  } | null>(null);

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
    setShowVibeIntake(false);
    setPendingMessage(null);
    setCheckpoint(null);
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
          skipped?: boolean;
          skipReason?: string;
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
            // Keep prior blocks for a truly linear timeline across follow-up requests.
            // Resume still clears its flag to keep behavior explicit.
            if (isResuming.current) isResuming.current = false;
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
            error?: string;
            toolCall?: { toolName: string; input: Record<string, unknown> };
          }
        );
      }

      // Chat auto-title event
      if (msg.type === "chat_renamed") {
        const { chatId: renamedChatId, title } = msg.payload as { chatId: string; title: string };
        renameChat(renamedChatId, title);
      }

      // Pipeline checkpoint — pause for user selection
      if (msg.type === "pipeline_checkpoint") {
        const payload = msg.payload as {
          checkpointId: string;
          label: string;
          message: string;
          checkpointType: "approve" | "design_direction";
          options: DesignOption[];
        };
        setCheckpoint({
          checkpointId: payload.checkpointId,
          label: payload.label,
          message: payload.message,
          checkpointType: payload.checkpointType,
          options: payload.options,
        });
      }

      // Pipeline checkpoint resolved (by timeout or another client)
      if (msg.type === "pipeline_checkpoint_resolved") {
        const payload = msg.payload as { checkpointId: string; selectedIndex: number; timedOut?: boolean };
        setCheckpoint((prev) =>
          prev?.checkpointId === payload.checkpointId
            ? { ...prev, resolved: { selectedIndex: payload.selectedIndex, timedOut: payload.timedOut } }
            : prev
        );
      }

      // Token usage events
      if (msg.type === "token_usage") {
        const payload = msg.payload as {
          chatId: string;
          projectId?: string;
          agentName: string;
          provider: string;
          model: string;
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
          cacheCreationInputTokens?: number;
          cacheReadInputTokens?: number;
          costEstimate: number;
        };
        useUsageStore.getState().addFromWs(payload);
      }
    });

    return unsub;
  }, [activeChat, addMessage, renameChat, resetThinking, stopAll, handleThinking, addTestResults, updateTestResults]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking, blocks, checkpoint]);

  async function handleResume() {
    if (!activeChat || !messages.length) return;
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;
    setInterrupted(false);
    setError(null);
    setThinking(true);
    isResuming.current = true;
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

  function handleVibeApply(brief: VibeBrief) {
    if (!activeProject) return;
    updateProject(activeProject.id, { vibeBrief: brief });
    setShowVibeIntake(false);
    if (pendingMessage) {
      fireMessage(pendingMessage);
      setPendingMessage(null);
    }
  }

  function handleCheckpointSelect(checkpointId: string, selectedIndex: number) {
    setCheckpoint((prev) =>
      prev?.checkpointId === checkpointId
        ? { ...prev, resolved: { selectedIndex } }
        : prev
    );
  }

  function handleVibeSkip() {
    setShowVibeIntake(false);
    if (pendingMessage) {
      fireMessage(pendingMessage);
      setPendingMessage(null);
    }
  }

  async function handleSend(content: string) {
    if (!activeChat) return;
    setError(null);
    setInterrupted(false);
    setCostLimitInterrupt(false);
    setShowLimitsInline(false);

    // First message on a fresh project → show vibe intake
    const hasUserMessages = messages.some((m) => m.role === "user");
    if (!hasUserMessages && activeProject && !activeProject.vibeBrief) {
      setPendingMessage(content);
      setShowVibeIntake(true);
      return;
    }

    fireMessage(content);
  }

  async function fireMessage(content: string) {
    if (!activeChat) return;

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
        <p className="text-muted-foreground text-sm">Select or create a chat to get started.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {error && (
        <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>{error}</span>
            <Button variant="ghost" size="sm" onClick={() => setError(null)} className="h-6 px-2 text-xs">
              <X className="h-3 w-3" />
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {interrupted && !thinking && (
        <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>Pipeline was interrupted by a server restart.</span>
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={handleResume} className="h-6 px-2 text-xs bg-amber-600 hover:bg-amber-500">
              Resume
            </Button>
            <Button
              variant="link"
              size="sm"
              onClick={handleRetryFresh}
              className="h-6 px-1 text-xs text-amber-500/70 dark:text-amber-400/70 hover:text-amber-600 dark:hover:text-amber-200"
            >
              Retry from scratch
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setInterrupted(false)} className="h-6 px-1">
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
      {costLimitInterrupt && !thinking && (
        <div className="border-b border-amber-500/30 bg-amber-500/10">
          <div className="px-4 py-2 text-amber-600 dark:text-amber-400 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Token limit reached. Pipeline paused.</span>
            </div>
            <div className="flex items-center gap-3">
              <Button size="sm" onClick={() => setShowLimitsInline((v) => !v)} className="h-6 px-2 text-xs bg-amber-600 hover:bg-amber-500">
                {showLimitsInline ? "Hide limits" : "Increase limit & resume"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setCostLimitInterrupt(false); setShowLimitsInline(false); }} className="h-6 px-1">
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
          {showLimitsInline && (
            <div className="px-4 pb-3 pt-1 border-t border-amber-500/20">
              <LimitsSettings />
              <Button
                size="sm"
                onClick={() => { setCostLimitInterrupt(false); setShowLimitsInline(false); handleResume(); }}
                className="mt-3 bg-emerald-600 hover:bg-emerald-500 text-xs"
              >
                Resume pipeline
              </Button>
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
        {checkpoint && activeChat && (
          <CheckpointCard
            chatId={activeChat.id}
            checkpointId={checkpoint.checkpointId}
            label={checkpoint.label}
            message={checkpoint.message}
            checkpointType={checkpoint.checkpointType}
            options={checkpoint.options}
            resolved={checkpoint.resolved}
            onSelect={handleCheckpointSelect}
          />
        )}
        <div ref={messagesEndRef} />
      </div>
      {showVibeIntake && activeProject && (
        <VibeIntake
          projectId={activeProject.id}
          onApply={handleVibeApply}
          onSkip={handleVibeSkip}
        />
      )}
      <MessageInput onSend={handleSend} disabled={thinking || showVibeIntake} onStop={handleStop} />
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex justify-start p-4">
      <div className="bg-muted rounded-lg px-4 py-3 flex items-center gap-2">
        <div className="flex gap-1">
          <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
        <span className="text-xs text-muted-foreground ml-1">Agents working...</span>
      </div>
    </div>
  );
}

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
  if (blocks.length === 0) {
    return (
      <>
        <MessageList messages={messages} />
        {thinking && <ThinkingIndicator />}
      </>
    );
  }

  const visibleMessages = messages.filter(isVisibleChatMessage);
  const items: Array<
    | { type: "message"; id: string; at: number; msg: Message }
    | { type: "block"; id: string; at: number; block: ThinkingBlock }
  > = [
    ...visibleMessages.map((msg) => ({ type: "message" as const, id: msg.id, at: msg.createdAt, msg })),
    ...blocks.map((block) => ({ type: "block" as const, id: block.id, at: block.startedAt, block })),
  ];

  items.sort((a, b) => {
    if (a.at !== b.at) return a.at - b.at;
    // Stable tie-breaker: user/system/assistant messages should appear before
    // same-timestamp thinking blocks for natural chat flow.
    if (a.type !== b.type) return a.type === "message" ? -1 : 1;
    return a.id.localeCompare(b.id);
  });

  return (
    <>
      <div className="py-2">
        {items.map((item) =>
          item.type === "message" ? (
            <ChatMessageItem key={item.id} msg={item.msg} />
          ) : (
            <AgentThinkingMessage
              key={item.id}
              block={item.block}
              onToggle={() => onToggle(item.block.id)}
            />
          )
        )}
      </div>
      {thinking && <ThinkingIndicator />}
    </>
  );
}
