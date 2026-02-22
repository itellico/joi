import { Card, Badge, Button, MetaText } from "../../components/ui";
import type { ModelRoute, AvailableModels, OllamaStatus, SettingsData } from "./types";

const taskDescriptions: Record<string, string> = {
  chat: "Final response + reasoning (smart model)",
  tool: "Tool orchestration (fast/cheap model for actions)",
  utility: "Fact extraction, classification (cheap)",
  triage: "Inbox triage: classify inbound messages",
  embedding: "Vector embeddings (local Ollama)",
};

interface ModelsTabProps {
  settings: SettingsData;
  routes: ModelRoute[];
  models: AvailableModels | null;
  ollama: OllamaStatus | null;
  pullingModel: boolean;
  pullingLlmModel: string | null;
  updateRoute: (task: string, field: "model" | "provider", value: string) => void;
  pullOllamaModel: () => void;
  pullOllamaLlmModel: (model: string) => void;
}

export default function ModelsTab({
  settings,
  routes,
  models,
  ollama,
  pullingModel,
  pullingLlmModel,
  updateRoute,
  pullOllamaModel,
  pullOllamaLlmModel,
}: ModelsTabProps) {
  const activeOllamaRoute = routes.find((r) => r.provider === "ollama" && r.task !== "embedding");
  const activeOllamaModel = activeOllamaRoute?.model || "qwen3";

  return (
    <div className="flex-col gap-6">
      {/* Model Routing */}
      <Card>
        <h3 className="mb-1">Model Routing</h3>
        <MetaText size="sm" className="block mb-4 text-md">
          Two-phase routing: <strong>Tool</strong> (fast/cheap) handles action orchestration, <strong>Chat</strong> (smart) generates the final response. When both differ, actions use the tool model, then the chat model writes the answer.
        </MetaText>
        <div className="flex-col gap-4">
          {routes.map((route) => {
            const noAnthropicKey = route.provider === "anthropic" && models && !models.hasAnthropicKey;
            const fallbackToOR = noAnthropicKey && models?.hasOpenRouterKey;
            const noKeyAtAll = noAnthropicKey && !models?.hasOpenRouterKey;

            return (
              <div key={route.task} className="route-row">
                <div className="route-label">
                  <strong className="capitalize">{route.task}</strong>
                  <MetaText size="xs" className="text-base">
                    {taskDescriptions[route.task] || ""}
                  </MetaText>
                </div>
                <div className="flex-col gap-1 flex-1 route-controls">
                  <div className="flex-row gap-2">
                    <select
                      value={route.provider}
                      onChange={(e) => updateRoute(route.task, "provider", e.target.value)}
                      disabled={route.task === "embedding"}
                      style={noAnthropicKey ? { borderColor: "var(--warning, #ff9f0a)" } : undefined}
                    >
                      <option value="anthropic">Anthropic</option>
                      <option value="openrouter">OpenRouter</option>
                      <option value="ollama">Ollama (Free)</option>
                    </select>
                    {route.task === "embedding" ? (
                      <input value={route.model} disabled className="flex-1" />
                    ) : (
                      <select
                        value={route.model}
                        onChange={(e) => updateRoute(route.task, "model", e.target.value)}
                        className="flex-1"
                      >
                        {route.provider === "anthropic" && models?.available.anthropic.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} (${m.costPer1kIn}/{m.costPer1kOut} per 1K)
                          </option>
                        ))}
                        {route.provider === "openrouter" && models?.available.openrouter.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} (${m.costPer1kIn}/{m.costPer1kOut} per 1K)
                          </option>
                        ))}
                        {route.provider === "ollama" && models?.available.ollama.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} (Free)
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  {fallbackToOR && (
                    <MetaText size="xs" className="text-warning">
                      No Anthropic API key — using OpenRouter as fallback
                    </MetaText>
                  )}
                  {noKeyAtAll && (
                    <MetaText size="xs" className="text-error">
                      No Anthropic API key — calls will fail. Add a key below or switch provider.
                    </MetaText>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Ollama Status */}
      <Card>
        <h3 className="mb-4">Ollama (Embeddings + LLM)</h3>
        <div className="flex-row gap-4 flex-wrap mb-3">
          <div>
            <MetaText size="sm" className="mr-2">Status:</MetaText>
            {ollama?.available
              ? <Badge status="success">Running</Badge>
              : <Badge status="error">Not Running</Badge>
            }
          </div>
          <div>
            <MetaText size="sm" className="mr-2">URL:</MetaText>
            <code>{settings.memory.ollamaUrl}</code>
          </div>
        </div>
        <div className="flex-row gap-4 flex-wrap">
          <div>
            <MetaText size="sm" className="mr-2">
              Embeddings ({settings.memory.embeddingModel}):
            </MetaText>
            {ollama?.modelLoaded ? (
              <Badge status="success">Loaded</Badge>
            ) : (
              <>
                <Badge status="warning">Not Loaded</Badge>
                <Button
                  size="sm"
                  className="ml-2"
                  onClick={pullOllamaModel}
                  disabled={pullingModel || !ollama?.available}
                >
                  {pullingModel ? "Pulling..." : "Pull Model"}
                </Button>
              </>
            )}
          </div>
          <div>
            <MetaText size="sm" className="mr-2">
              LLM ({activeOllamaModel}):
            </MetaText>
            <Button
              size="sm"
              onClick={() => pullOllamaLlmModel(activeOllamaModel)}
              disabled={!ollama?.available || pullingLlmModel !== null}
            >
              {pullingLlmModel === activeOllamaModel ? "Pulling..." : `Pull ${activeOllamaModel}`}
            </Button>
          </div>
        </div>
        <MetaText size="xs" className="block mt-3 text-base">
          Ollama can also serve LLM models (Qwen 3/3.5, Llama, etc.) for free. Select "Ollama (Free)" as provider in Model Routing above.
          Run <code>ollama run qwen3</code> to set up a local Qwen model.
        </MetaText>
      </Card>
    </div>
  );
}
