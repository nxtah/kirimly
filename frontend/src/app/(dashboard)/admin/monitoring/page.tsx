"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import AdminLayout from "@/components/AdminLayout";
import ConfirmDialog from "@/components/ConfirmDialog";
import PageHeader from "@/components/ui/PageHeader";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { Radio, Smartphone, User, ShieldAlert, Search, Filter, XCircle } from "lucide-react";

interface Session {
  user_id: number; username: string; display_name: string | null;
  status: string; phone_number: string | null;
  last_connected_at: string | null; error_message: string | null;
  has_qr?: boolean; in_memory: boolean;
}

interface LoginLog {
  id: number; user_id: number; username: string; display_name: string | null;
  ip_address: string | null; user_agent: string | null;
  success: boolean; fail_reason: string | null;
  logout_at: string | null; created_at: string;
}

interface LoginLogsRes { logs: LoginLog[]; pagination: { page: number; limit: number; total: number; total_pages: number }; }

export default function AdminMonitoringPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessLoading, setSessLoading] = useState(true);
  const [termTarget, setTermTarget] = useState<Session | null>(null);
  const [terminating, setTerminating] = useState(false);

  const [logs, setLogs] = useState<LoginLog[]>([]);
  const [logPagination, setLogPagination] = useState({ page: 1, limit: 30, total: 0, total_pages: 0 });
  const [logPage, setLogPage] = useState(1);
  const [logUserFilter, setLogUserFilter] = useState("");
  const [logFrom, setLogFrom] = useState("");
  const [logTo, setLogTo] = useState("");
  const [logLoading, setLogLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSessions = useCallback(async () => {
    try { const d = await api.get<{ sessions: Session[] }>("/api/admin/monitoring/sessions"); setSessions(d.sessions); }
    catch {} finally { setSessLoading(false); }
  }, []);

  useEffect(() => {
    fetchSessions();
    pollRef.current = setInterval(fetchSessions, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchSessions]);

  async function handleTerminate() {
    if (!termTarget) return;
    setTerminating(true);
    try { await api.post(`/api/admin/monitoring/sessions/${termTarget.user_id}/terminate`); setTermTarget(null); fetchSessions(); }
    catch {} finally { setTerminating(false); }
  }

  const fetchLogs = useCallback(async (p: number) => {
    setLogLoading(true);
    try {
      const params: Record<string, any> = { page: p, limit: 30 };
      if (logUserFilter) params.user_id = logUserFilter; if (logFrom) params.from = logFrom; if (logTo) params.to = logTo;
      const d = await api.get<LoginLogsRes>("/api/admin/monitoring/login-logs", { params });
      setLogs(d.logs); setLogPagination(d.pagination);
    } catch {} finally { setLogLoading(false); }
  }, [logUserFilter, logFrom, logTo]);
  useEffect(() => { fetchLogs(logPage); }, [logPage, fetchLogs]);

  return (
    <AdminLayout>
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <PageHeader title="Monitoring" subtitle="Real-time sessions and login activity" hideAvatar />

        {/* Sessions */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-ink mb-4 flex items-center gap-2">
            <Radio size={16} className="text-primary-500" /> Active Sessions
          </h2>
          <div className="bg-surface-card rounded-2xl shadow-card overflow-hidden">
            {sessLoading ? <SkeletonTable rows={4} /> : sessions.length === 0 ? (
              <div className="p-10 text-center text-sm text-ink-muted">
                <Smartphone size={28} className="mx-auto mb-2 text-gray-200" />
                <p>No sessions found.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">User</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Status</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Phone</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Last Connected</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Source</th>
                      <th className="text-right px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s) => (
                      <tr key={s.user_id} className="border-b border-gray-50 last:border-0 hover:bg-primary-50/30 transition-colors">
                        <td className="px-4 py-3 font-medium text-ink">{s.username}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium ${
                            s.status === "connected" ? "bg-primary-100 text-primary-700" :
                            s.status === "pending" ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-500"
                          }`}>
                            <Smartphone size={12} /> {s.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs font-mono text-ink-muted">{s.phone_number || "—"}</td>
                        <td className="px-4 py-3 text-xs text-ink-muted">{s.last_connected_at ? new Date(s.last_connected_at).toLocaleString() : "—"}</td>
                        <td className="px-4 py-3 text-xs text-ink-light">{s.in_memory ? "live" : "db"}</td>
                        <td className="px-4 py-3 text-right">
                          {s.status === "connected" && (
                            <button onClick={() => setTermTarget(s)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-all">
                              <XCircle size={12} /> Terminate
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="text-xs text-ink-light mt-2">Live — refreshes every 5s</p>
        </section>

        {/* Login Logs */}
        <section>
          <h2 className="text-sm font-semibold text-ink mb-4 flex items-center gap-2">
            <ShieldAlert size={16} className="text-primary-500" /> Login Logs
          </h2>

          <div className="bg-surface-card rounded-2xl shadow-card p-4 mb-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-ink-muted mb-1 uppercase tracking-wider">User ID</label>
              <input type="number" value={logUserFilter} onChange={(e) => setLogUserFilter(e.target.value)}
                className="w-20 border border-gray-200 rounded-xl px-3 py-2 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="ID" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-ink-muted mb-1 uppercase tracking-wider">From</label>
              <input type="date" value={logFrom} onChange={(e) => setLogFrom(e.target.value)}
                className="border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-ink-muted mb-1 uppercase tracking-wider">To</label>
              <input type="date" value={logTo} onChange={(e) => setLogTo(e.target.value)}
                className="border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <button onClick={() => { setLogPage(1); fetchLogs(1); }}
              className="px-4 py-2 text-xs font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 hover:scale-[1.02] transition-all">
              <Filter size={14} className="inline mr-1" />Apply
            </button>
          </div>

          <div className="bg-surface-card rounded-2xl shadow-card overflow-hidden">
            {logLoading ? <SkeletonTable rows={5} /> : logs.length === 0 ? (
              <div className="p-10 text-center text-sm text-ink-muted">
                <Search size={28} className="mx-auto mb-2 text-gray-200" />
                <p>No logs found.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">User</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Status</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">IP</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">User Agent</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((l) => (
                      <tr key={l.id} className="border-b border-gray-50 last:border-0 hover:bg-primary-50/30 transition-colors">
                        <td className="px-4 py-3 font-medium text-ink">{l.username}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded-lg text-xs font-medium ${l.success ? "bg-primary-100 text-primary-700" : "bg-red-100 text-red-700"}`}>
                            {l.success ? "success" : l.fail_reason || "failed"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-ink-muted font-mono">{l.ip_address || "—"}</td>
                        <td className="px-4 py-3 text-xs text-ink-light max-w-[200px] truncate">{l.user_agent || "—"}</td>
                        <td className="px-4 py-3 text-xs text-ink-muted">{new Date(l.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between mt-3 text-xs text-ink-muted">
            <span>Page {logPagination.page} of {logPagination.total_pages} ({logPagination.total} total)</span>
            <div className="flex gap-1.5">
              <button disabled={logPage <= 1} onClick={() => setLogPage((p) => p - 1)}
                className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-all">Prev</button>
              <button disabled={logPage >= logPagination.total_pages} onClick={() => setLogPage((p) => p + 1)}
                className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-all">Next</button>
            </div>
          </div>
        </section>

        <ConfirmDialog open={!!termTarget} onClose={() => setTermTarget(null)} onConfirm={handleTerminate}
          title="Terminate Session" message={`Force-disconnect "${termTarget?.username}" from WhatsApp?`}
          confirmLabel="Terminate" loading={terminating} />
      </div>
    </AdminLayout>
  );
}
