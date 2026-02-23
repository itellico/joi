import type Anthropic from "@anthropic-ai/sdk";
import type { ToolContext } from "../agent/tools.js";
import {
  ensureAvatarStyleGuide,
  generateAvatarAndStore,
  generateAvatarsForAllAgents,
  saveAvatarStyleGuide,
  type AvatarRenderMode,
} from "./avatar-studio.js";

type ToolHandler = (input: unknown, ctx: ToolContext) => Promise<unknown>;

export function getAvatarToolHandlers(): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  handlers.set("gemini_avatar_generate", async (input, ctx) => {
    const {
      agent_id,
      agent_name,
      prompt,
      soul_document,
      mode,
      model,
    } = input as {
      agent_id: string;
      agent_name?: string;
      prompt: string;
      soul_document?: string;
      mode?: AvatarRenderMode;
      model?: string;
    };

    if (!agent_id) return { error: "agent_id is required" };
    if (!prompt || !prompt.trim()) return { error: "prompt is required" };

    const result = await generateAvatarAndStore({
      config: ctx.config,
      conversationId: ctx.conversationId || null,
      agentId: agent_id,
      agentName: (agent_name || agent_id).trim(),
      prompt,
      soulDocument: soul_document,
      mode,
      model,
    });

    return {
      ok: true,
      ...result,
    };
  });

  handlers.set("gemini_avatar_generate_all", async (input, ctx) => {
    const { prompt, mode, model } = input as {
      prompt?: string;
      mode?: AvatarRenderMode;
      model?: string;
    };

    const results = await generateAvatarsForAllAgents({
      config: ctx.config,
      prompt: prompt || undefined,
      mode,
      model,
      conversationId: ctx.conversationId || null,
    });

    const succeeded = results.filter((r) => r.result);
    const failed = results.filter((r) => r.error);

    return {
      ok: true,
      total: results.length,
      succeeded: succeeded.length,
      failed: failed.length,
      results: results.map((r) => ({
        agentId: r.agentId,
        agentName: r.agentName,
        fileUrl: r.result?.fileUrl || null,
        error: r.error || null,
      })),
    };
  });

  handlers.set("avatar_style_get", async (_input, ctx) => {
    const style = await ensureAvatarStyleGuide(ctx.config);
    return {
      ok: true,
      source: style.source,
      note_path: style.notePath,
      created: style.created,
      content: style.content,
    };
  });

  handlers.set("avatar_style_set", async (input, ctx) => {
    const { content } = input as { content: string };
    if (!content || !content.trim()) return { error: "content is required" };

    const style = await saveAvatarStyleGuide(ctx.config, content);
    return {
      ok: true,
      source: style.source,
      note_path: style.notePath,
      content: style.content,
    };
  });

  return handlers;
}

export function getAvatarToolDefinitions(): Anthropic.Tool[] {
  return [
    {
      name: "gemini_avatar_generate",
      description:
        "Generate a consistent agent avatar image using Gemini image generation (Nano Banana and Nano Banana Pro style modes), " +
        "apply the shared Obsidian avatar style guide, and store the result in JOI Media.",
      input_schema: {
        type: "object" as const,
        properties: {
          agent_id: {
            type: "string",
            description: "Target JOI agent id (example: coder, scout, avatar-studio)",
          },
          agent_name: {
            type: "string",
            description: "Human readable agent name for prompt context",
          },
          prompt: {
            type: "string",
            description: "Creative direction for the avatar",
          },
          soul_document: {
            type: "string",
            description: "Optional personality/soul text to influence style",
          },
          mode: {
            type: "string",
            enum: ["nano", "pro"],
            description: "nano = gemini-2.5-flash-image, pro = gemini-3-pro-image-preview",
          },
          model: {
            type: "string",
            description: "Optional explicit Gemini model override",
          },
        },
        required: ["agent_id", "prompt"],
      },
    },
    {
      name: "gemini_avatar_generate_all",
      description:
        "Generate new avatars for ALL enabled agents in one batch. " +
        "Old avatars are automatically retired (housekeeping). " +
        "Each agent gets a unique avatar derived from its name and soul document.",
      input_schema: {
        type: "object" as const,
        properties: {
          prompt: {
            type: "string",
            description:
              "Optional shared creative direction applied to every agent (each avatar is still unique). " +
              "Examples: 'cyberpunk neon aesthetic', 'riding bikes in nature', 'steampunk inventors'.",
          },
          mode: {
            type: "string",
            enum: ["nano", "pro"],
            description: "nano = fast iterations, pro = polished final variants",
          },
          model: {
            type: "string",
            description: "Optional explicit Gemini model override",
          },
        },
        required: [],
      },
    },
    {
      name: "avatar_style_get",
      description:
        "Read the shared avatar style guide from Obsidian. Creates a default guide if missing.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "avatar_style_set",
      description:
        "Update the shared avatar style guide in Obsidian so all future generated avatars stay visually consistent.",
      input_schema: {
        type: "object" as const,
        properties: {
          content: {
            type: "string",
            description: "Full markdown content for the avatar style guide",
          },
        },
        required: ["content"],
      },
    },
  ];
}
