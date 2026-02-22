import { AccessToken } from "livekit-server-sdk";
import { RoomAgentDispatch, RoomConfiguration } from "@livekit/protocol";
import type { LiveKitConfig } from "../config/schema.js";

export interface TokenRequest {
  participantName?: string;
  conversationId?: string;
  agentId?: string;
}

export interface TokenResponse {
  serverUrl: string;
  token: string;
  roomName: string;
  conversationId: string;
}

/**
 * Generate a LiveKit access token with agent auto-dispatch.
 * The conversationId is embedded in room metadata so the agent
 * knows which conversation to persist transcripts to.
 */
export async function generateToken(
  config: LiveKitConfig,
  req: TokenRequest,
): Promise<TokenResponse> {
  if (!config.url || !config.apiKey || !config.apiSecret) {
    throw new Error("LiveKit not configured: set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET");
  }

  const participantName = req.participantName || "user";
  const conversationId = req.conversationId || crypto.randomUUID();
  const roomName = `joi-voice-${conversationId}`;

  // Metadata the agent will read to know which conversation/agent to use
  const metadata = JSON.stringify({
    conversationId,
    agentId: req.agentId || "personal",
  });

  const at = new AccessToken(config.apiKey, config.apiSecret, {
    identity: participantName,
    name: participantName,
    metadata,
    ttl: "10m",
  });

  at.addGrant({ roomJoin: true, room: roomName });

  // Auto-dispatch our JOI agent when the participant joins
  at.roomConfig = new RoomConfiguration({
    agents: [new RoomAgentDispatch({ agentName: "joi-voice" })],
    metadata,
  });

  const token = await at.toJwt();

  return {
    serverUrl: config.url,
    token,
    roomName,
    conversationId,
  };
}
