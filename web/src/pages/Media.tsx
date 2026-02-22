import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader, PageBody } from "../components/ui/PageLayout";
import { SearchInput, ChipGroup, ViewToggle, Pagination, Modal, Badge, MetaText, EmptyState } from "../components/ui";

interface MediaItem {
  id: string;
  message_id: string | null;
  conversation_id: string | null;
  channel_type: string | null;
  channel_id: string | null;
  sender_id: string | null;
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

const SORT_OPTIONS = [
  { value: "created_at", label: "Date" },
  { value: "filename", label: "Name" },
  { value: "size", label: "Size" },
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

export default function Media() {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<MediaStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<MediaItem | null>(null);

  const view = params.get("view") || localStorage.getItem("view-toggle:media") || "cards";
  const typeFilter = params.get("type") || "all";
  const channelFilter = params.get("channel") || "all";
  const search = params.get("q") || "";
  const sort = params.get("sort") || "created_at";
  const dir = params.get("dir") || "DESC";
  const page = parseInt(params.get("page") || "1") || 1;

  const updateParam = useCallback((key: string, value: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value && value !== "all" && value !== "1" && value !== "created_at" && value !== "DESC") {
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
      qs.set("sort", sort);
      qs.set("dir", dir);
      qs.set("limit", String(PAGE_SIZE));
      qs.set("offset", String((page - 1) * PAGE_SIZE));

      const resp = await fetch(`/api/media?${qs}`);
      const data = await resp.json();
      setItems(data.media || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error("Failed to fetch media:", err);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, channelFilter, search, sort, dir, page]);

  useEffect(() => {
    fetchMedia();
  }, [fetchMedia]);

  useEffect(() => {
    fetch("/api/media/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  const offset = (page - 1) * PAGE_SIZE;

  return (
    <>
      <PageHeader title="Media" />
      <PageBody>
        {stats && (
          <div className="media-stats-bar">
            <MetaText size="sm">{stats.total} files</MetaText>
            <MetaText size="sm">{formatBytes(stats.totalBytes)}</MetaText>
            {stats.byType.slice(0, 4).map((t) => (
              <MetaText key={t.media_type} size="sm">
                {TYPE_ICONS[t.media_type] || ""} {t.count}
              </MetaText>
            ))}
          </div>
        )}

        <div className="media-toolbar">
          <SearchInput
            value={search}
            onChange={(v) => updateParam("q", v)}
            placeholder="Search media..."
          />
          <ChipGroup
            options={TYPE_OPTIONS}
            value={typeFilter}
            onChange={(v) => updateParam("type", v)}
            variant="pill"
          />
          <ChipGroup
            options={CHANNEL_OPTIONS}
            value={channelFilter}
            onChange={(v) => updateParam("channel", v)}
            variant="pill"
          />
          <div className="media-sort">
            <select
              value={sort}
              onChange={(e) => updateParam("sort", e.target.value)}
              className="media-sort-select"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              className="media-sort-dir"
              onClick={() => updateParam("dir", dir === "DESC" ? "ASC" : "DESC")}
              title={dir === "DESC" ? "Newest first" : "Oldest first"}
            >
              {dir === "DESC" ? "\u2193" : "\u2191"}
            </button>
          </div>
          <ViewToggle
            value={view}
            onChange={(v) => {
              updateParam("view", v);
              localStorage.setItem("view-toggle:media", v);
            }}
            storageKey="media"
          />
        </div>

        {loading ? (
          <div className="media-loading">Loading...</div>
        ) : items.length === 0 ? (
          <EmptyState message="No media files found" />
        ) : view === "cards" ? (
          <div className="media-grid">
            {items.map((item) => (
              <MediaCard key={item.id} item={item} onClick={() => setLightbox(item)} />
            ))}
          </div>
        ) : (
          <div className="media-list">
            <table className="unified-list-table">
              <thead>
                <tr>
                  <th style={{ width: 52 }}></th>
                  <th>Filename</th>
                  <th>Type</th>
                  <th>Channel</th>
                  <th>Size</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="media-list-row" onClick={() => setLightbox(item)}>
                    <td>
                      <MediaThumb item={item} size={40} />
                    </td>
                    <td className="media-list-filename">{item.filename || item.media_type}</td>
                    <td><Badge status="muted">{item.media_type}</Badge></td>
                    <td>
                      {item.channel_type && (
                        <span style={{ borderLeft: `3px solid ${CHANNEL_COLORS[item.channel_type] || "var(--text-muted)"}`, paddingLeft: 6 }}>
                          <Badge status="muted">{item.channel_type}</Badge>
                        </span>
                      )}
                    </td>
                    <td><MetaText size="sm">{formatBytes(item.size_bytes)}</MetaText></td>
                    <td><MetaText size="sm">{timeAgo(item.created_at)}</MetaText></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > PAGE_SIZE && (
          <Pagination
            total={total}
            pageSize={PAGE_SIZE}
            offset={offset}
            onOffsetChange={(newOffset: number) => updateParam("page", String(Math.floor(newOffset / PAGE_SIZE) + 1))}
          />
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
  return (
    <div className="media-card" onClick={onClick}>
      <MediaThumb item={item} size={160} />
      <div className="media-card-info">
        <div className="media-card-name" title={item.filename || item.media_type}>
          {item.filename || item.media_type}
        </div>
        <div className="media-card-meta">
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
  const isImage = item.media_type === "photo" || item.mime_type?.startsWith("image/");
  const isVideo = item.media_type === "video" || item.mime_type?.startsWith("video/");
  const isAudio = item.media_type === "audio" || item.media_type === "voice" || item.mime_type?.startsWith("audio/");

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
          <div className="media-lightbox-details">
            <MetaText size="sm">Type: {item.media_type}</MetaText>
            {item.mime_type && <MetaText size="sm">MIME: {item.mime_type}</MetaText>}
            <MetaText size="sm">Size: {formatBytes(item.size_bytes)}</MetaText>
            {item.width && item.height && <MetaText size="sm">Dimensions: {item.width} x {item.height}</MetaText>}
            {item.channel_type && <MetaText size="sm">Channel: {item.channel_type}</MetaText>}
            <MetaText size="sm">Date: {new Date(item.created_at).toLocaleString("de-AT")}</MetaText>
            {item.caption && <MetaText size="sm">Caption: {item.caption}</MetaText>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
