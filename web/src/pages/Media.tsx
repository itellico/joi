import { useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  Badge,
  Card,
  ChipGroup,
  EmptyState,
  MetaText,
  Modal,
  Pagination,
  PageHeader,
  PageBody,
  SearchInput,
  Stack,
  UnifiedList,
  ViewToggle,
  type UnifiedListColumn,
} from "../components/ui";

interface MediaItem {
  id: string;
  message_id: string | null;
  conversation_id: string | null;
  channel_type: string | null;
  channel_id: string | null;
  sender_id: string | null;
  contact_id: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  contact_avatar_url: string | null;
  media_type: string;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string;
  thumbnail_path: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  status: string;
  caption: string | null;
  created_at: string;
}

interface MediaStats {
  byType: Array<{ media_type: string; count: number }>;
  byChannel: Array<{ channel_type: string; count: number }>;
  total: number;
  totalBytes: number;
}

const TYPE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "photo", label: "Photos" },
  { value: "video", label: "Videos" },
  { value: "audio", label: "Audio" },
  { value: "document", label: "Documents" },
  { value: "voice", label: "Voice" },
  { value: "sticker", label: "Stickers" },
];

const CHANNEL_OPTIONS = [
  { value: "all", label: "All" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "telegram", label: "Telegram" },
  { value: "imessage", label: "iMessage" },
  { value: "slack", label: "Slack" },
  { value: "discord", label: "Discord" },
  { value: "email", label: "Email" },
];

const TYPE_ICONS: Record<string, string> = {
  photo: "\uD83D\uDDBC\uFE0F",
  video: "\uD83C\uDFA5",
  audio: "\uD83C\uDFB5",
  voice: "\uD83C\uDF99\uFE0F",
  document: "\uD83D\uDCC4",
  sticker: "\uD83E\uDEAA",
  unknown: "\uD83D\uDCCE",
};

const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: "#25d366",
  telegram: "#0088cc",
  imessage: "#34c759",
  slack: "#4a154b",
  discord: "#5865f2",
  email: "#5ac8fa",
};

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("de-AT", { day: "numeric", month: "short" });
}

const PAGE_SIZE = 50;

function getSenderLabel(senderId: string | null): string | null {
  if (!senderId) return null;
  if (senderId === "status@broadcast") return "Status";
  if (senderId.endsWith("@s.whatsapp.net")) return "+" + senderId.split("@")[0];
  if (senderId.endsWith("@lid")) return senderId.split("@")[0];
  return senderId;
}

function getContactName(item: MediaItem): string | null {
  if (!item.contact_id) return null;
  return [item.contact_first_name, item.contact_last_name].filter(Boolean).join(" ") || null;
}

export default function Media() {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<MediaStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<MediaItem | null>(null);

  const viewMode = params.get("view") || localStorage.getItem("view-toggle:media") || "cards";
  const typeFilter = params.get("type") || "all";
  const channelFilter = params.get("channel") || "all";
  const search = params.get("q") || "";
  const page = parseInt(params.get("page") || "1") || 1;
  const offset = (page - 1) * PAGE_SIZE;

  const updateParam = useCallback((key: string, value: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value && value !== "all" && value !== "1") {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      if (key !== "page") next.delete("page");
      return next;
    });
  }, [setParams]);

  const fetchMedia = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (typeFilter !== "all") qs.set("type", typeFilter);
      if (channelFilter !== "all") qs.set("channel", channelFilter);
      if (search) qs.set("q", search);
      qs.set("sort", "created_at");
      qs.set("dir", "DESC");
      qs.set("limit", String(PAGE_SIZE));
      qs.set("offset", String(offset));

      const resp = await fetch(`/api/media?${qs}`);
      const data = await resp.json();
      setItems(data.media || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error("Failed to fetch media:", err);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, channelFilter, search, offset]);

  useEffect(() => {
    fetchMedia();
  }, [fetchMedia]);

  useEffect(() => {
    fetch("/api/media/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  const handleViewChange = (mode: string) => {
    updateParam("view", mode);
    localStorage.setItem("view-toggle:media", mode);
  };

  const statChips = useMemo(() => {
    if (!stats) return [];
    return stats.byType.map((t) => ({
      value: t.media_type,
      label: `${TYPE_ICONS[t.media_type] || ""} ${t.media_type}`,
      count: t.count,
    }));
  }, [stats]);

  const navigate = useNavigate();

  const columns: UnifiedListColumn<MediaItem>[] = useMemo(() => [
    {
      key: "thumb",
      header: "",
      render: (item) => <MediaThumb item={item} size={40} />,
      width: 52,
    },
    {
      key: "filename",
      header: "Filename",
      render: (item) => (
        <div className="unified-list-cell-break">
          <div className="text-primary">{item.filename || item.media_type}</div>
          {item.caption && <MetaText size="xs" className="block mt-1">{item.caption}</MetaText>}
        </div>
      ),
      sortValue: (item) => item.filename || item.media_type,
    },
    {
      key: "contact",
      header: "From",
      render: (item) => {
        const name = getContactName(item);
        if (!name) return <MetaText size="xs">{getSenderLabel(item.sender_id) || "—"}</MetaText>;
        return (
          <span
            className="media-contact-link"
            onClick={(e) => { e.stopPropagation(); navigate(`/contacts/${item.contact_id}`); }}
            title={`View ${name}`}
          >
            {name}
          </span>
        );
      },
      sortValue: (item) => getContactName(item) || item.sender_id || "",
      width: 150,
    },
    {
      key: "media_type",
      header: "Type",
      render: (item) => (
        <Badge status="muted" className="text-xs">{item.media_type}</Badge>
      ),
      sortValue: (item) => item.media_type,
      width: 100,
    },
    {
      key: "channel_type",
      header: "Channel",
      render: (item) => item.channel_type ? (
        <span style={{ borderLeft: `3px solid ${CHANNEL_COLORS[item.channel_type] || "var(--text-muted)"}`, paddingLeft: 6 }}>
          <Badge status="muted" className="text-xs">{item.channel_type}</Badge>
        </span>
      ) : <MetaText size="xs">—</MetaText>,
      sortValue: (item) => item.channel_type || "",
      width: 120,
    },
    {
      key: "size_bytes",
      header: "Size",
      render: (item) => <MetaText size="xs">{formatBytes(item.size_bytes)}</MetaText>,
      sortValue: (item) => item.size_bytes || 0,
      width: 90,
      align: "right",
    },
    {
      key: "created_at",
      header: "Date",
      render: (item) => <MetaText size="xs">{timeAgo(item.created_at)}</MetaText>,
      sortValue: (item) => new Date(item.created_at),
      width: 120,
    },
  ], [navigate]);

  return (
    <>
      <PageHeader
        title="Media"
        subtitle={stats ? `${stats.total.toLocaleString()} files \u00b7 ${formatBytes(stats.totalBytes)}` : undefined}
      />

      <PageBody>
        {/* Stat chips */}
        {statChips.length > 0 && (
          <ChipGroup
            variant="stat"
            options={statChips}
            value={typeFilter}
            onChange={(v) => updateParam("type", v === typeFilter ? "all" : v)}
          />
        )}

        {/* Search + View toggle toolbar */}
        <div className="list-page-toolbar">
          <SearchInput
            value={search}
            onChange={(v) => updateParam("q", v)}
            placeholder="Search media..."
            resultCount={search.trim() ? total : undefined}
            className="list-page-search"
          />
          <div className="list-page-toolbar-right">
            <ViewToggle
              value={viewMode}
              onChange={handleViewChange}
              storageKey="media"
            />
          </div>
        </div>

        {/* Type filter pills */}
        <ChipGroup
          variant="pill"
          options={TYPE_OPTIONS}
          value={typeFilter}
          onChange={(v) => { updateParam("type", v); }}
        />

        {/* Channel filter pills */}
        <ChipGroup
          variant="pill"
          options={CHANNEL_OPTIONS}
          value={channelFilter}
          onChange={(v) => { updateParam("channel", v); }}
        />

        {/* Content */}
        {loading && items.length === 0 ? (
          <Card><MetaText>Loading...</MetaText></Card>
        ) : items.length === 0 ? (
          <Card>
            <EmptyState
              icon={total === 0 && !search ? "\uD83D\uDCCE" : "\uD83D\uDD0D"}
              message={
                total === 0 && !search
                  ? "No media files yet. Media is downloaded automatically when messages with attachments arrive."
                  : "No media files match your filters."
              }
            />
          </Card>
        ) : viewMode === "list" ? (
          <>
            <UnifiedList
              items={items}
              columns={columns}
              rowKey={(item) => item.id}
              onRowClick={(item) => setLightbox(item)}
              defaultSort={{ key: "created_at", direction: "desc" }}
              tableAriaLabel="Media files list"
              emptyMessage="No media files found."
            />
            <Pagination
              total={total}
              pageSize={PAGE_SIZE}
              offset={offset}
              onOffsetChange={(newOffset: number) => updateParam("page", String(Math.floor(newOffset / PAGE_SIZE) + 1))}
            />
          </>
        ) : (
          <>
            <div className="media-grid">
              {items.map((item) => (
                <MediaCard key={item.id} item={item} onClick={() => setLightbox(item)} />
              ))}
            </div>
            <Pagination
              total={total}
              pageSize={PAGE_SIZE}
              offset={offset}
              onOffsetChange={(newOffset: number) => updateParam("page", String(Math.floor(newOffset / PAGE_SIZE) + 1))}
            />
          </>
        )}
      </PageBody>

      {lightbox && (
        <MediaLightbox item={lightbox} onClose={() => setLightbox(null)} />
      )}
    </>
  );
}

function MediaThumb({ item, size = 120 }: { item: MediaItem; size?: number }) {
  const isImage = item.media_type === "photo" || item.mime_type?.startsWith("image/");
  if (isImage && item.status === "ready") {
    return (
      <img
        src={`/api/media/${item.id}/thumbnail`}
        alt={item.filename || "thumbnail"}
        className="media-thumb"
        style={{ width: size, height: size, objectFit: "cover" }}
        loading="lazy"
      />
    );
  }
  return (
    <div className="media-thumb media-thumb-icon" style={{ width: size, height: size }}>
      <span className="media-thumb-emoji">{TYPE_ICONS[item.media_type] || TYPE_ICONS.unknown}</span>
    </div>
  );
}

function MediaCard({ item, onClick }: { item: MediaItem; onClick: () => void }) {
  const contactName = getContactName(item);
  return (
    <div className="media-card" onClick={onClick}>
      <MediaThumb item={item} size={160} />
      <div className="media-card-info">
        <div className="media-card-name" title={item.filename || item.media_type}>
          {item.filename || item.media_type}
        </div>
        <div className="media-card-meta">
          {contactName && (
            <span className="media-card-contact">{contactName}</span>
          )}
          {item.channel_type && (
            <span className="media-card-channel" style={{ color: CHANNEL_COLORS[item.channel_type] }}>
              {item.channel_type}
            </span>
          )}
          <MetaText size="xs">{formatBytes(item.size_bytes)}</MetaText>
          <MetaText size="xs">{timeAgo(item.created_at)}</MetaText>
        </div>
      </div>
    </div>
  );
}

function MediaLightbox({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const navigate = useNavigate();
  const isImage = item.media_type === "photo" || item.mime_type?.startsWith("image/");
  const isVideo = item.media_type === "video" || item.mime_type?.startsWith("video/");
  const isAudio = item.media_type === "audio" || item.media_type === "voice" || item.mime_type?.startsWith("audio/");
  const contactName = getContactName(item);

  return (
    <Modal open onClose={onClose} width="90vw">
      <div className="media-lightbox">
        <div className="media-lightbox-preview">
          {isImage && (
            <img src={`/api/media/${item.id}/file`} alt={item.filename || "image"} className="media-lightbox-img" />
          )}
          {isVideo && (
            <video src={`/api/media/${item.id}/file`} controls className="media-lightbox-video" />
          )}
          {isAudio && (
            <div className="media-lightbox-audio">
              <span className="media-lightbox-audio-icon">{TYPE_ICONS[item.media_type]}</span>
              <audio src={`/api/media/${item.id}/file`} controls />
            </div>
          )}
          {!isImage && !isVideo && !isAudio && (
            <div className="media-lightbox-doc">
              <span className="media-lightbox-doc-icon">{TYPE_ICONS[item.media_type] || TYPE_ICONS.unknown}</span>
              <a href={`/api/media/${item.id}/file`} download={item.filename || "download"} className="media-lightbox-download">
                Download {item.filename || "file"}
              </a>
            </div>
          )}
        </div>
        <div className="media-lightbox-meta">
          {item.filename && <div className="media-lightbox-filename">{item.filename}</div>}
          <Stack gap={1}>
            {contactName && (
              <div className="media-lightbox-contact">
                <MetaText size="sm">From: </MetaText>
                <span
                  className="media-contact-link"
                  onClick={() => { onClose(); navigate(`/contacts/${item.contact_id}`); }}
                >
                  {contactName}
                </span>
              </div>
            )}
            <MetaText size="sm">Type: {item.media_type}</MetaText>
            {item.mime_type && <MetaText size="sm">MIME: {item.mime_type}</MetaText>}
            <MetaText size="sm">Size: {formatBytes(item.size_bytes)}</MetaText>
            {item.width && item.height && <MetaText size="sm">Dimensions: {item.width} x {item.height}</MetaText>}
            {item.channel_type && <MetaText size="sm">Channel: {item.channel_type}</MetaText>}
            <MetaText size="sm">Date: {new Date(item.created_at).toLocaleString("de-AT")}</MetaText>
            {item.caption && <MetaText size="sm">Caption: {item.caption}</MetaText>}
          </Stack>
        </div>
      </div>
    </Modal>
  );
}
