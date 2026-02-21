import { useEffect, useState, useCallback, useRef, useMemo, type DragEvent, type MouseEvent as ReactMouseEvent } from "react";
import ChatWidget from "../components/ChatWidget";
import { Badge, Button, EmptyState, MetaText, Modal, PageHeader, SectionLabel } from "../components/ui";

type ThingsList = "inbox" | "today" | "upcoming" | "anytime" | "someday";
type SidebarItem =
  | { kind: "list"; list: ThingsList }
  | { kind: "logbook" }
  | { kind: "area"; uuid: string; title: string }
  | { kind: "project"; uuid: string; title: string; areaTitle: string | null };

interface ChecklistItem {
  uuid: string;
  title: string;
  completed: boolean;
  index: number;
}

interface Task {
  uuid: string;
  title: string;
  notes: string | null;
  list: ThingsList;
  projectUuid: string | null;
  projectTitle: string | null;
  headingTitle: string | null;
  areaUuid: string | null;
  areaTitle: string | null;
  tags: string[];
  checklist: ChecklistItem[];
  startDate: string | null;
  deadline: string | null;
  createdAt: string;
  checklistTotal: number;
  checklistDone: number;
  todayIndex: number;
  index: number;
}

interface CompletedTask {
  uuid: string;
  title: string;
  projectTitle: string | null;
  areaTitle: string | null;
  completedAt: string;
}

interface Project {
  uuid: string;
  title: string;
  notes: string | null;
  areaUuid: string | null;
  areaTitle: string | null;
  taskCount: number;
}

interface Area {
  uuid: string;
  title: string;
}

interface ProjectHeading {
  uuid: string;
  title: string;
  projectUuid: string;
}

interface UpdateOpts {
  title?: string;
  notes?: string;
  when?: string;
  tags?: string[];
  deadline?: string;
  listId?: string;
  headingId?: string;
}

const LISTS: { key: ThingsList; label: string; icon: string }[] = [
  { key: "inbox", label: "Inbox", icon: "inbox" },
  { key: "today", label: "Today", icon: "today" },
  { key: "upcoming", label: "Upcoming", icon: "upcoming" },
  { key: "anytime", label: "Anytime", icon: "anytime" },
  { key: "someday", label: "Someday", icon: "someday" },
];

function ListIcon({ type, size = 16 }: { type: string; size?: number }) {
  const s = size;
  const r = s / 2;
  if (type === "inbox") {
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2" width="12" height="12" rx="2.5" fill="#4A9EF5" />
        <path d="M5 8h6M8 5v6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "today") {
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
        <path d="M8 1.5l1.8 3.6 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4L2.2 5.7l4-.6z" fill="#F5C542" />
      </svg>
    );
  }
  if (type === "upcoming") {
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
        <rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="#E8453C" />
        <rect x="5" y="5" width="2.2" height="2.2" rx="0.5" fill="#fff" />
        <rect x="9" y="5" width="2.2" height="2.2" rx="0.5" fill="#fff" />
        <rect x="5" y="9" width="2.2" height="2.2" rx="0.5" fill="#fff" />
      </svg>
    );
  }
  if (type === "anytime") {
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
        <rect x="4" y="3" width="8" height="3" rx="1" fill="#48C8A4" />
        <rect x="4" y="7.5" width="8" height="3" rx="1" fill="#48C8A4" opacity="0.6" />
        <rect x="4.5" y="11.5" width="7" height="2" rx="0.8" fill="#48C8A4" opacity="0.3" />
      </svg>
    );
  }
  if (type === "someday") {
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
        <rect x="2" y="4" width="12" height="9" rx="2" fill="#F5C542" />
        <rect x="4" y="2" width="3" height="4" rx="1" fill="#F5C542" />
        <rect x="9" y="2" width="3" height="4" rx="1" fill="#F5C542" />
      </svg>
    );
  }
  if (type === "logbook") {
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2" width="12" height="12" rx="2.5" fill="#10b981" />
        <path d="M5.5 8.5l2 2 3.5-4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "area") {
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
        <circle cx={r} cy={r} r={r - 2} stroke="#8E8E93" strokeWidth="1.6" />
      </svg>
    );
  }
  if (type === "project") {
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
        <circle cx={r} cy={r} r={r - 2} stroke="#6C8EEF" strokeWidth="1.6" />
      </svg>
    );
  }
  return null;
}

function matchesSearch(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = query.toLowerCase();
  return fields.some((f) => f?.toLowerCase().includes(q));
}

function formatDeadlineShort(d: string): string {
  const date = new Date(d + "T00:00:00");
  const now = new Date();
  const diffDays = Math.round((date.getTime() - now.getTime()) / 86400000);
  if (diffDays < 0) return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays < 7) return date.toLocaleDateString("en-US", { weekday: "short" });
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface TasksProps {
  ws?: { send: (type: string, data?: unknown, id?: string) => void; on: (type: string, handler: (frame: { type: string; id?: string; data?: unknown }) => void) => () => void; status: string };
  chatMode?: "api" | "claude-code";
}

export default function Tasks({ ws, chatMode }: TasksProps) {
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [logbook, setLogbook] = useState<CompletedTask[]>([]);
  const [logbookLimit, setLogbookLimit] = useState(100);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [projects, setProjects] = useState<Project[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [selected, setSelected] = useState<SidebarItem>({ kind: "list", list: "inbox" });
  const [loading, setLoading] = useState(true);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [completing, setCompleting] = useState<Set<string>>(new Set());
  const [uncompleting, setUncompleting] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [editingUuid, setEditingUuid] = useState<string | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [collapsedAreas, setCollapsedAreas] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ uuid: string; x: number; y: number } | null>(null);
  const [moveDialogUuid, setMoveDialogUuid] = useState<string | null>(null);
  const [inlineCreating, setInlineCreating] = useState(false);
  const [createProjectDialog, setCreateProjectDialog] = useState<{ areaUuid?: string } | null>(null);
  const [createAreaDialog, setCreateAreaDialog] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);

  const [projectHeadings, setProjectHeadings] = useState<Record<string, ProjectHeading[]>>({});

  // Locked projects & chat widget state
  const [lockedProjects, setLockedProjects] = useState<string[]>([]);
  const [taskConversationMap, setTaskConversationMap] = useState<Record<string, { conversationId: string; title: string }>>({});
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [widgetMode, setWidgetMode] = useState<"panel" | "sheet">("panel");
  const [widgetTask, setWidgetTask] = useState<Task | null>(null);
  const [widgetConversationId, setWidgetConversationId] = useState<string | null>(null);

  const fetchConversationMap = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks/conversation-map");
      const data = await res.json();
      setTaskConversationMap(data.conversationMap || {});
    } catch { /* ignore */ }
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      const [tRes, pRes, aRes, tagRes, hRes, lpRes] = await Promise.all([
        fetch("/api/tasks"),
        fetch("/api/tasks/projects"),
        fetch("/api/tasks/areas"),
        fetch("/api/tasks/tags"),
        fetch("/api/tasks/headings"),
        fetch("/api/tasks/locked-projects"),
      ]);
      const tData = await tRes.json();
      const pData = await pRes.json();
      const aData = await aRes.json();
      const tagData = await tagRes.json();
      const hData = await hRes.json();
      const lpData = await lpRes.json();

      const flat: Task[] = [];
      for (const list of Object.values(tData.tasks) as Task[][]) flat.push(...list);
      setAllTasks(flat);
      setCounts(tData.counts || {});
      setProjects(pData.projects || []);
      setAreas(aData.areas || []);
      setAllTags(tagData.tags || []);
      setProjectHeadings(hData.headings || {});
      setLockedProjects(lpData.lockedProjects || []);
      fetchConversationMap();
    } catch (err) {
      console.error("Failed to load tasks:", err);
    } finally {
      setLoading(false);
    }
  }, [fetchConversationMap]);

  const fetchLogbook = useCallback(async (limit = logbookLimit) => {
    try {
      const res = await fetch(`/api/tasks/logbook?limit=${limit}`);
      const data = await res.json();
      setLogbook(data.tasks || []);
    } catch { /* ignore */ }
  }, [logbookLimit]);

  useEffect(() => {
    fetchAll();
    intervalRef.current = setInterval(fetchAll, 30000);
    return () => clearInterval(intervalRef.current);
  }, [fetchAll]);

  useEffect(() => {
    if (selected.kind === "logbook") fetchLogbook();
  }, [selected, fetchLogbook]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "Escape") {
        if (search) { setSearch(""); searchRef.current?.blur(); }
        if (contextMenu) setContextMenu(null);
        if (moveDialogUuid) setMoveDialogUuid(null);
        if (createProjectDialog) setCreateProjectDialog(null);
        if (createAreaDialog) setCreateAreaDialog(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [search, contextMenu, moveDialogUuid, createProjectDialog, createAreaDialog]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [contextMenu]);

  const isSearching = search.trim().length > 0;

  const searchResults = useMemo(() => {
    if (!isSearching) return [];
    const q = search.trim();
    return allTasks.filter((t) => matchesSearch(q, t.title, t.notes, t.projectTitle, t.areaTitle, t.headingTitle, ...t.tags));
  }, [allTasks, search, isSearching]);

  const searchLogbookResults = useMemo(() => {
    if (!isSearching) return [];
    const q = search.trim();
    return logbook.filter((t) => matchesSearch(q, t.title, t.projectTitle, t.areaTitle));
  }, [logbook, search, isSearching]);

  const handleComplete = async (uuid: string) => {
    setCompleting((prev) => new Set(prev).add(uuid));
    await fetch(`/api/tasks/${uuid}/complete`, { method: "PUT" });
    setTimeout(() => {
      setCompleting((prev) => { const n = new Set(prev); n.delete(uuid); return n; });
      setAllTasks((prev) => prev.filter((t) => t.uuid !== uuid));
    }, 600);
    setTimeout(fetchAll, 2500);
  };

  const handleUncomplete = async (uuid: string) => {
    setUncompleting((prev) => new Set(prev).add(uuid));
    await fetch(`/api/tasks/${uuid}/uncomplete`, { method: "PUT" });
    setTimeout(() => {
      setUncompleting((prev) => { const n = new Set(prev); n.delete(uuid); return n; });
      setLogbook((prev) => prev.filter((t) => t.uuid !== uuid));
    }, 600);
    setTimeout(() => { fetchAll(); fetchLogbook(); }, 2000);
  };

  const handleUpdate = async (uuid: string, opts: UpdateOpts) => {
    const task = allTasks.find((t) => t.uuid === uuid);
    if (!task) return;
    const body: Record<string, unknown> = {};
    if (opts.title !== undefined && opts.title !== task.title) body.title = opts.title;
    if (opts.notes !== undefined && opts.notes !== (task.notes || "")) body.notes = opts.notes;
    if (opts.when !== undefined) body.when = opts.when;
    if (opts.tags !== undefined) body.tags = opts.tags;
    if (opts.deadline !== undefined) body.deadline = opts.deadline;
    if (opts.listId !== undefined) body.listId = opts.listId;
    if (opts.headingId !== undefined) body.headingId = opts.headingId;
    if (Object.keys(body).length === 0) { setEditingUuid(null); return; }
    await fetch(`/api/tasks/${uuid}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setAllTasks((prev) => prev.map((t) => {
      if (t.uuid !== uuid) return t;
      const updated = { ...t };
      if (body.title) updated.title = body.title as string;
      if (body.notes !== undefined) updated.notes = body.notes as string;
      if (body.tags) updated.tags = body.tags as string[];
      if (body.deadline !== undefined) updated.deadline = body.deadline as string || null;
      return updated;
    }));
    setEditingUuid(null);
    setTimeout(fetchAll, 2000);
  };

  const handleDropOnList = async (e: DragEvent, targetList: ThingsList) => {
    e.preventDefault();
    setDropTarget(null);
    const uuid = e.dataTransfer.getData("text/plain");
    if (!uuid) return;
    const task = allTasks.find((t) => t.uuid === uuid);
    if (!task || task.list === targetList) return;
    setAllTasks((prev) => prev.map((t) => t.uuid === uuid ? { ...t, list: targetList } : t));
    await fetch(`/api/tasks/${uuid}/move`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ list: targetList }) });
    setTimeout(fetchAll, 2000);
  };

  const handleDragOver = (e: DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(id);
  };

  const toggleProjectCollapse = (uuid: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  };

  const toggleAreaCollapse = (uuid: string) => {
    setCollapsedAreas((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  };

  const handleDuplicate = async (uuid: string) => {
    await fetch(`/api/tasks/${uuid}/duplicate`, { method: "POST" });
    setTimeout(fetchAll, 2000);
  };

  const handleConvertToProject = async (uuid: string) => {
    const task = allTasks.find((t) => t.uuid === uuid);
    if (!task) return;
    await fetch("/api/tasks/create-project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: task.title, notes: task.notes || undefined }),
    });
    setTimeout(fetchAll, 2000);
  };

  const handleShowInThings = async (uuid: string) => {
    await fetch(`/api/tasks/${uuid}/show`, { method: "POST" });
  };

  const handleAppendChecklist = async (uuid: string, item: string) => {
    await fetch(`/api/tasks/${uuid}/checklist`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [item] }),
    });
    setTimeout(fetchAll, 2000);
  };

  const handleToggleChecklistItem = async (taskUuid: string, itemUuid: string, completed: boolean) => {
    // Optimistic update
    setAllTasks((prev) => prev.map((t) => {
      if (t.uuid !== taskUuid) return t;
      return {
        ...t,
        checklist: t.checklist.map((ci) => ci.uuid === itemUuid ? { ...ci, completed } : ci),
        checklistDone: t.checklistDone + (completed ? 1 : -1),
      };
    }));
    await fetch(`/api/tasks/checklist-items/${itemUuid}/toggle`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed }),
    });
    setTimeout(fetchAll, 2000);
  };

  const handleDeleteChecklistItem = async (taskUuid: string, itemUuid: string) => {
    // Optimistic update
    setAllTasks((prev) => prev.map((t) => {
      if (t.uuid !== taskUuid) return t;
      const item = t.checklist.find((ci) => ci.uuid === itemUuid);
      return {
        ...t,
        checklist: t.checklist.filter((ci) => ci.uuid !== itemUuid),
        checklistTotal: t.checklistTotal - 1,
        checklistDone: t.checklistDone - (item?.completed ? 1 : 0),
      };
    }));
    await fetch(`/api/tasks/checklist-items/${itemUuid}`, { method: "DELETE" });
    setTimeout(fetchAll, 2000);
  };

  const handleDeleteTask = async (uuid: string) => {
    setAllTasks((prev) => prev.filter((t) => t.uuid !== uuid));
    await fetch(`/api/tasks/${uuid}`, { method: "DELETE" });
    setTimeout(fetchAll, 2000);
  };

  const handleCreateTask = async (title: string, opts?: { list?: string; listId?: string; headingId?: string }) => {
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, ...opts }),
    });
    setTimeout(fetchAll, 2000);
  };

  const handleCreateProject = async (title: string, areaId?: string) => {
    await fetch("/api/tasks/create-project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, areaId }),
    });
    setTimeout(fetchAll, 2000);
  };

  const handleCreateArea = async (title: string) => {
    await fetch("/api/tasks/create-area", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    setTimeout(fetchAll, 2000);
  };

  const handleUpdateProject = async (uuid: string, notes: string) => {
    await fetch(`/api/tasks/projects/${uuid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    setTimeout(fetchAll, 2000);
  };

  const handleDeleteProject = async (uuid: string) => {
    await fetch(`/api/tasks/projects/${uuid}`, { method: "DELETE" });
    setSelected({ kind: "list", list: "today" });
    setTimeout(fetchAll, 2000);
  };

  const handleStartCoding = (task: Task) => {
    setWidgetTask(task);
    setWidgetConversationId(null); // New conversation
    setWidgetOpen(true);
  };

  const handleOpenConversation = (task: Task) => {
    const entry = taskConversationMap[task.uuid];
    if (entry) {
      setWidgetTask(task);
      setWidgetConversationId(entry.conversationId);
      setWidgetOpen(true);
    }
  };

  const handleMoveToProject = async (uuid: string, listId: string, headingId?: string) => {
    const body: Record<string, string> = { listId };
    if (headingId) body.headingId = headingId;
    await fetch(`/api/tasks/${uuid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setMoveDialogUuid(null);
    setTimeout(fetchAll, 2000);
  };

  // Content based on selection
  type Section = { label: string; tasks: Task[]; isProject?: boolean; projectUuid?: string; taskCount?: number; isArea?: boolean; areaIcon?: boolean };

  const getContent = (): { title: string; subtitle?: string; notes?: string | null; icon?: string; sections: Section[] } => {
    if (selected.kind === "list") {
      const listTasks = allTasks.filter((t) => t.list === selected.list);
      const info = LISTS.find((l) => l.key === selected.list)!;

      const standalone: Task[] = [];
      const areaMap = new Map<string, { areaTasks: Task[]; projects: Map<string, Task[]> }>();

      for (const t of listTasks) {
        if (!t.areaUuid && !t.projectUuid) { standalone.push(t); continue; }
        const areaKey = t.areaTitle || t.areaUuid || "";
        if (!areaMap.has(areaKey)) areaMap.set(areaKey, { areaTasks: [], projects: new Map() });
        const group = areaMap.get(areaKey)!;
        if (t.projectUuid) {
          const projKey = t.projectTitle || t.projectUuid;
          if (!group.projects.has(projKey)) group.projects.set(projKey, []);
          group.projects.get(projKey)!.push(t);
        } else {
          group.areaTasks.push(t);
        }
      }

      const sections: Section[] = [];
      if (standalone.length > 0) sections.push({ label: "", tasks: standalone });
      for (const [areaName, group] of areaMap) {
        if (group.areaTasks.length > 0) sections.push({ label: areaName, tasks: group.areaTasks, isArea: true, areaIcon: true });
        for (const [projName, tasks] of group.projects) {
          const proj = projects.find((p) => p.title === projName);
          sections.push({ label: projName, tasks, isProject: true, projectUuid: proj?.uuid, taskCount: tasks.length });
        }
      }

      return { title: info.label, icon: info.icon, sections };
    }

    if (selected.kind === "area") {
      const areaProjects = projects.filter((p) => p.areaUuid === selected.uuid);
      const areaTasks = allTasks.filter((t) => t.areaUuid === selected.uuid);
      const sections: Section[] = [];
      for (const proj of areaProjects) {
        sections.push({ label: proj.title, tasks: [], isProject: true, projectUuid: proj.uuid, taskCount: proj.taskCount });
      }
      const standalone = areaTasks.filter((t) => !t.projectUuid);
      if (standalone.length > 0) sections.push({ label: areaProjects.length > 0 ? "No Project" : "", tasks: standalone });
      return { title: selected.title, icon: "area", sections };
    }

    if (selected.kind === "project") {
      const proj = projects.find((p) => p.uuid === selected.uuid);
      const projTasks = allTasks.filter((t) => t.projectUuid === selected.uuid);
      const headings = projectHeadings[selected.uuid] || [];

      // Group tasks by heading title
      const byHeading = new Map<string, Task[]>();
      for (const t of projTasks) {
        const key = t.headingTitle || "";
        if (!byHeading.has(key)) byHeading.set(key, []);
        byHeading.get(key)!.push(t);
      }

      const sections: Section[] = [];
      // Tasks with no heading first
      const noHeading = byHeading.get("");
      if (noHeading) sections.push({ label: "", tasks: noHeading });

      // Then each heading (from DB order), even if it has no tasks
      for (const h of headings) {
        const tasks = byHeading.get(h.title) || [];
        sections.push({ label: h.title, tasks });
      }

      // Any heading titles from tasks that weren't in the headings list
      for (const [heading, tasks] of byHeading) {
        if (heading === "") continue;
        if (headings.some((h) => h.title === heading)) continue;
        sections.push({ label: heading, tasks });
      }

      return { title: selected.title, subtitle: selected.areaTitle || undefined, notes: proj?.notes || null, icon: "project", sections };
    }

    return { title: "", sections: [] };
  };

  const content = loading || selected.kind === "logbook" ? null : getContent();

  const isProjectLocked = (title: string) => lockedProjects.includes(title);
  const isSelectedLocked = selected.kind === "project" && isProjectLocked(selected.title);

  const areaTree = areas.map((a) => ({ area: a, projects: projects.filter((p) => p.areaUuid === a.uuid) }));
  const orphanProjects = projects.filter((p) => !p.areaUuid);

  const isSelected = (item: SidebarItem): boolean => {
    if (selected.kind !== item.kind) return false;
    if (item.kind === "list" && selected.kind === "list") return selected.list === item.list;
    if (item.kind === "logbook") return true;
    if ("uuid" in selected && "uuid" in item) return selected.uuid === item.uuid;
    return false;
  };

  const logbookByDate = logbook.reduce<Record<string, CompletedTask[]>>((acc, t) => {
    const day = t.completedAt.slice(0, 10);
    (acc[day] ||= []).push(t);
    return acc;
  }, {});

  const searchByList = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    for (const t of searchResults) {
      if (!grouped.has(t.list)) grouped.set(t.list, []);
      grouped.get(t.list)!.push(t);
    }
    return grouped;
  }, [searchResults]);

  // Determine current creation context for inline new task
  const getCreationContext = (): { list?: string; listId?: string } => {
    if (selected.kind === "list") return { list: selected.list };
    if (selected.kind === "project") return { listId: selected.uuid };
    return { list: "inbox" };
  };

  return (
    <>
    <PageHeader title="Tasks" />
    <div className="t3-layout">
      {/* ── Sidebar ── */}
      <div className="t3-sidebar">
        <div className="t3-search-box">
          <input ref={searchRef} type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="t3-search-input" />
          {search && <button className="t3-search-clear" onClick={() => setSearch("")}>&times;</button>}
        </div>

        <div className="t3-sidebar-section">
          {LISTS.map((l) => (
            <div
              key={l.key}
              className={`t3-sidebar-item${isSelected({ kind: "list", list: l.key }) && !isSearching ? " active" : ""}${dropTarget === l.key ? " drop-target" : ""}`}
              onClick={() => { setSelected({ kind: "list", list: l.key }); setSearch(""); }}
              onDragOver={(e) => handleDragOver(e, l.key)}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => handleDropOnList(e, l.key)}
            >
              <ListIcon type={l.icon} />
              <span className="t3-sidebar-label">{l.label}</span>
              {(counts[l.key] || 0) > 0 && <span className="t3-sidebar-count">{counts[l.key]}</span>}
            </div>
          ))}
        </div>

        <div className="t3-sidebar-divider" />

        <div className="t3-sidebar-section">
          <div
            className={`t3-sidebar-item${isSelected({ kind: "logbook" }) && !isSearching ? " active" : ""}`}
            onClick={() => { setSelected({ kind: "logbook" }); setSearch(""); }}
          >
            <ListIcon type="logbook" />
            <span className="t3-sidebar-label">Logbook</span>
          </div>
        </div>

        <div className="t3-sidebar-divider" />

        <div className="t3-sidebar-section t3-sidebar-scroll">
          {areaTree.map(({ area, projects: ap }) => (
            <div key={area.uuid}>
              <div
                className={`t3-sidebar-item t3-area-header${isSelected({ kind: "area", uuid: area.uuid, title: area.title }) && !isSearching ? " active" : ""}`}
                onClick={() => { setSelected({ kind: "area", uuid: area.uuid, title: area.title }); setSearch(""); }}
              >
                <span
                  className={`t3-area-chevron${collapsedAreas.has(area.uuid) ? " collapsed" : ""}`}
                  onClick={(e) => { e.stopPropagation(); toggleAreaCollapse(area.uuid); }}
                >&#9662;</span>
                <span className="t3-sidebar-label t3-area-label">{area.title}</span>
                <span
                  className="t3-area-add"
                  onClick={(e) => { e.stopPropagation(); setCreateProjectDialog({ areaUuid: area.uuid }); }}
                  title="New Project"
                >+</span>
              </div>
              <div className={`t3-area-children${collapsedAreas.has(area.uuid) ? " collapsed" : ""}`}>
                {ap.map((p) => (
                  <div
                    key={p.uuid}
                    className={`t3-sidebar-item t3-indent${isSelected({ kind: "project", uuid: p.uuid, title: p.title, areaTitle: area.title }) && !isSearching ? " active" : ""}`}
                    onClick={() => { setSelected({ kind: "project", uuid: p.uuid, title: p.title, areaTitle: area.title }); setSearch(""); }}
                  >
                    <ListIcon type="project" />
                    <span className="t3-sidebar-label">{p.title}</span>
                    {p.taskCount > 0 && <span className="t3-sidebar-count">{p.taskCount}</span>}
                    {isProjectLocked(p.title) && <span className="t3-sidebar-lock" title="Locked project">&#128274;</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {orphanProjects.length > 0 && areaTree.length > 0 && (
            <div className="t3-sidebar-section-label">Projects</div>
          )}
          {orphanProjects.map((p) => (
            <div
              key={p.uuid}
              className={`t3-sidebar-item${isSelected({ kind: "project", uuid: p.uuid, title: p.title, areaTitle: null }) && !isSearching ? " active" : ""}`}
              onClick={() => { setSelected({ kind: "project", uuid: p.uuid, title: p.title, areaTitle: null }); setSearch(""); }}
            >
              <ListIcon type="project" />
              <span className="t3-sidebar-label">{p.title}</span>
              {p.taskCount > 0 && <span className="t3-sidebar-count">{p.taskCount}</span>}
              {isProjectLocked(p.title) && <span className="t3-sidebar-lock" title="Locked project">&#128274;</span>}
            </div>
          ))}
        </div>

        <div className="t3-sidebar-actions">
          <button className="t3-new-area-btn" onClick={() => setCreateAreaDialog(true)} title="New Area">
            + New Area
          </button>
        </div>

      </div>

      {/* ── Content ── */}
      <div className={`t3-content${widgetOpen ? (widgetMode === "sheet" ? " widget-sheet-open" : " widget-panel-open") : ""}`}>
        {loading ? (
          <EmptyState message="Loading..." />
        ) : isSearching ? (
          <SearchView
            results={searchResults} logbookResults={searchLogbookResults} query={search}
            searchByList={searchByList} completing={completing} uncompleting={uncompleting}
            editingUuid={editingUuid} allTags={allTags} projects={projects} areas={areas}
            onComplete={handleComplete} onUncomplete={handleUncomplete}
            onUpdate={handleUpdate} onStartEdit={setEditingUuid} onCancelEdit={() => setEditingUuid(null)}
            onContextMenu={setContextMenu} onAppendChecklist={handleAppendChecklist}
            onToggleChecklistItem={handleToggleChecklistItem}
            onDeleteChecklistItem={handleDeleteChecklistItem}
          />
        ) : selected.kind === "logbook" ? (
          <LogbookView
            logbookByDate={logbookByDate} logbook={logbook} uncompleting={uncompleting}
            onUncomplete={handleUncomplete} onRefresh={fetchLogbook}
            onLoadMore={() => { const next = logbookLimit + 100; setLogbookLimit(next); fetchLogbook(next); }}
          />
        ) : content ? (
          <ContentView
            content={content} selected={selected} completing={completing}
            editingUuid={editingUuid} collapsedProjects={collapsedProjects}
            allTags={allTags} projects={projects} areas={areas}
            onComplete={handleComplete} onUpdate={handleUpdate}
            onStartEdit={setEditingUuid} onCancelEdit={() => setEditingUuid(null)}
            onSelect={setSelected} onToggleCollapse={toggleProjectCollapse}
            onContextMenu={setContextMenu} onAppendChecklist={handleAppendChecklist}
            onToggleChecklistItem={handleToggleChecklistItem}
            onDeleteChecklistItem={handleDeleteChecklistItem}
            isLockedProject={isSelectedLocked}
            taskConversationMap={taskConversationMap}
            onStartCoding={handleStartCoding}
            onOpenConversation={handleOpenConversation}
            onUpdateProject={handleUpdateProject}
            onDeleteProject={handleDeleteProject}
            onRefresh={fetchAll}
          />
        ) : null}

        {/* Bottom bar */}
        {!loading && selected.kind !== "logbook" && !isSearching && (
          <>
            {inlineCreating && (
              <InlineNewTask
                onSubmit={(title) => { handleCreateTask(title, getCreationContext()); setInlineCreating(false); }}
                onCancel={() => setInlineCreating(false)}
              />
            )}
            <div className="t3-bottom-bar">
              <Button onClick={() => setInlineCreating(true)}>+ New To-Do</Button>
            </div>
          </>
        )}
      </div>

      {/* ── Context Menu ── */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y}
          onDuplicate={() => { handleDuplicate(contextMenu.uuid); setContextMenu(null); }}
          onMove={() => { setMoveDialogUuid(contextMenu.uuid); setContextMenu(null); }}
          onConvert={() => { handleConvertToProject(contextMenu.uuid); setContextMenu(null); }}
          onDelete={() => { handleDeleteTask(contextMenu.uuid); setContextMenu(null); }}
          onShowInThings={() => { handleShowInThings(contextMenu.uuid); setContextMenu(null); }}
        />
      )}

      {/* ── Move Dialog ── */}
      {moveDialogUuid && (
        <MoveDialog
          taskUuid={moveDialogUuid}
          currentProjectUuid={allTasks.find((t) => t.uuid === moveDialogUuid)?.projectUuid || null}
          projects={projects} areas={areas}
          onMove={handleMoveToProject}
          onClose={() => setMoveDialogUuid(null)}
        />
      )}

      {/* ── Create Project Dialog ── */}
      {createProjectDialog && (
        <CreateProjectDialog
          areas={areas} defaultAreaUuid={createProjectDialog.areaUuid}
          onCreate={(title, areaId) => { handleCreateProject(title, areaId); setCreateProjectDialog(null); }}
          onClose={() => setCreateProjectDialog(null)}
        />
      )}

      {/* ── Create Area Dialog ── */}
      {createAreaDialog && (
        <CreateAreaDialog
          onCreate={(title) => { handleCreateArea(title); setCreateAreaDialog(false); }}
          onClose={() => setCreateAreaDialog(false)}
        />
      )}

      {/* ── Chat Widget ── */}
      {widgetOpen && ws && widgetTask && (
        <ChatWidget
          ws={ws}
          chatMode={chatMode || "api"}
          task={widgetTask}
          conversationId={widgetConversationId}
          onConversationCreated={() => fetchConversationMap()}
          onClose={() => setWidgetOpen(false)}
          mode={widgetMode}
          onModeChange={setWidgetMode}
        />
      )}

      {/* ── FAB when widget closed but task was selected ── */}
      {!widgetOpen && widgetTask && (
        <button
          className="t3-chat-fab"
          onClick={() => setWidgetOpen(true)}
          title={`Resume: ${widgetTask.title}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        </button>
      )}
    </div>
    </>
  );
}

/* ── Sub-views ── */

function SearchView({ results, logbookResults, query, searchByList, completing, uncompleting, editingUuid, allTags, onComplete, onUncomplete, onUpdate, onStartEdit, onCancelEdit, onContextMenu, onAppendChecklist, onToggleChecklistItem, onDeleteChecklistItem }: {
  results: Task[]; logbookResults: CompletedTask[]; query: string;
  searchByList: Map<string, Task[]>; completing: Set<string>; uncompleting: Set<string>;
  editingUuid: string | null; allTags: string[]; projects: Project[]; areas: Area[];
  onComplete: (u: string) => void; onUncomplete: (u: string) => void;
  onUpdate: (u: string, opts: UpdateOpts) => void;
  onStartEdit: (u: string) => void; onCancelEdit: () => void;
  onContextMenu: (ctx: { uuid: string; x: number; y: number }) => void;
  onAppendChecklist: (u: string, item: string) => void;
  onToggleChecklistItem: (taskUuid: string, itemUuid: string, completed: boolean) => void;
  onDeleteChecklistItem: (taskUuid: string, itemUuid: string) => void;
}) {
  return (
    <>
      <div className="t3-header">
        <div className="t3-header-title">
          <h2>Search Results</h2>
          <MetaText>{results.length} active{logbookResults.length > 0 ? `, ${logbookResults.length} completed` : ""}</MetaText>
        </div>
      </div>
      <div className="t3-task-list">
        {Array.from(searchByList.entries()).map(([listKey, tasks]) => (
          <div key={listKey}>
            <SectionLabel>{LISTS.find((l) => l.key === listKey)?.label || listKey}</SectionLabel>
            {tasks.map((task) => (
              <TaskRow key={task.uuid} task={task} onComplete={onComplete} onUpdate={onUpdate}
                isCompleting={completing.has(task.uuid)} isEditing={editingUuid === task.uuid}
                onStartEdit={() => onStartEdit(task.uuid)} onCancelEdit={onCancelEdit}
                allTags={allTags} onContextMenu={onContextMenu} onAppendChecklist={onAppendChecklist}
                onToggleChecklistItem={onToggleChecklistItem} onDeleteChecklistItem={onDeleteChecklistItem} />
            ))}
          </div>
        ))}
        {logbookResults.length > 0 && (
          <div>
            <SectionLabel>Logbook</SectionLabel>
            {logbookResults.map((t) => (
              <CompletedRow key={t.uuid} task={t} isUncompleting={uncompleting.has(t.uuid)} onUncomplete={onUncomplete} />
            ))}
          </div>
        )}
        {results.length === 0 && logbookResults.length === 0 && (
          <EmptyState message={`No tasks matching "${query}"`} />
        )}
      </div>
    </>
  );
}

function formatLogbookDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return date.toLocaleDateString("en-US", { weekday: "long" });
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  }
  return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function formatCompletionTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
}

function LogbookView({ logbookByDate, logbook, uncompleting, onUncomplete, onRefresh, onLoadMore }: {
  logbookByDate: Record<string, CompletedTask[]>; logbook: CompletedTask[];
  uncompleting: Set<string>; onUncomplete: (u: string) => void; onRefresh: () => void;
  onLoadMore: () => void;
}) {
  return (
    <>
      <div className="t3-header">
        <div className="t3-header-title">
          <ListIcon type="logbook" size={24} />
          <h2>Logbook</h2>
          <MetaText>{logbook.length} completed</MetaText>
        </div>
        <Button onClick={onRefresh}>Refresh</Button>
      </div>
      <div className="t3-task-list t3-logbook">
        {Object.entries(logbookByDate).map(([date, tasks]) => {
          // Group tasks by project within this date
          const byProject = new Map<string, CompletedTask[]>();
          const standalone: CompletedTask[] = [];
          for (const t of tasks) {
            if (t.projectTitle) {
              if (!byProject.has(t.projectTitle)) byProject.set(t.projectTitle, []);
              byProject.get(t.projectTitle)!.push(t);
            } else {
              standalone.push(t);
            }
          }

          return (
            <div key={date} className="t3-logbook-day">
              <div className="t3-logbook-date-header">
                <span className="t3-logbook-date-label">{formatLogbookDate(date)}</span>
                <span className="t3-logbook-date-count">{tasks.length} {tasks.length === 1 ? "task" : "tasks"}</span>
              </div>
              <div className="t3-logbook-day-tasks">
                {/* Standalone tasks (no project) */}
                {standalone.map((t) => (
                  <CompletedRow key={t.uuid} task={t} isUncompleting={uncompleting.has(t.uuid)} onUncomplete={onUncomplete} />
                ))}

                {/* Grouped by project */}
                {Array.from(byProject.entries()).map(([projectTitle, projectTasks]) => (
                  <div key={projectTitle} className="t3-logbook-project-group">
                    <div className="t3-logbook-project-header">
                      <ListIcon type="project" size={14} />
                      <span className="t3-logbook-project-name">{projectTitle}</span>
                      <span className="t3-logbook-project-count">{projectTasks.length}</span>
                    </div>
                    {projectTasks.map((t) => (
                      <CompletedRow key={t.uuid} task={t} isUncompleting={uncompleting.has(t.uuid)} onUncomplete={onUncomplete} showProject={false} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {logbook.length > 0 && logbook.length % 100 === 0 && (
          <div className="t3-logbook-load-more">
            <Button onClick={onLoadMore}>Load more</Button>
          </div>
        )}
        {logbook.length === 0 && <EmptyState message="No completed tasks yet" />}
      </div>
    </>
  );
}

function ContentView({ content, selected, completing, editingUuid, collapsedProjects, allTags, onComplete, onUpdate, onStartEdit, onCancelEdit, onSelect, onToggleCollapse, onContextMenu, onAppendChecklist, onToggleChecklistItem, onDeleteChecklistItem, isLockedProject, taskConversationMap, onStartCoding, onOpenConversation, onUpdateProject, onDeleteProject, onRefresh }: {
  content: { title: string; subtitle?: string; notes?: string | null; icon?: string; sections: { label: string; tasks: Task[]; isProject?: boolean; projectUuid?: string; taskCount?: number; isArea?: boolean; areaIcon?: boolean }[] };
  selected: SidebarItem; completing: Set<string>; editingUuid: string | null;
  collapsedProjects: Set<string>; allTags: string[]; projects: Project[]; areas: Area[];
  onComplete: (u: string) => void; onUpdate: (u: string, opts: UpdateOpts) => void;
  onStartEdit: (u: string) => void; onCancelEdit: () => void;
  onSelect: (item: SidebarItem) => void; onToggleCollapse: (uuid: string) => void;
  onContextMenu: (ctx: { uuid: string; x: number; y: number }) => void;
  onAppendChecklist: (u: string, item: string) => void;
  onToggleChecklistItem: (taskUuid: string, itemUuid: string, completed: boolean) => void;
  onDeleteChecklistItem: (taskUuid: string, itemUuid: string) => void;
  isLockedProject?: boolean;
  taskConversationMap?: Record<string, { conversationId: string; title: string }>;
  onStartCoding?: (task: Task) => void;
  onOpenConversation?: (task: Task) => void;
  onUpdateProject?: (uuid: string, notes: string) => void;
  onDeleteProject?: (uuid: string) => void;
  onRefresh?: () => void;
}) {
  const PREVIEW_COUNT = 3;
  const [editingNotes, setEditingNotes] = useState(false);
  const [projectNotes, setProjectNotes] = useState(content.notes || "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [projectLogbook, setProjectLogbook] = useState<CompletedTask[]>([]);
  const [showLoggedItems, setShowLoggedItems] = useState(false);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const isProject = selected.kind === "project";
  const projectUuid = isProject ? (selected as { uuid: string }).uuid : null;

  // Reset notes state when project changes
  useEffect(() => {
    setEditingNotes(false);
    setConfirmDelete(false);
    setShowProjectMenu(false);
    setProjectNotes(content.notes || "");
    setShowLoggedItems(false);
    setProjectLogbook([]);
  }, [projectUuid, content.notes]);

  // Fetch project logbook when showing logged items
  useEffect(() => {
    if (!isProject || !showLoggedItems || !projectUuid) return;
    fetch(`/api/tasks/logbook/project/${projectUuid}`)
      .then((r) => r.json())
      .then((d) => setProjectLogbook(d.tasks || []))
      .catch(() => setProjectLogbook([]));
  }, [isProject, showLoggedItems, projectUuid]);

  // Close menu on outside click
  useEffect(() => {
    if (!showProjectMenu) return;
    const handler = (e: globalThis.MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowProjectMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showProjectMenu]);

  const formatLoggedDate = (isoString: string): string => {
    const d = new Date(isoString);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000);
    if (diffDays === 0) return "today";
    if (diffDays === 1) return "yesterday";
    if (diffDays < 7) return d.toLocaleDateString("en-US", { weekday: "short" }).toLowerCase();
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <>
      <div className="t3-header">
        <div className="t3-header-title">
          {content.icon && <ListIcon type={content.icon} size={24} />}
          <h2>{content.title}</h2>
          {content.subtitle && <MetaText>{content.subtitle}</MetaText>}
          {isProject && (
            <div className="t3-header-dots-wrap" ref={menuRef}>
              <button className="t3-header-dots" onClick={() => setShowProjectMenu(!showProjectMenu)} title="Project options">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="13" cy="8" r="1.5"/></svg>
              </button>
              {showProjectMenu && (
                <div className="t3-dots-menu">
                  <button className="t3-dots-menu-item" onClick={() => { setShowProjectMenu(false); setEditingNotes(!editingNotes); setTimeout(() => notesRef.current?.focus(), 50); }}>
                    Edit notes
                  </button>
                  {confirmDelete ? (
                    <div className="t3-dots-menu-confirm">
                      <span>Delete this project?</span>
                      <div className="t3-dots-menu-confirm-btns">
                        <button className="t3-dots-menu-item t3-dots-menu-danger" onClick={() => { onDeleteProject?.(projectUuid!); setConfirmDelete(false); setShowProjectMenu(false); }}>Yes, delete</button>
                        <button className="t3-dots-menu-item" onClick={() => setConfirmDelete(false)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button className="t3-dots-menu-item t3-dots-menu-danger" onClick={() => setConfirmDelete(true)}>
                      Delete project
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {isProject && editingNotes ? (
        <div className="t3-project-notes-edit">
          <textarea
            ref={notesRef}
            className="t3-project-notes-textarea"
            value={projectNotes}
            onChange={(e) => setProjectNotes(e.target.value)}
            placeholder="Project notes..."
            rows={4}
          />
          <div className="t3-project-notes-actions">
            <Button variant="primary" size="sm" onClick={() => {
              onUpdateProject?.(projectUuid!, projectNotes);
              setEditingNotes(false);
              setTimeout(() => onRefresh?.(), 2000);
            }}>Save</Button>
            <Button size="sm" onClick={() => { setEditingNotes(false); setProjectNotes(content.notes || ""); }}>Cancel</Button>
          </div>
        </div>
      ) : content.notes ? (
        <div className="t3-project-notes" onClick={isProject ? () => { setEditingNotes(true); setTimeout(() => notesRef.current?.focus(), 50); } : undefined}
          style={isProject ? { cursor: "pointer" } : undefined}
        >{content.notes}</div>
      ) : isProject ? (
        <div className="t3-project-notes t3-project-notes-empty" onClick={() => { setEditingNotes(true); setTimeout(() => notesRef.current?.focus(), 50); }}>
          Click to add notes...
        </div>
      ) : null}

      <div className="t3-task-list">
        {content.sections.map((section, i) => {
          if (section.isProject && section.projectUuid) {
            const isCollapsed = !collapsedProjects.has(section.projectUuid);
            const allProjTasks = section.tasks.length > 0 ? section.tasks : [];
            const visibleTasks = isCollapsed ? allProjTasks.slice(0, PREVIEW_COUNT) : allProjTasks;
            const hiddenCount = allProjTasks.length - PREVIEW_COUNT;

            return (
              <div key={section.projectUuid} className="t3-project-section">
                <div
                  className="t3-project-header"
                  onClick={() => onSelect({ kind: "project", uuid: section.projectUuid!, title: section.label, areaTitle: selected.kind === "area" ? (selected as { title: string }).title : null })}
                >
                  <ListIcon type="project" size={18} />
                  <span className="t3-project-name">{section.label}</span>
                </div>
                {visibleTasks.map((task) => (
                  <TaskRow key={task.uuid} task={task} onComplete={onComplete} onUpdate={onUpdate}
                    isCompleting={completing.has(task.uuid)} isEditing={editingUuid === task.uuid}
                    onStartEdit={() => onStartEdit(task.uuid)} onCancelEdit={onCancelEdit}
                    allTags={allTags} onContextMenu={onContextMenu} onAppendChecklist={onAppendChecklist}
                    onToggleChecklistItem={onToggleChecklistItem}
                    onDeleteChecklistItem={onDeleteChecklistItem}
                    showCodeBtn={isLockedProject} hasConversation={!!taskConversationMap?.[task.uuid]}
                    onStartCoding={() => onStartCoding?.(task)} onOpenConversation={() => onOpenConversation?.(task)} />
                ))}
                {isCollapsed && hiddenCount > 0 && (
                  <div className="t3-show-more" onClick={() => onToggleCollapse(section.projectUuid!)}>
                    Show {hiddenCount} more
                  </div>
                )}
                {!isCollapsed && allProjTasks.length > PREVIEW_COUNT && (
                  <div className="t3-show-more" onClick={() => onToggleCollapse(section.projectUuid!)}>
                    Show less
                  </div>
                )}
              </div>
            );
          }

          /* ── Heading section (inside project view) ── */
          if (section.isArea || (section.label && !section.isProject)) {
            return (
              <div key={section.label || `s-${i}`}>
                {isProject && section.label ? (
                  <div className="t3-heading-section">
                    <span className="t3-heading-label">{section.label}</span>
                    <div className="t3-heading-line" />
                    <button className="t3-heading-dots" title="Section options">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="13" cy="8" r="1.5"/></svg>
                    </button>
                  </div>
                ) : (
                  <SectionLabel className="section-label-flex">
                    {section.areaIcon && <ListIcon type="area" size={16} />}
                    {section.label}
                  </SectionLabel>
                )}
                {section.tasks.map((task) => (
                  <TaskRow key={task.uuid} task={task} onComplete={onComplete} onUpdate={onUpdate}
                    isCompleting={completing.has(task.uuid)} isEditing={editingUuid === task.uuid}
                    onStartEdit={() => onStartEdit(task.uuid)} onCancelEdit={onCancelEdit}
                    allTags={allTags} onContextMenu={onContextMenu} onAppendChecklist={onAppendChecklist}
                    onToggleChecklistItem={onToggleChecklistItem}
                    onDeleteChecklistItem={onDeleteChecklistItem}
                    showCodeBtn={isLockedProject} hasConversation={!!taskConversationMap?.[task.uuid]}
                    onStartCoding={() => onStartCoding?.(task)} onOpenConversation={() => onOpenConversation?.(task)} />
                ))}
              </div>
            );
          }

          return (
            <div key={`s-${i}`}>
              {section.tasks.map((task) => (
                <TaskRow key={task.uuid} task={task} onComplete={onComplete} onUpdate={onUpdate}
                  isCompleting={completing.has(task.uuid)} isEditing={editingUuid === task.uuid}
                  onStartEdit={() => onStartEdit(task.uuid)} onCancelEdit={onCancelEdit}
                  allTags={allTags} onContextMenu={onContextMenu} onAppendChecklist={onAppendChecklist}
                  onToggleChecklistItem={onToggleChecklistItem}
                  onDeleteChecklistItem={onDeleteChecklistItem}
                  showCodeBtn={isLockedProject} hasConversation={!!taskConversationMap?.[task.uuid]}
                  onStartCoding={() => onStartCoding?.(task)} onOpenConversation={() => onOpenConversation?.(task)} />
              ))}
            </div>
          );
        })}
        {content.sections.length === 0 && <EmptyState message="No tasks" />}

        {/* ── Project logbook (completed items) ── */}
        {isProject && (
          <div className="t3-project-logbook">
            <button
              className="t3-project-logbook-toggle"
              onClick={() => setShowLoggedItems(!showLoggedItems)}
            >
              {showLoggedItems ? "Hide" : "Show"} logged items
            </button>
            {showLoggedItems && projectLogbook.length > 0 && (
              <div className="t3-project-logbook-list">
                {projectLogbook.map((t) => (
                  <div key={t.uuid} className="t3-project-logbook-row">
                    <span className="t3-check t3-check-done t3-check-logged" />
                    <span className="t3-logbook-row-date">{formatLoggedDate(t.completedAt)}</span>
                    <span className="t3-logbook-row-title">{t.title}</span>
                  </div>
                ))}
              </div>
            )}
            {showLoggedItems && projectLogbook.length === 0 && (
              <div className="t3-project-logbook-empty">No completed tasks</div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/* ── Completed row (logbook) ── */

function CompletedRow({ task, isUncompleting, onUncomplete, showProject = true }: {
  task: CompletedTask; isUncompleting: boolean; onUncomplete: (u: string) => void; showProject?: boolean;
}) {
  return (
    <div className={`t3-row t3-row-completed${isUncompleting ? " t3-uncompleting" : ""}`}>
      <button
        className={`t3-check t3-check-done${isUncompleting ? " t3-unchecking" : ""}`}
        onClick={() => !isUncompleting && onUncomplete(task.uuid)}
        title="Mark incomplete"
      />
      <div className="t3-row-body t3-completed-body">
        <span className={`t3-row-title t3-completed-title${isUncompleting ? " t3-restoring" : ""}`}>{task.title}</span>
        <span className="t3-completed-meta">
          {showProject && task.projectTitle && (
            <span className="t3-completed-project">{task.projectTitle}</span>
          )}
          {task.areaTitle && !task.projectTitle && (
            <span className="t3-completed-area">{task.areaTitle}</span>
          )}
          <span className="t3-completed-time">{formatCompletionTime(task.completedAt)}</span>
        </span>
      </div>
    </div>
  );
}

/* ── Task row ── */

function TaskRow({ task, onComplete, onUpdate, isCompleting, isEditing, onStartEdit, onCancelEdit, allTags, onContextMenu, onAppendChecklist, onToggleChecklistItem, onDeleteChecklistItem, showCodeBtn, hasConversation, onStartCoding, onOpenConversation }: {
  task: Task;
  onComplete: (u: string) => void;
  onUpdate: (u: string, opts: UpdateOpts) => void;
  isCompleting: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  allTags: string[];
  onContextMenu: (ctx: { uuid: string; x: number; y: number }) => void;
  onAppendChecklist: (u: string, item: string) => void;
  onToggleChecklistItem: (taskUuid: string, itemUuid: string, completed: boolean) => void;
  onDeleteChecklistItem: (taskUuid: string, itemUuid: string) => void;
  showCodeBtn?: boolean;
  hasConversation?: boolean;
  onStartCoding?: () => void;
  onOpenConversation?: () => void;
}) {
  const [editTitle, setEditTitle] = useState(task.title);
  const [editNotes, setEditNotes] = useState(task.notes || "");
  const [editWhen, setEditWhen] = useState<string | undefined>(undefined);
  const [editTags, setEditTags] = useState<string[]>(task.tags);
  const [editDeadline, setEditDeadline] = useState<string | undefined>(undefined);
  const [newChecklistItem, setNewChecklistItem] = useState("");
  const [openPicker, setOpenPicker] = useState<"when" | "tags" | "deadline" | null>(null);
  const [expanded, setExpanded] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isEditing) {
      setEditTitle(task.title);
      setEditNotes(task.notes || "");
      setEditWhen(undefined);
      setEditTags(task.tags);
      setEditDeadline(undefined);
      setNewChecklistItem("");
      setOpenPicker(null);
      setTimeout(() => titleRef.current?.focus(), 50);
    }
  }, [isEditing, task.title, task.notes, task.tags]);

  const handleSave = () => {
    const opts: UpdateOpts = {};
    if (editTitle !== task.title) opts.title = editTitle;
    if (editNotes !== (task.notes || "")) opts.notes = editNotes;
    if (editWhen !== undefined) opts.when = editWhen;
    if (JSON.stringify(editTags) !== JSON.stringify(task.tags)) opts.tags = editTags;
    if (editDeadline !== undefined) opts.deadline = editDeadline;
    onUpdate(task.uuid, opts);
  };

  const handleContextMenu = (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu({ uuid: task.uuid, x: e.clientX, y: e.clientY });
  };

  const handleRowClick = () => {
    if (isEditing) return;
    setExpanded(!expanded);
  };

  const isOverdue = task.deadline && task.deadline < new Date().toISOString().slice(0, 10);
  const hasNotes = task.notes && task.notes.trim().length > 0;
  const hasChecklist = task.checklistTotal > 0;

  // ── Full Edit Mode (double-click) ──
  if (isEditing) {
    return (
      <div className="t3-edit-card" onClick={(e) => e.stopPropagation()}>
        <div className="t3-edit-top">
          <button className="t3-check" onClick={() => { onCancelEdit(); onComplete(task.uuid); }} />
          <input ref={titleRef} className="t3-edit-title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) handleSave(); if (e.key === "Escape") onCancelEdit(); }}
            placeholder="New To-Do" />
        </div>
        <textarea className="t3-edit-notes" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Notes" rows={3} />

        {/* Checklist */}
        <div className="t3-edit-checklist">
          {task.checklist.map((ci) => (
            <div key={ci.uuid} className="t3-cl-item">
              <span
                className={`t3-cl-dot clickable${ci.completed ? " done" : ""}`}
                onClick={() => onToggleChecklistItem(task.uuid, ci.uuid, !ci.completed)}
              />
              <span className={`t3-cl-title${ci.completed ? " t3-done" : ""}`}>{ci.title}</span>
              <button className="t3-cl-delete" onClick={() => onDeleteChecklistItem(task.uuid, ci.uuid)} title="Delete">&times;</button>
            </div>
          ))}
          <div className="t3-cl-add">
            <span className="t3-cl-dot" />
            <input
              className="t3-cl-add-input"
              value={newChecklistItem}
              onChange={(e) => setNewChecklistItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newChecklistItem.trim()) {
                  onAppendChecklist(task.uuid, newChecklistItem.trim());
                  setNewChecklistItem("");
                }
              }}
              placeholder="Add checklist item..."
            />
          </div>
        </div>

        {/* Toolbar */}
        <div className="t3-edit-toolbar" ref={toolbarRef}>
          <div className="t3-toolbar-wrap">
            <button
              className={`t3-toolbar-btn${editWhen !== undefined ? " active" : ""}`}
              onClick={() => setOpenPicker(openPicker === "when" ? null : "when")}
              title="When"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1.5l1.8 3.6 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4L2.2 5.7l4-.6z" fill="currentColor"/></svg>
            </button>
            <button
              className={`t3-toolbar-btn${editTags.length > 0 ? " active" : ""}`}
              onClick={() => setOpenPicker(openPicker === "tags" ? null : "tags")}
              title="Tags"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3a1 1 0 011-1h4.586a1 1 0 01.707.293l5.414 5.414a1 1 0 010 1.414l-4.586 4.586a1 1 0 01-1.414 0L2.293 8.293A1 1 0 012 7.586V3zm3 1a1 1 0 100 2 1 1 0 000-2z"/></svg>
            </button>
            <button
              className={`t3-toolbar-btn${(editDeadline !== undefined || task.deadline) ? " active" : ""}`}
              onClick={() => setOpenPicker(openPicker === "deadline" ? null : "deadline")}
              title="Deadline"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1 8a7 7 0 1114 0A7 7 0 011 8zm7-5.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM7.25 4v4.5l3 1.5.75-1.5L8.75 7.5V4h-1.5z"/></svg>
            </button>
          </div>

          {openPicker === "when" && (
            <WhenPicker
              value={editWhen}
              onSelect={(v) => { setEditWhen(v); setOpenPicker(null); }}
              onClose={() => setOpenPicker(null)}
            />
          )}
          {openPicker === "tags" && (
            <TagsPicker
              allTags={allTags}
              selected={editTags}
              onToggle={(tag) => {
                setEditTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
              }}
              onClose={() => setOpenPicker(null)}
            />
          )}
          {openPicker === "deadline" && (
            <DeadlinePicker
              value={editDeadline !== undefined ? editDeadline : task.deadline || undefined}
              onSelect={(v) => { setEditDeadline(v); setOpenPicker(null); }}
              onClear={() => { setEditDeadline(""); setOpenPicker(null); }}
              onClose={() => setOpenPicker(null)}
            />
          )}
        </div>

        <div className="t3-edit-actions">
          <Button variant="primary" size="sm" onClick={handleSave}>Save</Button>
          <Button size="sm" onClick={onCancelEdit}>Cancel</Button>
        </div>
      </div>
    );
  }

  // ── Normal Row (click to expand, double-click to edit) ──
  return (
    <div
      className={`t3-row${isCompleting ? " t3-completing" : ""}${expanded ? " t3-expanded" : ""}`}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", task.uuid); e.dataTransfer.effectAllowed = "move"; }}
      onClick={handleRowClick}
      onDoubleClick={(e) => { e.stopPropagation(); onStartEdit(); }}
      onContextMenu={handleContextMenu}
    >
      <button
        className={`t3-check${isCompleting ? " t3-check-done" : ""}`}
        onClick={(e) => { e.stopPropagation(); if (!isCompleting) onComplete(task.uuid); }}
        title="Complete"
      />
      <div className="t3-row-content">
        <div className="t3-row-body">
          <span className={`t3-row-title${isCompleting ? " t3-done" : ""}${!task.title ? " t3-row-title-empty" : ""}`}>
            {task.title || "New To-Do"}
          </span>
          <span className="t3-row-indicators">
            {task.deadline && (
              <Badge status={isOverdue ? "error" : "muted"} className="text-xs">
                {formatDeadlineShort(task.deadline)}
              </Badge>
            )}
            {hasNotes && !expanded && (
              <span className="t3-icon-indicator" title="Has notes">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4 1h8a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V3a2 2 0 012-2zm1 3v1.5h6V4H5zm0 3v1.5h6V7H5zm0 3v1.5h4V10H5z"/></svg>
              </span>
            )}
            {hasChecklist && (
              <span className={`t3-checklist-progress${task.checklistDone === task.checklistTotal ? " t3-checklist-complete" : ""}`}>
                {task.checklistDone}/{task.checklistTotal}
              </span>
            )}
            {task.tags.map((tag) => <Badge key={tag} status="muted" className="text-xs">{tag}</Badge>)}
          </span>
        </div>

        {/* Expanded: notes preview + inline checklist */}
        {expanded && (
          <div className="t3-row-detail" onClick={(e) => e.stopPropagation()}>
            {hasNotes && (
              <div className="t3-row-notes-preview">{task.notes!.slice(0, 200)}{task.notes!.length > 200 ? "..." : ""}</div>
            )}
            {task.checklist.length > 0 && (
              <div className="t3-row-checklist">
                {task.checklist.map((ci) => (
                  <div key={ci.uuid} className="t3-cl-item" onClick={(e) => e.stopPropagation()}>
                    <span
                      className={`t3-cl-dot clickable${ci.completed ? " done" : ""}`}
                      onClick={() => onToggleChecklistItem(task.uuid, ci.uuid, !ci.completed)}
                    />
                    <span className={`t3-cl-title${ci.completed ? " t3-done" : ""}`}>{ci.title}</span>
                    <button className="t3-cl-delete" onClick={() => onDeleteChecklistItem(task.uuid, ci.uuid)} title="Delete">&times;</button>
                  </div>
                ))}
              </div>
            )}
            <div className="t3-row-detail-actions">
              <button className="t3-detail-edit-btn" onClick={() => onStartEdit()}>Edit</button>
              {showCodeBtn && (
                <button className="t3-detail-edit-btn" onClick={() => onStartCoding?.()}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
                  </svg>
                  Code
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      {hasConversation && (
        <button className="t3-row-conversation-badge" onClick={(e) => { e.stopPropagation(); onOpenConversation?.(); }} title="Open conversation">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        </button>
      )}
    </div>
  );
}

/* ── MiniCalendar ── */

function MiniCalendar({ selected, onSelect }: { selected?: string; onSelect: (date: string) => void }) {
  const [viewDate, setViewDate] = useState(() => {
    if (selected) return new Date(selected + "T00:00:00");
    return new Date();
  });

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const todayStr = toDateStr(new Date());

  const firstDay = new Date(year, month, 1);
  const startDay = (firstDay.getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const prev = () => setViewDate(new Date(year, month - 1, 1));
  const next = () => setViewDate(new Date(year, month + 1, 1));

  return (
    <div className="t3-calendar">
      <div className="t3-calendar-header">
        <button className="t3-calendar-nav" onClick={prev}>&lsaquo;</button>
        <span className="t3-calendar-title">
          {viewDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </span>
        <button className="t3-calendar-nav" onClick={next}>&rsaquo;</button>
      </div>
      <div className="t3-calendar-weekdays">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="t3-calendar-grid">
        {cells.map((day, i) => {
          if (day === null) return <span key={`e-${i}`} />;
          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const isToday = dateStr === todayStr;
          const isSel = dateStr === selected;
          return (
            <button
              key={dateStr}
              className={`t3-calendar-day${isToday ? " today" : ""}${isSel ? " selected" : ""}`}
              onClick={() => onSelect(dateStr)}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── WhenPicker ── */

function WhenPicker({ value, onSelect }: { value?: string; onSelect: (v: string) => void; onClose: () => void }) {
  const [showCal, setShowCal] = useState(false);

  return (
    <div className="t3-dropdown" onClick={(e) => e.stopPropagation()}>
      <div className="t3-dropdown-item" onClick={() => onSelect("today")}>
        <ListIcon type="today" size={14} />
        <span>Today</span>
        {value === "today" && <span className="t3-dropdown-check">&#10003;</span>}
      </div>
      <div className="t3-dropdown-item" onClick={() => onSelect("evening")}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M12 3a6 6 0 11-7.7 8.3A5 5 0 0012 3z" fill="#8E8E93"/></svg>
        <span>This Evening</span>
        {value === "evening" && <span className="t3-dropdown-check">&#10003;</span>}
      </div>
      <div className="t3-dropdown-item" onClick={() => onSelect("someday")}>
        <ListIcon type="someday" size={14} />
        <span>Someday</span>
        {value === "someday" && <span className="t3-dropdown-check">&#10003;</span>}
      </div>
      <div className="t3-dropdown-item" onClick={() => onSelect("anytime")}>
        <ListIcon type="anytime" size={14} />
        <span>Anytime</span>
        {value === "anytime" && <span className="t3-dropdown-check">&#10003;</span>}
      </div>
      <div className="t3-dropdown-divider" />
      <div className="t3-dropdown-item" onClick={() => setShowCal(!showCal)}>
        <ListIcon type="upcoming" size={14} />
        <span>Specific Date...</span>
      </div>
      {showCal && (
        <MiniCalendar
          selected={value && value.includes("-") ? value : undefined}
          onSelect={(d) => onSelect(d)}
        />
      )}
      {value && (
        <>
          <div className="t3-dropdown-divider" />
          <div className="t3-dropdown-item" onClick={() => onSelect("")}>
            <span className="text-error">Remove</span>
          </div>
        </>
      )}
    </div>
  );
}

/* ── TagsPicker ── */

function TagsPicker({ allTags, selected, onToggle }: {
  allTags: string[]; selected: string[];
  onToggle: (tag: string) => void; onClose: () => void;
}) {
  return (
    <div className="t3-dropdown" onClick={(e) => e.stopPropagation()}>
      {allTags.length === 0 && <div className="t3-dropdown-item t3-dropdown-dim">No tags</div>}
      {allTags.map((tag) => (
        <div key={tag} className="t3-dropdown-item" onClick={() => onToggle(tag)}>
          <span className={`t3-tag-check${selected.includes(tag) ? " checked" : ""}`} />
          <span>{tag}</span>
        </div>
      ))}
    </div>
  );
}

/* ── DeadlinePicker ── */

function DeadlinePicker({ value, onSelect, onClear }: {
  value?: string; onSelect: (v: string) => void; onClear: () => void; onClose: () => void;
}) {
  return (
    <div className="t3-dropdown" onClick={(e) => e.stopPropagation()}>
      <MiniCalendar selected={value} onSelect={onSelect} />
      {value && (
        <>
          <div className="t3-dropdown-divider" />
          <div className="t3-dropdown-item" onClick={onClear}>
            <span className="text-error">Remove Deadline</span>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Context Menu ── */

function ContextMenu({ x, y, onDuplicate, onMove, onConvert, onDelete, onShowInThings }: {
  x: number; y: number;
  onDuplicate: () => void; onMove: () => void; onConvert: () => void; onDelete: () => void; onShowInThings: () => void;
}) {
  // Adjust position to stay in viewport
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const nx = rect.right > window.innerWidth ? x - rect.width : x;
      const ny = rect.bottom > window.innerHeight ? y - rect.height : y;
      if (nx !== pos.x || ny !== pos.y) setPos({ x: nx, y: ny });
    }
  }, [x, y]);

  return (
    <div ref={menuRef} className="t3-context-menu" style={{ left: pos.x, top: pos.y }} onClick={(e) => e.stopPropagation()}>
      <div className="t3-dropdown-item" onClick={onDuplicate}>Duplicate</div>
      <div className="t3-dropdown-item" onClick={onMove}>Move to...</div>
      <div className="t3-dropdown-item" onClick={onConvert}>Convert to Project</div>
      <div className="t3-dropdown-divider" />
      <div className="t3-dropdown-item t3-dropdown-danger" onClick={onDelete}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 1a.5.5 0 00-.5.5V2H2.5a.5.5 0 000 1h.538l.853 10.66A2 2 0 005.885 15h4.23a2 2 0 001.994-1.84L12.962 3h.538a.5.5 0 000-1H11v-.5a.5.5 0 00-.5-.5h-5zM6 2v-.5h4V2H6zm-.5 3a.5.5 0 01.5.5v7a.5.5 0 01-1 0v-7a.5.5 0 01.5-.5zm3 0a.5.5 0 01.5.5v7a.5.5 0 01-1 0v-7a.5.5 0 01.5-.5z"/></svg>
        Delete
      </div>
      <div className="t3-dropdown-divider" />
      <div className="t3-dropdown-item" onClick={onShowInThings}>Open in Things 3</div>
    </div>
  );
}

/* ── Move Dialog ── */

function MoveDialog({ taskUuid, currentProjectUuid, projects, areas, onMove, onClose }: {
  taskUuid: string;
  currentProjectUuid: string | null;
  projects: Project[];
  areas: Area[];
  onMove: (uuid: string, listId: string, headingId?: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [headings, setHeadings] = useState<ProjectHeading[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => searchRef.current?.focus(), 100);
  }, []);

  const loadHeadings = async (projectUuid: string) => {
    if (expandedProject === projectUuid) { setExpandedProject(null); return; }
    try {
      const res = await fetch(`/api/tasks/projects/${projectUuid}/headings`);
      const data = await res.json();
      setHeadings(data.headings || []);
      setExpandedProject(projectUuid);
    } catch {
      setExpandedProject(projectUuid);
      setHeadings([]);
    }
  };

  const filtered = search.trim()
    ? projects.filter((p) => p.title.toLowerCase().includes(search.toLowerCase()))
    : projects;

  const areaMap = new Map<string | null, Project[]>();
  for (const p of filtered) {
    const key = p.areaUuid;
    if (!areaMap.has(key)) areaMap.set(key, []);
    areaMap.get(key)!.push(p);
  }

  return (
    <Modal open title="Move to..." onClose={onClose} width={400}>
      <input
        ref={searchRef}
        className="t3-move-search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search projects..."
      />
      <div className="t3-move-list">
        {Array.from(areaMap.entries()).map(([areaUuid, projs]) => {
          const area = areas.find((a) => a.uuid === areaUuid);
          return (
            <div key={areaUuid || "none"}>
              {area && <SectionLabel className="section-label-padded">{area.title}</SectionLabel>}
              {projs.map((p) => (
                <div key={p.uuid}>
                  <div
                    className={`t3-move-item${p.uuid === currentProjectUuid ? " current" : ""}`}
                    onClick={() => {
                      if (expandedProject === p.uuid || headings.length === 0) {
                        onMove(taskUuid, p.uuid);
                      } else {
                        loadHeadings(p.uuid);
                      }
                    }}
                  >
                    <ListIcon type="project" size={14} />
                    <span>{p.title}</span>
                    {p.uuid === currentProjectUuid && <span className="t3-dropdown-check">&#10003;</span>}
                    <button
                      className="t3-move-expand"
                      onClick={(e) => { e.stopPropagation(); loadHeadings(p.uuid); }}
                    >&#9662;</button>
                  </div>
                  {expandedProject === p.uuid && headings.length > 0 && headings.map((h) => (
                    <div
                      key={h.uuid}
                      className="t3-move-item t3-move-heading"
                      onClick={() => onMove(taskUuid, p.uuid, h.uuid)}
                    >
                      <span>{h.title}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          );
        })}
        {filtered.length === 0 && <EmptyState message="No projects found" />}
      </div>
    </Modal>
  );
}

/* ── Inline New Task ── */

function InlineNewTask({ onSubmit, onCancel }: { onSubmit: (title: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => ref.current?.focus(), 50);
  }, []);

  return (
    <div className="t3-new-task-inline">
      <span className="t3-check" />
      <input
        ref={ref}
        className="t3-new-task-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && title.trim()) { onSubmit(title.trim()); setTitle(""); }
          if (e.key === "Escape") onCancel();
        }}
        placeholder="New To-Do"
      />
    </div>
  );
}

/* ── Create Project Dialog ── */

function CreateProjectDialog({ areas, defaultAreaUuid, onCreate, onClose }: {
  areas: Area[];
  defaultAreaUuid?: string;
  onCreate: (title: string, areaId?: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [areaId, setAreaId] = useState(defaultAreaUuid || "");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => ref.current?.focus(), 50);
  }, []);

  return (
    <Modal open title="New Project" onClose={onClose} width={400}>
      <div className="flex-col gap-3 mt-3">
        <input
          ref={ref}
          className="t3-dialog-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && title.trim()) onCreate(title.trim(), areaId || undefined);
            if (e.key === "Escape") onClose();
          }}
          placeholder="Project name"
        />
        <select className="t3-dialog-input" value={areaId} onChange={(e) => setAreaId(e.target.value)}>
          <option value="">No Area</option>
          {areas.map((a) => <option key={a.uuid} value={a.uuid}>{a.title}</option>)}
        </select>
        <div className="t3-edit-actions">
          <Button variant="primary" size="sm" onClick={() => title.trim() && onCreate(title.trim(), areaId || undefined)}>Create</Button>
          <Button size="sm" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Create Area Dialog ── */

function CreateAreaDialog({ onCreate, onClose }: {
  onCreate: (title: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => ref.current?.focus(), 50);
  }, []);

  return (
    <Modal open title="New Area" onClose={onClose} width={400}>
      <div className="flex-col gap-3 mt-3">
        <input
          ref={ref}
          className="t3-dialog-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && title.trim()) onCreate(title.trim());
            if (e.key === "Escape") onClose();
          }}
          placeholder="Area name"
        />
        <div className="t3-edit-actions">
          <Button variant="primary" size="sm" onClick={() => title.trim() && onCreate(title.trim())}>Create</Button>
          <Button size="sm" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}
