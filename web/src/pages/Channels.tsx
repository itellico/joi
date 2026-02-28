import { useEffect, useState, useCallback } from "react";
import { useLocation } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  EmptyState as UiEmptyState,
  FormField,
  MetaText,
  Modal,
  PageBody,
  PageHeader,
  Row,
  SectionLabel,
  Stack,
  StatusDot,
} from "../components/ui";
import {
  consumeIntegrationWatchdogAlert,
  consumeIntegrationWatchdogQr,
  type IntegrationWatchdogAlert,
} from "../lib/integrationWatchdog";

// ─── Types ───

interface Channel {
  id: string;
  channel_type:
    | "whatsapp"
    | "telegram"
    | "imessage"
    | "slack"
    | "discord"
    | "notion"
    | "emby"
    | "jellyseerr"
    | "webhook";
  enabled: boolean;
  status: string;
  display_name: string | null;
  error_message: string | null;
  last_connected_at: string | null;
  webhook_secret: string | null;
  scope: string | null;
  scope_metadata: Record<string, unknown> | null;
  language: string | null;
  created_at: string;
}

const LANGUAGE_OPTIONS: { value: string; label: string; flag: string }[] = [
  { value: "en", label: "English", flag: "\uD83C\uDDEC\uD83C\uDDE7" },
  { value: "de", label: "Deutsch", flag: "\uD83C\uDDE6\uD83C\uDDF9" },
  { value: "fr", label: "Fran\u00E7ais", flag: "\uD83C\uDDEB\uD83C\uDDF7" },
  { value: "es", label: "Espa\u00F1ol", flag: "\uD83C\uDDEA\uD83C\uDDF8" },
  { value: "it", label: "Italiano", flag: "\uD83C\uDDEE\uD83C\uDDF9" },
  { value: "pt", label: "Portugu\u00EAs", flag: "\uD83C\uDDF5\uD83C\uDDF9" },
];

interface GoogleAccount {
  id: string;
  email: string | null;
  display_name: string;
  scopes: string[];
  is_default: boolean;
  status: string;
  error_message: string | null;
  last_used_at: string | null;
  created_at: string;
}

interface ChannelMessageEvent {
  channelId: string;
  channelType: string;
  direction: "inbound" | "outbound";
  from: string;
  text: string;
  attachments?: Array<{ type: string; filename?: string }>;
  timestamp?: string;
}

const ATTACHMENT_ICONS: Record<string, string> = {
  photo: "\uD83D\uDCF7",
  video: "\uD83C\uDFA5",
  audio: "\uD83C\uDFA7",
  voice: "\uD83C\uDF99\uFE0F",
  document: "\uD83D\uDCC4",
  sticker: "\uD83D\uDE00",
  unknown: "\uD83D\uDCCE",
};

interface WsHandle {
  status: string;
  send: (type: string, data?: unknown, id?: string) => void;
  on: (type: string, handler: (frame: { data?: unknown }) => void) => () => void;
}

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  imessage: "iMessage",
  slack: "Slack",
  discord: "Discord",
  notion: "Notion",
  emby: "Emby",
  jellyseerr: "Jellyseerr",
  webhook: "Webhook",
};

const CHANNEL_CATEGORY_LABELS: Record<string, string> = {
  whatsapp: "Communication",
  telegram: "Communication",
  imessage: "Communication",
  slack: "Communication",
  discord: "Communication",
  notion: "Knowledge",
  emby: "Media",
  jellyseerr: "Media",
  webhook: "Automation",
};

const SETUP_GUIDES: Record<string, { steps: string[]; note?: string }> = {
  whatsapp: {
    steps: [
      "Give your channel a name (e.g. \"Personal WhatsApp\")",
      "Click \"Add Channel\" then click \"Connect\" on the new card",
      "A QR code will appear \u2014 open WhatsApp on your phone",
      "Go to Settings > Linked Devices > Link a Device",
      "Scan the QR code with your phone camera",
    ],
    note: "WhatsApp Web uses Baileys (open-source). Your session persists across restarts. No phone number or API key needed \u2014 just scan the QR code.",
  },
  telegram: {
    steps: [
      "Enter your phone number (with country code, e.g. +43...)",
      "Give the channel a name and click \"Add Channel\"",
      "Click \"Connect\" \u2014 Telegram will send you a login code",
      "Enter the code in the modal that appears",
      "If you have 2FA enabled, you'll also be prompted for your password",
    ],
    note: "This connects your personal Telegram account via MTProto (not a bot). JOI can read and reply to your messages directly. Session is saved for auto-reconnect.",
  },
  imessage: {
    steps: [
      "Make sure Messages.app is signed in to iMessage on this Mac",
      "Grant Full Disk Access to your terminal (System Settings > Privacy & Security)",
      "Grant Automation permission for Messages.app when prompted",
      "Give the channel a name and click \"Add Channel\", then \"Connect\"",
    ],
    note: "Uses native AppleScript to send and reads the Messages database directly for incoming messages. No extra software needed \u2014 just macOS permissions.",
  },
  slack: {
    steps: [
      "Create a Slack App at api.slack.com/apps (or install the same app to multiple workspaces)",
      "Enable Socket Mode and generate an App-Level Token (xapp-...)",
      "Under OAuth & Permissions, add bot scopes: channels:history, channels:read, chat:write, users:read, users:read.email",
      "Install the app to your workspace and copy the Bot User OAuth Token (xoxb-...)",
      "Enter both tokens below, give it a name, and click Add Channel",
    ],
    note: "Uses Socket Mode (WebSocket) \u2014 no public URL needed. Each workspace is a separate channel instance. Optionally limit to specific channels.",
  },
  discord: {
    steps: [
      "Create a Discord Application at discord.com/developers/applications",
      "Go to Bot settings, click Reset Token, and copy the bot token",
      "Enable MESSAGE CONTENT intent under Privileged Gateway Intents",
      "Invite the bot to your server using OAuth2 > URL Generator (scopes: bot; permissions: Read Messages, Send Messages)",
      "Enter the bot token below, give it a name, and click Add Channel",
    ],
    note: "Uses discord.js with WebSocket gateway. Optionally filter by guild and channel IDs. DM monitoring is off by default.",
  },
  notion: {
    steps: [
      "Go to notion.so/my-integrations and create a new integration",
      "Copy the Internal Integration Token (ntn_...)",
      "In Notion, share the pages/databases you want JOI to access with your integration",
      "Enter the token and workspace name below",
    ],
    note: "Notion is a tools-based integration (not a messaging channel). JOI's agent can search, read, create, and update Notion pages on your behalf.",
  },
  emby: {
    steps: [
      "Open Emby Dashboard > API Keys and create (or copy) an API key",
      "Enter your Emby server URL including port (for example: http://192.168.x.x:8096)",
      "Set a webhook secret in JOI and copy the Emby webhook URL from the channel card",
      "Configure Emby webhook URL: /api/webhooks/emby/<channel-id>?secret=<webhookSecret>",
      "Enter your API key and add the integration",
      "Click Connect to validate credentials and set status to connected",
    ],
    note: "Emby is both browsing + webhook integration. Webhook events are ingested into JOI through the gateway.",
  },
  jellyseerr: {
    steps: [
      "Open Jellyseerr Settings > General and copy your API key",
      "Enter your Jellyseerr server URL including port",
      "Set a webhook secret in JOI and copy the Jellyseerr webhook URL from the channel card",
      "Configure Jellyseerr webhook URL: /api/webhooks/jellyseerr/<channel-id>?secret=<webhookSecret>",
      "Enter API key and add the integration",
      "Click Connect to validate credentials and enable request management tools",
    ],
    note: "Jellyseerr supports request tools and inbound webhook events through JOI gateway webhooks.",
  },
  webhook: {
    steps: [
      "Set a channel name, then add a webhook secret in JOI",
      "Create the integration and copy its webhook URL from the channel card",
      "Generic webhook URL format: /api/webhooks/inbound/<channel-id>?secret=<webhookSecret>",
      "Configure your external app to send POST JSON to that URL",
      "Authenticate with one of: ?secret=<secret>, x-joi-webhook-secret, x-webhook-secret, or Authorization: Bearer <secret>",
      "Optional: configure sender/message/event field paths for custom payload mapping",
      "Click Connect to activate and start ingesting webhook events",
    ],
    note: "Webhook channels are inbound-only. JOI stores, triages, and routes these events through the same gateway inbox flow as other channels.",
  },
};

const CONNECTED_INFO: Record<string, string[]> = {
  whatsapp: [
    "JOI receives messages sent to your WhatsApp number and auto-replies",
    "Each sender gets their own conversation visible in the Chat page",
    "You can ask JOI to send WhatsApp messages via the channel_send tool",
    "Session persists across restarts \u2014 no need to re-scan",
  ],
  telegram: [
    "JOI receives messages sent to your personal Telegram account",
    "Each sender gets their own conversation visible in the Chat page",
    "You can ask JOI to send Telegram messages via the channel_send tool",
    "Session persists across restarts \u2014 auto-reconnects without re-auth",
  ],
  imessage: [
    "JOI receives iMessages by reading the Messages database directly",
    "Each sender gets their own conversation visible in the Chat page",
    "You can ask JOI to send iMessages via the channel_send tool",
    "Runs natively on this Mac \u2014 no extra software needed",
  ],
  slack: [
    "JOI receives messages from your Slack workspace via Socket Mode",
    "Each sender gets their own conversation visible in the Chat page",
    "You can ask JOI to send Slack messages via the channel_send tool",
    "Filter to specific channels or monitor everything including DMs",
  ],
  discord: [
    "JOI receives messages from your Discord server(s)",
    "Each sender gets their own conversation visible in the Chat page",
    "You can ask JOI to send Discord messages via the channel_send tool",
    "Filter by guild and channel \u2014 bot must be invited to the server",
  ],
  notion: [
    "JOI can search, read, and create Notion pages via agent tools",
    "Use notion_search, notion_read, notion_create in conversations",
    "Query Notion databases with filters via notion_query_db",
    "Multi-workspace support \u2014 add multiple Notion integrations with different scopes",
  ],
  emby: [
    "JOI can browse your Emby movie and series libraries",
    "Use emby_library and emby_search to discover content quickly",
    "Use emby_recently_watched, emby_continue_watching, and emby_next_up for watch state",
    "Use emby_now_playing to inspect active playback sessions",
  ],
  jellyseerr: [
    "JOI can search discover results via Jellyseerr",
    "Use jellyseerr_requests and jellyseerr_request_status to audit request flow",
    "Use jellyseerr_create_request and jellyseerr_cancel_request to manage requests",
    "Use jellyseerr_available to check if a title is available or still pending",
  ],
  webhook: [
    "JOI ingests incoming webhook events as channel messages",
    "Each sender/source is grouped into conversations in the Chat inbox",
    "Use webhookSecret and header/query auth to secure inbound calls",
    "Route any SaaS/app events through the JOI gateway endpoint",
  ],
};

// ─── Helpers ───

function scopeServices(scopes: string[]): string[] {
  const services: string[] = [];
  const joined = scopes.join(" ");
  if (joined.includes("gmail")) services.push("Gmail");
  if (joined.includes("calendar")) services.push("Calendar");
  if (joined.includes("drive")) services.push("Drive");
  return services.length > 0 ? services : ["Gmail", "Calendar", "Drive"];
}

type DotStatus = "ok" | "error" | "running" | "warning" | "muted";

function channelStatusToDot(status: string): DotStatus {
  switch (status) {
    case "connected": return "ok";
    case "connecting": return "running";
    case "error": return "error";
    case "pending":
    case "awaiting_code":
    case "awaiting_2fa": return "warning";
    default: return "muted";
  }
}

function channelBadgeStatus(channel: Channel): "success" | "error" | "warning" {
  if (channel.status === "connected") return "success";
  if (channel.status === "error") return "error";
  return "warning";
}

function channelNeedsAttention(status: string): boolean {
  return status === "disconnected" || status === "error" || status === "awaiting_code" || status === "awaiting_2fa";
}

// ─── Main Component ───

export default function Channels({ ws }: { ws: WsHandle }) {
  const location = useLocation();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [googleAccounts, setGoogleAccounts] = useState<GoogleAccount[]>([]);
  const [webhookBaseUrl, setWebhookBaseUrl] = useState("");
  const [webhookBaseSource, setWebhookBaseSource] = useState("");
  const [webhookNetworkMode, setWebhookNetworkMode] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showAddGoogle, setShowAddGoogle] = useState(false);
  const [qrModal, setQrModal] = useState<{ channelId: string; dataUrl: string } | null>(null);
  const [telegramAuth, setTelegramAuth] = useState<{ channelId: string; mode: "code" | "password" } | null>(null);
  const [messages, setMessages] = useState<ChannelMessageEvent[]>([]);
  const [watchdogAlert, setWatchdogAlert] = useState<IntegrationWatchdogAlert | null>(null);
  const [dismissedWatchdogKey, setDismissedWatchdogKey] = useState<string | null>(null);

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch("/api/channels");
      const data = await res.json();
      setChannels(data.channels || []);
    } catch (err) {
      console.error("Failed to load channels:", err);
    }
  }, []);

  const fetchGoogleAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/google/accounts");
      const data = await res.json();
      setGoogleAccounts(data.accounts || []);
    } catch (err) {
      console.error("Failed to load Google accounts:", err);
    }
  }, []);

  const fetchWebhookBase = useCallback(async () => {
    try {
      const res = await fetch("/api/gateway/webhook-base");
      const data = await res.json() as {
        webhookBaseUrl?: string | null;
        source?: string | null;
        networkMode?: string | null;
      };
      const resolved = (data.webhookBaseUrl || "").trim().replace(/\/+$/, "");
      setWebhookBaseUrl(resolved);
      setWebhookBaseSource((data.source || "").trim());
      setWebhookNetworkMode((data.networkMode || "").trim().toLowerCase());
    } catch (err) {
      console.error("Failed to resolve webhook base URL:", err);
      setWebhookBaseUrl("");
      setWebhookBaseSource("");
      setWebhookNetworkMode("");
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchChannels(), fetchGoogleAccounts(), fetchWebhookBase()]).finally(() => setLoading(false));
  }, [fetchChannels, fetchGoogleAccounts, fetchWebhookBase]);

  // Consume watchdog payloads that were queued while user was on another page.
  useEffect(() => {
    const alert = consumeIntegrationWatchdogAlert();
    if (alert) {
      setWatchdogAlert(alert);
      setDismissedWatchdogKey(null);
    }

    const qr = consumeIntegrationWatchdogQr();
    if (qr) setQrModal({ channelId: qr.channelId, dataUrl: qr.qrDataUrl });
  }, [location.key]);

  // Live status updates via WS
  useEffect(() => {
    const unsub1 = ws.on("channel.status", (frame) => {
      const data = frame.data as { channelId: string; status: string; error?: string; channelType?: string };
      setChannels((prev) =>
        prev.map((ch) =>
          ch.id === data.channelId
            ? { ...ch, status: data.status, error_message: data.error || null }
            : ch,
        ),
      );
      if (data.status === "awaiting_code") {
        setTelegramAuth({ channelId: data.channelId, mode: "code" });
      } else if (data.status === "awaiting_2fa") {
        setTelegramAuth({ channelId: data.channelId, mode: "password" });
      } else if (data.status === "connected" || data.status === "error") {
        setTelegramAuth((prev) => (prev?.channelId === data.channelId ? null : prev));
      }
    });

    const unsub2 = ws.on("channel.qr", (frame) => {
      const data = frame.data as { channelId: string; qrDataUrl: string };
      setQrModal({ channelId: data.channelId, dataUrl: data.qrDataUrl });
    });

    const unsub3 = ws.on("channel.message", (frame) => {
      const data = frame.data as ChannelMessageEvent;
      setMessages((prev) => [data, ...prev].slice(0, 50));
    });

    const unsub4 = ws.on("google.status", (frame) => {
      const data = frame.data as { accountId: string; status: string; account?: GoogleAccount };
      if (data.status === "deleted") {
        setGoogleAccounts((prev) => prev.filter((a) => a.id !== data.accountId));
      } else if (data.account) {
        setGoogleAccounts((prev) => {
          const exists = prev.find((a) => a.id === data.accountId);
          if (exists) {
            return prev.map((a) => (a.id === data.accountId ? data.account! : a));
          }
          return [...prev, data.account!];
        });
      }
    });

    return () => {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
    };
  }, [ws]);

  useEffect(() => {
    const pendingTelegram = channels.find((channel) => channel.status === "awaiting_code" || channel.status === "awaiting_2fa");
    if (pendingTelegram) {
      setTelegramAuth((prev) => (
        prev?.channelId === pendingTelegram.id
          ? prev
          : { channelId: pendingTelegram.id, mode: pendingTelegram.status === "awaiting_2fa" ? "password" : "code" }
      ));
    }

    if (!watchdogAlert) {
      const unhealthy = channels.find((channel) => channel.enabled && !!channel.last_connected_at && channelNeedsAttention(channel.status));
      if (unhealthy) {
        const unhealthyKey = `${unhealthy.id}:${unhealthy.status}`;
        if (dismissedWatchdogKey === unhealthyKey) return;
        setWatchdogAlert({
          channelId: unhealthy.id,
          channelType: unhealthy.channel_type,
          status: unhealthy.status,
          source: "heartbeat",
          message: `${CHANNEL_LABELS[unhealthy.channel_type] || unhealthy.channel_type} requires reconnect.`,
          detectedAt: new Date().toISOString(),
        });
      }
      return;
    }

    const tracked = channels.find((channel) => channel.id === watchdogAlert.channelId);
    if (tracked?.status === "connected") {
      setWatchdogAlert(null);
      setDismissedWatchdogKey(null);
    }
  }, [channels, dismissedWatchdogKey, watchdogAlert]);

  const handleConnect = async (id: string) => {
    try {
      await fetch(`/api/channels/${id}/connect`, { method: "POST" });
      fetchChannels();
    } catch (err) {
      console.error("Connect failed:", err);
    }
  };

  const handleDisconnect = async (id: string) => {
    try {
      await fetch(`/api/channels/${id}/disconnect`, { method: "POST" });
      fetchChannels();
    } catch (err) {
      console.error("Disconnect failed:", err);
    }
  };

  const handleDeleteChannel = async (id: string) => {
    if (!confirm(`Delete channel "${id}"?`)) return;
    try {
      await fetch(`/api/channels/${id}`, { method: "DELETE" });
      fetchChannels();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const handleDeleteGoogle = async (id: string) => {
    if (!confirm(`Remove Google account "${id}"?`)) return;
    try {
      await fetch(`/api/google/accounts/${id}`, { method: "DELETE" });
      fetchGoogleAccounts();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await fetch(`/api/google/accounts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_default: true }),
      });
      fetchGoogleAccounts();
    } catch (err) {
      console.error("Set default failed:", err);
    }
  };

  const handleReconnect = (id: string) => {
    window.open(`/api/google/accounts/${id}/auth`, "_blank", "width=600,height=700");
  };

  const connectedChannels = channels.filter((ch) => ch.status === "connected").length;
  const connectedGoogle = googleAccounts.filter((a) => a.status === "connected").length;
  const isEmpty = channels.length === 0 && googleAccounts.length === 0;
  const channelGroups = channels.reduce<Record<string, Channel[]>>((acc, ch) => {
    const group = CHANNEL_CATEGORY_LABELS[ch.channel_type] || "Other";
    if (!acc[group]) acc[group] = [];
    acc[group].push(ch);
    return acc;
  }, {});
  const channelGroupOrder = ["Communication", "Automation", "Media", "Knowledge", "Other"];

  function renderStatusSummary(): string {
    if (connectedChannels > 0 && connectedGoogle > 0) {
      return `${connectedChannels} integrations | ${connectedGoogle} Google`;
    }
    if (connectedChannels > 0) return `${connectedChannels} integrations`;
    if (connectedGoogle > 0) return `${connectedGoogle} Google`;
    return "none connected";
  }

  return (
    <>
      <PageHeader
        title="Integrations"
        actions={
          <>
            {!isEmpty && <MetaText size="sm">{renderStatusSummary()}</MetaText>}
            <Button variant="primary" size="sm" onClick={() => setShowAdd(true)}>
              + Add Integration
            </Button>
          </>
        }
      />

      <PageBody gap={20}>
        {watchdogAlert && (
          <Card className="channels-watchdog-alert">
            <Row justify="between" align="start" gap={3} wrap>
              <div>
                <Row gap={2} className="mb-2">
                  <Badge status="warning">Connection Alert</Badge>
                  <Badge status="warning">
                    {CHANNEL_LABELS[watchdogAlert.channelType] || watchdogAlert.channelType}
                  </Badge>
                </Row>
                <p className="channels-watchdog-title">
                  {watchdogAlert.message}
                </p>
                <MetaText size="xs">
                  Channel: {watchdogAlert.channelId} · Status: {watchdogAlert.status}
                </MetaText>
              </div>
              <Row gap={2}>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    void handleConnect(watchdogAlert.channelId);
                  }}
                >
                  Reconnect Now
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setDismissedWatchdogKey(`${watchdogAlert.channelId}:${watchdogAlert.status}`);
                    setWatchdogAlert(null);
                  }}
                >
                  Dismiss
                </Button>
              </Row>
            </Row>
          </Card>
        )}

        {loading ? (
          <Card><MetaText size="sm">Loading...</MetaText></Card>
        ) : isEmpty ? (
          <IntegrationsEmptyState onAdd={() => setShowAdd(true)} />
        ) : (
          <>
            {/* ─── Integrations Section ─── */}
            {channels.length > 0 && (
              <div>
                <SectionHeader title="Integrations" />
                <Stack gap={3}>
                  {channelGroupOrder
                    .filter((group) => (channelGroups[group] || []).length > 0)
                    .map((group) => (
                      <div key={group}>
                        <MetaText size="xs" className="block mb-2 text-secondary">
                          {group}
                        </MetaText>
                        <Stack gap={3}>
                          {(channelGroups[group] || []).map((ch) => (
                            <ChannelCard
                              key={ch.id}
                              channel={ch}
                              webhookBaseUrl={webhookBaseUrl}
                              webhookBaseSource={webhookBaseSource}
                              webhookNetworkMode={webhookNetworkMode}
                              onConnect={handleConnect}
                              onDisconnect={handleDisconnect}
                              onDelete={handleDeleteChannel}
                              onAuthPrompt={(id, mode) => setTelegramAuth({ channelId: id, mode })}
                            />
                          ))}
                        </Stack>
                      </div>
                    ))}
                </Stack>
              </div>
            )}

            {/* ─── Google Accounts Section ─── */}
            <div>
              <SectionHeader title="Google Accounts" />
              <Stack gap={3}>
                {googleAccounts.map((acct) => (
                  <GoogleAccountCard
                    key={acct.id}
                    account={acct}
                    onSetDefault={handleSetDefault}
                    onReconnect={handleReconnect}
                    onDelete={handleDeleteGoogle}
                  />
                ))}
                <button onClick={() => setShowAddGoogle(true)} className="channels-add-btn">
                  + Add Google Account
                </button>
              </Stack>
            </div>

            {/* ─── Live Activity ─── */}
            <MessageFeed messages={messages} />
          </>
        )}
      </PageBody>

      <AddIntegrationModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onAddChannel={() => {}}
        onAddGoogle={() => {
          setShowAdd(false);
          setShowAddGoogle(true);
        }}
        onChannelAdded={() => {
          setShowAdd(false);
          fetchChannels();
        }}
      />

      <AddGoogleAccountModal
        open={showAddGoogle}
        onClose={() => setShowAddGoogle(false)}
        onAdded={() => {
          setShowAddGoogle(false);
          fetchGoogleAccounts();
        }}
      />

      <QrModal
        open={qrModal !== null}
        channelId={qrModal?.channelId ?? ""}
        dataUrl={qrModal?.dataUrl ?? ""}
        onClose={() => setQrModal(null)}
      />

      <TelegramAuthModal
        open={telegramAuth !== null}
        channelId={telegramAuth?.channelId ?? ""}
        mode={telegramAuth?.mode ?? "code"}
        onClose={() => setTelegramAuth(null)}
      />
    </>
  );
}

/* ---------- Section Header ---------- */

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="channels-section-header">
      <SectionLabel className="nowrap">{title}</SectionLabel>
      <div className="channels-section-line" />
    </div>
  );
}

/* ---------- Empty State ---------- */

function IntegrationsEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <Card>
      <p className="text-primary text-md font-semibold mb-2 mt-0">
        Connect integrations to JOI
      </p>
      <MetaText size="sm" className="block mb-4 text-secondary leading-relaxed">
        Connect messaging channels and Google accounts so JOI can send emails, manage your calendar,
        and reply to messages on your behalf.
      </MetaText>

      <Row gap={3} wrap className="mb-4">
        <IntegrationPreview type="WhatsApp" desc="Scan a QR code to link your number" color="#25D366" />
        <IntegrationPreview type="Telegram" desc="Connect your personal account" color="#2AABEE" />
        <IntegrationPreview type="Slack" desc="Connect workspaces via Socket Mode" color="#4A154B" />
        <IntegrationPreview type="Discord" desc="Monitor servers with a bot" color="#5865F2" />
        <IntegrationPreview type="Notion" desc="Search, read, and create pages" color="#000000" />
        <IntegrationPreview type="Emby" desc="Browse media libraries and watch status" color="#52B54B" />
        <IntegrationPreview type="Jellyseerr" desc="Manage media request workflows" color="#6366F1" />
        <IntegrationPreview type="Webhook" desc="Ingest events from any external app" color="#FF7A00" />
        <IntegrationPreview type="Google" desc="Gmail, Calendar, and Drive" color="#4285F4" />
      </Row>

      <Button variant="primary" onClick={onAdd}>
        + Add Your First Integration
      </Button>
    </Card>
  );
}

function IntegrationPreview({ type, desc, color }: { type: string; desc: string; color: string }) {
  return (
    <div className="channels-integration-preview">
      <span className="text-sm font-semibold" style={{ color }}>{type}</span>
      <p className="text-xs text-muted">{desc}</p>
    </div>
  );
}

/* ---------- Channel Card ---------- */

function ChannelCard({
  channel,
  webhookBaseUrl,
  webhookBaseSource,
  webhookNetworkMode,
  onConnect,
  onDisconnect,
  onDelete,
  onAuthPrompt,
}: {
  channel: Channel;
  webhookBaseUrl: string;
  webhookBaseSource: string;
  webhookNetworkMode: string;
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  onDelete: (id: string) => void;
  onAuthPrompt?: (channelId: string, mode: "code" | "password") => void;
}) {
  const isConnected = channel.status === "connected";
  const isConnecting = channel.status === "connecting";
  const isAwaitingAuth = channel.status === "awaiting_code" || channel.status === "awaiting_2fa";
  const [showInfo, setShowInfo] = useState(false);

  const capabilities = CONNECTED_INFO[channel.channel_type] || [];
  const typeLabel = CHANNEL_LABELS[channel.channel_type] || channel.channel_type;
  const categoryLabel = CHANNEL_CATEGORY_LABELS[channel.channel_type] || "Other";
  const displayLabel = channel.display_name || channel.id;
  const showTypeBadge = displayLabel.trim().toLowerCase() !== typeLabel.toLowerCase();
  const webhookPathByType: Record<string, string | null> = {
    emby: `/api/webhooks/emby/${encodeURIComponent(channel.id)}`,
    jellyseerr: `/api/webhooks/jellyseerr/${encodeURIComponent(channel.id)}`,
    webhook: `/api/webhooks/inbound/${encodeURIComponent(channel.id)}`,
  };
  const webhookPath = webhookPathByType[channel.channel_type] || null;
  const hasWebhookEndpoint = Boolean(webhookPath);
  const originFallback = (() => {
    if (typeof window === "undefined") return "";
    try {
      const parsed = new URL(window.location.origin);
      const host = parsed.hostname.toLowerCase();
      if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1") {
        return "";
      }
      return parsed.origin;
    } catch {
      return "";
    }
  })();
  const webhookBase = (webhookBaseUrl || originFallback).replace(/\/+$/, "");
  const webhookUrl = hasWebhookEndpoint && webhookPath && webhookBase
    ? `${webhookBase}${webhookPath}${channel.webhook_secret ? `?secret=${encodeURIComponent(channel.webhook_secret)}` : ""}`
    : "";

  const copyWebhookUrl = () => {
    if (!webhookUrl || !navigator?.clipboard) return;
    void navigator.clipboard.writeText(webhookUrl);
  };

  return (
    <Card>
      <Row justify="between" align="start">
        <div className="flex-1">
          <Row gap={2} className="mb-2">
            <span className="text-md font-semibold">
              {displayLabel}
            </span>
            <Badge status="warning">{categoryLabel}</Badge>
            {showTypeBadge && (
              <Badge status={channelBadgeStatus(channel)}>
                {typeLabel}
              </Badge>
            )}
            {channel.scope && (
              <Badge status="warning">{channel.scope}</Badge>
            )}
            {channel.language && channel.language !== "en" && (
              <Badge status="warning">
                {LANGUAGE_OPTIONS.find((l) => l.value === channel.language)?.flag || ""}{" "}
                {LANGUAGE_OPTIONS.find((l) => l.value === channel.language)?.label || channel.language}
              </Badge>
            )}
            <StatusDot status={channelStatusToDot(channel.status)} pulse={isConnecting} />
            <MetaText size="xs">{channel.status}</MetaText>
          </Row>

          {channel.error_message && (
            <p className="channels-error-text">{channel.error_message}</p>
          )}

          {channel.last_connected_at && (
            <MetaText size="xs" className="block mb-1">
              Last connected: {new Date(channel.last_connected_at).toLocaleString()}
            </MetaText>
          )}

          {hasWebhookEndpoint && (
            <div className="mt-2">
              <MetaText size="xs" className="block mb-1">
                Webhook URL
              </MetaText>
              <Row gap={2}>
                <input
                  type="text"
                  readOnly
                  value={webhookUrl}
                  className="channels-input"
                />
                <Button size="sm" type="button" onClick={copyWebhookUrl} disabled={!webhookUrl}>
                  Copy URL
                </Button>
              </Row>
              {!channel.webhook_secret && (
                <MetaText size="xs" className="block mt-1 text-secondary">
                  No webhook secret set. Recreate the integration with a webhook secret.
                </MetaText>
              )}
              {!webhookBase && (
                <MetaText size="xs" className="block mt-1 text-secondary">
                  Could not auto-resolve gateway host yet. Reload this page after gateway is reachable.
                </MetaText>
              )}
              {webhookBase && (webhookBaseSource || webhookNetworkMode) && (
                <MetaText size="xs" className="block mt-1 text-secondary">
                  Resolved via {webhookBaseSource || "auto"}{webhookNetworkMode ? ` (${webhookNetworkMode} mode)` : ""}.
                </MetaText>
              )}
              <MetaText size="xs" className="block mt-1 text-secondary">
                Auth supported: query `secret`, header `x-joi-webhook-secret` / `x-webhook-secret`, or `Authorization: Bearer`.
              </MetaText>
            </div>
          )}

          {isConnected && (
            <div className="mt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowInfo(!showInfo)}
                className="channels-info-link"
              >
                {showInfo ? "Hide info" : "What can I do with this?"}
              </Button>
              {showInfo && (
                <ul className="channels-capabilities-list">
                  {capabilities.map((cap, i) => (
                    <li key={i}>{cap}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <Row gap={2}>
          {isAwaitingAuth ? (
            <Button
              size="sm"
              variant="accent"
              onClick={() => onAuthPrompt?.(channel.id, channel.status === "awaiting_2fa" ? "password" : "code")}
            >
              {channel.status === "awaiting_2fa" ? "Enter Password" : "Enter Code"}
            </Button>
          ) : isConnected ? (
            <Button size="sm" onClick={() => onDisconnect(channel.id)}>
              Disconnect
            </Button>
          ) : (
            <Button size="sm" onClick={() => onConnect(channel.id)} disabled={isConnecting}>
              {isConnecting ? "Connecting..." : "Connect"}
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={() => onDelete(channel.id)}>
            Delete
          </Button>
        </Row>
      </Row>
    </Card>
  );
}

/* ---------- Google Account Card ---------- */

function GoogleAccountCard({
  account,
  onSetDefault,
  onReconnect,
  onDelete,
}: {
  account: GoogleAccount;
  onSetDefault: (id: string) => void;
  onReconnect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const isConnected = account.status === "connected";
  const services = scopeServices(account.scopes);

  return (
    <Card>
      <Row justify="between" align="start">
        <div className="flex-1">
          <Row gap={2} className="mb-1">
            <span className="text-md font-semibold">
              {account.display_name}
            </span>
            {account.is_default && (
              <Badge status="success" className="text-xs">DEFAULT</Badge>
            )}
            <StatusDot status={channelStatusToDot(account.status)} />
            <MetaText size="xs">{account.status}</MetaText>
          </Row>

          {account.email && (
            <MetaText size="sm" className="block mb-1 text-secondary">
              {account.email}
            </MetaText>
          )}

          <MetaText size="xs" className="block mb-1">
            {services.join(", ")}
          </MetaText>

          {account.error_message && (
            <p className="channels-error-text mt-1">{account.error_message}</p>
          )}
        </div>

        <Row gap={2}>
          {isConnected && !account.is_default && (
            <Button size="sm" onClick={() => onSetDefault(account.id)}>
              Set Default
            </Button>
          )}
          <Button size="sm" onClick={() => onReconnect(account.id)}>
            {isConnected ? "Reconnect" : "Connect"}
          </Button>
          <Button size="sm" variant="danger" onClick={() => onDelete(account.id)}>
            Remove
          </Button>
        </Row>
      </Row>
    </Card>
  );
}

/* ---------- Message Feed ---------- */

function MessageFeed({ messages }: { messages: ChannelMessageEvent[] }) {
  return (
    <div>
      <SectionHeader title="Live Activity" />

      {messages.length === 0 ? (
        <Card>
          <UiEmptyState message="No messages yet. When channels receive or send messages, they appear here in real time." />
        </Card>
      ) : (
        <Card className="channels-msg-feed-card">
          <Stack gap={1}>
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`channels-msg-row${i < messages.length - 1 ? " channels-msg-row--bordered" : ""}`}
              >
                <span className={`channels-msg-direction ${msg.direction === "inbound" ? "channels-msg-direction-in" : "channels-msg-direction-out"}`}>
                  {msg.direction === "inbound" ? "IN" : "OUT"}
                </span>
                <MetaText size="xs" className="flex-shrink-0">
                  {CHANNEL_LABELS[msg.channelType] || msg.channelType}
                </MetaText>
                <span className="channels-msg-from">
                  {msg.from}
                </span>
                <span className="channels-msg-text">
                  {msg.attachments?.map((a, j) => (
                    <span key={j} title={a.filename || a.type}>{ATTACHMENT_ICONS[a.type] || ATTACHMENT_ICONS.unknown} </span>
                  ))}
                  {msg.text || (msg.attachments?.length ? "" : "(empty)")}
                </span>
                {msg.timestamp && (
                  <MetaText size="xs" className="flex-shrink-0">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </MetaText>
                )}
              </div>
            ))}
          </Stack>
        </Card>
      )}
    </div>
  );
}

/* ---------- Add Integration Modal (chooser) ---------- */

function AddIntegrationModal({
  open,
  onClose,
  onAddGoogle,
  onChannelAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAddChannel: () => void;
  onAddGoogle: () => void;
  onChannelAdded: () => void;
}) {
  const [mode, setMode] = useState<"choose" | "channel">("choose");

  if (!open) return null;

  if (mode === "channel") {
    return <AddChannelModal open onClose={onClose} onAdded={onChannelAdded} />;
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Integration" width={440}>
      <Stack gap={3}>
        <button onClick={() => setMode("channel")} className="channels-option-btn">
          <span className="text-base font-semibold text-primary">
            Channel / Integration
          </span>
          <p className="text-xs text-muted channels-option-desc">
            WhatsApp, Telegram, iMessage, Slack, Discord, Notion, Emby, Jellyseerr, or Webhook
          </p>
        </button>

        <button onClick={onAddGoogle} className="channels-option-btn">
          <span className="text-base font-semibold text-google">
            Google Account
          </span>
          <p className="text-xs text-muted channels-option-desc">
            Gmail, Calendar, and Drive access
          </p>
        </button>
      </Stack>

      <Row justify="end" className="mt-4">
        <Button size="sm" onClick={onClose}>Cancel</Button>
      </Row>
    </Modal>
  );
}

/* ---------- Add Channel Modal ---------- */

type ChannelTypeOption =
  | "whatsapp"
  | "telegram"
  | "imessage"
  | "slack"
  | "discord"
  | "notion"
  | "emby"
  | "jellyseerr"
  | "webhook";

const CHANNEL_NAME_PLACEHOLDERS: Record<ChannelTypeOption, string> = {
  whatsapp: "Personal WhatsApp",
  telegram: "My Telegram",
  imessage: "iMessage",
  slack: "Itellico Slack",
  discord: "My Discord Server",
  notion: "Itellico Notion",
  emby: "Emby",
  jellyseerr: "Jellyseerr",
  webhook: "Ops Webhook",
};

function createWebhookSecret(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function AddChannelModal({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [type, setType] = useState<ChannelTypeOption>("whatsapp");
  const [name, setName] = useState("");
  const [scope, setScope] = useState("");
  const [language, setLanguage] = useState("en");
  const [saving, setSaving] = useState(false);

  // Type-specific fields
  const [phoneNumber, setPhoneNumber] = useState("");
  const [botToken, setBotToken] = useState("");
  const [appToken, setAppToken] = useState("");
  const [channelIds, setChannelIds] = useState("");
  const [guildIds, setGuildIds] = useState("");
  const [notionToken, setNotionToken] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [mediaServerUrl, setMediaServerUrl] = useState("");
  const [mediaApiKey, setMediaApiKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [webhookSourceLabel, setWebhookSourceLabel] = useState("");
  const [webhookMessagePath, setWebhookMessagePath] = useState("");
  const [webhookSenderPath, setWebhookSenderPath] = useState("");
  const [webhookEventPath, setWebhookEventPath] = useState("");

  const guide = SETUP_GUIDES[type];

  useEffect(() => {
    if ((type === "emby" || type === "jellyseerr" || type === "webhook") && !webhookSecret) {
      setWebhookSecret(createWebhookSecret());
    }
  }, [type, webhookSecret]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const channelName = name.trim();
    if (!channelName) return;

    const id = channelName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    if (!id) return;

    setSaving(true);
    try {
      const config: Record<string, unknown> = {};

      if (type === "telegram") config.phoneNumber = phoneNumber;
      if (type === "slack") {
        config.botToken = botToken;
        config.appToken = appToken;
        if (channelIds.trim()) config.channels = channelIds.split(",").map((s) => s.trim()).filter(Boolean);
      }
      if (type === "discord") {
        config.botToken = botToken;
        if (guildIds.trim()) config.guildIds = guildIds.split(",").map((s) => s.trim()).filter(Boolean);
        if (channelIds.trim()) config.channelIds = channelIds.split(",").map((s) => s.trim()).filter(Boolean);
      }
      if (type === "notion") {
        config.token = notionToken;
        if (workspaceName.trim()) config.workspaceName = workspaceName.trim();
      }
      if (type === "emby" || type === "jellyseerr") {
        config.serverUrl = mediaServerUrl.trim();
        config.apiKey = mediaApiKey.trim();
        config.webhookSecret = webhookSecret.trim() || createWebhookSecret();
      }
      if (type === "webhook") {
        config.webhookSecret = webhookSecret.trim() || createWebhookSecret();
        if (webhookSourceLabel.trim()) config.sourceLabel = webhookSourceLabel.trim();
        if (webhookMessagePath.trim()) config.messagePath = webhookMessagePath.trim();
        if (webhookSenderPath.trim()) config.senderPath = webhookSenderPath.trim();
        if (webhookEventPath.trim()) config.eventPath = webhookEventPath.trim();
      }

      await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          channel_type: type,
          config,
          display_name: channelName,
          scope: scope.trim() || undefined,
          language: language || "en",
        }),
      });
      onAdded();
    } catch (err) {
      console.error("Failed to create channel:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Channel" width={520}>
      <form onSubmit={handleSubmit}>
        <Stack gap={4}>
          <FormField label="Channel Type">
            <Row gap={2} wrap>
              {(["whatsapp", "telegram", "imessage", "slack", "discord", "notion", "emby", "jellyseerr", "webhook"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`channels-type-btn ${type === t ? "channels-type-btn-active" : ""}`}
                >
                  {CHANNEL_LABELS[t]}
                </button>
              ))}
            </Row>
          </FormField>

          {/* Setup guide */}
          {guide && (
            <div className="channels-setup-guide">
              <SectionLabel className="mb-2">Setup Steps</SectionLabel>
              <ol className="channels-setup-steps">
                {guide.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
              {guide.note && (
                <MetaText size="xs" className="block mt-2 leading-relaxed">
                  {guide.note}
                </MetaText>
              )}
            </div>
          )}

          <FormField label="Channel Name" hint="A friendly name for this channel. Used as the ID and display label.">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={CHANNEL_NAME_PLACEHOLDERS[type]}
              required
              className="channels-input"
            />
          </FormField>

          <FormField label="Scope" hint="Optional label to tag this channel with a company or context (e.g. 'itellico-at', 'personal').">
            <input
              type="text"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="e.g. itellico-at, personal"
              className="channels-input"
            />
          </FormField>

          <FormField label="Language" hint="JOI will respond, transcribe speech, and format dates in this language.">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="channels-input"
            >
              {LANGUAGE_OPTIONS.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {lang.flag} {lang.label}
                </option>
              ))}
            </select>
          </FormField>

          {type === "telegram" && (
            <FormField label="Phone Number" hint="Your Telegram phone number with country code.">
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+43 660 1234567"
                required
                className="channels-input"
              />
            </FormField>
          )}

          {type === "slack" && (
            <>
              <FormField label="Bot Token" hint="Bot User OAuth Token (xoxb-...) from your Slack App.">
                <input
                  type="password"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder="xoxb-..."
                  required
                  className="channels-input"
                />
              </FormField>
              <FormField label="App Token" hint="App-Level Token (xapp-...) for Socket Mode.">
                <input
                  type="password"
                  value={appToken}
                  onChange={(e) => setAppToken(e.target.value)}
                  placeholder="xapp-..."
                  required
                  className="channels-input"
                />
              </FormField>
              <FormField label="Channel IDs" hint="Comma-separated Slack channel IDs to monitor (leave empty for all).">
                <input
                  type="text"
                  value={channelIds}
                  onChange={(e) => setChannelIds(e.target.value)}
                  placeholder="C01ABC, C02DEF"
                  className="channels-input"
                />
              </FormField>
            </>
          )}

          {type === "discord" && (
            <>
              <FormField label="Bot Token" hint="Discord bot token from Developer Portal.">
                <input
                  type="password"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder="MTIz..."
                  required
                  className="channels-input"
                />
              </FormField>
              <FormField label="Guild IDs" hint="Comma-separated server IDs to monitor (leave empty for all).">
                <input
                  type="text"
                  value={guildIds}
                  onChange={(e) => setGuildIds(e.target.value)}
                  placeholder="123456789, 987654321"
                  className="channels-input"
                />
              </FormField>
              <FormField label="Channel IDs" hint="Comma-separated channel IDs (leave empty for all text channels).">
                <input
                  type="text"
                  value={channelIds}
                  onChange={(e) => setChannelIds(e.target.value)}
                  placeholder="789012345"
                  className="channels-input"
                />
              </FormField>
            </>
          )}

          {type === "notion" && (
            <>
              <FormField label="API Token" hint="Internal Integration Token from notion.so/my-integrations.">
                <input
                  type="password"
                  value={notionToken}
                  onChange={(e) => setNotionToken(e.target.value)}
                  placeholder="ntn_..."
                  required
                  className="channels-input"
                />
              </FormField>
              <FormField label="Workspace Name" hint="A label for this Notion workspace.">
                <input
                  type="text"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  placeholder="Itellico AI"
                  className="channels-input"
                />
              </FormField>
            </>
          )}

          {(type === "emby" || type === "jellyseerr") && (
            <>
              <FormField label="Server URL" hint="Full URL including port.">
                <input
                  type="url"
                  value={mediaServerUrl}
                  onChange={(e) => setMediaServerUrl(e.target.value)}
                  placeholder={type === "emby" ? "http://192.168.178.162:8096" : "http://192.168.178.162:5055"}
                  required
                  className="channels-input"
                />
              </FormField>
              <FormField label="API Key" hint="API key from Emby/Jellyseerr settings.">
                <input
                  type="password"
                  value={mediaApiKey}
                  onChange={(e) => setMediaApiKey(e.target.value)}
                  placeholder="Paste API key"
                  required
                  className="channels-input"
                />
              </FormField>
              <FormField label="Webhook Secret" hint="Used to verify incoming webhook calls from Emby/Jellyseerr.">
                <input
                  type="text"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder="Auto-generated secret"
                  className="channels-input"
                />
                <Row justify="end" className="mt-1">
                  <Button
                    size="sm"
                    type="button"
                    onClick={() => setWebhookSecret(createWebhookSecret())}
                  >
                    Generate New Secret
                  </Button>
                </Row>
              </FormField>
            </>
          )}

          {type === "webhook" && (
            <>
              <FormField label="Webhook Secret" hint="Used to verify incoming webhook calls into JOI.">
                <input
                  type="text"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder="Auto-generated secret"
                  className="channels-input"
                />
                <Row justify="end" className="mt-1">
                  <Button
                    size="sm"
                    type="button"
                    onClick={() => setWebhookSecret(createWebhookSecret())}
                  >
                    Generate New Secret
                  </Button>
                </Row>
              </FormField>

              <FormField label="Source Label" hint="Optional label shown in message titles (e.g. Stripe, GitHub, CI).">
                <input
                  type="text"
                  value={webhookSourceLabel}
                  onChange={(e) => setWebhookSourceLabel(e.target.value)}
                  placeholder="Optional source label"
                  className="channels-input"
                />
              </FormField>

              <FormField label="Message Path" hint="Optional dot path to payload text (example: data.message or detail.text).">
                <input
                  type="text"
                  value={webhookMessagePath}
                  onChange={(e) => setWebhookMessagePath(e.target.value)}
                  placeholder="message"
                  className="channels-input"
                />
              </FormField>

              <FormField label="Sender Path" hint="Optional dot path to sender (example: user.name or actor.email).">
                <input
                  type="text"
                  value={webhookSenderPath}
                  onChange={(e) => setWebhookSenderPath(e.target.value)}
                  placeholder="sender.name"
                  className="channels-input"
                />
              </FormField>

              <FormField label="Event Path" hint="Optional dot path to event type (example: type or detail.event).">
                <input
                  type="text"
                  value={webhookEventPath}
                  onChange={(e) => setWebhookEventPath(e.target.value)}
                  placeholder="event"
                  className="channels-input"
                />
              </FormField>
            </>
          )}

          <Row justify="end" gap={2} className="mt-1">
            <Button size="sm" type="button" onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving || !name.trim()}>
              {saving ? "Adding..." : "Add Channel"}
            </Button>
          </Row>
        </Stack>
      </form>
    </Modal>
  );
}

/* ---------- Add Google Account Modal ---------- */

function AddGoogleAccountModal({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const displayName = name.trim();
    if (!displayName) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/google/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: displayName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create account");
        return;
      }

      // Open OAuth flow in new window
      window.open(`/api/google/accounts/${data.id}/auth`, "_blank", "width=600,height=700");
      setWaiting(true);

      // Poll for status change (the WS event will also update the list)
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch("/api/google/accounts");
          const statusData = await statusRes.json();
          const acct = (statusData.accounts || []).find((a: GoogleAccount) => a.id === data.id);
          if (acct && acct.status === "connected") {
            clearInterval(pollInterval);
            onAdded();
          }
        } catch { /* ignore polling errors */ }
      }, 2000);

      // Stop polling after 5 minutes
      setTimeout(() => clearInterval(pollInterval), 300000);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Google Account" width={440}>
      <MetaText size="sm" className="block leading-relaxed mb-4 text-secondary">
        Connect a Google account to give JOI access to Gmail, Calendar, and Drive.
        A new browser window will open for Google sign-in.
      </MetaText>

      {waiting ? (
        <div className="channels-waiting-state">
          <p className="text-base text-primary mb-2">
            Waiting for authentication...
          </p>
          <MetaText size="xs">
            Complete the Google sign-in in the popup window. This dialog will close automatically.
          </MetaText>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <Stack gap={3}>
            <FormField label="Account Name" hint="A friendly label. The Google email will be added automatically after sign-in.">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Personal, Work"
                autoFocus
                required
                className="channels-input"
              />
            </FormField>

            {error && (
              <MetaText size="xs" className="block text-error">{error}</MetaText>
            )}

            <Row justify="end" gap={2}>
              <Button size="sm" type="button" onClick={onClose}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={saving || !name.trim()}>
                {saving ? "Creating..." : "Add & Authenticate"}
              </Button>
            </Row>
          </Stack>
        </form>
      )}
    </Modal>
  );
}

/* ---------- Telegram Auth Modal ---------- */

function TelegramAuthModal({
  open,
  channelId,
  mode,
  onClose,
}: {
  open: boolean;
  channelId: string;
  mode: "code" | "password";
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const body = mode === "code" ? { code: value.trim() } : { password: value.trim() };
      const res = await fetch(`/api/channels/${channelId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Verification failed");
      } else {
        setValue("");
      }
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const title = mode === "code" ? "Telegram Login Code" : "Two-Factor Password";
  const description = mode === "code"
    ? "Telegram sent a login code to your phone or Telegram app. Enter it below."
    : "Your account has two-factor authentication. Enter your 2FA password.";

  return (
    <Modal open={open} onClose={onClose} title={title} width={400}>
      <MetaText size="sm" className="block leading-relaxed mb-4 text-secondary">
        {description}
      </MetaText>
      <form onSubmit={handleSubmit}>
        <Stack gap={3}>
          <input
            type={mode === "password" ? "password" : "text"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={mode === "code" ? "12345" : "Your 2FA password"}
            autoFocus
            required
            className={`channels-input channels-auth-input ${mode === "code" ? "channels-auth-code" : ""}`}
          />
          {error && (
            <MetaText size="xs" className="block text-error">{error}</MetaText>
          )}
          <Row justify="end" gap={2}>
            <Button size="sm" type="button" onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={submitting || !value.trim()}>
              {submitting ? "Verifying..." : "Submit"}
            </Button>
          </Row>
        </Stack>
      </form>
    </Modal>
  );
}

/* ---------- QR Modal ---------- */

function QrModal({
  open,
  dataUrl,
  onClose,
}: {
  open: boolean;
  channelId: string;
  dataUrl: string;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Scan QR Code" width={400}>
      <div className="text-center">
        <MetaText size="sm" className="block leading-relaxed text-secondary">
          Open WhatsApp on your phone, go to{" "}
          <strong>Settings &gt; Linked Devices &gt; Link a Device</strong>,
          then scan this code.
        </MetaText>
        <img
          src={dataUrl}
          alt="WhatsApp QR Code"
          className="channels-qr-image"
        />
        <MetaText size="xs" className="block mb-3">
          The QR code refreshes automatically. If it expires, disconnect and reconnect.
        </MetaText>
        <Button size="sm" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}
