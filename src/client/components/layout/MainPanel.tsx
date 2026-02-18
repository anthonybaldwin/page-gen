export function MainPanel() {
  return (
    <main className="flex-1 flex flex-col min-w-0">
      {/* Tab bar: Chat | Preview */}
      <div className="flex border-b border-zinc-800 bg-zinc-900">
        <button className="px-4 py-2 text-sm font-medium text-white border-b-2 border-blue-500">
          Chat
        </button>
        <button className="px-4 py-2 text-sm font-medium text-zinc-500 hover:text-zinc-300 transition-colors">
          Preview
        </button>
      </div>

      {/* Content area */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-zinc-500 text-sm">
            Create a project and start chatting to build something.
          </p>
        </div>
      </div>

      {/* Message input */}
      <div className="p-4 border-t border-zinc-800">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Describe what you want to build..."
            className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 transition-colors"
          />
          <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors">
            Send
          </button>
        </div>
      </div>
    </main>
  );
}
