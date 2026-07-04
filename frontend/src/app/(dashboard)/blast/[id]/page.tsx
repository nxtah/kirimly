"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import ConfirmDialog from "@/components/ConfirmDialog";
import { SkeletonTable, SkeletonCard } from "@/components/ui/Skeleton";
import { ArrowLeft, Send, CheckCircle2, XCircle, Clock, AlertTriangle, X, Loader2, FileDown, RefreshCw } from "lucide-react";

interface BlastDetail {
  id: number; name: string; template_id: number; total_contacts: number;
  sent_count: number; delivered_count: number; read_count: number;
  replied_count: number; failed_count: number; status: string;
  created_at: string; sent_at: string | null; completed_at: string | null;
}
interface BlastMessage {
  delivered_at?: string | null;
  read_at?: string | null;
  replied_at?: string | null;
  reply_body?: string | null;
  wave_number?: number;
  id: number; contact_id: number | null; contact_name: string | null;
  phone_number: string; message_body: string; status: string;
  error_message: string | null; sent_at: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-100 text-gray-500", sent: "bg-blue-100 text-blue-700",
  delivered: "bg-cyan-100 text-cyan-700", read: "bg-green-100 text-green-700",
  replied: "bg-purple-100 text-purple-700", failed: "bg-red-100 text-red-700",
};

export default function BlastProgressPage() {
  const params = useParams(); const router = useRouter();
  const blastId = Number(params.id);
  const [blast, setBlast] = useState<BlastDetail | null>(null);
  const [messages, setMessages] = useState<BlastMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isFinal = blast?.status === "completed" || blast?.status === "cancelled";

  const fetchDetail = useCallback(async () => {
    try {
      const [dRes, mRes] = await Promise.all([
        api.get<{ blast: BlastDetail; progress: any }>(`/api/blasts/${blastId}`),
        api.get<{ messages: BlastMessage[] }>(`/api/blasts/${blastId}/messages`),
      ]);
      setBlast(dRes.blast); setMessages(mRes.messages);
      if (dRes.blast.status === "completed" || dRes.blast.status === "cancelled") {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      }
    } catch (err: any) {
      if (err.status === 404) { setError("Blast not found"); if (pollRef.current) clearInterval(pollRef.current); }
      else setError(err?.body?.error || "Failed to load");
    } finally { setLoading(false); }
  }, [blastId]);

  useEffect(() => {
    fetchDetail();
    if (!isFinal) pollRef.current = setInterval(fetchDetail, 4000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchDetail, isFinal]);

  async function handleRetry() {
    setRetrying(true);
    try {
      const res = await api.post(`/api/blasts/${blastId}/retry`);
      router.push(`/blast/${res.blast_id}`);
    } catch (err: any) {
      setError(err?.body?.error || "Retry failed");
    } finally {
      setRetrying(false);
    }
  }

  async function handleCancel() {
    setCancelling(true);
    try { await api.post(`/api/blasts/${blastId}/cancel`); setCancelOpen(false); fetchDetail(); }
    catch (err: any) { setError(err?.body?.error || "Cancel failed"); }
    finally { setCancelling(false); }
  }


  function exportCsv() {
    const headers = ["Contact Name","Phone","Wave","Status","Sent At","Delivered At","Read At","Replied At","Reply Message"];
    const rows = messages.map((m) => [
      m.contact_name || "",
      m.phone_number,
      m.wave_number || 1,
      m.status,
      m.sent_at ? new Date(m.sent_at).toLocaleString() : "",
      m.delivered_at ? new Date(m.delivered_at).toLocaleString() : "",
      m.read_at ? new Date(m.read_at).toLocaleString() : "",
      m.replied_at ? new Date(m.replied_at).toLocaleString() : "",
      m.reply_body || "",
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.map((v) => '\"' + String(v).replace(/"/g, '""') + '\"').join(","))].join("\n");
    var blob = new Blob([csv], { type: "text/csv" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var name = (blast ? blast.name : "blast-" + blastId).replace(/[^a-zA-Z0-9]/g, "_");
    a.href = url; a.download = name + ".csv"; a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-5">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonTable rows={5} />
        </div>
      </DashboardLayout>
    );
  }

  if (error || !blast) {
    return (
      <DashboardLayout>
        <div className="p-6 lg:p-8 max-w-5xl mx-auto">
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-2xl px-5 py-4 flex items-start gap-3">
            <XCircle size={18} className="shrink-0 mt-0.5" />
            <div><p className="font-semibold">Error</p><p>{error || "Blast not found"}</p></div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const pct = blast.total_contacts > 0 ? Math.round(((blast.sent_count + blast.failed_count) / blast.total_contacts) * 100) : 0;
  const done = blast.sent_count + blast.failed_count;
  const pending = blast.total_contacts - done;

  return (
    <DashboardLayout>
      <div className="p-6 lg:p-8 max-w-5xl mx-auto">
        {/* Back */}
        <button onClick={() => router.push("/blast")}
          className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink mb-4 transition-colors">
          <ArrowLeft size={14} /> Back to Broadcasts
        </button>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h1 className="text-xl font-bold text-ink">{blast.name}</h1>
            <p className="text-xs text-ink-muted mt-0.5">{new Date(blast.created_at).toLocaleString()}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium ${
              blast.status === "completed" ? "bg-primary-100 text-primary-700 ring-1 ring-primary-200" :
              blast.status === "cancelled" ? "bg-gray-100 text-gray-500 ring-1 ring-gray-200" :
              blast.status === "sending" ? "bg-yellow-100 text-yellow-700 ring-1 ring-yellow-200 animate-pulse" :
              "bg-blue-100 text-blue-700"
            }`}>
              {blast.status === "sending" && <Loader2 size={12} className="animate-spin" />}
              {blast.status}
            </span>
            {blast.status === "sending" && (
              <button onClick={() => setCancelOpen(true)}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-xl hover:bg-red-100 transition-all">
                <X size={12} /> Cancel
              </button>
            )}
          </div>
        </div>

        {/* Progress card */}
        <div className="bg-surface-card rounded-2xl shadow-card p-6 mb-5 transition-all hover:shadow-md">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-ink-muted">Progress</span>
            <span className="text-lg font-bold text-ink">{pct}%</span>
          </div>
          <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-primary-500 rounded-full transition-all duration-700 ease-out" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex items-center gap-5 mt-3 text-xs">
            <span className="flex items-center gap-1.5 text-primary-600"><CheckCircle2 size={14} /> {blast.sent_count} sent</span>
            <span className="flex items-center gap-1.5 text-red-500"><XCircle size={14} /> {blast.failed_count} failed</span>
            <span className="flex items-center gap-1.5 text-ink-muted"><Clock size={14} /> {Math.max(0, pending)} pending</span>
          </div>
          {blast.status === "completed" && blast.completed_at && (
            <p className="text-xs text-ink-muted mt-3">Completed {new Date(blast.completed_at).toLocaleString()}</p>
          )}
          {blast.status === "cancelled" && (
            <p className="text-xs text-red-500 mt-3">Cancelled — remaining messages not sent.</p>
          )}
        </div>

        {/* Messages */}
        <div className="flex items-center justify-between mb-3"><h2 className="text-sm font-semibold text-ink">Messages</h2>{messages.length > 0 && (<button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-ink-muted bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:scale-[1.02] transition-all"><FileDown size={14} /> Export CSV</button>)}</div>
        <div className="bg-surface-card rounded-2xl shadow-card overflow-hidden">
          {messages.length === 0 ? (
            <div className="p-10 text-center">
              <Send size={28} className="text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-ink-muted">No messages yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Contact</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Phone</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Status</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map((m) => (
                    <tr key={m.id} className="border-b border-gray-50 last:border-0 hover:bg-primary-50/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-ink">{m.contact_name || "—"}</td>
                      <td className="px-4 py-3 text-xs font-mono text-ink-muted">{m.phone_number}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-lg text-[10px] font-medium ${STATUS_COLORS[m.status] || "bg-gray-100 text-gray-500"}`}>
                          {m.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-light">
                        {m.sent_at ? new Date(m.sent_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <ConfirmDialog open={cancelOpen} onClose={() => setCancelOpen(false)} onConfirm={handleCancel}
          title="Cancel Broadcast" message="Sent messages can't be recalled, but pending messages will be cancelled."
          confirmLabel="Yes, Cancel" loading={cancelling} />
      </div>
    </DashboardLayout>
  );
}
