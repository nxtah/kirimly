"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import AdminLayout from "@/components/AdminLayout";
import ChartAreaCard from "@/components/ui/ChartAreaCard";
import DonutChartCard from "@/components/ui/DonutChartCard";
import ProgressBarList from "@/components/ui/ProgressBarList";
import { SkeletonCard, SkeletonChart } from "@/components/ui/Skeleton";
import { Users, Smartphone, Send, UserCheck, MessageSquare, Eye, XCircle, LogIn } from "lucide-react";

interface GlobalStats {
  users: { total: number; active: number };
  wa_sessions: { connected_db: number; connected_realtime: number };
  messaging: { total_blasts: number; total_blast_messages: number; sent: number; delivered: number; read: number; replied: number; failed: number };
  contacts: { total: number };
  login_activity: { last_24h: number };
}

interface LoginLog {
  id: number; created_at: string; success: boolean;
}

const DAYS = 7;

function buildLoginChartData(logs: LoginLog[]) {
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const buckets: Record<string, { logins: number; failed: number }> = {};
  const now = new Date();
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    buckets[d.toISOString().slice(0, 10)] = { logins: 0, failed: 0 };
  }
  for (const log of logs) {
    const key = log.created_at?.slice(0, 10);
    if (!key || !buckets[key]) continue;
    if (log.success) buckets[key].logins++;
    else buckets[key].failed++;
  }
  return Object.entries(buckets).map(([dateStr, v]) => ({
    name: dayNames[new Date(dateStr).getDay()],
    date: dateStr, ...v,
  }));
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [loginChart, setLoginChart] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [s, logsRes] = await Promise.all([
          api.get<GlobalStats>("/api/admin/stats"),
          api.get<{ logs: LoginLog[] }>("/api/admin/monitoring/login-logs", {
            params: { from: new Date(Date.now() - DAYS * 86400000).toISOString(), limit: 5000 },
          }),
        ]);
        setStats(s);
        setLoginChart(buildLoginChartData(logsRes.logs));
      } catch {} finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const m = stats?.messaging;
  const donutData = [
    { name: "Delivered", value: m?.delivered ?? 0, color: "#22C55E" },
    { name: "Read", value: m?.read ?? 0, color: "#86EFAC" },
    { name: "Replied", value: m?.replied ?? 0, color: "#FBBF24" },
    { name: "Failed", value: m?.failed ?? 0, color: "#F87171" },
  ].filter((d) => d.value > 0);

  const progressItems = [
    { label: "Delivery Rate", value: m?.total_blast_messages ? Math.round(((m.delivered + m.read + m.replied) / m.total_blast_messages) * 100) : 0, suffix: "%", color: "#22C55E" },
    { label: "Read Rate", value: m?.total_blast_messages ? Math.round((m.read / m.total_blast_messages) * 100) : 0, suffix: "%", color: "#86EFAC" },
    { label: "Failure Rate", value: m?.total_blast_messages ? Math.round((m.failed / m.total_blast_messages) * 100) : 0, suffix: "%", color: "#F87171" },
  ];

  const s = stats;
  const cardDefs = [
    { label: "Total Users", value: s?.users.total ?? 0, icon: Users, bg: "bg-emerald-100 text-emerald-600", sub: `${s?.users.active ?? 0} active`, highlight: true },
    { label: "WA Connected", value: s?.wa_sessions.connected_realtime ?? 0, icon: Smartphone, bg: "bg-green-100 text-green-600", sub: `${s?.wa_sessions.connected_db ?? 0} in DB` },
    { label: "Total Blasts", value: s?.messaging.total_blasts ?? 0, icon: Send, bg: "bg-primary-100 text-primary-600", sub: `${s?.messaging.total_blast_messages ?? 0} msgs` },
    { label: "Contacts", value: s?.contacts.total ?? 0, icon: UserCheck, bg: "bg-teal-100 text-teal-600", sub: "across all users" },
    { label: "Sent", value: s?.messaging.sent ?? 0, icon: MessageSquare, bg: "bg-cyan-100 text-cyan-600", sub: `${s?.messaging.delivered ?? 0} delivered` },
    { label: "Read", value: s?.messaging.read ?? 0, icon: Eye, bg: "bg-green-100 text-green-600", sub: `${s?.messaging.replied ?? 0} replied` },
    { label: "Failed", value: s?.messaging.failed ?? 0, icon: XCircle, bg: "bg-red-100 text-red-600", sub: `${(s?.messaging.total_blast_messages ?? 0) > 0 ? Math.round(((s?.messaging.failed ?? 0) / (s?.messaging.total_blast_messages ?? 1)) * 100) : 0}% rate` },
    { label: "Logins (24h)", value: s?.login_activity.last_24h ?? 0, icon: LogIn, bg: "bg-indigo-100 text-indigo-600", sub: "successful" },
  ];

  return (
    <AdminLayout>
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-ink tracking-tight">Admin Dashboard</h1>
          <p className="text-sm text-ink-muted mt-0.5">System overview</p>
        </div>

        {loading ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
              {[1,2,3,4,5,6,7,8].map(i => <SkeletonCard key={i} />)}
            </div>
            <div className="grid grid-cols-12 gap-6">
              <div className="col-span-12 lg:col-span-8"><SkeletonChart /></div>
              <div className="col-span-12 lg:col-span-4"><SkeletonChart /></div>
            </div>
          </div>
        ) : !stats ? (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-2xl p-5">Failed to load stats</div>
        ) : (
          <div className="grid grid-cols-12 gap-5">
            {/* Row 1: 8 stat cards in 4x2 */}
            {cardDefs.map((c) => {
              const Icon = c.icon;
              return (
                <div key={c.label}
                  className={`col-span-6 lg:col-span-3 relative bg-surface-card rounded-2xl shadow-sm p-5 transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 group ${
                    c.highlight ? "ring-2 ring-primary-500 bg-gradient-to-br from-surface-card to-primary-50/40" : ""
                  }`}>
                  {c.highlight && (
                    <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-primary-500/5 to-transparent rounded-bl-full pointer-events-none" />
                  )}
                  <div className={`absolute top-4 right-4 w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 group-hover:scale-110 ${c.bg}`}>
                    <Icon size={18} />
                  </div>
                  <p className="text-sm font-semibold text-ink-muted mb-1.5 tracking-wide">{c.label}</p>
                  <p className={`text-3xl font-bold tracking-tight ${c.highlight ? "text-primary-700" : "text-ink"}`}>{c.value}</p>
                  <p className="text-xs text-ink-light mt-1.5">{c.sub}</p>
                </div>
              );
            })}

            {/* Row 2: Login activity chart */}
            <div className="col-span-12 lg:col-span-8">
              <ChartAreaCard
                title="Login Activity"
                subtitle="7-day overview"
                data={loginChart}
                dataKey="logins"
                formatValue={(v) => `${v} logins`}
              />
            </div>

            {/* Row 2: Message status donut */}
            <div className="col-span-12 lg:col-span-4">
              {donutData.length > 0 ? (
                <DonutChartCard
                  title="Message Status"
                  subtitle="All-time delivery breakdown"
                  data={donutData}
                  formatValue={(v) => `${v} messages`}
                />
              ) : (
                <div className="bg-surface-card rounded-2xl shadow-card p-6 h-full flex flex-col items-center justify-center text-center">
                  <Send size={32} className="text-gray-200 mb-2" />
                  <p className="text-sm font-medium text-ink-muted">No message data</p>
                  <p className="text-xs text-ink-light mt-1 max-w-[160px]">Send broadcasts to see delivery stats</p>
                </div>
              )}
            </div>

            {/* Row 3: Delivery performance */}
            <div className="col-span-12 lg:col-span-4">
              <div className="bg-surface-card rounded-2xl shadow-card p-6 transition-all hover:shadow-md h-full">
                <p className="text-sm font-semibold text-ink mb-4">Delivery Performance</p>
                <ProgressBarList items={progressItems} />
              </div>
            </div>

            {/* Row 3: Login activity summary */}
            <div className="col-span-12 lg:col-span-8">
              <div className="bg-surface-card rounded-2xl shadow-card p-6 transition-all hover:shadow-md h-full">
                <p className="text-sm font-semibold text-ink mb-4">Platform Summary</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-ink-muted">Total Users</p>
                    <p className="text-2xl font-bold text-ink">{stats.users.total}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-muted">WA Connected</p>
                    <p className="text-2xl font-bold text-primary-600">{stats.wa_sessions.connected_realtime}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-muted">Blasts Today</p>
                    <p className="text-2xl font-bold text-ink">{stats.messaging.total_blasts}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-muted">Total Msgs</p>
                    <p className="text-2xl font-bold text-ink">{stats.messaging.total_blast_messages}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-muted">24h Logins</p>
                    <p className="text-2xl font-bold text-ink">{stats.login_activity.last_24h}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-muted">Replied</p>
                    <p className="text-2xl font-bold text-purple-600">{stats.messaging.replied}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
