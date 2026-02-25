import { useEffect, useRef, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  ChipGroup,
  EmptyState,
  MetaText,
  Modal,
  Pagination,
  PageHeader,
  PageBody,
  SearchInput,
  UnifiedList,
  type UnifiedListColumn,
} from "../components/ui";

interface Quote {
  id: string;
  quote_number: string;
  title: string;
  status: string;
  net_total: number;
  gross_total: number;
  currency: string;
  issued_date: string;
  valid_until: string | null;
  tags: string[];
  created_at: string;
  contact_first_name: string | null;
  contact_last_name: string | null;
  company_name: string | null;
}

interface StatusCount {
  status: string;
  count: number;
}

interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  emails: string[];
  company_name: string | null;
  company_id: string | null;
  job_title: string | null;
}

interface Template {
  id: string;
  name: string;
  description: string | null;
  org_name: string | null;
}

const STATUS_OPTIONS = ["all", "draft", "sent", "accepted", "declined", "expired"] as const;

const STATUS_BADGE: Record<string, { status: string; label: string }> = {
  draft: { status: "warning", label: "Draft" },
  sent: { status: "accent", label: "Sent" },
  accepted: { status: "success", label: "Accepted" },
  declined: { status: "error", label: "Declined" },
  expired: { status: "muted", label: "Expired" },
};

function formatCurrency(n: number | null, currency = "EUR"): string {
  if (n === null || n === undefined) return "-";
  return `${n.toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function formatDate(d: string | null): string {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("de-AT", { day: "numeric", month: "short", year: "numeric" });
}

function contactName(q: Quote): string {
  return [q.contact_first_name, q.contact_last_name].filter(Boolean).join(" ") || "";
}

export default function Quotes() {
  const navigate = useNavigate();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [total, setTotal] = useState(0);
  const [statusCounts, setStatusCounts] = useState<StatusCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [offset, setOffset] = useState(0);
  const [lastQueryMs, setLastQueryMs] = useState<number | null>(null);
  const limit = 50;

  // New Quote modal
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState("Neues Angebot");
  const [contactSearch, setContactSearch] = useState("");
  const [contactResults, setContactResults] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const contactSearchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchQuotes = (s: string, status: string, off: number) => {
    const params = new URLSearchParams();
    if (s) params.set("search", s);
    if (status && status !== "all") params.set("status", status);
    params.set("limit", String(limit));
    params.set("offset", String(off));

    const startedAt = performance.now();
    setLoading(true);
    fetch(`/api/quotes?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setQuotes(data.quotes || []);
        setTotal(data.total || 0);
        if (data.statusCounts) setStatusCounts(data.statusCounts);
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        setLastQueryMs(Math.round(performance.now() - startedAt));
      });
  };

  // Consolidated fetch effect
  const searchRef = useRef(search);
  const prevSearchRef = useRef(search);
  searchRef.current = search;

  useEffect(() => {
    const searchChanged = search !== prevSearchRef.current;
    prevSearchRef.current = search;

    if (searchChanged && search !== "") {
      const timer = setTimeout(() => {
        setOffset(0);
        fetchQuotes(searchRef.current, statusFilter, 0);
      }, 300);
      return () => clearTimeout(timer);
    }
    fetchQuotes(search, statusFilter, offset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, offset]);

  const totalAll = useMemo(
    () => statusCounts.reduce((sum, s) => sum + s.count, 0),
    [statusCounts],
  );

  const getStatusCount = (s: string) => {
    if (s === "all") return totalAll;
    return statusCounts.find((sc) => sc.status === s)?.count || 0;
  };

  // Contact search for new-quote modal
  const searchContacts = (q: string) => {
    setContactSearch(q);
    if (contactSearchTimer.current) clearTimeout(contactSearchTimer.current);
    if (!q.trim()) { setContactResults([]); return; }
    contactSearchTimer.current = setTimeout(() => {
      fetch(`/api/contacts?search=${encodeURIComponent(q)}&limit=8`)
        .then((r) => r.json())
        .then((data) => setContactResults(data.contacts || []))
        .catch(() => {});
    }, 200);
  };

  // Load templates when modal opens
  const openNewQuoteModal = () => {
    setShowNew(true);
    setNewTitle("Neues Angebot");
    setContactSearch("");
    setContactResults([]);
    setSelectedContact(null);
    setSelectedTemplate("");
    fetch("/api/quote-templates")
      .then((r) => r.json())
      .then((data) => setTemplates(data.templates || data || []))
      .catch(() => {});
  };

  const handleCreate = async () => {
    setCreating(true);
    try {
      const body: Record<string, unknown> = { title: newTitle };
      if (selectedContact) {
        body.contact_id = selectedContact.id;
        if (selectedContact.company_id) body.company_id = selectedContact.company_id;
      }
      if (selectedTemplate) body.template_id = selectedTemplate;

      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.id) navigate(`/quotes/${data.id}`);
    } catch {
      // ignore
    } finally {
      setCreating(false);
    }
  };

  const columns: UnifiedListColumn<Quote>[] = useMemo(() => [
    {
      key: "quote_number",
      header: "#",
      render: (q) => (
        <span className="font-mono text-sm">{q.quote_number}</span>
      ),
      sortValue: (q) => q.quote_number,
      width: 100,
    },
    {
      key: "title",
      header: "Title",
      render: (q) => (
        <div className="min-w-0">
          <div className="text-primary font-semibold">{q.title}</div>
          {(q.company_name || contactName(q)) && (
            <MetaText size="xs">
              {q.company_name}{q.company_name && contactName(q) ? " — " : ""}{contactName(q)}
            </MetaText>
          )}
        </div>
      ),
      sortValue: (q) => q.title,
      width: 280,
    },
    {
      key: "status",
      header: "Status",
      render: (q) => {
        const badge = STATUS_BADGE[q.status] || { status: "muted", label: q.status };
        return (
          <Badge status={badge.status as "success" | "warning" | "error" | "accent" | "muted"} className="text-xs capitalize">
            {badge.label}
          </Badge>
        );
      },
      sortValue: (q) => q.status,
      width: 100,
      align: "center",
    },
    {
      key: "net_total",
      header: "Net Total",
      render: (q) => (
        <span className="font-mono text-sm">{formatCurrency(q.net_total, q.currency)}</span>
      ),
      sortValue: (q) => q.net_total,
      width: 140,
      align: "right",
    },
    {
      key: "issued_date",
      header: "Issued",
      render: (q) => <MetaText size="xs">{formatDate(q.issued_date)}</MetaText>,
      sortValue: (q) => q.issued_date ? new Date(q.issued_date) : null,
      width: 120,
    },
    {
      key: "valid_until",
      header: "Valid Until",
      render: (q) => {
        if (!q.valid_until) return <MetaText size="xs">-</MetaText>;
        const expired = new Date(q.valid_until) < new Date();
        return (
          <MetaText size="xs" style={expired ? { color: "var(--error)" } : undefined}>
            {formatDate(q.valid_until)}
          </MetaText>
        );
      },
      sortValue: (q) => q.valid_until ? new Date(q.valid_until) : null,
      width: 120,
    },
  ], []);

  return (
    <>
      <PageHeader
        title="Quotes"
        subtitle={`${totalAll} quotes`}
        actions={
          <Button variant="primary" onClick={openNewQuoteModal}>
            New Quote
          </Button>
        }
      />

      <PageBody>
        <div className="list-page-toolbar">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search quotes, contacts..."
            resultCount={search.trim() ? total : undefined}
            queryTimeMs={lastQueryMs ?? undefined}
            debounceMs={0}
            className="list-page-search"
          />
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

        {loading && quotes.length === 0 ? (
          <EmptyState message="Loading..." />
        ) : quotes.length === 0 ? (
          <EmptyState
            icon="📋"
            message={totalAll === 0 ? "No quotes yet. Create your first quote." : "No quotes found."}
          />
        ) : (
          <>
            <UnifiedList
              items={quotes}
              columns={columns}
              rowKey={(q) => q.id}
              onRowClick={(q) => navigate(`/quotes/${q.id}`)}
              defaultSort={{ key: "issued_date", direction: "desc" }}
              tableAriaLabel="Quotes list"
              emptyMessage="No quotes found."
            />
            <Pagination
              total={total}
              pageSize={limit}
              offset={offset}
              onOffsetChange={setOffset}
            />
          </>
        )}
      </PageBody>

      {/* New Quote Modal */}
      <Modal open={showNew} title="New Quote" onClose={() => setShowNew(false)}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Title */}
          <label>
            <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Title</span>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="form-input"
              style={{ width: "100%", marginTop: 4 }}
            />
          </label>

          {/* Contact search */}
          <div>
            <span style={{ fontSize: "0.8rem", fontWeight: 500, display: "block", marginBottom: 4 }}>Contact</span>
            {selectedContact ? (
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 12px", borderRadius: 8, background: "var(--bg-secondary)",
                border: "1px solid var(--border)",
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>
                    {selectedContact.first_name} {selectedContact.last_name}
                  </div>
                  {selectedContact.company_name && (
                    <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                      {selectedContact.company_name}
                      {selectedContact.job_title && ` — ${selectedContact.job_title}`}
                    </div>
                  )}
                  {selectedContact.emails?.[0] && (
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      {selectedContact.emails[0]}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => { setSelectedContact(null); setContactSearch(""); }}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "var(--text-muted)", fontSize: "1.1rem", padding: "0 4px",
                  }}
                  title="Remove contact"
                >
                  ×
                </button>
              </div>
            ) : (
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  value={contactSearch}
                  onChange={(e) => searchContacts(e.target.value)}
                  className="form-input"
                  placeholder="Search contacts by name, email, company..."
                  style={{ width: "100%"}}
                  autoFocus
                />
                {contactResults.length > 0 && (
                  <div style={{
                    position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10,
                    background: "var(--bg-primary)", border: "1px solid var(--border)",
                    borderRadius: 8, marginTop: 4, maxHeight: 240, overflowY: "auto",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                  }}>
                    {contactResults.map((c) => (
                      <div
                        key={c.id}
                        onClick={() => { setSelectedContact(c); setContactSearch(""); setContactResults([]); }}
                        style={{
                          padding: "8px 12px", cursor: "pointer",
                          borderBottom: "1px solid var(--border)",
                        }}
                        onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "var(--bg-secondary)"; }}
                        onMouseLeave={(e) => { (e.target as HTMLElement).style.background = "transparent"; }}
                      >
                        <div style={{ fontWeight: 500 }}>
                          {c.first_name} {c.last_name}
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                          {[c.company_name, c.job_title, c.emails?.[0]].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Template picker */}
          <label>
            <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>Template</span>
            <select
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
              className="form-input"
              style={{ width: "100%", marginTop: 4 }}
            >
              <option value="">No template (blank quote)</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.org_name ? ` (${t.org_name})` : ""}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <Button variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleCreate} disabled={creating}>
              {creating ? "Creating..." : "Create Quote"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
