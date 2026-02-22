import { useState } from "react";
import { Button } from "../ui/button.tsx";
import { api } from "../../lib/api.ts";
import type { DesignOption } from "../../../shared/types.ts";
import { Check, Palette } from "lucide-react";

interface CheckpointCardProps {
  chatId: string;
  checkpointId: string;
  label: string;
  message: string;
  checkpointType: "approve" | "design_direction";
  options: DesignOption[];
  resolved?: { selectedIndex: number; timedOut?: boolean };
  onSelect: (checkpointId: string, selectedIndex: number) => void;
}

export function CheckpointCard({
  chatId,
  checkpointId,
  label,
  message,
  checkpointType,
  options,
  resolved,
  onSelect,
}: CheckpointCardProps) {
  const [selecting, setSelecting] = useState(false);

  async function handleSelect(index: number) {
    if (resolved || selecting) return;
    setSelecting(true);
    try {
      await api.post("/agents/checkpoint", { chatId, checkpointId, selectedIndex: index });
      onSelect(checkpointId, index);
    } catch (err) {
      console.error("[CheckpointCard] Failed to resolve checkpoint:", err);
      // Still notify parent to update UI
      onSelect(checkpointId, index);
    } finally {
      setSelecting(false);
    }
  }

  // Approve-type checkpoint: simple approve/skip buttons
  if (checkpointType === "approve") {
    return (
      <div className="mx-4 my-3 rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Palette className="h-4 w-4 text-violet-500" />
          <span>{label}</span>
        </div>
        <p className="text-xs text-muted-foreground">{message}</p>
        {resolved ? (
          <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" />
            <span>{resolved.timedOut ? "Auto-approved (timeout)" : "Approved"}</span>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-xs" onClick={() => handleSelect(0)} disabled={selecting}>
              {selecting ? "..." : "Approve & Continue"}
            </Button>
          </div>
        )}
      </div>
    );
  }

  // Design direction checkpoint: show option cards
  return (
    <div className="mx-4 my-3 rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Palette className="h-4 w-4 text-violet-500" />
        <span>{label}</span>
      </div>
      <p className="text-xs text-muted-foreground">{message}</p>

      <div className="flex gap-3 overflow-x-auto pb-1">
        {options.map((option, index) => {
          const isSelected = resolved?.selectedIndex === index;
          const isDimmed = resolved && !isSelected;

          return (
            <button
              key={index}
              type="button"
              onClick={() => handleSelect(index)}
              disabled={!!resolved || selecting}
              className={`
                flex-shrink-0 w-52 rounded-lg border p-3 text-left transition-all
                ${isSelected
                  ? "border-violet-500 bg-violet-500/10 ring-1 ring-violet-500/30"
                  : isDimmed
                    ? "border-border/50 opacity-50"
                    : "border-border hover:border-violet-400 hover:bg-accent/50 cursor-pointer"
                }
              `}
            >
              {/* Color swatch strip */}
              {option.colorPreview.length > 0 && (
                <div className="flex h-4 rounded-sm overflow-hidden mb-2">
                  {option.colorPreview.map((hex, ci) => (
                    <div
                      key={ci}
                      className="flex-1"
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </div>
              )}

              <div className="flex items-start justify-between gap-1">
                <span className="text-xs font-semibold text-foreground">{option.name}</span>
                {isSelected && <Check className="h-3.5 w-3.5 text-violet-500 flex-shrink-0" />}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1 line-clamp-3">{option.description}</p>
            </button>
          );
        })}
      </div>

      {resolved?.timedOut && (
        <p className="text-[11px] text-amber-500">Auto-selected due to timeout.</p>
      )}
    </div>
  );
}
