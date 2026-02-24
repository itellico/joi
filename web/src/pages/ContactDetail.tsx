import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import MarkdownField from "../components/MarkdownField";
import { Badge, Button, Card, EmptyState, MetaText, Modal, PageBody, PageHeader } from "../components/ui";

interface Contact {
  id: string;
  apple_id: string | null;
  first_name: string | null;
  last_name: string | null;
  nickname: string | null;
  emails: string[];
  phones: string[];
  company_id: string | null;
  company_name: string | null;
  job_title: string | null;
  birthday: string | null;
  tags: string[];
  status: string;
  notes: string | null;
  telegram_username: string | null;
  telegram_id: string | null;
  slack_handle: string | null;
  avatar_url: string | null;
  obsidian_path: string | null;
  extra: Record<string, unknown> | null;
  source: string | null;
  address: { street?: string; city?: string; state?: string; zip?: string; country?: string } | null;
  social_profiles: Array<{ service: string; username: string; url: string }> | null;
  last_contacted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ThingsTask {
  uuid: string;
  title: string;
  notes: string | null;
  list: string;
  projectTitle: string | null;
  tags: string[];
  startDate: string | null;
  deadline: string | null;
  checklist: Array<{ uuid: string; title: string; completed: boolean }>;
  checklistTotal: number;
  checklistDone: number;
}

interface ObsidianNote {
  exists: boolean;
  path: string;
  content: string | null;
  modifiedAt?: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: "var(--success)",
  client: "var(--accent)",
  lead: "var(--warning)",
  partner: "#c084fc",
  friend: "#60a5fa",
  archived: "var(--text-muted)",
};

const STATUS_OPTIONS = ["active", "client", "lead", "partner", "friend", "archived"];

function getInitials(first: string | null, last: string | null): string {
  const f = first?.trim()?.[0] || "";
  const l = last?.trim()?.[0] || "";
  return (f + l).toUpperCase() || "?";
}

function getInitialColor(name: string): string {
  const colors = ["#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function formatDate(d: string | null): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("de-AT", { day: "numeric", month: "short", year: "numeric" });
}

const PLATFORM_COLORS: Record<string, string> = {
  telegram: "#29b6f6",
  imessage: "#34c759",
  whatsapp: "#25d366",
  email: "#ff9800",
  slack: "#e91e63",
};

interface ContactMediaItem {
  id: string;
  media_type: string;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  thumbnail_path: string | null;
  width: number | null;
  height: number | null;
  channel_type: string | null;
  caption: string | null;
  created_at: string;
}

const MEDIA_TYPE_ICONS: Record<string, string> = {
  photo: "\uD83D\uDDBC\uFE0F",
  video: "\uD83C\uDFA5",
  audio: "\uD83C\uDFB5",
  voice: "\uD83C\uDF99\uFE0F",
  document: "\uD83D\uDCC4",
  sticker: "\uD83E\uDEAA",
  unknown: "\uD83D\uDCCE",
};

const ATTACHMENT_ICONS: Record<string, string> = {
  photo: "\uD83D\uDCF7",
  video: "\uD83C\uDFA5",
  audio: "\uD83C\uDFA7",
  voice: "\uD83C\uDF99\uFE0F",
  document: "\uD83D\uDCC4",
  sticker: "\uD83D\uDE00",
};

export default function ContactDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(true);
  const [notesValue, setNotesValue] = useState("");
  const [saving, setSaving] = useState(false);

  // Things3 tasks — explicit links
  const [linkedTasks, setLinkedTasks] = useState<ThingsTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [creatingTask, setCreatingTask] = useState(false);

  // Task picker modal
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerResults, setPickerResults] = useState<ThingsTask[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  // Communication timeline
  const [interactions, setInteractions] = useState<Array<{
    id: string; platform: string; direction: string | null;
    summary: string | null; metadata: Record<string, unknown> & { attachments?: Array<{ type: string; filename?: string }> };
    occurred_at: string; created_at: string;
  }>>([]);
  const [interactionsLoading, setInteractionsLoading] = useState(false);

  // Obsidian note
  const [obsNote, setObsNote] = useState<ObsidianNote | null>(null);
  const [obsLoading, setObsLoading] = useState(false);
  const [obsContent, setObsContent] = useState("");
  const [obsSaving, setObsSaving] = useState(false);

  // Media gallery
  const [contactMedia, setContactMedia] = useState<ContactMediaItem[]>([]);
  const [contactMediaTotal, setContactMediaTotal] = useState(0);
  const [mediaLoading, setMediaLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`/api/contacts/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setContact(data.contact);
        setNotesValue(data.contact?.notes || "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const loadTasks = useCallback(() => {
    if (!id) return;
    setTasksLoading(true);
    fetch(`/api/contacts/${id}/tasks`)
      .then((r) => r.json())
      .then((data) => {
        setLinkedTasks(data.linked || []);
      })
      .catch(() => {})
      .finally(() => setTasksLoading(false));
  }, [id]);

  const loadInteractions = useCallback(() => {
    if (!id) return;
    setInteractionsLoading(true);
    fetch(`/api/contacts/${id}/interactions?limit=50`)
      .then((r) => r.json())
      .then((data) => setInteractions(data.interactions || []))
      .catch(() => {})
      .finally(() => setInteractionsLoading(false));
  }, [id]);

  const loadObsidianNote = useCallback(() => {
    if (!id) return;
    setObsLoading(true);
    fetch(`/api/contacts/${id}/obsidian`)
      .then((r) => r.json())
      .then((data: ObsidianNote) => {
        setObsNote(data);
        setObsContent(data.content || "");
      })
      .catch(() => {})
      .finally(() => setObsLoading(false));
  }, [id]);

  const loadContactMedia = useCallback(() => {
    if (!id) return;
    setMediaLoading(true);
    fetch(`/api/contacts/${id}/media?limit=20`)
      .then((r) => r.json())
      .then((data) => {
        setContactMedia(data.media || []);
        setContactMediaTotal(data.total || 0);
      })
      .catch(() => {})
      .finally(() => setMediaLoading(false));
  }, [id]);

  useEffect(() => {
    loadTasks();
    loadInteractions();
    loadObsidianNote();
    loadContactMedia();
  }, [loadTasks, loadInteractions, loadObsidianNote, loadContactMedia]);

  const updateStatus = async (newStatus: string) => {
    if (!id) return;
    try {
      await fetch(`/api/contacts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      setContact((prev) => prev ? { ...prev, status: newStatus } : prev);
    } catch { /* ignore */ }
  };

  const handleCreateTask = async () => {
    if (!id || !newTaskTitle.trim()) return;
    setCreatingTask(true);
    try {
      await fetch(`/api/contacts/${id}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTaskTitle.trim() }),
      });
      setNewTaskTitle("");
      // Small delay for Things3 to register the task before we re-read SQLite
      setTimeout(loadTasks, 500);
    } catch { /* ignore */ }
    setCreatingTask(false);
  };

  const linkTask = async (taskUuid: string) => {
    if (!id) return;
    await fetch(`/api/contacts/${id}/tasks/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskUuid }),
    }).catch(() => {});
    loadTasks();
  };

  const unlinkTask = async (taskUuid: string) => {
    if (!id) return;
    await fetch(`/api/contacts/${id}/tasks/link/${taskUuid}`, { method: "DELETE" }).catch(() => {});
    loadTasks();
  };

  // Debounced search for task picker modal
  useEffect(() => {
    if (!pickerOpen) return;
    const excludeUuids = linkedTasks.map((t) => t.uuid).join(",");
    setPickerLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (pickerSearch.trim()) params.set("q", pickerSearch.trim());
      if (excludeUuids) params.set("exclude", excludeUuids);
      fetch(`/api/tasks/search?${params}`)
        .then((r) => r.json())
        .then((data) => setPickerResults(data.tasks || []))
        .catch(() => setPickerResults([]))
        .finally(() => setPickerLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [pickerSearch, pickerOpen, linkedTasks]);

  const linkFromPicker = async (taskUuid: string) => {
    setPickerResults((prev) => prev.filter((t) => t.uuid !== taskUuid));
    await linkTask(taskUuid);
  };

  const createObsidianNote = async () => {
    if (!id || !contact) return;
    const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(" ");
    const template = `# ${fullName}\n\n## About\n\n${contact.company_name ? `- Company: ${contact.company_name}` : ""}${contact.job_title ? `\n- Role: ${contact.job_title}` : ""}\n\n## Notes\n\n`;
    try {
      const resp = await fetch(`/api/contacts/${id}/obsidian`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: template }),
      });
      const data = await resp.json();
      if (data.saved) {
        setObsContent(template);
        setObsNote({ exists: true, path: data.path, content: template });
      }
    } catch { /* ignore */ }
  };

  if (loading) {
    return (
      <>
        <PageHeader title="Contact" />
        <PageBody>
          <MetaText size="sm">Loading...</MetaText>
        </PageBody>
      </>
    );
  }

  if (!contact) {
    return (
      <>
        <PageHeader title="Contact not found" />
        <PageBody>
          <Button size="sm" onClick={() => navigate("/contacts")}>Back to Contacts</Button>
        </PageBody>
      </>
    );
  }

  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || contact.nickname || "(No name)";
  const addr = contact.address;
  const addressStr = addr
    ? [addr.street, [addr.zip, addr.city].filter(Boolean).join(" "), addr.state, addr.country]
        .filter(Boolean)
        .join(", ")
    : null;

  return (
    <>
      <PageHeader
        title={fullName}
        actions={<Button size="sm" onClick={() => navigate("/contacts")}>Back</Button>}
      />

      <PageBody className="contact-detail-body">
        {/* Header card */}
        <div className="crm-detail-header">
          <div
            className="crm-avatar crm-avatar-lg"
            style={{ background: getInitialColor(fullName) }}
          >
            {getInitials(contact.first_name, contact.last_name)}
          </div>
          <div className="crm-detail-info">
            <h3 className="crm-detail-name">{fullName}</h3>
            {(contact.company_name || contact.job_title) && (
              <div className="crm-detail-role">
                {contact.job_title}{contact.job_title && contact.company_name ? " at " : ""}{contact.company_name}
              </div>
            )}
            <div className="crm-detail-meta">
              <select
                className="crm-status-select"
                value={contact.status}
                onChange={(e) => updateStatus(e.target.value)}
                style={{ borderColor: STATUS_COLORS[contact.status] || "var(--border)" }}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
              {contact.tags.length > 0 && (
                <div className="flex-row gap-1 flex-wrap">
                  {contact.tags.map((t) => (
                    <Badge key={t} status="muted">{t}</Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Contact info sections */}
        <div className="crm-detail-sections">
          {contact.emails.length > 0 && (
            <div className="crm-detail-section">
              <div className="crm-detail-label">Email</div>
              <div className="crm-detail-values">
                {contact.emails.map((e, i) => (
                  <a key={i} href={`mailto:${e}`}>{e}</a>
                ))}
              </div>
            </div>
          )}

          {contact.phones.length > 0 && (
            <div className="crm-detail-section">
              <div className="crm-detail-label">Phone</div>
              <div className="crm-detail-values">
                {contact.phones.map((p, i) => (
                  <a key={i} href={`tel:${p}`}>{p}</a>
                ))}
              </div>
            </div>
          )}

          {contact.telegram_username && (
            <div className="crm-detail-section">
              <div className="crm-detail-label">Telegram</div>
              <div className="crm-detail-values">
                <span>@{contact.telegram_username}</span>
              </div>
            </div>
          )}

          {contact.slack_handle && (
            <div className="crm-detail-section">
              <div className="crm-detail-label">Slack</div>
              <div className="crm-detail-values">
                <span>{contact.slack_handle}</span>
              </div>
            </div>
          )}

          {contact.birthday && (
            <div className="crm-detail-section">
              <div className="crm-detail-label">Birthday</div>
              <div className="crm-detail-values">
                <span>{formatDate(contact.birthday)}</span>
              </div>
            </div>
          )}

          {addressStr && (
            <div className="crm-detail-section">
              <div className="crm-detail-label">Address</div>
              <div className="crm-detail-values">
                <span>{addressStr}</span>
              </div>
            </div>
          )}

          {contact.social_profiles && contact.social_profiles.length > 0 && (
            <div className="crm-detail-section">
              <div className="crm-detail-label">Social</div>
              <div className="crm-detail-values">
                {contact.social_profiles.map((sp, i) => (
                  <span key={i}>
                    {sp.service}: {sp.username || sp.url}
                  </span>
                ))}
              </div>
            </div>
          )}

          {contact.last_contacted_at && (
            <div className="crm-detail-section">
              <div className="crm-detail-label">Last Contact</div>
              <div className="crm-detail-values">
                <span>{formatDate(contact.last_contacted_at)}</span>
              </div>
            </div>
          )}

          {contact.extra && Object.keys(contact.extra).length > 0 && (() => {
            const display = Object.entries(contact.extra).filter(
              ([k]) => !["source", "memory_id", "updated_at"].includes(k),
            );
            if (display.length === 0) return null;
            return (
              <div className="crm-detail-section">
                <div className="crm-detail-label">AI Insights</div>
                <div className="crm-detail-values">
                  {display.map(([key, value]) => (
                    <span key={key}>
                      {key.replace(/_/g, " ")}: {String(value)}
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Communication Timeline */}
        <Card className="mt-6">
          <div className="flex-row justify-between mb-3">
            <h4>Communication Timeline</h4>
            {interactions.length > 0 && (
              <MetaText size="xs">{interactions.length} messages</MetaText>
            )}
          </div>

          {interactionsLoading ? (
            <MetaText size="sm" className="block">Loading interactions...</MetaText>
          ) : interactions.length === 0 ? (
            <MetaText size="sm" className="block">
              No interactions recorded yet. Messages from linked channels will appear here automatically.
            </MetaText>
          ) : (
            <div className="flex-col gap-2">
              {interactions.map((ix) => {
                const dirArrow = ix.direction === "outbound" ? "\u2192" : "\u2190";
                const atts = ix.metadata?.attachments;
                return (
                  <div key={ix.id} className="crm-task-row">
                    <span
                      className="platform-dot"
                      style={{ background: PLATFORM_COLORS[ix.platform] || "var(--text-muted)" }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="crm-task-title pre-wrap">
                        {ix.summary || "(no summary)"}
                      </div>
                      <div className="crm-task-meta">
                        <span className="capitalize">{ix.platform}</span>
                        <span>{dirArrow} {ix.direction || "unknown"}</span>
                        {atts && atts.length > 0 && (
                          <span>{atts.map((a: { type: string }) =>
                            ATTACHMENT_ICONS[a.type] || "\uD83D\uDCCE"
                          ).join(" ")}</span>
                        )}
                        <span>{formatDate(ix.occurred_at)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Media Gallery */}
        <Card className="mt-4">
          <div className="flex-row justify-between mb-3">
            <h4>Media</h4>
            {contactMediaTotal > 0 && (
              <Link to={`/media?contact=${id}`} style={{ fontSize: 12, color: "var(--accent)" }}>
                View all ({contactMediaTotal})
              </Link>
            )}
          </div>

          {mediaLoading ? (
            <MetaText size="sm" className="block">Loading media...</MetaText>
          ) : contactMedia.length === 0 ? (
            <MetaText size="sm" className="block">
              No media files from this contact yet.
            </MetaText>
          ) : (
            <div className="contact-media-grid">
              {contactMedia.map((m) => {
                const isImage = m.media_type === "photo" || m.mime_type?.startsWith("image/");
                return (
                  <a
                    key={m.id}
                    href={`/api/media/${m.id}/file`}
                    target="_blank"
                    rel="noreferrer"
                    className="contact-media-item"
                    title={m.filename || m.media_type}
                  >
                    {isImage ? (
                      <img
                        src={`/api/media/${m.id}/thumbnail`}
                        alt={m.filename || "media"}
                        className="contact-media-thumb"
                        loading="lazy"
                      />
                    ) : (
                      <div className="contact-media-icon">
                        {MEDIA_TYPE_ICONS[m.media_type] || MEDIA_TYPE_ICONS.unknown}
                      </div>
                    )}
                    <div className="contact-media-label">
                      {m.filename || m.media_type}
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </Card>

        {/* Notes */}
        <Card className="mt-4">
          <h4 className="mb-2">Notes</h4>
          <MarkdownField
            value={notesValue}
            onSave={async (val) => {
              setSaving(true);
              try {
                await fetch(`/api/contacts/${id}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ notes: val }),
                });
                setNotesValue(val);
                setContact((prev) => prev ? { ...prev, notes: val } : prev);
              } finally {
                setSaving(false);
              }
            }}
            saving={saving}
            placeholder="Add notes..."
            minRows={4}
            maxHeight="300px"
          />
        </Card>

        {/* Things3 Tasks -- linked + suggestions */}
        <Card className="mt-4">
          <div className="flex-row justify-between mb-3">
            <h4>Tasks</h4>
            <MetaText size="xs">
              via Things3 {linkedTasks.length > 0 && `(${linkedTasks.length} linked)`}
            </MetaText>
          </div>

          {tasksLoading ? (
            <MetaText size="sm" className="block">Loading tasks...</MetaText>
          ) : (
            <>
              {/* Linked tasks */}
              {linkedTasks.length > 0 && (
                <div className="flex-col gap-2">
                  {linkedTasks.map((task) => (
                    <div key={task.uuid} className="crm-task-row">
                      <div className="flex-1">
                        <div className="crm-task-title">{task.title}</div>
                        <div className="crm-task-meta">
                          {task.projectTitle && <span>{task.projectTitle}</span>}
                          {task.deadline && <span>Due {formatDate(task.deadline)}</span>}
                          {task.checklistTotal > 0 && (
                            <span>{task.checklistDone}/{task.checklistTotal} items</span>
                          )}
                          {task.tags.length > 0 && (
                            <span>{task.tags.join(", ")}</span>
                          )}
                        </div>
                      </div>
                      <span className={`crm-task-list crm-task-list--${task.list}`}>
                        {task.list}
                      </span>
                      <button
                        className="crm-link-btn crm-link-btn--unlink"
                        title="Unlink task"
                        onClick={() => unlinkTask(task.uuid)}
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {linkedTasks.length === 0 && (
                <MetaText size="sm" className="block">
                  No linked tasks. Create one below or link existing tasks.
                </MetaText>
              )}
            </>
          )}

          {/* Quick task creation + link existing */}
          <div className="flex-row gap-2 mt-3">
            <input
              type="text"
              className="crm-search-input contact-new-task-input"
              placeholder="New task for this contact..."
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateTask(); }}
            />
            <Button
              size="sm"
              onClick={handleCreateTask}
              disabled={creatingTask || !newTaskTitle.trim()}
            >
              {creatingTask ? "..." : "Add"}
            </Button>
            <Button
              size="sm"
              onClick={() => setPickerOpen(true)}
            >
              Link existing
            </Button>
          </div>

          {/* Task picker modal */}
          <Modal open={pickerOpen} onClose={() => { setPickerOpen(false); setPickerSearch(""); }} title="Link existing task" width={520}>
            <input
              className="crm-search-input"
              style={{ width: "100%", maxWidth: "none", marginBottom: 12 }}
              placeholder="Search tasks..."
              value={pickerSearch}
              onChange={(e) => setPickerSearch(e.target.value)}
              autoFocus
            />
            {pickerLoading ? (
              <MetaText size="sm" className="block">Searching...</MetaText>
            ) : pickerResults.length === 0 ? (
              <MetaText size="sm" className="block">No tasks found.</MetaText>
            ) : (
              <div className="flex-col gap-2" style={{ maxHeight: 400, overflowY: "auto" }}>
                {pickerResults.map((task) => (
                  <div key={task.uuid} className="crm-task-row">
                    <div className="flex-1">
                      <div className="crm-task-title">{task.title}</div>
                      <div className="crm-task-meta">
                        {task.projectTitle && <span>{task.projectTitle}</span>}
                        {task.deadline && <span>Due {formatDate(task.deadline)}</span>}
                        {task.tags.length > 0 && <span>{task.tags.join(", ")}</span>}
                      </div>
                    </div>
                    <button
                      className="crm-link-btn crm-link-btn--link"
                      onClick={() => linkFromPicker(task.uuid)}
                    >
                      Link
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Modal>
        </Card>

        {/* Obsidian Note */}
        <Card className="mt-4">
          <div className="flex-row justify-between mb-3">
            <h4>Obsidian Note</h4>
            {obsNote?.exists && obsNote.modifiedAt && (
              <MetaText size="xs">Modified {formatDate(obsNote.modifiedAt)}</MetaText>
            )}
          </div>

          {obsLoading ? (
            <MetaText size="sm" className="block">Loading note...</MetaText>
          ) : obsNote?.exists ? (
            <>
              <MetaText size="xs" className="block mb-2">
                {obsNote.path}
              </MetaText>
              <MarkdownField
                value={obsContent}
                onSave={async (val) => {
                  setObsSaving(true);
                  try {
                    const resp = await fetch(`/api/contacts/${id}/obsidian`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ content: val }),
                    });
                    const data = await resp.json();
                    if (data.saved) {
                      setObsContent(val);
                      setObsNote((prev) => prev ? { ...prev, exists: true, content: val } : prev);
                    }
                  } finally {
                    setObsSaving(false);
                  }
                }}
                saving={obsSaving}
                minRows={8}
                maxHeight="500px"
                placeholder="Empty note"
              />
            </>
          ) : (
            <EmptyState
              message="No Obsidian note for this contact yet."
              action={
                <Button size="sm" onClick={createObsidianNote}>Create Note in People/</Button>
              }
              className="contact-empty-compact"
            />
          )}
        </Card>

        {/* Footer metadata */}
        <MetaText size="xs" className="mt-6 block">
          {contact.source && <span>Source: {contact.source} &middot; </span>}
          Created {formatDate(contact.created_at)} &middot; Updated {formatDate(contact.updated_at)}
          {contact.apple_id && <span> &middot; Apple ID: {contact.apple_id.slice(0, 8)}...</span>}
        </MetaText>
      </PageBody>
    </>
  );
}
