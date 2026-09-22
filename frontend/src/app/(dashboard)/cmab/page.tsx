"use client";

import { useEffect, useState } from "react";
import { Brain, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import ProgressBarList from "@/components/ui/ProgressBarList";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { formatContext, type CmabDecision, type CmabPerformanceRow } from "@/lib/cmab";

export default function CmabPage() {
  const [performance, setPerformance] = useState<CmabPerformanceRow[] | null>(null);
  const [decision, setDecision] = useState<CmabDecision | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [perf, latest] = await Promise.all([
          api.get<{ performance: CmabPerformanceRow[] }>("/api/cmab/performance"),
          api.get<{ decision: CmabDecision | null }>("/api/cmab/decisions/latest"),
        ]);
        setPerformance(perf.performance);
        setDecision(latest.decision);
      } catch (err: any) {
        setError(err?.body?.error || "Gagal memuat data CMAB");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const bestReward = performance?.[0]?.avg_reward ?? null;

  return (
    <DashboardLayout>
      <div className="p-6 lg:p-8 max-w-5xl mx-auto">
        <PageHeader
          title="CMAB"
          subtitle="Rekomendasi template WhatsApp berbasis Contextual Multi-Armed Bandit (LinUCB)"
        />

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-2xl px-5 py-3 mb-6">{error}</div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SkeletonCard /><SkeletonCard />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard title="Template Dipantau" value={performance?.length ?? 0} subtitle="arm CMAB" />
              <StatCard
                title="Reward Terbaik"
                value={bestReward != null ? bestReward.toFixed(2) : "—"}
                subtitle={performance?.[0]?.template_name || "belum ada data"}
                highlighted
              />
              <StatCard
                title="Total Observasi"
                value={performance?.reduce((s, p) => s + p.observation_count, 0) ?? 0}
                subtitle="campaign yang sudah dipelajari"
              />
            </div>

            {/* Latest Decision */}
            <div className="bg-surface-card rounded-2xl shadow-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles size={16} className="text-primary-600" />
                <p className="text-sm font-semibold text-ink">Latest Decision</p>
              </div>
              {decision ? (
                <div className="space-y-2 text-sm">
                  <p className="text-ink-muted">Context: <span className="text-ink font-medium">{formatContext(decision.context)}</span></p>
                  <p className="text-ink-muted">
                    Direkomendasikan: <span className="text-ink font-medium">{decision.recommended_template_name || `Template #${decision.recommended_template_id}`}</span>
                  </p>
                  {decision.selected_template_id && decision.selected_template_id !== decision.recommended_template_id && (
                    <p className="text-ink-muted">
                      Dipakai (diganti manual): <span className="text-ink font-medium">{decision.selected_template_name}</span>
                    </p>
                  )}
                  <p className="text-ink-muted">
                    Reward:{" "}
                    {decision.reward != null ? (
                      <span className="text-primary-700 font-semibold">{Number(decision.reward).toFixed(2)}</span>
                    ) : (
                      <span className="text-ink-light">menunggu hasil pengiriman…</span>
                    )}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-ink-muted">Belum ada rekomendasi. Buka New Broadcast untuk mendapatkan rekomendasi pertama.</p>
              )}
            </div>

            {/* Current Performance */}
            <div className="bg-surface-card rounded-2xl shadow-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Brain size={16} className="text-primary-600" />
                <p className="text-sm font-semibold text-ink">Current Performance</p>
              </div>
              {performance && performance.length > 0 ? (
                <ProgressBarList
                  items={performance.map((p) => ({
                    label: `${p.template_name} (${p.observation_count}x)`,
                    value: p.avg_reward != null ? Math.round(p.avg_reward * 100) : 0,
                    max: 100,
                    suffix: p.avg_reward != null ? `% (avg reward ${p.avg_reward.toFixed(2)})` : " — belum ada observasi",
                  }))}
                />
              ) : (
                <p className="text-sm text-ink-muted">Belum ada template atau belum ada campaign yang selesai dipelajari.</p>
              )}
            </div>

            <p className="text-[11px] text-ink-light leading-relaxed">
              Catatan: reward dihitung dari delivered/read/reply campaign (0.2/0.3/0.5), beberapa jam setelah broadcast selesai
              supaya hasil pengiriman sempat tercatat. Semakin banyak campaign, rekomendasi semakin akurat.
            </p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
