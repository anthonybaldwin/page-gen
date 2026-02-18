export function Sidebar() {
  return (
    <aside className="w-64 border-r border-zinc-800 bg-zinc-900 flex flex-col">
      <div className="p-4 border-b border-zinc-800">
        <h1 className="text-lg font-bold text-white">Just Build It</h1>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <p className="text-sm text-zinc-500 p-2">No projects yet</p>
      </div>
      <div className="p-3 border-t border-zinc-800">
        <button className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors">
          New Project
        </button>
      </div>
    </aside>
  );
}
