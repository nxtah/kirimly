"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import StatCard from "@/components/ui/StatCard";
import ChartAreaCard from "@/components/ui/ChartAreaCard";
import DonutChartCard from "@/components/ui/DonutChartCard";
import ProgressBarList from "@/components/ui/ProgressBarList";
import PageHeader from "@/components/ui/PageHeader";
import { SkeletonCard, SkeletonChart, SkeletonTable } from "@/components/ui/Skeleton";
import {
  Users,
  FileText,
  Send,
  CheckCircle2,
  Smartphone,
  LogOut,
  ChevronDown,
  MessageSquare,
  Eye,
  Reply,
  XCircle,
} from "lucide-react";

interface DashStats {
  total_contacts: number;
  total_templates: number;
  total_blasts: number;
  messages_sent: number;
  messages_delivered: number;
  messages_read: number;
  messages_replied: number;
  messages_failed: number;
  delivery_rate: number;
  read_rate: number;
}

interface WaSessionInfo {
  status: string;
  phone_number: string | null;
  last_connected_at: string | null;
}

interface DashData {
  stats: DashStats;
  recent_blasts: any[];
}

interface LogEntry {
  id: number; status: string; sent_at: string | null;
  delivered_at: string | null; read_at: string | null;
  replied_at: string | null; created_at: string;
}

interface LogsResponse {
  logs: LogEntry[];
}

/* ── Aggregate logs into daily chart data ── */
function buildChartData(logs: LogEntry[], days: number) {
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const buckets: Record<string, { sent: number; delivered: number; read: number }> = {};

  // Init all days in range
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    buckets[key] = { sent: 0, delivered: 0, read: 0 };
  }

  for (const log of logs) {
    let key: string | null = null;
    if (log.sent_at) key = log.sent_at.slice(0, 10);
    else if (log.created_at) key = log.created_at.slice(0, 10);
    if (!key || !buckets[key]) continue;

    buckets[key].sent++;
    if (log.status === "delivered" || log.status === "read" || log.status === "replied") {
      buckets[key].delivered++;
    }
    if (log.status === "read" || log.status === "replied") {
      buckets[key].read++;
    }
  }

  return Object.entries(buckets).map(([dateStr, vals]) => {
    const d = new Date(dateStr);
    return {
      name: dayNames[d.getDay()],
      date: dateStr,
      ...vals,
    };
  });
}

const STATUS_BADGE: Record<string, string> = {
  completed: "bg-primary-100 text-primary-700",
  sending: "bg-yellow-100 text-yellow-700",
  cancelled: "bg-gray-100 text-gray-500",
  draft: "bg-blue-100 text-blue-700",
};

function DashboardContent() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<DashData | null>(null);
  const [waInfo, setWaInfo] = useState<WaSessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartData, setChartData] = useState<any[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [period, setPeriod] = useState("7d");

  useEffect(() => {
    async function load() {
      try {
        const days = period === "30d" ? 30 : 7;
        const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
        const [statsData, waData, logsData] = await Promise.all([
          api.get<DashData>("/api/dashboard/stats", { params: { days } }),
          api.get<WaSessionInfo>("/api/wa/session/status"),
          api.get<LogsResponse>("/api/logs", { params: { from: since, limit: 5000 } }),
        ]);
        setData(statsData);
        setWaInfo(waData);
        setChartData(buildChartData(logsData.logs, days));
        if (waData.status !== "connected") {
          router.replace("/connect-wa");
        }
      } catch (err: any) {
        setError(err?.body?.error || err.message || "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router, period]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // ── Loading state ──
  if (loading) {
    return (
      <DashboardLayout>
        <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <SkeletonCard />
            </div>
          </div>
          <div className="grid grid-cols-12 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="col-span-12 sm:col-span-6 lg:col-span-3">
                <SkeletonCard />
              </div>
            ))}
            <div className="col-span-12 lg:col-span-8"><SkeletonChart /></div>
            <div className="col-span-12 lg:col-span-4"><SkeletonChart /></div>
            <div className="col-span-12"><SkeletonTable rows={4} /></div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <DashboardLayout>
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-2xl p-6 flex items-start gap-3">
            <XCircle size={20} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Failed to load dashboard</p>
              <p className="text-red-500 mt-0.5">{error}</p>
            </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const stats = data?.stats;
  const recentBlasts = data?.recent_blasts || [];

  // Derived donut data from real stats
  const realDonut = [
    { name: "Delivered", value: stats?.messages_delivered ?? 0, color: "#22C55E" },
    { name: "Read", value: stats?.messages_read ?? 0, color: "#86EFAC" },
    { name: "Replied", value: stats?.messages_replied ?? 0, color: "#FBBF24" },
    { name: "Failed", value: stats?.messages_failed ?? 0, color: "#F87171" },
  ].filter((d) => d.value > 0);

  const progressItems = [
    { label: "Delivery Rate", value: stats?.delivery_rate ?? 0, suffix: "%", color: "#22C55E" },
    { label: "Read Rate", value: stats?.read_rate ?? 0, suffix: "%", color: "#86EFAC" },
    { label: "Reply Rate", value: stats?.messages_sent ? Math.round(((stats?.messages_replied ?? 0) / stats.messages_sent) * 100) : 0, suffix: "%", color: "#FBBF24" },
  ];

  const initials = (user?.display_name || user?.username || "U").slice(0, 2).toUpperCase();

  return (
    <DashboardLayout>
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        {/* ── Topbar / Header ── */}
        <div className="sticky top-0 z-10 bg-surface/80 backdrop-blur-lg pb-4 lg:pb-6 -mx-6 lg:-mx-8 px-6 lg:px-8 pt-0">
          <div className="flex items-center justify-between pt-3 lg:pt-4">
            <div>
              <h1 className="text-xl lg:text-2xl font-bold text-ink tracking-tight">Dashboard</h1>
              <p className="text-xs lg:text-sm text-ink-muted mt-0.5 hidden sm:block">
                Selamat datang kembali, {user?.display_name || user?.username}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* Period toggle */}
              <div className="inline-flex bg-gray-100 rounded-xl p-0.5 gap-0.5">
                <button
                  onClick={() => setPeriod("7d")}
                  className={`px-3.5 py-1.5 text-sm font-medium rounded-lg transition-all ${
                    period === "7d" ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  7 days
                </button>
                <button
                  onClick={() => setPeriod("30d")}
                  className={`px-3.5 py-1.5 text-sm font-medium rounded-lg transition-all ${
                    period === "30d" ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  30 days
                </button>
              </div>
              {/* Avatar dropdown */}
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex items-center gap-2 bg-surface-card rounded-full pl-3 pr-2 py-1.5 shadow-card hover:shadow-md transition-all"
                >
                  <div className="w-8 h-8 rounded-full bg-primary-500 text-white text-sm font-bold flex items-center justify-center">
                    {initials}
                  </div>
                  <ChevronDown size={14} className="text-ink-muted" />
                </button>
                {dropdownOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-surface-card rounded-2xl shadow-card-heavy border border-gray-100 py-1 z-20">
                    <div className="px-4 py-2 border-b border-gray-100">
                      <p className="text-sm font-medium text-ink">{user?.display_name || user?.username}</p>
                      <p className="text-xs text-ink-light">{user?.username}</p>
                    </div>
                    <button
                      onClick={() => { logout(); router.push("/login"); }}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <LogOut size={14} /> Sign out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* WA status bar */}
          {waInfo && (
            <div className="mt-4 bg-white rounded-2xl shadow-card px-5 py-3 flex items-center gap-3">
              <Smartphone size={16} className={waInfo.status === "connected" ? "text-primary-500" : "text-yellow-500"} />
              <span className="text-sm text-ink-muted">
                WhatsApp:{" "}
                <span className="font-medium text-ink">
                  {waInfo.status === "connected"
                    ? `Connected ${waInfo.phone_number ? "(" + waInfo.phone_number + ")" : ""}`
                    : "Not connected"}
                </span>
              </span>
            </div>
          )}
        </div>

        {/* ── Grid Dashboard ── */}
        <div className="grid grid-cols-12 gap-6">

          {/* Row 1: 4 stat cards */}
          <div className="col-span-12 grid grid-cols-2 lg:grid-cols-4 gap-5">
            <StatCard
              title="Total Contacts"
              value={stats?.total_contacts ?? 0}
              icon={<Users size={18} />}
              iconBg="bg-emerald-100 text-emerald-600"
              highlighted
              subtitle="All time"
            />
            <StatCard
              title="Templates"
              value={stats?.total_templates ?? 0}
              icon={<FileText size={18} />}
              iconBg="bg-green-100 text-green-600"
              subtitle="Message templates"
            />
            <StatCard
              title="Blasts Sent"
              value={stats?.total_blasts ?? 0}
              icon={<Send size={18} />}
              iconBg="bg-primary-100 text-primary-600"
              subtitle="Total broadcasts"
            />
            <StatCard
              title="Messages Sent"
              value={stats?.messages_sent ?? 0}
              subtitle={`${realDonut[0]?.value || 0} delivered`}
              icon={<MessageSquare size={18} />}
              iconBg="bg-teal-100 text-teal-600"
            />
          </div>

          {/* Row 2: area chart (wider) + donut chart (narrower) */}
          <div className="col-span-12 lg:col-span-8">
            <ChartAreaCard
              title="Message Activity"
              subtitle={`${period === "30d" ? "30-day" : "7-day"} overview`}
              data={chartData}
              dataKey="sent"
              formatValue={(v) => `${v} messages`}
            />
          </div>
          <div className="col-span-12 lg:col-span-4">
            {realDonut.length > 0 ? (
              <DonutChartCard
                title="Message Status"
                subtitle="Delivery breakdown"
                data={realDonut}
                formatValue={(v) => `${v} messages`}
              />
            ) : (
              <div className="bg-surface-card rounded-2xl shadow-card p-6 h-full flex flex-col items-center justify-center text-center">
                <Send size={32} className="text-gray-200 mb-2" />
                <p className="text-sm font-medium text-ink-muted mb-0.5">No message data yet</p>
                <p className="text-xs text-ink-light max-w-[160px]">Send your first broadcast to see delivery stats here</p>
              </div>
            )}
          </div>

          {/* Row 3: progress bars */}
          <div className="col-span-12 lg:col-span-4">
            <div className="bg-surface-card rounded-2xl shadow-card p-6 transition-all duration-200 hover:shadow-md">
              <p className="text-sm font-semibold text-ink mb-4">Delivery Performance</p>
              <ProgressBarList items={progressItems} />
            </div>
          </div>

          {/* Row 3: recent blasts */}
          <div className="col-span-12 lg:col-span-8">
            <div className="bg-surface-card rounded-2xl shadow-card p-6 transition-all duration-200 hover:shadow-md">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-semibold text-ink">Recent Blasts</p>
                <button
                  onClick={() => router.push("/blast")}
                  className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                >
                  View all
                </button>
              </div>

              {recentBlasts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <Send size={36} className="text-gray-200 mb-3" />
                  <p className="text-sm font-medium text-ink-muted mb-1">No blasts yet</p>
                  <p className="text-xs text-ink-light mb-4">
                    Create your first broadcast to see it here.
                  </p>
                  <button
                    onClick={() => router.push("/blast/new")}
                    className="px-4 py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 hover:scale-[1.02] transition-all shadow-sm"
                  >
                    + New Broadcast
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {recentBlasts.map((b: any) => (
                    <div
                      key={b.id}
                      onClick={() => router.push(`/blast/${b.id}`)}
                      className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 transition-all cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink">{b.name}</p>
                        <p className="text-xs text-ink-muted mt-0.5">
                          {b.total_contacts} contacts · {b.sent_count} sent · {b.failed_count} failed
                        </p>
                      </div>
                      <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-medium ${STATUS_BADGE[b.status] || "bg-gray-100 text-gray-600"}`}>
                        {b.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </DashboardLayout>
  );
}

export default function DashboardPage() {
  return <DashboardContent />;
}
