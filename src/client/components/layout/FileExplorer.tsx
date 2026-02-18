export function FileExplorer() {
  return (
    <aside className="w-64 border-l border-zinc-800 bg-zinc-900 flex flex-col">
      <div className="p-3 border-b border-zinc-800">
        <h2 className="text-sm font-medium text-zinc-400">Files</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <p className="text-xs text-zinc-600 p-2">No project selected</p>
      </div>
    </aside>
  );
}
