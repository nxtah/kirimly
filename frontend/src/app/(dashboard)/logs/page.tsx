"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import PageHeader from "@/components/ui/PageHeader";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { Search, Download, Filter, Phone, MessageSquare } from "lucide-react";

interface BlastSummary { id: number; name: string; status: string; created_at: string; }

interface LogEntry {
  id: number; blast_id: number; blast_name: string; contact_id: number | null;
  contact_name: string | null; phone_number: string; message_body: string;
  status: string; error_message: string | null; reply_body: string | null;
  sent_at: string | null; delivered_at: string | null; read_at: string | null;
  replied_at: string | null; created_at: string;
}

interface Pagination { page: number; limit: number; total: number; total_pages: number; }
interface Summary { total: number; sent: number; delivered: number; read: number; replied: number; failed: number; }
interface LogsRes { logs: LogEntry[]; pagination: Pagination; summary: Summary; }

const STATUSES = ["", "sent", "delivered", "read", "replied", "failed"];
const STATUS_COLORS: Record<string, string> = {
  sent: "bg-gray-100 text-gray-600", delivered: "bg-blue-100 text-blue-700",
  read: "bg-green-100 text-green-700", replied: "bg-purple-100 text-purple-700",
  failed: "bg-red-100 text-red-700",
};

const LIMIT = 50;

export default function LogsPage() {
  const [blasts, setBlasts] = useState<BlastSummary[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [filterBlast, setFilterBlast] = useState<number | "">("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [search, setSearch] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    api.get<{ blasts: BlastSummary[] }>("/api/blasts").then((d) => setBlasts(d.blasts)).catch(() => {});
  }, []);

  const fetchLogs = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page: p, limit: LIMIT };
      if (filterBlast) params.blast_id = filterBlast;
      if (filterStatus) params.status = filterStatus;
      if (filterFrom) params.from = filterFrom;
      if (filterTo) params.to = filterTo;
      if (search.trim()) params.search = search.trim();
      const data = await api.get<LogsRes>("/api/logs", { params });
      setLogs(data.logs); setPagination(data.pagination); setSummary(data.summary);
    } catch {} finally { setLoading(false); }
  }, [filterBlast, filterStatus, filterFrom, filterTo, search]);

  useEffect(() => { fetchLogs(page); }, [page, fetchLogs]);

  function applyFilters() { setPage(1); fetchLogs(1); }
  function onSearchChange(v: string) { setSearch(v); clearTimeout(searchTimer.current); searchTimer.current = setTimeout(() => { setPage(1); }, 400); }

  const totalPages = pagination?.total_pages || 1;

  return (
    <DashboardLayout>
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <PageHeader title="Message Logs" subtitle={`${pagination?.total || 0} total entries`} />

        {/* Summary cards */}
        {summary && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-5">
            <SumCard label="Total" value={summary.total} />
            <SumCard label="Sent" value={summary.sent} color="text-gray-600" />
            <SumCard label="Delivered" value={summary.delivered} color="text-blue-600" />
            <SumCard label="Read" value={summary.read} color="text-green-600" />
            <SumCard label="Replied" value={summary.replied} color="text-purple-600" />
            <SumCard label="Failed" value={summary.failed} color="text-red-600" />
          </div>
        )}

        {/* Filters */}
        <div className="bg-surface-card rounded-2xl shadow-card p-4 mb-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[160px] flex-1">
              <label className="block text-[10px] font-semibold text-ink-muted mb-1 uppercase tracking-wider">Blast</label>
              <select value={filterBlast} onChange={(e) => setFilterBlast(e.target.value ? Number(e.target.value) : "")}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-primary-500">
                <option value="">All Blasts</option>
                {blasts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="min-w-[120px]">
              <label className="block text-[10px] font-semibold text-ink-muted mb-1 uppercase tracking-wider">Status</label>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-primary-500">
                {STATUSES.map((s) => <option key={s} value={s}>{s || "All"}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-ink-muted mb-1 uppercase tracking-wider">From</label>
              <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)}
                className="border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-ink-muted mb-1 uppercase tracking-wider">To</label>
              <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)}
                className="border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div className="min-w-[180px] flex-1">
              <label className="block text-[10px] font-semibold text-ink-muted mb-1 uppercase tracking-wider">Search</label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-light" />
                <input type="text" placeholder="Name or number..." onChange={(e) => onSearchChange(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl pl-9 pr-3 py-2 text-xs text-ink placeholder-ink-light focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
            </div>
            <button onClick={applyFilters}
              className="px-4 py-2 text-xs font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 hover:scale-[1.02] transition-all">
              <Filter size={14} className="inline mr-1" />Apply
            </button>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <SkeletonTable rows={8} />
        ) : logs.length === 0 ? (
          <div className="bg-surface-card rounded-2xl shadow-card p-12 text-center">
            <MessageSquare size={36} className="text-gray-200 mx-auto mb-3" />
            <h2 className="text-base font-semibold text-ink mb-1">No logs found</h2>
            <p className="text-sm text-ink-muted">Try adjusting your filters.</p>
          </div>
        ) : (
          <>
            <div className="bg-surface-card rounded-2xl shadow-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Contact</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Phone</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Blast</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Status</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Sent</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Delivered</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Read</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Replied</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Reply</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((l) => (
                      <tr key={l.id} className="border-b border-gray-50 last:border-0 hover:bg-primary-50/30 transition-colors">
                        <td className="px-4 py-3 font-medium text-ink whitespace-nowrap">{l.contact_name || "—"}</td>
                        <td className="px-4 py-3 text-xs font-mono text-ink-muted whitespace-nowrap">{l.phone_number}</td>
                        <td className="px-4 py-3 text-xs text-ink-light max-w-[120px] truncate">{l.blast_name}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded-lg text-[10px] font-medium ${STATUS_COLORS[l.status] || "bg-gray-100 text-gray-500"}`}>{l.status}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-ink-light whitespace-nowrap">{l.sent_at ? fmt(l.sent_at) : "—"}</td>
                        <td className="px-4 py-3 text-xs text-ink-light whitespace-nowrap">{l.delivered_at ? fmt(l.delivered_at) : "—"}</td>
                        <td className="px-4 py-3 text-xs text-ink-light whitespace-nowrap">{l.read_at ? fmt(l.read_at) : "—"}</td>
                        <td className="px-4 py-3 text-xs text-ink-light whitespace-nowrap">{l.replied_at ? fmt(l.replied_at) : "—"}</td>
                        <td className="px-4 py-3 text-xs text-ink-light max-w-[140px] truncate">{l.reply_body || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex items-center justify-between mt-4 text-xs text-ink-muted">
              <span>Page {pagination?.page} of {pagination?.total_pages} ({pagination?.total} total)</span>
              <div className="flex gap-1.5">
                <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                  className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-all">Prev</button>
                <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}
                  className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-all">Next</button>
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function fmt(d: string) { return new Date(d).toLocaleDateString() + " " + new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }

function SumCard({ label, value, color = "text-ink" }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-surface-card rounded-2xl shadow-card px-4 py-3 text-center">
      <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
