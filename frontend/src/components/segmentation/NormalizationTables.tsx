"use client";

import { ATTRS, ATTR_LABELS, STATUS_LABELS, type NormReport, type NormStatus, type SimilarPair, type Attr } from "@/lib/segmentation";

const STATUS_STYLE: Record<NormStatus, string> = {
  canonical: "bg-gray-100 text-gray-600",
  mapped: "bg-primary-100 text-primary-700",
  ambiguous: "bg-amber-100 text-amber-800",
  unrecognized: "bg-blue-50 text-blue-700",
  missing: "bg-red-50 text-red-600",
};

interface Props {
  report: NormReport;
  similar?: Record<Attr, SimilarPair[]>;
  /** ringkas: tampilkan lebih sedikit baris (dipakai di pratinjau import) */
  compact?: boolean;
}

/**
 * Laporan normalisasi per variabel: nilai asli → nilai baku (+ jumlah & status), nilai yang tidak ada di
 * kamus (dibiarkan apa adanya), dan pasangan nilai mirip (kemungkinan typo, TIDAK digabung otomatis).
 */
export default function NormalizationTables({ report, similar, compact }: Props) {
  const limit = compact ? 6 : 40;
  const shown = ATTRS.filter((a) => report[a] && (report[a]!.changes.length > 0 || report[a]!.unrecognized.length > 0 || (similar?.[a]?.length ?? 0) > 0));

  if (shown.length === 0) {
    return <p className="text-sm text-ink-muted">Tidak ada nilai yang perlu dibakukan — seluruh nilai sudah seragam.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Normalisasi kategori (sebelum One-Hot Encoding)</p>
      {shown.map((attr) => {
        const r = report[attr]!;
        const pairs = similar?.[attr] ?? [];
        return (
          <details key={attr} open={!compact || r.changes.length > 0} className="border border-gray-100 rounded-xl">
            <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-ink flex items-center gap-2 flex-wrap">
              {ATTR_LABELS[attr]}
              {(Object.keys(r.totals) as NormStatus[]).filter((s) => s !== "canonical" || compact === false).map((s) => (
                <span key={s} className={`text-[11px] px-2 py-0.5 rounded-full font-normal ${STATUS_STYLE[s]}`}>
                  {STATUS_LABELS[s]}: {r.totals[s]}
                </span>
              ))}
            </summary>

            <div className="px-4 pb-4 space-y-4">
              {r.changes.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-ink-muted">
                      <tr className="border-b border-gray-100">
                        <th className="text-left font-medium py-1.5 pr-3">Nilai asli</th>
                        <th className="text-left font-medium py-1.5 pr-3">Menjadi (baku)</th>
                        <th className="text-left font-medium py-1.5 pr-3">Status</th>
                        <th className="text-right font-medium py-1.5">Jumlah</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.changes.slice(0, limit).map((c, i) => (
                        <tr key={i} className="border-b border-gray-50 last:border-0">
                          <td className="py-1.5 pr-3 text-ink">{c.original}</td>
                          <td className="py-1.5 pr-3 font-medium text-ink">{c.value}</td>
                          <td className="py-1.5 pr-3"><span className={`px-2 py-0.5 rounded-full ${STATUS_STYLE[c.status]}`}>{STATUS_LABELS[c.status]}</span></td>
                          <td className="py-1.5 text-right tabular-nums">{c.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {r.changes.length > limit && <p className="text-[11px] text-ink-light mt-1">+{r.changes.length - limit} pemetaan lain</p>}
                </div>
              )}

              {r.unrecognized.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-ink-muted mb-1.5">Tidak ada di kamus — dibiarkan apa adanya ({r.unrecognized.length} nilai)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {r.unrecognized.slice(0, compact ? 12 : 40).map((u) => (
                      <span key={u.value} className="text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{u.value} <span className="opacity-60">×{u.count}</span></span>
                    ))}
                  </div>
                </div>
              )}

              {pairs.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-amber-800 mb-1.5">Kemungkinan typo — mirip tetapi TIDAK digabung otomatis (mohon ditinjau)</p>
                  <ul className="space-y-1">
                    {pairs.slice(0, 10).map((p, i) => (
                      <li key={i} className="text-xs text-ink">
                        <strong>{p.value}</strong> <span className="text-ink-muted">({p.count})</span> ≈ {p.similar_to} <span className="text-ink-muted">({p.similar_count})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}
