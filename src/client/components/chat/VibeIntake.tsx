import { useState, useRef, useCallback } from "react";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { api, apiUpload } from "../../lib/api.ts";
import type { VibeBrief, Project } from "../../../shared/types.ts";
import { Palette, Sparkles, ImagePlus, X } from "lucide-react";

const ADJECTIVE_PRESETS = [
  "minimal", "bold", "playful", "serious", "warm", "cool",
  "professional", "experimental", "elegant", "raw", "clean", "dense",
  "airy", "structured", "organic", "technical", "nostalgic", "futuristic",
  "corporate", "indie", "luxury", "accessible", "editorial", "cozy",
];

const METAPHORS = [
  { value: "studio", label: "Studio" },
  { value: "workshop", label: "Workshop" },
  { value: "library", label: "Library" },
  { value: "arcade", label: "Arcade" },
  { value: "cabin", label: "Cabin" },
  { value: "cockpit", label: "Cockpit" },
  { value: "gallery", label: "Gallery" },
  { value: "campsite", label: "Campsite" },
  { value: "custom", label: "Custom" },
];

interface VibeIntakeProps {
  projectId: string;
  onApply: (brief: VibeBrief) => void;
  onSkip: () => void;
}

export function VibeIntake({ projectId, onApply, onSkip }: VibeIntakeProps) {
  const [adjectives, setAdjectives] = useState<string[]>([]);
  const [customAdj, setCustomAdj] = useState("");
  const [metaphor, setMetaphor] = useState("studio");
  const [customMetaphor, setCustomMetaphor] = useState("");
  const [targetUser, setTargetUser] = useState("");
  const [antiReferences, setAntiReferences] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [moodImages, setMoodImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadMoodImages = useCallback(async (files: FileList) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const formData = new FormData();
      for (const file of Array.from(files)) {
        formData.append("images", file);
      }
      const res = await apiUpload<{ uploaded: string[] }>(`/projects/${projectId}/mood-images`, formData);
      setMoodImages((prev) => [...prev, ...res.uploaded]);
    } catch (err) {
      console.error("[VibeIntake] Failed to upload mood images:", err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [projectId]);

  async function removeMoodImage(filename: string) {
    try {
      await api.delete(`/projects/${projectId}/mood-images/${filename}`);
      setMoodImages((prev) => prev.filter((f) => f !== filename));
    } catch (err) {
      console.error("[VibeIntake] Failed to remove mood image:", err);
    }
  }

  function toggleAdj(adj: string) {
    setAdjectives((prev) =>
      prev.includes(adj) ? prev.filter((a) => a !== adj) : [...prev, adj]
    );
  }

  function addCustomAdj() {
    const trimmed = customAdj.trim().toLowerCase();
    if (trimmed && !adjectives.includes(trimmed)) {
      setAdjectives((prev) => [...prev, trimmed]);
      setCustomAdj("");
    }
  }

  async function handleApply() {
    setSaving(true);
    const brief: VibeBrief = {
      adjectives,
      targetUser,
      antiReferences,
      metaphor,
      ...(metaphor === "custom" ? { customMetaphor } : {}),
      ...(additionalNotes ? { additionalNotes } : {}),
    };
    try {
      await api.patch<Project>(`/projects/${projectId}`, { vibeBrief: brief });
      onApply(brief);
    } catch (err) {
      console.error("[VibeIntake] Failed to save vibe brief:", err);
      // Still apply locally so the pipeline isn't blocked
      onApply(brief);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-4 my-3 rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Palette className="h-4 w-4 text-violet-500" />
        <span>How should this feel?</span>
        <span className="text-muted-foreground font-normal text-xs ml-1">(optional — shapes the design)</span>
      </div>

      {/* Adjectives */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">Pick 3-6 vibes</label>
        <div className="flex flex-wrap gap-1.5">
          {ADJECTIVE_PRESETS.map((adj) => (
            <Badge
              key={adj}
              variant={adjectives.includes(adj) ? "default" : "outline"}
              className="cursor-pointer select-none text-xs px-2 py-0.5 transition-colors"
              onClick={() => toggleAdj(adj)}
            >
              {adj}
            </Badge>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={customAdj}
            onChange={(e) => setCustomAdj(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustomAdj())}
            placeholder="Add custom..."
            className="flex-1 h-7 rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={addCustomAdj} disabled={!customAdj.trim()}>
            Add
          </Button>
        </div>
      </div>

      {/* Mood Board */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">Inspiration images (optional, max 10)</label>
        <div className="flex flex-wrap gap-2">
          {moodImages.map((filename) => (
            <div key={filename} className="relative group w-16 h-16 rounded-md overflow-hidden border border-border">
              <img
                src={`/api/projects/${projectId}/mood-images/${filename}/file`}
                alt="Mood"
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => removeMoodImage(filename)}
                className="absolute top-0 right-0 p-0.5 bg-black/60 rounded-bl-md opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3 text-white" />
              </button>
            </div>
          ))}
          {moodImages.length < 10 && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-16 h-16 rounded-md border border-dashed border-border hover:border-violet-400 flex items-center justify-center text-muted-foreground hover:text-violet-500 transition-colors"
            >
              {uploading ? (
                <span className="text-[10px]">...</span>
              ) : (
                <ImagePlus className="h-5 w-5" />
              )}
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.gif"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && uploadMoodImages(e.target.files)}
        />
      </div>

      {/* Metaphor */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">It should feel like a...</label>
        <div className="flex flex-wrap gap-1.5">
          {METAPHORS.map((m) => (
            <Badge
              key={m.value}
              variant={metaphor === m.value ? "default" : "outline"}
              className="cursor-pointer select-none text-xs px-2 py-0.5 transition-colors"
              onClick={() => setMetaphor(m.value)}
            >
              {m.label}
            </Badge>
          ))}
        </div>
        {metaphor === "custom" && (
          <input
            type="text"
            value={customMetaphor}
            onChange={(e) => setCustomMetaphor(e.target.value)}
            placeholder="Describe the feeling..."
            className="w-full h-7 rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
        )}
      </div>

      {/* Optional fields — collapsed by default */}
      <details className="group">
        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
          More options (target user, anti-references, notes)
        </summary>
        <div className="mt-2 space-y-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Who is this for?</label>
            <input
              type="text"
              value={targetUser}
              onChange={(e) => setTargetUser(e.target.value)}
              placeholder="e.g. Creative professionals who value simplicity"
              className="w-full h-7 mt-1 rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">What should it NOT feel like?</label>
            <input
              type="text"
              value={antiReferences}
              onChange={(e) => setAntiReferences(e.target.value)}
              placeholder="e.g. Corporate, cluttered, like a government website"
              className="w-full h-7 mt-1 rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Additional notes</label>
            <textarea
              value={additionalNotes}
              onChange={(e) => setAdditionalNotes(e.target.value)}
              placeholder="Anything else the AI should know about the design direction..."
              rows={2}
              className="w-full mt-1 rounded-md border border-border bg-background px-2 py-1 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
      </details>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-1">
        <Button
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={handleApply}
          disabled={saving}
        >
          <Sparkles className="h-3 w-3" />
          {saving ? "Saving..." : "Apply & Build"}
        </Button>
        <button
          type="button"
          onClick={onSkip}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Skip — use defaults
        </button>
      </div>
    </div>
  );
}
