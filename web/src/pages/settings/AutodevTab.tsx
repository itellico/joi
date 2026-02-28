import { Card, FormField, FormGrid, MetaText } from "../../components/ui";
import type { SettingsData } from "./types";

interface AutodevTabProps {
  settings: SettingsData;
  setSettings: React.Dispatch<React.SetStateAction<SettingsData | null>>;
}

export default function AutodevTab({ settings, setSettings }: AutodevTabProps) {
  const executorMode = settings.autodev.executorMode;
  const isAutoMode = executorMode === "auto";

  return (
    <div className="flex-col gap-6">
      <Card>
        <h3 className="mb-1">AutoDev Runtime</h3>
        <MetaText size="sm" className="block mb-4 text-md">
          Runtime controls for task routing and discussion behavior. Changes apply immediately on save.
        </MetaText>
        <FormGrid>
          <FormField label="Executor Mode" hint="Auto = route per task. Fixed mode forces one executor for all tasks.">
            <select
              value={executorMode}
              onChange={(e) =>
                setSettings((s) => s
                  ? {
                    ...s,
                    autodev: {
                      ...s.autodev,
                      executorMode: e.target.value as SettingsData["autodev"]["executorMode"],
                    },
                  }
                  : s)
              }
            >
              <option value="auto">Auto routing</option>
              <option value="codex-cli">Codex only</option>
              <option value="claude-code">Claude only</option>
              <option value="gemini-cli">Gemini only</option>
            </select>
          </FormField>

          <FormField label="Parallel Writer + Shadow" hint="Only used when Executor Mode is Auto and route is not strict.">
            <label className="flex-row items-center gap-2 text-sm" style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={settings.autodev.parallelExecution}
                onChange={(e) =>
                  setSettings((s) => s
                    ? { ...s, autodev: { ...s.autodev, parallelExecution: e.target.checked } }
                    : s)
                }
              />
              <span>{settings.autodev.parallelExecution ? "Enabled" : "Disabled"}</span>
            </label>
            {!isAutoMode && (
              <MetaText size="sm" className="mt-2 block text-md">
                Parallel mode is ignored when Executor Mode is fixed.
              </MetaText>
            )}
          </FormField>
        </FormGrid>
      </Card>

      <Card>
        <h3 className="mb-1">Discussion Mode</h3>
        <MetaText size="sm" className="block mb-4 text-md">
          When enabled, Codex and Claude discuss implementation first, then Codex executes.
        </MetaText>
        <FormGrid>
          <FormField label="Enable Discussion" hint="Use for difficult tasks where pre-implementation debate is useful.">
            <label className="flex-row items-center gap-2 text-sm" style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={settings.autodev.discussionMode}
                onChange={(e) =>
                  setSettings((s) => s
                    ? { ...s, autodev: { ...s.autodev, discussionMode: e.target.checked } }
                    : s)
                }
              />
              <span>{settings.autodev.discussionMode ? "Enabled" : "Disabled"}</span>
            </label>
          </FormField>

          <FormField label="Max Discussion Turns" hint="Hard cap per task before final Codex execution.">
            <select
              value={String(settings.autodev.discussionMaxTurns)}
              onChange={(e) =>
                setSettings((s) => s
                  ? {
                    ...s,
                    autodev: {
                      ...s.autodev,
                      discussionMaxTurns: Math.min(5, Math.max(1, Math.floor(Number(e.target.value) || 5))),
                    },
                  }
                  : s)
              }
            >
              <option value="1">1 turn</option>
              <option value="2">2 turns</option>
              <option value="3">3 turns</option>
              <option value="4">4 turns</option>
              <option value="5">5 turns</option>
            </select>
          </FormField>
        </FormGrid>
      </Card>
    </div>
  );
}
