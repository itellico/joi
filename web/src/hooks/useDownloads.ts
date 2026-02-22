import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionStatus, Frame } from "./useWebSocket";

export interface DownloadItem {
  id: string;
  title: string;
  status: "downloading" | "queued" | "completed" | "error" | "paused";
  progress: number; // 0-100
  speed?: string; // e.g. "12.3 MB/s"
  eta?: string; // e.g. "2m 34s"
  size?: number; // total bytes
  downloaded?: number; // bytes downloaded
  error?: string;
  completedAt?: number;
}

export interface DownloadStats {
  downloading: number;
  queued: number;
  paused: number;
  completed: number;
  totalSpeed?: string;
}

interface WS {
  status: ConnectionStatus;
  send: (type: string, data?: unknown, id?: string) => void;
  on: (type: string, handler: (frame: Frame) => void) => () => void;
}

const MAX_RECENT = 5;

export function useDownloads(ws: WS) {
  const [active, setActive] = useState<DownloadItem[]>([]);
  const [recentlyCompleted, setRecentlyCompleted] = useState<DownloadItem[]>([]);
  const [stats, setStats] = useState<DownloadStats>({ downloading: 0, queued: 0, paused: 0, completed: 0 });
  const [paused, setPaused] = useState(false);
  const mountedRef = useRef(true);

  const activeCount = stats.downloading + stats.queued;

  const fetchActive = useCallback(async () => {
    try {
      const [dlRes, qRes, statsRes] = await Promise.all([
        fetch("/api/videos?status=downloading"),
        fetch("/api/videos?status=queued"),
        fetch("/api/downloads/stats"),
      ]);
      if (!mountedRef.current) return;
      const downloading: DownloadItem[] = dlRes.ok ? (await dlRes.json()).videos ?? [] : [];
      const queued: DownloadItem[] = qRes.ok ? (await qRes.json()).videos ?? [] : [];
      setActive([
        ...downloading.map((v) => ({ ...v, status: "downloading" as const })),
        ...queued.map((v) => ({ ...v, status: "queued" as const })),
      ]);
      if (statsRes.ok) {
        const s = await statsRes.json();
        setStats(s);
        setPaused(s.paused > 0 && s.downloading === 0);
      }
    } catch {
      // API not available yet — no-op
    }
  }, []);

  // Fetch on mount + ws reconnect
  useEffect(() => {
    mountedRef.current = true;
    if (ws.status === "connected") fetchActive();
    return () => { mountedRef.current = false; };
  }, [ws.status, fetchActive]);

  // Subscribe to WS events
  useEffect(() => {
    const unsubs = [
      // Progress updates for individual downloads
      ws.on("download.progress", (frame) => {
        const data = frame.data as {
          videoId: string;
          percent: number;
          speed?: string;
          eta?: string;
          downloaded?: number;
          size?: number;
        };
        setActive((prev) =>
          prev.map((item) =>
            item.id === data.videoId
              ? {
                  ...item,
                  progress: data.percent,
                  speed: data.speed,
                  eta: data.eta,
                  downloaded: data.downloaded,
                  size: data.size,
                }
              : item,
          ),
        );
      }),

      // Status changes (started, completed, error, paused)
      ws.on("download.status", (frame) => {
        const data = frame.data as {
          videoId: string;
          status: DownloadItem["status"];
          title?: string;
          error?: string;
        };

        if (data.status === "completed") {
          // Move from active to recently completed
          setActive((prev) => prev.filter((item) => item.id !== data.videoId));
          setRecentlyCompleted((prev) => {
            const completed: DownloadItem = {
              id: data.videoId,
              title: data.title ?? data.videoId,
              status: "completed",
              progress: 100,
              completedAt: Date.now(),
            };
            return [completed, ...prev].slice(0, MAX_RECENT);
          });
        } else if (data.status === "error") {
          setActive((prev) =>
            prev.map((item) =>
              item.id === data.videoId
                ? { ...item, status: "error", error: data.error }
                : item,
            ),
          );
        }

        // Refetch stats on any status change
        fetchActive();
      }),

      // External changes (e.g. enqueue from Library page)
      ws.on("videos.updated", () => {
        fetchActive();
      }),
    ];

    return () => unsubs.forEach((u) => u());
  }, [ws, fetchActive]);

  const pauseAll = useCallback(async () => {
    try {
      await fetch("/api/downloads/pause", { method: "POST" });
      setPaused(true);
      fetchActive();
    } catch { /* no-op */ }
  }, [fetchActive]);

  const resumeAll = useCallback(async () => {
    try {
      await fetch("/api/downloads/resume", { method: "POST" });
      setPaused(false);
      fetchActive();
    } catch { /* no-op */ }
  }, [fetchActive]);

  const cancel = useCallback(async (id: string) => {
    try {
      await fetch(`/api/downloads/${id}/cancel`, { method: "POST" });
      setActive((prev) => prev.filter((item) => item.id !== id));
      fetchActive();
    } catch { /* no-op */ }
  }, [fetchActive]);

  return {
    active,
    recentlyCompleted,
    stats,
    activeCount,
    paused,
    pauseAll,
    resumeAll,
    cancel,
  };
}
