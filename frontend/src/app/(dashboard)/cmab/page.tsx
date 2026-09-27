"use client";

import { useEffect, useState } from "react";
import { Brain, Sparkles, FlaskConical, History, ChevronLeft, ChevronRight, Loader2, Download, Info } from "lucide-react";
import { api, getToken } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import ProgressBarList from "@/components/ui/ProgressBarList";
import { SkeletonCard } from "@/components/ui/Skeleton";
import RewardCurveChart from "@/components/cmab/RewardCurveChart";
import {
  formatContext,
  type CmabDecision,
  type CmabPerformanceRow,
  type CmabSummary,
  type Pagination,
  type CmabRewardPoint,
  type CmabEvaluationResult,
  type CmabEvaluationConfig,
  type CmabEvaluationSummary,
} from "@/lib/cmab";

const DECISIONS_PER_PAGE = 10;
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

function pct(v: number | null) {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

function fmt(v: number) {
  return v.toFixed(3);
}

/** Unduh file dari endpoint export CMAB (butuh Authorization header, jadi tidak bisa <a href> polos). */
async function downloadEvaluation(id: number, format: "csv" | "json") {
  const token = getToken();
  const res = await fetch(`${API_BASE}/api/cmab/evaluations/${id}/export?format=${format}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cmab-evaluation-${id}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function CmabPage() {
  const [summary, setSummary] = useState<CmabSummary | null>(null);
  const [performance, setPerformance] = useState<CmabPerformanceRow[] | null>(null);
  const [decision, setDecision] = useState<CmabDecision | null>(null);
  const [series, setSeries] = useState<CmabRewardPoint[] | null>(null);
  const [decisions, setDecisions] = useState<CmabDecision[] | null>(null);
  const [decisionsPagination, setDecisionsPagination] = useState<Pagination | null>(null);
  const [decisionsPage, setDecisionsPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [evalConfig, setEvalConfig] = useState<CmabEvaluationConfig | null>(null);
  const [showSchema, setShowSchema] = useState(false);
  const [alphaInput, setAlphaInput] = useState("");
  const [nContextsInput, setNContextsInput] = useState("");
  const [nTrialsInput, setNTrialsInput] = useState("");
  const [seedInput, setSeedInput] = useState("");
  const [evalResult, setEvalResult] = useState<CmabEvaluationResult | null>(null);
  const [evalRunning, setEvalRunning] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evalHistory, setEvalHistory] = useState<CmabEvaluationSummary[] | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [s, perf, latest, rs] = await Promise.all([
          api.get<CmabSummary>("/api/cmab/summary"),
          api.get<{ performance: CmabPerformanceRow[] }>("/api/cmab/performance"),
          api.get<{ decision: CmabDecision | null }>("/api/cmab/decisions/latest"),
          api.get<{ series: CmabRewardPoint[] }>("/api/cmab/reward-timeseries"),
        ]);
        setSummary(s);
        setPerformance(perf.performance);
        setDecision(latest.decision);
        setSeries(rs.series);
      } catch (err: any) {
        setError(err?.body?.error || "Gagal memuat data CMAB");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    async function loadDecisions() {
      try {
        const r = await api.get<{ decisions: CmabDecision[]; pagination: Pagination }>("/api/cmab/decisions", {
          params: { page: decisionsPage, limit: DECISIONS_PER_PAGE },
        });
        setDecisions(r.decisions);
        setDecisionsPagination(r.pagination);
      } catch {
        // riwayat opsional — abaikan, section lain tetap tampil
      }
    }
    loadDecisions();
  }, [decisionsPage]);

  useEffect(() => {
    async function loadEvalConfig() {
      try {
        const cfg = await api.get<CmabEvaluationConfig>("/api/cmab/evaluation-config");
        setEvalConfig(cfg);
      } catch {
        // dokumentasi opsional — tombol Jalankan Simulasi tetap berfungsi dengan default
      }
    }
    loadEvalConfig();
  }, []);

  async function loadEvalHistory() {
    try {
      const r = await api.get<{ evaluations: CmabEvaluationSummary[] }>("/api/cmab/evaluations", { params: { limit: 5 } });
      setEvalHistory(r.evaluations);
    } catch {
      // riwayat opsional
    }
  }

  useEffect(() => { loadEvalHistory(); }, []);

  async function runSimulation() {
    setEvalRunning(true);
    setEvalError(null);
    try {
      const body: Record<string, number> = {};
      if (alphaInput.trim()) body.alpha = Number(alphaInput);
      if (nContextsInput.trim()) body.n_contexts = Number(nContextsInput);
      if (nTrialsInput.trim()) body.n_trials = Number(nTrialsInput);
      if (seedInput.trim()) body.seed = Number(seedInput);
      const r = await api.post<CmabEvaluationResult>("/api/cmab/evaluate", body);
      setEvalResult(r);
      loadEvalHistory();
    } catch (err: any) {
      setEvalError(err?.body?.error || "Simulasi gagal dijalankan");
    } finally {
      setEvalRunning(false);
    }
  }

  return (
    <DashboardLayout>
      <div className="p-6 lg:p-8 max-w-6xl mx-auto">
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
            {/* Ringkasan */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard title="Arm (Template)" value={summary?.arms ?? 0} subtitle="dipantau LinUCB" />
              <StatCard title="Total Keputusan" value={summary?.decisions ?? 0} subtitle="rekomendasi diminta" />
              <StatCard title="Observasi" value={summary?.observations ?? 0} subtitle="campaign yang sudah dipelajari" highlighted />
              <StatCard title="Reward Pending" value={summary?.pending_rewards ?? 0} subtitle="menunggu dihitung" />
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
                  {decision.manual_override && (
                    <p className="text-ink-muted">
                      Dipakai (diganti manual): <span className="text-ink font-medium">{decision.selected_template_name}</span>
                    </p>
                  )}
                  <p className="text-ink-muted flex items-center gap-2">
                    Reward:{" "}
                    {decision.reward != null ? (
                      <span className="text-primary-700 font-semibold">{Number(decision.reward).toFixed(2)}</span>
                    ) : (
                      <span className="text-ink-light">menunggu hasil pengiriman…</span>
                    )}
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                      decision.reward_status === "computed" ? "bg-primary-100 text-primary-700" : "bg-amber-100 text-amber-700"
                    }`}>
                      {decision.reward_status === "computed" ? "computed" : "pending"}
                    </span>
                  </p>
                </div>
              ) : (
                <p className="text-sm text-ink-muted">Belum ada rekomendasi. Buka New Broadcast untuk mendapatkan rekomendasi pertama.</p>
              )}
            </div>

            {/* Performa per template + breakdown */}
            <div className="bg-surface-card rounded-2xl shadow-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Brain size={16} className="text-primary-600" />
                <p className="text-sm font-semibold text-ink">Performa per Template</p>
              </div>
              {performance && performance.length > 0 ? (
                <>
                  <ProgressBarList
                    className="mb-5"
                    items={performance.map((p) => ({
                      label: `${p.template_name} (${p.observation_count}x)`,
                      value: p.avg_reward != null ? Math.round(p.avg_reward * 100) : 0,
                      max: 100,
                      suffix: p.avg_reward != null ? `% (avg reward ${p.avg_reward.toFixed(2)})` : " — belum ada observasi",
                    }))}
                  />
                  <div className="overflow-x-auto -mx-5 px-5">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-ink-light border-b border-gray-100">
                          <th className="text-left font-medium py-2 pr-3">Template</th>
                          <th className="text-right font-medium py-2 px-2">Terkirim</th>
                          <th className="text-right font-medium py-2 px-2">Delivered</th>
                          <th className="text-right font-medium py-2 px-2">Read</th>
                          <th className="text-right font-medium py-2 px-2">Replied</th>
                          <th className="text-right font-medium py-2 px-2">Failed</th>
                          <th className="text-right font-medium py-2 pl-2">Override rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {performance.map((p) => (
                          <tr key={p.template_id} className="border-b border-gray-50 last:border-0">
                            <td className="py-2 pr-3 text-ink font-medium">{p.template_name}</td>
                            <td className="py-2 px-2 text-right text-ink-muted">{p.total_contacts}</td>
                            <td className="py-2 px-2 text-right text-ink-muted">{p.delivered_count}</td>
                            <td className="py-2 px-2 text-right text-ink-muted">{p.read_count}</td>
                            <td className="py-2 px-2 text-right text-ink-muted">{p.replied_count}</td>
                            <td className="py-2 px-2 text-right text-ink-muted">{p.failed_count}</td>
                            <td className="py-2 pl-2 text-right text-ink-muted">{pct(p.override_rate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="text-sm text-ink-muted">Belum ada template atau belum ada campaign yang selesai dipelajari.</p>
              )}
            </div>

            {/* Grafik cumulative average reward (data nyata) */}
            <div className="bg-surface-card rounded-2xl shadow-card p-5">
              <div className="flex items-center gap-2 mb-2">
                <Brain size={16} className="text-primary-600" />
                <p className="text-sm font-semibold text-ink">Cumulative Average Reward</p>
              </div>
              {series && series.length > 0 ? (
                <RewardCurveChart series={[{ label: "Reward rata-rata", color: "#22C55E", values: series.map((s) => s.cumulative_avg_reward) }]} xLabel="Campaign ke-" />
              ) : (
                <p className="text-sm text-ink-muted">Belum ada reward yang dihitung. Grafik akan terisi begitu campaign selesai & delay reward terlewati.</p>
              )}
            </div>

            {/* Riwayat keputusan berpaginasi */}
            <div className="bg-surface-card rounded-2xl shadow-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <History size={16} className="text-primary-600" />
                  <p className="text-sm font-semibold text-ink">Riwayat Keputusan</p>
                </div>
                {decisionsPagination && (
                  <div className="flex items-center gap-2 text-xs text-ink-muted">
                    <button onClick={() => setDecisionsPage((p) => Math.max(1, p - 1))} disabled={decisionsPage <= 1}
                      className="p-1 rounded-lg hover:bg-gray-100 disabled:opacity-30"><ChevronLeft size={14} /></button>
                    Hal {decisionsPagination.page} / {Math.max(1, decisionsPagination.total_pages)}
                    <button onClick={() => setDecisionsPage((p) => (decisionsPagination && p < decisionsPagination.total_pages ? p + 1 : p))}
                      disabled={!decisionsPagination || decisionsPage >= decisionsPagination.total_pages}
                      className="p-1 rounded-lg hover:bg-gray-100 disabled:opacity-30"><ChevronRight size={14} /></button>
                  </div>
                )}
              </div>
              {decisions && decisions.length > 0 ? (
                <div className="overflow-x-auto -mx-5 px-5">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-ink-light border-b border-gray-100">
                        <th className="text-left font-medium py-2 pr-3">Waktu</th>
                        <th className="text-left font-medium py-2 px-2">Context</th>
                        <th className="text-left font-medium py-2 px-2">Direkomendasikan</th>
                        <th className="text-left font-medium py-2 px-2">Dipakai</th>
                        <th className="text-center font-medium py-2 px-2">Override</th>
                        <th className="text-right font-medium py-2 px-2">Reward</th>
                        <th className="text-center font-medium py-2 pl-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {decisions.map((d) => (
                        <tr key={d.id} className="border-b border-gray-50 last:border-0">
                          <td className="py-2 pr-3 text-ink-muted whitespace-nowrap">{new Date(d.decided_at).toLocaleString("id-ID")}</td>
                          <td className="py-2 px-2 text-ink-muted whitespace-nowrap">{formatContext(d.context)}</td>
                          <td className="py-2 px-2 text-ink">{d.recommended_template_name || "—"}</td>
                          <td className="py-2 px-2 text-ink">{d.selected_template_name || "—"}</td>
                          <td className="py-2 px-2 text-center">
                            {d.manual_override == null ? "—" : d.manual_override ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">ya</span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">tidak</span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-right text-ink-muted">{d.reward != null ? d.reward.toFixed(2) : "—"}</td>
                          <td className="py-2 pl-2 text-center">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                              d.reward_status === "computed" ? "bg-primary-100 text-primary-700" : "bg-gray-100 text-gray-600"
                            }`}>{d.reward_status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-ink-muted">Belum ada riwayat keputusan.</p>
              )}
            </div>

            {/* Evaluation mode — Data Simulasi, terpisah tegas dari performa nyata di atas */}
            <div className="rounded-2xl border-2 border-dashed border-violet-300 bg-violet-50/50 p-5">
              <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <FlaskConical size={16} className="text-violet-600" />
                  <p className="text-sm font-semibold text-violet-900">Evaluation Mode</p>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-600 text-white font-semibold tracking-wide">DATA SIMULASI</span>
                </div>
              </div>
              <p className="text-xs text-violet-700 mb-4">
                Bukan data kampanye nyata — context & 3 arm (Informatif/Persuasif/Urgency) SINTETIS dipakai untuk
                membandingkan LinUCB dengan strategi statis (memilih template favorit tanpa mempertimbangkan context).
                Tidak pernah menulis ke template atau model CMAB Anda yang sesungguhnya.
              </p>

              {/* Dokumentasi: mapping context vector, mekanisme arm/reward, definisi baseline & regret */}
              {evalConfig && (
                <div className="bg-white/70 rounded-xl p-4 mb-4 text-xs text-violet-900 space-y-2">
                  <button onClick={() => setShowSchema((v) => !v)} className="flex items-center gap-1.5 font-semibold hover:underline">
                    <Info size={13} /> Context vector: {evalConfig.context_schema.dimension} dimensi ({showSchema ? "sembunyikan" : "lihat"} mapping & encoding)
                  </button>
                  {showSchema && (
                    <div className="overflow-x-auto max-h-56 overflow-y-auto border border-violet-100 rounded-lg mt-2">
                      <table className="w-full text-[11px]">
                        <thead className="sticky top-0 bg-violet-50">
                          <tr className="text-violet-700">
                            <th className="text-left font-medium py-1.5 px-2">Idx</th>
                            <th className="text-left font-medium py-1.5 px-2">Kelompok</th>
                            <th className="text-left font-medium py-1.5 px-2">Label</th>
                            <th className="text-left font-medium py-1.5 px-2">Encoding</th>
                          </tr>
                        </thead>
                        <tbody>
                          {evalConfig.context_schema.dims.map((d) => (
                            <tr key={d.index} className="border-t border-violet-50">
                              <td className="py-1 px-2 text-violet-500">{d.index}</td>
                              <td className="py-1 px-2">{d.group}</td>
                              <td className="py-1 px-2">{d.label}</td>
                              <td className="py-1 px-2 text-violet-600">{d.encoding}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="pt-1">
                    <strong>Mekanisme:</strong> tiap arm sintetis punya rate dasar delivered/read/replied yang{" "}
                    <strong>sama persis</strong> di ketiga arm, plus bonus bila jam pengiriman & audience context cocok
                    dengan preferensinya — supaya keunggulan hanya bisa didapat dengan benar-benar memakai context.
                  </p>
                  <p><strong>Reward simulasi:</strong> {evalConfig.reward_formula.simulation} ({evalConfig.reward_formula.production})</p>
                  <p><strong>Baseline statis:</strong> {evalConfig.baseline_definition}</p>
                  <p><strong>Regret:</strong> {evalConfig.regret_formula}</p>
                </div>
              )}

              {/* Parameter simulasi */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                <label className="text-[11px] text-violet-700 font-medium">
                  Alpha
                  <input type="number" step="0.05" min="0" max="5" value={alphaInput}
                    onChange={(e) => setAlphaInput(e.target.value)}
                    placeholder={evalConfig ? String(evalConfig.default_alpha) : "0.3"}
                    className="mt-1 w-full rounded-lg border border-violet-200 px-2 py-1.5 text-xs text-ink" />
                </label>
                <label className="text-[11px] text-violet-700 font-medium">
                  Jumlah context
                  <input type="number" min={evalConfig?.bounds.min_contexts ?? 100} max={evalConfig?.bounds.max_contexts ?? 300} value={nContextsInput}
                    onChange={(e) => setNContextsInput(e.target.value)}
                    placeholder={String(evalConfig?.bounds.min_contexts ?? 100)}
                    className="mt-1 w-full rounded-lg border border-violet-200 px-2 py-1.5 text-xs text-ink" />
                </label>
                <label className="text-[11px] text-violet-700 font-medium">
                  Jumlah percobaan (≥{evalConfig?.bounds.min_trials ?? 30})
                  <input type="number" min={evalConfig?.bounds.min_trials ?? 30} max={evalConfig?.bounds.max_trials ?? 60} value={nTrialsInput}
                    onChange={(e) => setNTrialsInput(e.target.value)}
                    placeholder={String(evalConfig?.bounds.min_trials ?? 30)}
                    className="mt-1 w-full rounded-lg border border-violet-200 px-2 py-1.5 text-xs text-ink" />
                </label>
                <label className="text-[11px] text-violet-700 font-medium">
                  Seed (opsional)
                  <input type="number" value={seedInput} onChange={(e) => setSeedInput(e.target.value)}
                    placeholder="acak"
                    className="mt-1 w-full rounded-lg border border-violet-200 px-2 py-1.5 text-xs text-ink" />
                </label>
              </div>
              <button onClick={runSimulation} disabled={evalRunning}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-violet-600 rounded-xl hover:bg-violet-700 disabled:opacity-50 transition-all mb-4">
                {evalRunning ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />}
                {evalRunning ? "Menjalankan… (bisa sampai ~20 detik)" : "Jalankan Simulasi"}
              </button>

              {evalError && <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-4 py-2 mb-3">{evalError}</div>}

              {evalResult ? (
                <div className="space-y-4">
                  <p className="text-[11px] text-violet-700">
                    Konfigurasi: alpha={evalResult.config.alpha}, {evalResult.config.n_contexts} context/trial,{" "}
                    {evalResult.config.n_trials} trial, seed={evalResult.config.seed}
                  </p>
                  <RewardCurveChart
                    xLabel="Context ke-"
                    series={[
                      { label: "LinUCB (kontekstual)", color: "#7C3AED", values: evalResult.linucb.cumulative_avg_curve },
                      { label: "Baseline statis", color: "#9CA3AF", values: evalResult.baseline.cumulative_avg_curve },
                    ]}
                  />
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-center">
                    <div className="bg-white/70 rounded-xl p-3">
                      <p className="text-[11px] text-violet-700 font-medium">LinUCB (mean ± std, {evalResult.config.n_trials} trial)</p>
                      <p className="text-lg font-bold text-violet-900">{fmt(evalResult.linucb.mean_total)} ± {fmt(evalResult.linucb.std_total)}</p>
                      <p className="text-[10px] text-violet-600">CI95 [{fmt(evalResult.linucb.ci95[0])}, {fmt(evalResult.linucb.ci95[1])}]</p>
                    </div>
                    <div className="bg-white/70 rounded-xl p-3">
                      <p className="text-[11px] text-violet-700 font-medium">Baseline (mean ± std)</p>
                      <p className="text-lg font-bold text-violet-900">{fmt(evalResult.baseline.mean_total)} ± {fmt(evalResult.baseline.std_total)}</p>
                      <p className="text-[10px] text-violet-600">CI95 [{fmt(evalResult.baseline.ci95[0])}, {fmt(evalResult.baseline.ci95[1])}]</p>
                    </div>
                    <div className="bg-white/70 rounded-xl p-3">
                      <p className="text-[11px] text-violet-700 font-medium">Peningkatan LinUCB</p>
                      <p className={`text-lg font-bold ${(evalResult.improvement_pct ?? 0) >= 0 ? "text-violet-900" : "text-red-600"}`}>
                        {evalResult.improvement_pct != null ? `${evalResult.improvement_pct >= 0 ? "+" : ""}${evalResult.improvement_pct.toFixed(1)}%` : "—"}
                      </p>
                    </div>
                    <div className="bg-white/70 rounded-xl p-3 col-span-2 sm:col-span-3">
                      <p className="text-[11px] text-violet-700 font-medium">Rata-rata regret di seluruh percobaan</p>
                      <p className="text-lg font-bold text-violet-900">{fmt(evalResult.avg_regret)} ± {fmt(evalResult.std_regret)}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button onClick={() => downloadEvaluation(evalResult.id, "csv")}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-violet-700 bg-white rounded-lg border border-violet-200 hover:bg-violet-50">
                      <Download size={12} /> Unduh CSV
                    </button>
                    <button onClick={() => downloadEvaluation(evalResult.id, "json")}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-violet-700 bg-white rounded-lg border border-violet-200 hover:bg-violet-50">
                      <Download size={12} /> Unduh JSON
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-violet-600">Belum ada hasil simulasi pada sesi ini — klik &quot;Jalankan Simulasi&quot;.</p>
              )}

              {/* Riwayat evaluasi */}
              {evalHistory && evalHistory.length > 0 && (
                <div className="mt-5 pt-4 border-t border-violet-200">
                  <p className="text-xs font-semibold text-violet-900 mb-2">Riwayat Simulasi (5 terakhir)</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-violet-700">
                          <th className="text-left font-medium py-1.5 pr-2">Waktu</th>
                          <th className="text-right font-medium py-1.5 px-2">Trial</th>
                          <th className="text-right font-medium py-1.5 px-2">LinUCB</th>
                          <th className="text-right font-medium py-1.5 px-2">Baseline</th>
                          <th className="text-right font-medium py-1.5 px-2">Peningkatan</th>
                          <th className="text-right font-medium py-1.5 pl-2">Unduh</th>
                        </tr>
                      </thead>
                      <tbody>
                        {evalHistory.map((ev) => (
                          <tr key={ev.id} className="border-t border-violet-100">
                            <td className="py-1.5 pr-2 text-violet-800 whitespace-nowrap">{new Date(ev.created_at || "").toLocaleString("id-ID")}</td>
                            <td className="py-1.5 px-2 text-right text-violet-800">{ev.config.n_trials}</td>
                            <td className="py-1.5 px-2 text-right text-violet-800">{fmt(ev.linucb.mean_total)}</td>
                            <td className="py-1.5 px-2 text-right text-violet-800">{fmt(ev.baseline.mean_total)}</td>
                            <td className="py-1.5 px-2 text-right text-violet-800">{ev.improvement_pct != null ? `${ev.improvement_pct.toFixed(1)}%` : "—"}</td>
                            <td className="py-1.5 pl-2 text-right">
                              <button onClick={() => downloadEvaluation(ev.id, "csv")} className="text-violet-600 hover:underline">CSV</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
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
