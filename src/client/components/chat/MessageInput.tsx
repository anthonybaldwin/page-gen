import { useState, useRef } from "react";

export function MessageInput({ onSend, disabled = false }: { onSend: (content: string) => void; disabled?: boolean }) {
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
    <form onSubmit={handleSubmit} className="p-4 border-t border-zinc-800">
      <div className="flex gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? "Agents are working..." : "Describe what you want to build..."}
          rows={1}
          disabled={disabled}
          className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 transition-colors resize-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || !input.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Send
        </button>
      </div>
    </form>
  );
}
