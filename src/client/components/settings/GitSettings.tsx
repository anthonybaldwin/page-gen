import { useState, useEffect } from "react";
import { api } from "../../lib/api.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { Loader2, Check } from "lucide-react";

interface GitConfig {
  name: string;
  email: string;
}

export function GitSettings() {
  const [config, setConfig] = useState<GitConfig>({ name: "", email: "" });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<GitConfig>("/settings/git")
      .then(setConfig)
      .catch(() => setError("Failed to load git settings"));
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.put("/settings/git", config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Failed to save git settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium mb-1">Git Configuration</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Name and email used for version commits. Applied to all project repositories.
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Name</label>
          <Input
            value={config.name}
            onChange={(e) => setConfig({ ...config, name: e.target.value })}
            placeholder="Page Gen User"
            className="text-sm"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Email</label>
          <Input
            value={config.email}
            onChange={(e) => setConfig({ ...config, email: e.target.value })}
            placeholder="user@pagegen.local"
            className="text-sm"
          />
        </div>
      </div>

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      <Button
        onClick={handleSave}
        disabled={saving}
        size="sm"
        className="text-xs"
      >
        {saving ? (
          <Loader2 className="h-3 w-3 animate-spin mr-1" />
        ) : saved ? (
          <Check className="h-3 w-3 mr-1" />
        ) : null}
        {saved ? "Saved" : "Save"}
      </Button>
    </div>
  );
}
