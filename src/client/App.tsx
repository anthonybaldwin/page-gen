import { Sidebar } from "./components/layout/Sidebar.tsx";
import { MainPanel } from "./components/layout/MainPanel.tsx";
import { FileExplorer } from "./components/layout/FileExplorer.tsx";

export function App() {
  return (
    <div className="flex h-full bg-zinc-950 text-zinc-100">
      {/* Left: Sidebar - project/chat navigation */}
      <Sidebar />

      {/* Center: Main panel - chat + preview */}
      <MainPanel />

      {/* Right: File explorer */}
      <FileExplorer />
    </div>
  );
}
