import { ApiKeySettings } from "../billing/ApiKeySettings.tsx";
import { LimitsSettings } from "../billing/LimitsSettings.tsx";
import { ModelSettings } from "./ModelSettings.tsx";
import { PricingSettings } from "./PricingSettings.tsx";
import { PromptEditor } from "./PromptEditor.tsx";
import { ToolSettings } from "./ToolSettings.tsx";
import { GitSettings } from "./GitSettings.tsx";
import { AppearanceSettings } from "./AppearanceSettings.tsx";
import { PipelineSettings } from "./PipelineSettings.tsx";
import { FlowEditorTab } from "./FlowEditorTab.tsx";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs.tsx";
import { Button } from "../ui/button.tsx";
import { X } from "lucide-react";

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <Tabs defaultValue="keys" className="flex flex-col flex-1 min-h-0">
        {/* Pinned header */}
        <div className="shrink-0 border-b border-border">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-sm font-medium text-foreground">Settings</h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              aria-label="Close settings"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <TabsList className="w-full justify-start rounded-none bg-transparent px-4 h-auto pb-0 gap-1">
            <TabsTrigger value="keys" className="rounded-b-none data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary text-xs">
              API Keys
            </TabsTrigger>
            <TabsTrigger value="limits" className="rounded-b-none data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary text-xs">
              Limits
            </TabsTrigger>
            <TabsTrigger value="models" className="rounded-b-none data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary text-xs">
              Agents
            </TabsTrigger>
            <TabsTrigger value="pipeline" className="rounded-b-none data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary text-xs">
              Pipeline
            </TabsTrigger>
            <TabsTrigger value="tools" className="rounded-b-none data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary text-xs">
              Tools
            </TabsTrigger>
            <TabsTrigger value="prompts" className="rounded-b-none data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary text-xs">
              Prompts
            </TabsTrigger>
            <TabsTrigger value="pricing" className="rounded-b-none data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary text-xs">
              Models
            </TabsTrigger>
            <TabsTrigger value="git" className="rounded-b-none data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary text-xs">
              Git
            </TabsTrigger>
            <TabsTrigger value="appearance" className="rounded-b-none data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary text-xs">
              Appearance
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Content — flex column; tall tabs fill space, others scroll */}
        <div className="min-h-0 flex-1 flex flex-col p-4">
          <TabsContent value="keys" className="mt-0 flex-1 overflow-y-auto"><ApiKeySettings /></TabsContent>
          <TabsContent value="limits" className="mt-0 flex-1 overflow-y-auto">
            <LimitsSettings />
            <hr className="my-6 border-border" />
            <PipelineSettings />
          </TabsContent>
          <TabsContent value="models" className="mt-0 flex-1 overflow-y-auto"><ModelSettings /></TabsContent>
          <TabsContent value="pipeline" className="mt-0 flex-1 flex flex-col min-h-0"><FlowEditorTab /></TabsContent>
          <TabsContent value="pricing" className="mt-0 flex-1 overflow-y-auto"><PricingSettings /></TabsContent>
          <TabsContent value="prompts" className="mt-0 flex-1 flex flex-col min-h-0"><PromptEditor /></TabsContent>
          <TabsContent value="tools" className="mt-0 flex-1 overflow-y-auto"><ToolSettings /></TabsContent>
          <TabsContent value="git" className="mt-0 flex-1 overflow-y-auto"><GitSettings /></TabsContent>
          <TabsContent value="appearance" className="mt-0 flex-1 overflow-y-auto"><AppearanceSettings /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
