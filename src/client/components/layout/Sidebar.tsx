import { useEffect, useState } from "react";
import { useProjectStore } from "../../stores/projectStore.ts";
import { useChatStore } from "../../stores/chatStore.ts";
import { api } from "../../lib/api.ts";
import type { Project, Chat } from "../../../shared/types.ts";

export function Sidebar() {
  const { projects, activeProject, setProjects, setActiveProject } = useProjectStore();
  const { chats, activeChat, setChats, setActiveChat } = useChatStore();
  const [newProjectName, setNewProjectName] = useState("");
  const [showNewProject, setShowNewProject] = useState(false);

  useEffect(() => {
    api.get<Project[]>("/projects").then(setProjects).catch(console.error);
  }, [setProjects]);

  useEffect(() => {
    if (!activeProject) {
      setChats([]);
      return;
    }
    api
      .get<Chat[]>(`/chats?projectId=${activeProject.id}`)
      .then(setChats)
      .catch(console.error);
  }, [activeProject, setChats]);

  async function handleCreateProject() {
    const name = newProjectName.trim();
    if (!name) return;
    const project = await api.post<Project>("/projects", { name });
    setProjects([...projects, project]);
    setActiveProject(project);
    setShowNewProject(false);
    setNewProjectName("");
  }

  async function handleCreateChat() {
    if (!activeProject) return;
    const chat = await api.post<Chat>("/chats", {
      projectId: activeProject.id,
      title: `Chat ${chats.length + 1}`,
    });
    setChats([...chats, chat]);
    setActiveChat(chat);
  }

  return (
    <aside className="w-64 border-r border-zinc-800 bg-zinc-900 flex flex-col">
      <div className="p-4 border-b border-zinc-800">
        <h1 className="text-lg font-bold text-white">Just Build It</h1>
      </div>

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
          <button
            key={project.id}
            onClick={() => setActiveProject(project)}
            className={`w-full text-left rounded px-2 py-1.5 text-sm transition-colors ${
              activeProject?.id === project.id
                ? "bg-zinc-800 text-white"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
            }`}
          >
            {project.name}
          </button>
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
              <button
                key={chat.id}
                onClick={() => setActiveChat(chat)}
                className={`w-full text-left rounded px-2 py-1.5 text-sm transition-colors ${
                  activeChat?.id === chat.id
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                }`}
              >
                {chat.title}
              </button>
            ))}
            {chats.length === 0 && (
              <p className="text-xs text-zinc-600 px-2 py-1">No chats yet</p>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
