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

  useEffect(() => {
    fetchQuotes(search, statusFilter, offset);
  }, [statusFilter, offset]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setOffset(0);
      fetchQuotes(search, statusFilter, 0);
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

  const handleCreate = async () => {
    try {
      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Neues Angebot" }),
      });
      const data = await res.json();
      if (data.id) navigate(`/quotes/${data.id}`);
    } catch {
      // ignore
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
          <Button variant="primary" onClick={handleCreate}>
            New Quote
          </Button>
        }
      />

      <PageBody>
        <div className="list-page-toolbar">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search quotes..."
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
    </>
  );
}
