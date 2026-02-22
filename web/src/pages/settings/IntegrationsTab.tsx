import { Card, Badge, FormField, FormGrid, MetaText } from "../../components/ui";
import type { SettingsData, CoderConfig, AvailableModels } from "./types";

interface IntegrationsTabProps {
  settings: SettingsData;
  setSettings: React.Dispatch<React.SetStateAction<SettingsData | null>>;
  coderConfig: CoderConfig | null;
  setCoderConfig: React.Dispatch<React.SetStateAction<CoderConfig | null>>;
  models: AvailableModels | null;
  telegramBotToken: string;
  setTelegramBotToken: React.Dispatch<React.SetStateAction<string>>;
}

export default function IntegrationsTab({
  settings, setSettings, coderConfig, setCoderConfig, models, telegramBotToken, setTelegramBotToken,
}: IntegrationsTabProps) {
  return (
    <div className="flex-col gap-6">
      {/* Coder Agent */}
      {coderConfig && (
        <Card>
          <h3 className="mb-1">Coder Agent</h3>
          <MetaText size="sm" className="block mb-4 text-md">
            Coding agent that delegates to Claude Code CLI. Configurable orchestration model and CLI settings.
          </MetaText>
          <FormGrid>
            <FormField label="Orchestration Model" hint="Model used for planning and coordination (API mode)">
              <select
                value={coderConfig.model}
                onChange={(e) => setCoderConfig((c) => c ? { ...c, model: e.target.value } : c)}
              >
                {models?.available.anthropic.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
                {models?.available.openrouter.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Claude Code Model" hint="Model passed to CLI --model flag (e.g. sonnet, opus). Blank = CLI default.">
              <input
                type="text"
                placeholder="CLI default (leave blank)"
                value={coderConfig.claudeCodeModel}
                onChange={(e) => setCoderConfig((c) => c ? { ...c, claudeCodeModel: e.target.value } : c)}
              />
            </FormField>
            <FormField label="Working Directory" hint="Default CWD for Claude Code sessions">
              <input
                type="text"
                placeholder="~/dev_mm/joi"
                value={coderConfig.defaultCwd}
                onChange={(e) => setCoderConfig((c) => c ? { ...c, defaultCwd: e.target.value } : c)}
              />
            </FormField>
          </FormGrid>
        </Card>
      )}

      {/* Telegram Bot */}
      <Card>
        <h3 className="mb-1">Telegram Bot</h3>
        <MetaText size="sm" className="block mb-4 text-md">
          JOI sends notifications, security reports, and daily briefings via this Telegram bot.
        </MetaText>
        <FormGrid>
          <FormField label="Bot Username" hint="The @username of your Telegram bot (without @)">
            <div className="flex-row gap-2">
              <input
                type="text"
                placeholder="joi_pa_bot"
                value={settings.telegram.botUsername || ""}
                onChange={(e) =>
                  setSettings((s) => s ? { ...s, telegram: { ...s.telegram, botUsername: e.target.value } } : s)
                }
              />
              {settings.telegram.botUsername && <Badge status="success">@{settings.telegram.botUsername}</Badge>}
            </div>
          </FormField>
          <FormField label="Bot Token" hint="From @BotFather. Or set TELEGRAM_BOT_TOKEN in .env">
            <div className="flex-row gap-2">
              <input
                type="password"
                placeholder={settings.telegram.botToken || "123456:ABC-DEF..."}
                value={telegramBotToken}
                onChange={(e) => setTelegramBotToken(e.target.value)}
              />
              {settings.telegram.botToken && <Badge status="success">Active</Badge>}
            </div>
          </FormField>
          <FormField label="Chat ID" hint="Your Telegram user/chat ID for receiving notifications">
            <input
              type="text"
              placeholder="1478308564"
              value={settings.telegram.chatId || ""}
              onChange={(e) =>
                setSettings((s) => s ? { ...s, telegram: { ...s.telegram, chatId: e.target.value } } : s)
              }
            />
          </FormField>
        </FormGrid>
      </Card>
    </div>
  );
}
