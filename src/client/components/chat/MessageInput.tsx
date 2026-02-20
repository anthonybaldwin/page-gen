import { useState, useRef } from "react";
import { Button } from "../ui/button.tsx";
import { Textarea } from "../ui/textarea.tsx";
import { Send, Square } from "lucide-react";

interface MessageInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  onStop?: () => void;
}

export function MessageInput({ onSend, disabled = false, onStop }: MessageInputProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setInput("");
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-4 border-t border-border">
      <div className="flex gap-2">
        <Textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? "Agents are working... click Stop to interrupt" : "Describe what you want to build..."}
          rows={1}
          disabled={disabled}
          className="flex-1 min-h-[38px] resize-none"
        />
        {disabled && onStop ? (
          <Button
            type="button"
            variant="destructive"
            onClick={onStop}
            aria-label="Stop agents"
          >
            <Square className="h-4 w-4 mr-1" />
            Stop
          </Button>
        ) : (
          <Button
            type="submit"
            disabled={disabled || !input.trim()}
            aria-label="Send message"
          >
            <Send className="h-4 w-4 mr-1" />
            Send
          </Button>
        )}
      </div>
    </form>
  );
}
