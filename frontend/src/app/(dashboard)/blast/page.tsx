"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import PageHeader from "@/components/ui/PageHeader";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { Plus, Send, CheckCircle2, XCircle, Clock, TrendingUp, Search, Filter, LayoutGrid, List } from "lucide-react";

interface BlastSummary {
  id: number; name: string; template_id: number;
  total_contacts: number; sent_count: number; failed_count: number;
  status: string; created_at: string; completed_at: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  completed: "bg-primary-100 text-primary-700 ring-1 ring-primary-200",
  sending: "bg-yellow-100 text-yellow-700 ring-1 ring-yellow-200",
  cancelled: "bg-gray-100 text-gray-500 ring-1 ring-gray-200",
  scheduled: "bg-blue-100 text-blue-700 ring-1 ring-blue-200",
  draft: "bg-blue-100 text-blue-700 ring-1 ring-blue-200",
};

export default function BlastHistoryPage() {
  const router = useRouter();
  const [blasts, setBlasts] = useState<BlastSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [view, setView] = useState<"list" | "card">("list");
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const fetchBlasts = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = {};
      if (search.trim()) params.search = search.trim();
      if (from) params.from = from;
      if (to) params.to = to;
      const data = await api.get<{ blasts: BlastSummary[] }>("/api/blasts", { params });
      setBlasts(data.blasts);
    } catch (err: any) {
      setError(err?.body?.error || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [search, from, to]);

  useEffect(() => { fetchBlasts(); }, [fetchBlasts]);

  return (
    <DashboardLayout>
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <PageHeader
          title="Broadcasts"
          subtitle={`${blasts.length} broadcast(s)`}
          actions={
            <button onClick={() => router.push("/blast/new")}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 hover:scale-[1.02] transition-all shadow-sm">
              <Plus size={16} /> New Broadcast
            </button>
          }
        />

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-2xl px-5 py-3 mb-6 flex items-start gap-2">
            <span>⚠️</span><span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="underline shrink-0">Dismiss</button>
          </div>
        )}

        {/* Filters */}
        <div className="bg-surface-card rounded-2xl shadow-card p-4 mb-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-[10px] font-semibold text-ink-muted mb-1 uppercase tracking-wider">Search</label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-light" />
                <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); clearTimeout(searchTimer.current); searchTimer.current = setTimeout(() => fetchBlasts(), 400); }}
                  placeholder="Search by name..." className="w-full border border-gray-200 rounded-xl pl-9 pr-3 py-2 text-sm text-ink placeholder-ink-light focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-ink-muted mb-1 uppercase tracking-wider">From</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-ink-muted mb-1 uppercase tracking-wider">To</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <button onClick={fetchBlasts}
              className="px-4 py-2 text-xs font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 hover:scale-[1.02] transition-all">
              <Filter size={14} className="inline mr-1" /> Apply
            </button>
            <div className="flex bg-gray-100 rounded-xl p-0.5 gap-0.5 ml-auto">
              <button onClick={() => setView("list")}
                className={`p-2 rounded-lg transition-all ${view === "list" ? "bg-white shadow-sm text-primary-600" : "text-ink-muted hover:text-ink"}`}>
                <List size={16} />
              </button>
              <button onClick={() => setView("card")}
                className={`p-2 rounded-lg transition-all ${view === "card" ? "bg-white shadow-sm text-primary-600" : "text-ink-muted hover:text-ink"}`}>
                <LayoutGrid size={16} />
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <SkeletonTable rows={5} />
        ) : blasts.length === 0 ? (
          <div className="bg-surface-card rounded-2xl shadow-card p-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary-100 text-primary-600 flex items-center justify-center mx-auto mb-4">
              <Send size={32} />
            </div>
            <h2 className="text-lg font-semibold text-ink mb-1">
              {search || from ? "No broadcasts match your filters" : "No broadcasts yet"}
            </h2>
            <p className="text-sm text-ink-muted mb-6 max-w-sm mx-auto">
              {search || from ? "Try adjusting your search or filters." : "Start your first WhatsApp broadcast."}
            </p>
            {!search && !from && (
              <button onClick={() => router.push("/blast/new")}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 hover:scale-[1.02] transition-all shadow-sm">
                <Plus size={16} /> New Broadcast
              </button>
            )}
          </div>
        ) : view === "list" ? (
          /* ── List view ── */
          <div className="space-y-2">
            {blasts.map((b) => {
              const rate = b.total_contacts > 0 ? Math.round((b.sent_count / b.total_contacts) * 100) : 0;
              return (
                <div key={b.id}
                  onClick={() => router.push(`/blast/${b.id}`)}
                  className="bg-surface-card rounded-2xl shadow-sm p-4 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-ink">{b.name}</h3>
                      <p className="text-xs text-ink-muted mt-0.5">
                        {new Date(b.created_at).toLocaleDateString()} · {new Date(b.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    <span className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium ${STATUS_STYLES[b.status] || "bg-gray-100 text-gray-600"}`}>
                      {b.status === "completed" && <CheckCircle2 size={12} />}
                      {b.status === "sending" && <Clock size={12} />}
                      {b.status === "cancelled" && <XCircle size={12} />}
                      {b.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-xs">
                    <span className="text-ink-muted"><Send size={12} className="inline mr-1" />{b.total_contacts} contacts</span>
                    <span className="text-primary-600"><CheckCircle2 size={12} className="inline mr-1" />{b.sent_count}</span>
                    <span className="text-red-500"><XCircle size={12} className="inline mr-1" />{b.failed_count}</span>
                    <span className="text-ink"><TrendingUp size={12} className="inline mr-1" />{rate}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* ── Card view ── */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {blasts.map((b) => {
              const rate = b.total_contacts > 0 ? Math.round((b.sent_count / b.total_contacts) * 100) : 0;
              return (
                <div key={b.id}
                  onClick={() => router.push(`/blast/${b.id}`)}
                  className="bg-surface-card rounded-2xl shadow-sm p-5 transition-all duration-200 hover:shadow-md hover:-translate-y-1 cursor-pointer flex flex-col"
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <h3 className="text-sm font-semibold text-ink leading-snug line-clamp-2">{b.name}</h3>
                    <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium ${STATUS_STYLES[b.status] || "bg-gray-100 text-gray-600"}`}>
                      {b.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-ink-muted mb-3">
                    {new Date(b.created_at).toLocaleDateString()}
                  </p>
                  <div className="mt-auto space-y-1.5">
                    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-primary-500 rounded-full" style={{ width: `${rate}%` }} />
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-ink-muted">{b.total_contacts} contacts</span>
                      <span className="text-primary-600 font-medium">{rate}%</span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-ink-muted pt-1 border-t border-gray-100">
                      <span className="text-primary-600">✅ {b.sent_count}</span>
                      <span className="text-red-500">❌ {b.failed_count}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
