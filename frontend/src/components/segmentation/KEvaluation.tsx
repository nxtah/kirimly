"use client";

import { Download, Play, Info, AlertTriangle, CheckCircle2 } from "lucide-react";
import ElbowChart from "./ElbowChart";
import { downloadCsv, num } from "@/lib/csv";
import type { SuggestResult } from "@/lib/segmentation";

interface KEvaluationProps {
  result: SuggestResult | null;
  loading: boolean;
  disabled: boolean;
  disabledHint?: string;
  selectedK: number;
  onEvaluate: () => void;
  onPickK: (k: number) => void;
}

const METRIC_LABEL: Record<string, string> = { elbow: "Elbow", silhouette: "Silhouette", davies_bouldin: "Davies-Bouldin" };
const AGREEMENT: Record<string, { text: string; style: string }> = {
  all: { text: "Semua metrik sepakat", style: "bg-primary-100 text-primary-700" },
  majority: { text: "Mayoritas metrik sepakat", style: "bg-blue-100 text-blue-700" },
  none: { text: "Metrik tidak sepakat — keputusan di tangan Anda", style: "bg-amber-100 text-amber-800" },
  single: { text: "Satu kandidat", style: "bg-gray-100 text-gray-600" },
};

export default function KEvaluation({ result, loading, disabled, disabledHint, selectedK, onEvaluate, onPickK }: KEvaluationProps) {
  const scores = result?.scores ?? [];
  const rec = result?.recommendation ?? null;
  const bestSil = scores.filter((s) => s.silhouette != null).sort((a, b) => (b.silhouette! - a.silhouette!) || a.k - b.k)[0]?.k;
  const bestDbi = scores.filter((s) => s.davies_bouldin != null).sort((a, b) => (a.davies_bouldin! - b.davies_bouldin!) || a.k - b.k)[0]?.k;

  function exportCsv() {
    downloadCsv("evaluasi-k.csv", [
      ["K", "Inertia_SSE", "Silhouette_Score", "Davies_Bouldin_Index", "Elbow", "Rekomendasi"],
      ...scores.map((s) => [s.k, num(s.inertia), num(s.silhouette), num(s.davies_bouldin),
        rec?.per_metric.elbow === s.k ? "ya" : "", rec?.k === s.k ? "ya" : ""]),
    ]);
  }

  return (
    <section className="bg-surface-card rounded-2xl shadow-card p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div>
          <p className="text-sm font-semibold text-ink">Evaluasi Kandidat K</p>
          <p className="text-xs text-ink-muted mt-0.5">
            K = 2 sampai 6 diuji dengan K-Means pada data yang sama. Tiga metrik dipakai bersama — bukan satu — untuk membantu memilih K.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {result && (
            <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-ink-muted bg-surface-card rounded-xl border border-gray-200 hover:bg-gray-50">
              <Download size={13} /> CSV
            </button>
          )}
          <button onClick={onEvaluate} disabled={loading || disabled}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 disabled:opacity-40 transition-all shadow-sm">
            <Play size={14} /> {loading ? "Menghitung…" : result ? "Hitung ulang" : "Evaluasi K"}
          </button>
        </div>
      </div>
      {disabled && disabledHint && <p className="flex items-center gap-1.5 text-xs text-ink-muted mt-2"><Info size={13} /> {disabledHint}</p>}

      {result && (
        <div className="mt-5 space-y-6">
          <p className="text-xs text-ink-muted">
            Dievaluasi pada <strong className="text-ink">{result.n_samples}</strong> data dengan <strong className="text-ink">{result.feature_count}</strong> fitur hasil One-Hot Encoding.
          </p>

          {/* Tabel K vs metrik */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-muted">
                <tr className="border-b border-gray-100">
                  <th className="text-left font-medium px-3 py-2">K</th>
                  <th className="text-right font-medium px-3 py-2">Inertia / SSE <span className="font-normal">(↓)</span></th>
                  <th className="text-right font-medium px-3 py-2">Silhouette <span className="font-normal">(↑)</span></th>
                  <th className="text-right font-medium px-3 py-2">Davies-Bouldin <span className="font-normal">(↓)</span></th>
                  <th className="text-left font-medium px-3 py-2">Keterangan</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {scores.map((s) => (
                  <tr key={s.k} className={`border-b border-gray-50 last:border-0 ${selectedK === s.k ? "bg-primary-50/50" : ""}`}>
                    <td className="px-3 py-2 font-semibold text-ink">{s.k}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(s.inertia, 2)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${bestSil === s.k ? "font-bold text-primary-700" : ""}`}>{num(s.silhouette, 3) || "—"}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${bestDbi === s.k ? "font-bold text-primary-700" : ""}`}>{num(s.davies_bouldin, 3) || "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {rec?.per_metric.elbow === s.k && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">Elbow</span>}
                        {bestSil === s.k && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary-100 text-primary-700">Silhouette terbaik</span>}
                        {bestDbi === s.k && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary-100 text-primary-700">DBI terbaik</span>}
                        {rec?.k === s.k && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-900 text-white">Rekomendasi</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => onPickK(s.k)} disabled={selectedK === s.k}
                        className="text-xs font-medium text-primary-600 hover:underline disabled:text-ink-light disabled:no-underline">
                        {selectedK === s.k ? "Dipilih" : "Pakai K ini"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">Elbow Method (K vs SSE)</p>
              <ElbowChart scores={scores} elbowK={rec?.per_metric.elbow ?? null} selectedK={selectedK} />
            </div>

            {rec && (
              <div>
                <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">Rekomendasi K</p>
                <div className="border border-gray-100 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-3xl font-bold text-ink">K = {rec.k}</span>
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${AGREEMENT[rec.agreement]?.style}`}>{AGREEMENT[rec.agreement]?.text}</span>
                  </div>

                  <ul className="text-sm space-y-1.5">
                    {(["elbow", "silhouette", "davies_bouldin"] as const).map((m) => (
                      <li key={m} className="flex items-center justify-between">
                        <span className="text-ink-muted">{METRIC_LABEL[m]} memilih</span>
                        <span className={`font-semibold ${rec.per_metric[m] === rec.k ? "text-primary-700" : "text-ink"}`}>
                          {rec.per_metric[m] != null ? `K = ${rec.per_metric[m]}` : "—"}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <p className={`text-xs flex items-start gap-1.5 ${rec.needs_user_decision ? "text-amber-800" : "text-ink-muted"}`}>
                    {rec.needs_user_decision ? <AlertTriangle size={13} className="shrink-0 mt-0.5" /> : <CheckCircle2 size={13} className="shrink-0 mt-0.5 text-primary-600" />}
                    {rec.rationale}
                  </p>
                  <p className="text-[11px] text-ink-light">
                    Rekomendasi hanyalah bantuan keputusan. Silhouette &amp; Davies-Bouldin berbasis jarak pada vektor One-Hot sehingga cenderung memilih K kecil;
                    pertimbangkan juga interpretasi cluster dan tujuan campaign.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
