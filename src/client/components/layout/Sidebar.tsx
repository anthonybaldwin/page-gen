import React, { Suspense, useEffect, useState } from "react";
import { useProjectStore } from "../../stores/projectStore.ts";
import { useChatStore } from "../../stores/chatStore.ts";
import { useUsageStore } from "../../stores/usageStore.ts";
import { useThemeStore } from "../../stores/themeStore.ts";
import { api } from "../../lib/api.ts";
import type { Project, Chat } from "../../../shared/types.ts";
import { UsageBadge } from "../billing/UsageBadge.tsx";
const UsageDashboard = React.lazy(() => import("../billing/UsageDashboard.tsx").then(m => ({ default: m.UsageDashboard })));
import { SettingsButton } from "../settings/SettingsButton.tsx";
const SettingsModal = React.lazy(() => import("../settings/SettingsModal.tsx").then(m => ({ default: m.SettingsModal })));
import { VersionHistory } from "../versions/VersionHistory.tsx";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { ScrollArea } from "../ui/scroll-area.tsx";
import { Separator } from "../ui/separator.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog.tsx";
import { ConfirmDialog } from "../ui/confirm-dialog.tsx";
import {
  PanelLeft,
  Plus,
  Trash2,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { projects, activeProject, setProjects, setActiveProject, renameProject } = useProjectStore();
  const { chats, activeChat, messages, setChats, setActiveChat, setMessages, renameChat } = useChatStore();
  const [newProjectName, setNewProjectName] = useState("");
  const [showNewProject, setShowNewProject] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUsage, setShowUsage] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [chatToDelete, setChatToDelete] = useState<Chat | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { theme, setTheme } = useThemeStore();

  // Sync active chat id to usage store
  const setActiveChatId = useUsageStore((s) => s.setActiveChatId);
  useEffect(() => {
    setActiveChatId(activeChat?.id ?? null);
  }, [activeChat?.id, setActiveChatId]);

  // Sync active project id to usage store
  const setActiveProjectId = useUsageStore((s) => s.setActiveProjectId);
  useEffect(() => {
    setActiveProjectId(activeProject?.id ?? null);
  }, [activeProject?.id, setActiveProjectId]);

  // Load projects and restore active project from localStorage
  useEffect(() => {
    api.get<Project[]>("/projects").then((loaded) => {
      setProjects(loaded);
      if (!activeProject && loaded.length > 0) {
        const savedId = localStorage.getItem("pagegen:activeProjectId");
        const saved = savedId ? loaded.find((p) => p.id === savedId) : null;
        setActiveProject(saved ?? loaded[loaded.length - 1]!);
      }
    }).catch(console.error);
  }, [setProjects]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load chats when project changes; restore active chat from localStorage
  useEffect(() => {
    if (!activeProject) {
      setActiveChat(null);
      setMessages([]);
      setChats([]);
      return;
    }
    api
      .get<Chat[]>(`/chats?projectId=${activeProject.id}`)
      .then((loaded) => {
        setChats(loaded);
        const savedId = localStorage.getItem("pagegen:activeChatId");
        const saved = savedId ? loaded.find((c) => c.id === savedId) : null;
        if (saved) {
          setActiveChat(saved);
        } else if (!activeChat || !loaded.find((c) => c.id === activeChat.id)) {
          // No saved chat or saved chat not in this project — select most recent or null
          setActiveChat(loaded.length > 0 ? loaded[loaded.length - 1]! : null);
          if (loaded.length === 0) setMessages([]);
        }
      })
      .catch(console.error);
  }, [activeProject, setChats, setActiveChat, setMessages]); // eslint-disable-line react-hooks/exhaustive-deps

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

  function cycleTheme() {
    const order: Array<"light" | "dark" | "system"> = ["light", "dark", "system"];
    const idx = order.indexOf(theme);
    setTheme(order[(idx + 1) % order.length]!);
  }

  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const activeChatIsEmpty = !!activeChat && messages.length === 0;

  if (collapsed) {
    return (
      <aside className="w-14 border-r border-sidebar-border bg-sidebar flex flex-col items-center py-3 transition-all duration-200">
        <img src="/rated-pg.png" alt="Rated PG" className="h-5 w-auto" />
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          className="mt-2 text-muted-foreground hover:text-foreground"
          aria-label="Expand sidebar"
        >
          <PanelLeft className="h-4 w-4" />
        </Button>

        {activeProject && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCreateChat}
            disabled={activeChatIsEmpty}
            className="mt-2 text-muted-foreground hover:text-foreground disabled:opacity-30"
            aria-label="New chat"
            title={activeChatIsEmpty ? "Send a message first" : "New chat"}
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}

        <div className="flex-1" />

        <SettingsButton onClick={() => setShowSettings(true)} />
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground"
          onClick={cycleTheme}
          aria-label={`Theme: ${theme}. Click to cycle.`}
          title={`Theme: ${theme}`}
        >
          <ThemeIcon className="h-4 w-4" />
        </Button>

        {/* Dialogs must be rendered even when collapsed */}
        <Dialog open={showSettings} onOpenChange={setShowSettings}>
          <DialogContent className="max-w-[1600px] max-h-[90vh] p-0 gap-0 top-[5vh] translate-y-0 flex flex-col overflow-hidden">
            <DialogHeader className="sr-only">
              <DialogTitle>Settings</DialogTitle>
            </DialogHeader>
            <Suspense fallback={<div className="p-8 text-center text-muted-foreground text-sm">Loading...</div>}>
              <SettingsModal onClose={() => setShowSettings(false)} />
            </Suspense>
          </DialogContent>
        </Dialog>
      </aside>
    );
  }

  return (
    <aside className="w-64 border-r border-sidebar-border bg-sidebar flex flex-col transition-all duration-200">
      <div className="p-4 border-b border-sidebar-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/rated-pg.png" alt="Rated PG" className="h-6 w-auto" />
          <h1 className="text-lg font-bold text-foreground">Page Gen.</h1>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          aria-label="Collapse sidebar"
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
      </div>

      {error && (
        <div className="px-3 py-2 bg-destructive/10 border-b border-destructive/30 text-destructive text-xs">
          <span>{error}</span>
          <Button
            variant="link"
            size="sm"
            onClick={() => setError(null)}
            className="text-destructive hover:text-destructive/80 ml-1 h-auto p-0"
          >
            dismiss
          </Button>
        </div>
      )}

      {/* Projects */}
      <div className="p-2 border-b border-sidebar-border">
        <div className="flex items-center justify-between px-2 mb-1">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Projects
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={() => setShowNewProject(!showNewProject)}
            aria-label="New project"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {showNewProject && (
          <div className="flex gap-1 px-1 mb-2">
            <Input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
              placeholder="Project name..."
              className="h-7 text-xs"
              autoFocus
            />
          </div>
        )}
        {projects.map((project) => (
          <div
            key={project.id}
            className="group flex items-center rounded-md transition-colors"
          >
            {editingId === project.id ? (
              <Input
                type="text"
                value={editingValue}
                onChange={(e) => setEditingValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameProject(project.id);
                  if (e.key === "Escape") setEditingId(null);
                }}
                onBlur={() => handleRenameProject(project.id)}
                className="flex-1 h-7 text-sm rounded-r-none"
                autoFocus
              />
            ) : (
              <Button
                variant="ghost"
                onClick={() => setActiveProject(project)}
                onDoubleClick={() => { setEditingId(project.id); setEditingValue(project.name); }}
                className={`flex-1 justify-start h-auto rounded-r-none px-2 py-1.5 text-sm font-normal truncate ${
                  activeProject?.id === project.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50"
                }`}
              >
                {project.name}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                setProjectToDelete(project);
              }}
              className="opacity-0 group-hover:opacity-100 h-7 w-7 text-muted-foreground hover:text-destructive transition-all"
              title="Delete project"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        {projects.length === 0 && !showNewProject && (
          <p className="text-xs text-muted-foreground/60 px-2 py-1">No projects yet</p>
        )}
      </div>

      {/* Chats */}
      <ScrollArea className="flex-1 p-2">
        {activeProject && (
          <>
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Chats
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground disabled:opacity-30"
                onClick={handleCreateChat}
                disabled={activeChatIsEmpty}
                aria-label="New chat"
                title={activeChatIsEmpty ? "Send a message first" : "New chat"}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {chats.map((chat) => (
              <div
                key={chat.id}
                className="group flex items-center rounded-md transition-colors"
              >
                {editingId === chat.id ? (
                  <Input
                    type="text"
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameChat(chat.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onBlur={() => handleRenameChat(chat.id)}
                    className="flex-1 h-7 text-sm rounded-r-none"
                    autoFocus
                  />
                ) : (
                  <Button
                    variant="ghost"
                    onClick={() => setActiveChat(chat)}
                    onDoubleClick={() => { setEditingId(chat.id); setEditingValue(chat.title); }}
                    className={`flex-1 justify-start h-auto rounded-r-none px-2 py-1.5 text-sm font-normal truncate ${
                      activeChat?.id === chat.id
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50"
                    }`}
                  >
                    {chat.title}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    setChatToDelete(chat);
                  }}
                  className="opacity-0 group-hover:opacity-100 h-7 w-7 text-muted-foreground hover:text-destructive transition-all"
                  title="Delete chat"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {chats.length === 0 && (
              <p className="text-xs text-muted-foreground/60 px-2 py-1">No chats yet</p>
            )}
          </>
        )}
      </ScrollArea>

      {/* Versions */}
      {activeProject && (
        <div className="border-t border-sidebar-border">
          <VersionHistory />
        </div>
      )}

      <Separator />

      {/* Footer bar: Settings, Theme toggle, Usage */}
      <div className="flex items-center border-t border-sidebar-border">
        <SettingsButton onClick={() => setShowSettings(true)} />
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground hover:text-foreground"
          onClick={cycleTheme}
          aria-label={`Theme: ${theme}. Click to cycle.`}
          title={`Theme: ${theme}`}
        >
          <ThemeIcon className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <UsageBadge onClick={() => setShowUsage(true)} />
        </div>
      </div>

      {/* Usage dashboard dialog */}
      <Dialog open={showUsage} onOpenChange={setShowUsage}>
        <DialogContent className="max-w-5xl max-h-[80vh] p-0 gap-0 top-[10vh] translate-y-0 flex flex-col overflow-hidden">
          <DialogHeader className="sr-only">
            <DialogTitle>Usage Dashboard</DialogTitle>
          </DialogHeader>
          <Suspense fallback={<div className="p-8 text-center text-muted-foreground text-sm">Loading...</div>}>
            <UsageDashboard onClose={() => setShowUsage(false)} />
          </Suspense>
        </DialogContent>
      </Dialog>

      {/* Settings dialog */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="max-w-[1600px] max-h-[90vh] p-0 gap-0 top-[5vh] translate-y-0 flex flex-col overflow-hidden">
          <DialogHeader className="sr-only">
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>
          <Suspense fallback={<div className="p-8 text-center text-muted-foreground text-sm">Loading...</div>}>
            <SettingsModal onClose={() => setShowSettings(false)} />
          </Suspense>
        </DialogContent>
      </Dialog>

      {/* Project delete confirmation */}
      <ConfirmDialog
        open={!!projectToDelete}
        onOpenChange={(open) => { if (!open) setProjectToDelete(null); }}
        title="Delete Project"
        description="This will permanently delete the project and all its chats, messages, pipeline runs, agent executions, and generated files. This action cannot be undone."
        confirmText={projectToDelete?.name}
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={async () => {
          if (!projectToDelete) return;
          setDeleting(true);
          try {
            await api.delete(`/projects/${projectToDelete.id}`);
            setProjects(projects.filter((p) => p.id !== projectToDelete.id));
            if (activeProject?.id === projectToDelete.id) {
              setActiveProject(null);
              setChats([]);
              setActiveChat(null);
              setMessages([]);
            }
            setProjectToDelete(null);
          } catch (err) {
            console.error("[sidebar] Failed to delete project:", err);
          } finally {
            setDeleting(false);
          }
        }}
      />

      {/* Chat delete confirmation */}
      <ConfirmDialog
        open={!!chatToDelete}
        onOpenChange={(open) => { if (!open) setChatToDelete(null); }}
        title="Delete Chat"
        description="This will permanently delete this chat along with its messages and token usage records."
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={async () => {
          if (!chatToDelete) return;
          setDeleting(true);
          try {
            await api.delete(`/chats/${chatToDelete.id}`);
            setChats(chats.filter((ch) => ch.id !== chatToDelete.id));
            if (activeChat?.id === chatToDelete.id) {
              setActiveChat(null);
              setMessages([]);
            }
            setChatToDelete(null);
          } catch (err) {
            console.error("[sidebar] Failed to delete chat:", err);
          } finally {
            setDeleting(false);
          }
        }}
      />
    </aside>
  );
}
