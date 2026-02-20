import { Settings } from "lucide-react";
import { Button } from "../ui/button.tsx";

interface Props {
  onClick: () => void;
}

export function SettingsButton({ onClick }: Props) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground"
      aria-label="Settings"
    >
      <Settings className="h-4 w-4" />
    </Button>
  );
}
