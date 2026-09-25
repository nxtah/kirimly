"use client";

import { Download } from "lucide-react";
import StatCard from "@/components/ui/StatCard";
import DonutChartCard from "@/components/ui/DonutChartCard";
import { downloadCsv, num } from "@/lib/csv";
import { ATTRS, ATTR_LABELS, type RunDetail } from "@/lib/segmentation";

export const CLUSTER_COLORS = ["#22C55E", "#38BDF8", "#FBBF24", "#A78BFA", "#F87171", "#14B8A6", "#F97316", "#EC4899", "#64748B", "#84CC16"];
export const colorOf = (no: number) => CLUSTER_COLORS[(no - 1) % CLUSTER_COLORS.length];

/** Hasil Segmentasi: K, jumlah data, jumlah cluster, anggota & persentase, SSE, Silhouette, DBI. */
export default function ClusterResult({ run }: { run: RunDetail }) {
  const total = run.segments.reduce((s, x) => s + x.size, 0) || run.n_samples;
  const pre = run.preprocessing;

  function exportCsv() {
    downloadCsv(`hasil-cluster-run-${run.id}.csv`, [
      ["K", "Jumlah_data", "Inertia_SSE", "Silhouette", "Davies_Bouldin"],
      [run.k, run.n_samples, num(run.inertia), num(run.silhouette), num(run.davies_bouldin)],
      [],
      ["Cluster", "Jumlah_anggota", "Persentase", ...ATTRS.map((a) => `Dominan_${ATTR_LABELS[a]}`)],
      ...run.segments.map((s) => [s.cluster_no, s.size, ((s.size / total) * 100).toFixed(1), ...ATTRS.map((a) => s.profile.dominant[a] ?? "")]),
    ]);
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm font-semibold text-ink">Hasil Segmentasi</p>
        <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-ink-muted bg-surface-card rounded-xl border border-gray-200 hover:bg-gray-50">
          <Download size={13} /> CSV
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard title="K Digunakan" value={run.k} highlighted />
        <StatCard title="Data Diproses" value={run.n_samples} subtitle={pre ? `${pre.imputed_missing ?? 0} baris missing diimputasi` : undefined} />
        <StatCard title="Jumlah Cluster" value={run.segments.length} />
        <StatCard title="Inertia / SSE" value={run.inertia != null ? run.inertia.toFixed(2) : "—"} subtitle="lebih kecil lebih rapat" />
        <StatCard title="Silhouette" value={run.silhouette != null ? run.silhouette.toFixed(3) : "—"} subtitle="mendekati 1 = terpisah jelas" />
        <StatCard title="Davies-Bouldin" value={run.davies_bouldin != null ? run.davies_bouldin.toFixed(3) : "—"} subtitle="lebih kecil lebih baik" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <DonutChartCard
          title="Proporsi Cluster"
          subtitle="Jumlah anggota per cluster"
          data={run.segments.map((s) => ({ name: `Cluster ${s.cluster_no}`, value: s.size, color: colorOf(s.cluster_no) }))}
          formatValue={(v) => `${v} anggota`}
        />
        <div className="lg:col-span-2 bg-surface-card rounded-2xl shadow-card p-5">
          <p className="text-sm font-semibold text-ink mb-4">Jumlah &amp; Persentase Anggota</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-muted">
                <tr className="border-b border-gray-100">
                  <th className="text-left font-medium px-3 py-2">Cluster</th>
                  <th className="text-right font-medium px-3 py-2">Anggota</th>
                  <th className="text-right font-medium px-3 py-2">Persentase</th>
                  <th className="text-left font-medium px-3 py-2 w-1/3">Proporsi</th>
                </tr>
              </thead>
              <tbody>
                {run.segments.map((s) => {
                  const pct = (s.size / total) * 100;
                  return (
                    <tr key={s.cluster_no} className="border-b border-gray-50 last:border-0">
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-2 font-semibold text-ink">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colorOf(s.cluster_no) }} /> Cluster {s.cluster_no}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium">{s.size}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{pct.toFixed(1)}%</td>
                      <td className="px-3 py-2.5">
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: colorOf(s.cluster_no) }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="text-xs text-ink-muted">
                  <td className="px-3 pt-2">Total</td>
                  <td className="px-3 pt-2 text-right tabular-nums">{total}</td>
                  <td className="px-3 pt-2 text-right">100%</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          {pre && (
            <p className="text-[11px] text-ink-light mt-3">
              {pre.feature_count} fitur One-Hot dari 4 variabel · {pre.total_prospects} data tersimpan · {pre.imputed_missing ?? 0} baris missing diimputasi &quot;Tidak Diketahui&quot;.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
