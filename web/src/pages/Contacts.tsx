import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  ChipGroup,
  EmptyState,
  MetaText,
  Pagination,
  PageHeader,
  PageBody,
  Row,
  SearchInput,
  UnifiedList,
  ViewToggle,
  type UnifiedListColumn,
} from "../components/ui";

interface Contact {
  id: string;
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
  slack_handle: string | null;
  avatar_url: string | null;
  last_contacted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface StatusCount {
  status: string;
  count: number;
}

const STATUS_OPTIONS = ["all", "active", "client", "lead", "partner", "friend", "archived"] as const;

const STATUS_COLORS: Record<string, string> = {
  active: "var(--success)",
  client: "var(--accent)",
  lead: "var(--warning)",
  partner: "#c084fc",
  friend: "#60a5fa",
  archived: "var(--text-muted)",
};

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

function contactName(c: Contact): string {
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || c.nickname || "(No name)";
}

export default function Contacts() {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [statusCounts, setStatusCounts] = useState<StatusCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [importing, setImporting] = useState(false);
  const [offset, setOffset] = useState(0);
  const [lastQueryMs, setLastQueryMs] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "cards">(() => {
    const stored = localStorage.getItem("view-toggle:contacts");
    return stored === "list" ? "list" : "cards";
  });
  const limit = 50;

  const fetchContacts = (s: string, status: string, off: number) => {
    const params = new URLSearchParams();
    if (s) params.set("search", s);
    if (status && status !== "all") params.set("status", status);
    params.set("limit", String(limit));
    params.set("offset", String(off));

    const startedAt = performance.now();
    setLoading(true);
    fetch(`/api/contacts?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setContacts(data.contacts || []);
        setTotal(data.total || 0);
        if (data.statusCounts) setStatusCounts(data.statusCounts);
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        setLastQueryMs(Math.round(performance.now() - startedAt));
      });
  };

  useEffect(() => {
    fetchContacts(search, statusFilter, offset);
  }, [statusFilter, offset]);

  // Debounced search — SearchInput handles debounce internally, so we fetch directly
  useEffect(() => {
    const timer = setTimeout(() => {
      setOffset(0);
      fetchContacts(search, statusFilter, 0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const totalAll = useMemo(
    () => statusCounts.reduce((sum, s) => sum + s.count, 0),
    [statusCounts],
  );

  const getStatusCount = (s: string) => {
    if (s === "all") return totalAll;
    return statusCounts.find((sc) => sc.status === s)?.count || 0;
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const res = await fetch("/api/contacts/import-apple", { method: "POST" });
      const data = await res.json();
      if (data.error) {
        alert(`Import failed: ${data.error}`);
      } else {
        fetchContacts(search, statusFilter, 0);
      }
    } catch {
      alert("Import request failed");
    } finally {
      setImporting(false);
    }
  };

  const handleViewChange = (mode: "list" | "cards") => {
    setViewMode(mode);
    localStorage.setItem("view-toggle:contacts", mode);
  };

  const columns: UnifiedListColumn<Contact>[] = useMemo(() => [
    {
      key: "name",
      header: "Name",
      render: (c) => {
        const name = contactName(c);
        return (
          <Row gap={2}>
            <div
              className="crm-avatar crm-avatar-sm"
              style={{ background: getInitialColor(name) }}
            >
              {getInitials(c.first_name, c.last_name)}
            </div>
            <div className="min-w-0">
              <div className="text-primary font-semibold">{name}</div>
              {(c.company_name || c.job_title) && (
                <MetaText size="xs">
                  {c.job_title}{c.job_title && c.company_name ? " at " : ""}{c.company_name}
                </MetaText>
              )}
            </div>
          </Row>
        );
      },
      sortValue: (c) => contactName(c),
      width: 260,
    },
    {
      key: "email",
      header: "Email",
      render: (c) => c.emails[0] || <MetaText size="xs">—</MetaText>,
      sortValue: (c) => c.emails[0] || "",
    },
    {
      key: "phone",
      header: "Phone",
      render: (c) => c.phones[0] || <MetaText size="xs">—</MetaText>,
      sortValue: (c) => c.phones[0] || "",
      width: 150,
    },
    {
      key: "status",
      header: "Status",
      render: (c) => (
        <Badge
          status={c.status === "active" ? "success" : c.status === "client" ? "accent" : c.status === "lead" ? "warning" : "muted"}
          className="text-xs capitalize"
        >
          {c.status}
        </Badge>
      ),
      sortValue: (c) => c.status,
      width: 100,
      align: "center",
    },
    {
      key: "tags",
      header: "Tags",
      render: (c) => c.tags.length > 0 ? (
        <span className="text-secondary text-sm">
          {c.tags.slice(0, 2).join(" · ")}
          {c.tags.length > 2 && ` +${c.tags.length - 2}`}
        </span>
      ) : <MetaText size="xs">—</MetaText>,
      sortValue: (c) => c.tags.length,
      width: 160,
    },
    {
      key: "last_contacted",
      header: "Last Contact",
      render: (c) => c.last_contacted_at ? (
        <MetaText size="xs">{new Date(c.last_contacted_at).toLocaleDateString()}</MetaText>
      ) : <MetaText size="xs">—</MetaText>,
      sortValue: (c) => c.last_contacted_at ? new Date(c.last_contacted_at) : null,
      width: 120,
    },
  ], []);

  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle={`${totalAll.toLocaleString()} contacts`}
        actions={
          <Button variant="primary" onClick={handleImport} disabled={importing}>
            {importing ? "Importing..." : "Import Apple Contacts"}
          </Button>
        }
      />

      <PageBody>
        {/* Search + View toggle toolbar */}
        <div className="list-page-toolbar">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search by name, email, or company..."
            resultCount={search.trim() ? total : undefined}
            queryTimeMs={lastQueryMs ?? undefined}
            debounceMs={0}
            className="list-page-search"
          />
          <div className="list-page-toolbar-right">
            <ViewToggle
              value={viewMode}
              onChange={handleViewChange}
              storageKey="contacts"
            />
          </div>
        </div>

        <ChipGroup
          variant="pill"
          options={STATUS_OPTIONS.map((s) => ({
            value: s,
            label: s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1),
            count: getStatusCount(s),
          }))}
          value={statusFilter}
          onChange={(v) => { setStatusFilter(v); setOffset(0); }}
        />

        {loading && contacts.length === 0 ? (
          <EmptyState message="Loading..." />
        ) : contacts.length === 0 ? (
          <EmptyState
            icon="👤"
            message={
              totalAll === 0
                ? <>No contacts found. Click "Import Apple Contacts" to get started.</>
                : "No contacts found."
            }
          />
        ) : viewMode === "list" ? (
          <>
            <UnifiedList
              items={contacts}
              columns={columns}
              rowKey={(c) => c.id}
              onRowClick={(c) => navigate(`/contacts/${c.id}`)}
              defaultSort={{ key: "name", direction: "asc" }}
              tableAriaLabel="Contacts list"
              emptyMessage="No contacts found."
            />
            <Pagination
              total={total}
              pageSize={limit}
              offset={offset}
              onOffsetChange={setOffset}
            />
          </>
        ) : (
          <>
            <div className="crm-contact-grid">
              {contacts.map((c) => {
                const name = contactName(c);
                return (
                  <div
                    key={c.id}
                    className="crm-contact-card"
                    onClick={() => navigate(`/contacts/${c.id}`)}
                  >
                    <div className="crm-card-header">
                      <div
                        className="crm-avatar"
                        style={{ background: getInitialColor(name) }}
                      >
                        {getInitials(c.first_name, c.last_name)}
                      </div>
                      <div className="crm-card-info">
                        <div className="crm-card-name">{name}</div>
                        {(c.company_name || c.job_title) && (
                          <div className="crm-card-role">
                            {c.job_title}{c.job_title && c.company_name ? " at " : ""}{c.company_name}
                          </div>
                        )}
                      </div>
                      {c.status !== "active" && (
                        <span
                          className="crm-status-dot"
                          style={{ background: STATUS_COLORS[c.status] || "var(--text-muted)" }}
                          title={c.status}
                        />
                      )}
                    </div>
                    <div className="crm-card-details">
                      {c.emails[0] && <div className="crm-card-detail">{c.emails[0]}</div>}
                      {c.phones[0] && <div className="crm-card-detail">{c.phones[0]}</div>}
                    </div>
                    {c.tags.length > 0 && (
                      <div className="crm-card-tags">
                        {c.tags.slice(0, 3).map((t) => (
                          <span key={t} className="tag">{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <Pagination
              total={total}
              pageSize={limit}
              offset={offset}
              onOffsetChange={setOffset}
            />
          </>
        )}
      </PageBody>
    </>
  );
}
