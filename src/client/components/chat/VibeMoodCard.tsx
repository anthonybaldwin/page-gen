import { useState } from "react";
import { Button } from "../ui/button.tsx";
import { Badge } from "../ui/badge.tsx";
import { CheckCircle2, ChevronDown } from "lucide-react";
import type { Message } from "../../../shared/types.ts";
import { parseMetadata } from "./MessageList.tsx";

interface Props {
  msg: Message;
  projectId?: string;
}

export function VibeMoodCard({ msg, projectId }: Props) {
  const [expanded, setExpanded] = useState(false);
  const meta = parseMetadata(msg);
  if (!meta) return null;

  const metaType = meta.type as string;
  const isVibe = metaType === "vibe-brief";
  const isMood = metaType === "mood-analysis";
  const isCheckpointResolved = metaType === "checkpoint-resolved";
  const displayName = isVibe ? "Vibe Brief" : isMood ? "Mood Analysis" : "Checkpoint";

  // Build summary text for collapsed view
  const summary = isVibe
    ? (meta.adjectives as string[] | undefined)?.slice(0, 3).join(", ") || "Vibe captured"
    : isMood
      ? (meta.data as Record<string, unknown>)?.moodKeywords
        ? ((meta.data as Record<string, unknown>).moodKeywords as string[]).slice(0, 3).join(", ")
        : "Mood analyzed"
      : (meta.label as string) || "Checkpoint resolved";

  return (
    <div className="flex justify-start px-4 py-1.5">
      <div className="w-full max-w-[85%] rounded-lg overflow-hidden border bg-card/50 border-border/60 transition-colors">
        {/* Header — matches AgentThinkingMessage pattern */}
        <Button
          variant="ghost"
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2.5 px-3 py-2 h-auto justify-start rounded-none hover:bg-accent/50 group"
        >
          <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
          <span className="text-sm font-medium text-muted-foreground">{displayName}</span>
          <span className="text-xs text-muted-foreground flex-1 truncate">{summary}</span>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-all shrink-0 ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </Button>

        {/* Expandable body */}
        {expanded && (
          <div className="border-t border-border/60 px-4 py-3 space-y-3">
            {isVibe ? (
              <VibeContent meta={meta} />
            ) : isCheckpointResolved ? (
              <CheckpointResolvedContent meta={meta} />
            ) : (
              <MoodContent meta={meta} projectId={projectId} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function VibeContent({ meta }: { meta: Record<string, unknown> }) {
  const adjectives = (meta.adjectives as string[] | undefined) || [];
  const metaphor = meta.metaphor as string | undefined;
  const customMetaphor = meta.customMetaphor as string | undefined;
  const targetUser = meta.targetUser as string | undefined;
  const antiRefs = meta.antiReferences as string[] | undefined;
  const additionalNotes = meta.additionalNotes as string | undefined;

  const displayMetaphor = metaphor === "custom" && customMetaphor ? customMetaphor : metaphor;

  return (
    <>
      {adjectives.length > 0 && (
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Feel</span>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {adjectives.map((adj, i) => (
              <Badge key={i} variant="secondary" className="text-xs px-2 py-0.5">{adj}</Badge>
            ))}
          </div>
        </div>
      )}
      {displayMetaphor && (
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Metaphor</span>
          <p className="text-xs text-foreground mt-0.5">{displayMetaphor}</p>
        </div>
      )}
      {targetUser && (
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Target User</span>
          <p className="text-xs text-foreground mt-0.5">{targetUser}</p>
        </div>
      )}
      {antiRefs && (Array.isArray(antiRefs) ? antiRefs.length > 0 : String(antiRefs).length > 0) && (
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Avoid</span>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {(typeof antiRefs === "string" ? [antiRefs] : antiRefs).map((ref, i) => (
              <Badge key={i} variant="outline" className="text-xs px-2 py-0.5 text-destructive/70 border-destructive/30">{ref}</Badge>
            ))}
          </div>
        </div>
      )}
      {additionalNotes && (
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Notes</span>
          <p className="text-xs text-foreground mt-0.5">{additionalNotes}</p>
        </div>
      )}
    </>
  );
}

function MoodContent({ meta, projectId }: { meta: Record<string, unknown>; projectId?: string }) {
  const data = (meta.data as Record<string, unknown>) || {};
  const images = (meta.images as string[]) || [];
  const palette = (data.palette as string[]) || [];
  const styleDescriptors = (data.styleDescriptors as string[]) || [];
  const moodKeywords = (data.moodKeywords as string[]) || [];
  const textureNotes = data.textureNotes as string | undefined;
  const typographyHints = data.typographyHints as string | undefined;
  const layoutPatterns = data.layoutPatterns as string | undefined;
  const designEra = data.designEra as string | undefined;
  const componentPatterns = (data.componentPatterns as string[]) || [];

  return (
    <>
      {palette.length > 0 && (
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Palette</span>
          <div className="flex gap-1 mt-1">
            {palette.map((hex, i) => (
              <div
                key={i}
                className="w-8 h-8 rounded-md border border-border/40"
                style={{ backgroundColor: hex }}
                title={hex}
              />
            ))}
          </div>
        </div>
      )}
      {styleDescriptors.length > 0 && (
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Style</span>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {styleDescriptors.map((s, i) => (
              <Badge key={i} variant="secondary" className="text-xs px-2 py-0.5">{s}</Badge>
            ))}
          </div>
        </div>
      )}
      {moodKeywords.length > 0 && (
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Mood</span>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {moodKeywords.map((k, i) => (
              <Badge key={i} variant="secondary" className="text-xs px-2 py-0.5">{k}</Badge>
            ))}
          </div>
        </div>
      )}
      {textureNotes && (
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Textures</span>
          <p className="text-xs text-foreground mt-0.5">{textureNotes}</p>
        </div>
      )}
      {typographyHints && (
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Typography</span>
          <p className="text-xs text-foreground mt-0.5">{typographyHints}</p>
        </div>
      )}
      {layoutPatterns && (
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Layout</span>
          <p className="text-xs text-foreground mt-0.5">{layoutPatterns}</p>
        </div>
      )}
      {designEra && (
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Design Era</span>
          <p className="text-xs text-foreground mt-0.5">{designEra}</p>
        </div>
      )}
      {componentPatterns.length > 0 && (
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Component Patterns</span>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {componentPatterns.map((p, i) => (
              <Badge key={i} variant="secondary" className="text-xs px-2 py-0.5">{p}</Badge>
            ))}
          </div>
        </div>
      )}
      {images.length > 0 && projectId && (
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Inspiration Images</span>
          <div className="flex flex-wrap gap-2 mt-1">
            {images.map((filename, i) => (
              <img
                key={i}
                src={`/api/projects/${projectId}/mood-images/${filename}/file`}
                alt={`Mood ${i + 1}`}
                className="w-16 h-16 object-cover rounded-md border border-border/40"
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function CheckpointResolvedContent({ meta }: { meta: Record<string, unknown> }) {
  const label = meta.label as string | undefined;
  const options = (meta.options as Array<{ name: string; description?: string; colorPreview?: string[] }>) || [];
  const selectedIndex = meta.selectedIndex as number | undefined;

  return (
    <>
      {label && (
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Decision</span>
          <p className="text-xs text-foreground mt-0.5">{label}</p>
        </div>
      )}
      {options.length > 0 && (
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Options</span>
          <div className="space-y-1.5 mt-1">
            {options.map((opt, i) => (
              <div
                key={i}
                className={`text-xs rounded border overflow-hidden ${
                  i === selectedIndex
                    ? "border-emerald-500/50 bg-emerald-500/10 text-foreground"
                    : "border-border/40 text-muted-foreground opacity-50"
                }`}
              >
                {opt.colorPreview && opt.colorPreview.length > 0 && (
                  <div className="flex h-3">
                    {opt.colorPreview.map((hex, ci) => (
                      <div key={ci} className="flex-1" style={{ backgroundColor: hex }} />
                    ))}
                  </div>
                )}
                <div className="px-2 py-1">
                  <span className="font-medium">{opt.name}</span>
                  {opt.description && <span className="ml-1 opacity-70">— {opt.description}</span>}
                  {i === selectedIndex && <span className="ml-1 text-emerald-500 text-[10px]">(selected)</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
