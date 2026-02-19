import { useEffect, useState } from "react";
import { useProjectStore } from "../../stores/projectStore.ts";
import { useChatStore } from "../../stores/chatStore.ts";
import { useUsageStore } from "../../stores/usageStore.ts";
import { api } from "../../lib/api.ts";
import type { Project, Chat } from "../../../shared/types.ts";
import { UsageBadge } from "../billing/UsageBadge.tsx";
import { UsageDashboard } from "../billing/UsageDashboard.tsx";
import { SettingsButton } from "../settings/SettingsButton.tsx";
import { SettingsModal } from "../settings/SettingsModal.tsx";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { projects, activeProject, setProjects, setActiveProject, renameProject } = useProjectStore();
  const { chats, activeChat, setChats, setActiveChat, setMessages, renameChat } = useChatStore();
  const [newProjectName, setNewProjectName] = useState("");
  const [showNewProject, setShowNewProject] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUsage, setShowUsage] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  // Sync active chat id to usage store
  const setActiveChatId = useUsageStore((s) => s.setActiveChatId);
  useEffect(() => {
    setActiveChatId(activeChat?.id ?? null);
  }, [activeChat, setActiveChatId]);

  useEffect(() => {
    api.get<Project[]>("/projects").then(setProjects).catch(console.error);
  }, [setProjects]);

  useEffect(() => {
    setActiveChat(null);
    setMessages([]);
    if (!activeProject) {
      setChats([]);
      return;
    }
    api
      .get<Chat[]>(`/chats?projectId=${activeProject.id}`)
      .then(setChats)
      .catch(console.error);
  }, [activeProject, setChats, setActiveChat, setMessages]);

  async function handleCreateProject() {
    const name = newProjectName.trim();
    if (!name) return;
    try {
      const project = await api.post<Project>("/projects", { name });
      setProjects([...projects, project]);
      setActiveProject(project);
      setShowNewProject(false);
      setNewProjectName("");
    } catch (err) {
      console.error("[sidebar] Failed to create project:", err);
      setError("Failed to create project. Is the backend server running?");
    }
  }

  async function handleCreateChat() {
    if (!activeProject) return;
    try {
      const chat = await api.post<Chat>("/chats", {
        projectId: activeProject.id,
        title: `Chat ${chats.length + 1}`,
      });
      setChats([...chats, chat]);
      setActiveChat(chat);
    } catch (err) {
      console.error("[sidebar] Failed to create chat:", err);
      setError("Failed to create chat. Is the backend server running?");
    }
  }

  async function handleRenameProject(id: string) {
    const name = editingValue.trim();
    if (!name) { setEditingId(null); return; }
    try {
      await api.patch(`/projects/${id}`, { name });
      renameProject(id, name);
    } catch (err) {
      console.error("[sidebar] Failed to rename project:", err);
    }
    setEditingId(null);
  }

  async function handleRenameChat(id: string) {
    const title = editingValue.trim();
    if (!title) { setEditingId(null); return; }
    try {
      await api.patch(`/chats/${id}`, { title });
      renameChat(id, title);
    } catch (err) {
      console.error("[sidebar] Failed to rename chat:", err);
    }
    setEditingId(null);
  }

  if (collapsed) {
    return (
      <aside className="w-12 border-r border-zinc-800 bg-zinc-900 flex flex-col items-center py-3 transition-all duration-200">
        <button
          onClick={onToggle}
          className="text-zinc-400 hover:text-white p-1.5 rounded hover:bg-zinc-800 transition-colors"
          title="Expand sidebar"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zM2 10a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 10zm0 5.25a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z" clipRule="evenodd" />
          </svg>
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-64 border-r border-zinc-800 bg-zinc-900 flex flex-col transition-all duration-200">
      <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
        <h1 className="text-lg font-bold text-white">Just Build It</h1>
        <button
          onClick={onToggle}
          className="text-zinc-400 hover:text-white p-1 rounded hover:bg-zinc-800 transition-colors"
          title="Collapse sidebar"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M11.78 5.22a.75.75 0 010 1.06L8.06 10l3.72 3.72a.75.75 0 11-1.06 1.06l-4.25-4.25a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 0z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
      {error && (
        <div className="px-3 py-2 bg-red-900/30 border-b border-red-800 text-red-300 text-xs">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-200 ml-1 underline">
            dismiss
          </button>
        </div>
      )}

      {/* Projects */}
      <div className="p-2 border-b border-zinc-800">
        <div className="flex items-center justify-between px-2 mb-1">
          <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
            Projects
          </span>
          <button
            onClick={() => setShowNewProject(!showNewProject)}
            className="text-zinc-500 hover:text-zinc-300 text-lg leading-none"
          >
            +
          </button>
        </div>
        {showNewProject && (
          <div className="flex gap-1 px-1 mb-2">
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
              placeholder="Project name..."
              className="flex-1 rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
              autoFocus
            />
          </div>
        )}
        {projects.map((project) => (
          <div
            key={project.id}
            className="group flex items-center rounded transition-colors"
          >
            {editingId === project.id ? (
              <input
                type="text"
                value={editingValue}
                onChange={(e) => setEditingValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameProject(project.id);
                  if (e.key === "Escape") setEditingId(null);
                }}
                onBlur={() => handleRenameProject(project.id)}
                className="flex-1 rounded-l bg-zinc-800 border border-blue-500 px-2 py-1 text-sm text-white focus:outline-none"
                autoFocus
              />
            ) : (
              <button
                onClick={() => setActiveProject(project)}
                onDoubleClick={() => { setEditingId(project.id); setEditingValue(project.name); }}
                className={`flex-1 text-left rounded-l px-2 py-1.5 text-sm transition-colors truncate ${
                  activeProject?.id === project.id
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                }`}
              >
                {project.name}
              </button>
            )}
            <button
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  await api.delete(`/projects/${project.id}`);
                  setProjects(projects.filter((p) => p.id !== project.id));
                  if (activeProject?.id === project.id) {
                    setActiveProject(null);
                    setChats([]);
                    setActiveChat(null);
                    setMessages([]);
                  }
                } catch (err) {
                  console.error("[sidebar] Failed to delete project:", err);
                }
              }}
              className="opacity-0 group-hover:opacity-100 px-1.5 py-1.5 text-zinc-500 hover:text-red-400 transition-all"
              title="Delete project"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        ))}
        {projects.length === 0 && !showNewProject && (
          <p className="text-xs text-zinc-600 px-2 py-1">No projects yet</p>
        )}
      </div>

      {/* Chats */}
      <div className="flex-1 overflow-y-auto p-2">
        {activeProject && (
          <>
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Chats
              </span>
              <button
                onClick={handleCreateChat}
                className="text-zinc-500 hover:text-zinc-300 text-lg leading-none"
              >
                +
              </button>
            </div>
            {chats.map((chat) => (
              <div
                key={chat.id}
                className="group flex items-center rounded transition-colors"
              >
                {editingId === chat.id ? (
                  <input
                    type="text"
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameChat(chat.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onBlur={() => handleRenameChat(chat.id)}
                    className="flex-1 rounded-l bg-zinc-800 border border-blue-500 px-2 py-1 text-sm text-white focus:outline-none"
                    autoFocus
                  />
                ) : (
                  <button
                    onClick={() => setActiveChat(chat)}
                    onDoubleClick={() => { setEditingId(chat.id); setEditingValue(chat.title); }}
                    className={`flex-1 text-left rounded-l px-2 py-1.5 text-sm transition-colors truncate ${
                      activeChat?.id === chat.id
                        ? "bg-zinc-800 text-white"
                        : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                    }`}
                  >
                    {chat.title}
                  </button>
                )}
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      await api.delete(`/chats/${chat.id}`);
                      setChats(chats.filter((ch) => ch.id !== chat.id));
                      if (activeChat?.id === chat.id) {
                        setActiveChat(null);
                        setMessages([]);
                      }
                    } catch (err) {
                      console.error("[sidebar] Failed to delete chat:", err);
                    }
                  }}
                  className="opacity-0 group-hover:opacity-100 px-1.5 py-1.5 text-zinc-500 hover:text-red-400 transition-all"
                  title="Delete chat"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                    <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            ))}
            {chats.length === 0 && (
              <p className="text-xs text-zinc-600 px-2 py-1">No chats yet</p>
            )}
          </>
        )}
      </div>

      <div className="flex items-center border-t border-zinc-800">
        <SettingsButton onClick={() => setShowSettings(true)} />
        <div className="flex-1">
          <UsageBadge onClick={() => setShowUsage(true)} />
        </div>
      </div>

      {/* Usage dashboard modal */}
      {showUsage && (
        <div className="fixed inset-0 z-50 flex items-start pt-[10vh] justify-center bg-black/60">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg w-full max-w-3xl h-[80vh] flex flex-col shadow-2xl">
            <UsageDashboard onClose={() => setShowUsage(false)} />
          </div>
        </div>
      )}

      {/* Settings modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-start pt-[10vh] justify-center bg-black/60">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg w-full max-w-3xl h-[80vh] flex flex-col shadow-2xl">
            <SettingsModal onClose={() => setShowSettings(false)} />
          </div>
        </div>
      )}
    </aside>
  );
}
