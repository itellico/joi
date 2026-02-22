import type { DownloadItem, DownloadStats } from "../hooks/useDownloads";

interface DownloadPanelProps {
  open: boolean;
  onClose: () => void;
  active: DownloadItem[];
  recentlyCompleted: DownloadItem[];
  stats: DownloadStats;
  paused: boolean;
  onPauseAll: () => void;
  onResumeAll: () => void;
  onCancel: (id: string) => void;
}

function formatBytes(bytes?: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="dl-progress-track">
      <div
        className="dl-progress-fill"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

function ActiveItem({
  item,
  onCancel,
}: {
  item: DownloadItem;
  onCancel: (id: string) => void;
}) {
  const isDownloading = item.status === "downloading";
  return (
    <div className="dl-item">
      <div className="dl-item-header">
        <span className="dl-item-title" title={item.title}>
          {item.title}
        </span>
        <button
          className="dl-item-cancel"
          onClick={() => onCancel(item.id)}
          title="Cancel"
        >
          &times;
        </button>
      </div>
      {isDownloading ? (
        <>
          <ProgressBar percent={item.progress} />
          <div className="dl-item-meta">
            <span>{item.progress.toFixed(0)}%</span>
            {item.speed && <span>{item.speed}</span>}
            {item.eta && <span>{item.eta}</span>}
            {item.size && (
              <span>
                {formatBytes(item.downloaded)} / {formatBytes(item.size)}
              </span>
            )}
          </div>
        </>
      ) : item.status === "error" ? (
        <div className="dl-item-error">{item.error ?? "Download failed"}</div>
      ) : (
        <div className="dl-item-queued">Queued</div>
      )}
    </div>
  );
}

function CompletedItem({ item }: { item: DownloadItem }) {
  return (
    <div className="dl-item dl-item--completed">
      <div className="dl-item-header">
        <span className="dl-item-done-icon">&#10003;</span>
        <span className="dl-item-title" title={item.title}>
          {item.title}
        </span>
      </div>
    </div>
  );
}

function StatsRibbon({ stats, paused }: { stats: DownloadStats; paused: boolean }) {
  if (paused) {
    return <div className="dl-stats dl-stats--paused">Paused</div>;
  }
  const parts: string[] = [];
  if (stats.downloading > 0) parts.push(`${stats.downloading} downloading`);
  if (stats.queued > 0) parts.push(`${stats.queued} queued`);
  if (parts.length === 0) parts.push("No active downloads");
  return <div className="dl-stats">{parts.join(", ")}</div>;
}

export default function DownloadPanel({
  open,
  onClose,
  active,
  recentlyCompleted,
  stats,
  paused,
  onPauseAll,
  onResumeAll,
  onCancel,
}: DownloadPanelProps) {
  const downloading = active.filter((i) => i.status === "downloading");
  const queued = active.filter((i) => i.status === "queued" || i.status === "paused");
  const errors = active.filter((i) => i.status === "error");

  return (
    <div className={`dl-panel ${open ? "dl-panel--open" : ""}`}>
      <div className="dl-panel-header">
        <span className="dl-panel-title">Downloads</span>
        <div className="dl-panel-actions">
          {(stats.downloading > 0 || stats.queued > 0) && (
            <button
              className="dl-panel-btn"
              onClick={paused ? onResumeAll : onPauseAll}
            >
              {paused ? "Resume" : "Pause"}
            </button>
          )}
          <button className="dl-panel-close" onClick={onClose}>
            &times;
          </button>
        </div>
      </div>

      <StatsRibbon stats={stats} paused={paused} />

      <div className="dl-panel-body">
        {downloading.length > 0 && (
          <div className="dl-section">
            {downloading.map((item) => (
              <ActiveItem key={item.id} item={item} onCancel={onCancel} />
            ))}
          </div>
        )}

        {errors.length > 0 && (
          <div className="dl-section">
            {errors.map((item) => (
              <ActiveItem key={item.id} item={item} onCancel={onCancel} />
            ))}
          </div>
        )}

        {queued.length > 0 && (
          <div className="dl-section">
            <div className="dl-section-label">Queued</div>
            {queued.map((item) => (
              <ActiveItem key={item.id} item={item} onCancel={onCancel} />
            ))}
          </div>
        )}

        {recentlyCompleted.length > 0 && (
          <div className="dl-section">
            <div className="dl-section-label">Recently completed</div>
            {recentlyCompleted.map((item) => (
              <CompletedItem key={item.id} item={item} />
            ))}
          </div>
        )}

        {downloading.length === 0 &&
          queued.length === 0 &&
          errors.length === 0 &&
          recentlyCompleted.length === 0 && (
            <div className="dl-empty">No downloads</div>
          )}
      </div>
    </div>
  );
}
