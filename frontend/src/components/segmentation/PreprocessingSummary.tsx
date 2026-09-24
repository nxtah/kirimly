"use client";

import { Download } from "lucide-react";
import NormalizationTables from "./NormalizationTables";
import { downloadCsv } from "@/lib/csv";
import { ATTRS, ATTR_LABELS, STATUS_LABELS, type ProspectSummary } from "@/lib/segmentation";

/** Preprocessing Summary: missing per variabel + laporan normalisasi (asli → baku) + nilai mirip. */
export default function PreprocessingSummary({ summary }: { summary: ProspectSummary }) {
  const missing = summary.imports.missing;
  const hasReport = ATTRS.some((a) => summary.normalization[a]);

  function exportCsv() {
    const rows: (string | number)[][] = [["Variabel", "Nilai_asli", "Nilai_baku", "Status", "Jumlah"]];
    for (const a of ATTRS) {
      for (const c of summary.normalization[a]?.changes ?? []) rows.push([ATTR_LABELS[a], c.original, c.value, STATUS_LABELS[c.status], c.count]);
      for (const u of summary.normalization[a]?.unrecognized ?? []) rows.push([ATTR_LABELS[a], u.value, u.value, STATUS_LABELS.unrecognized, u.count]);
      for (const p of summary.similar_values[a] ?? []) rows.push([ATTR_LABELS[a], p.value, p.similar_to, "Kemungkinan typo (tidak digabung)", p.count]);
    }
    downloadCsv("preprocessing-normalisasi.csv", rows);
  }

  return (
    <section className="bg-surface-card rounded-2xl shadow-card p-5 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-ink">Preprocessing Summary</p>
          <p className="text-xs text-ink-muted mt-0.5">
            Validasi, pembersihan (spasi, kapitalisasi), dan pembakuan kategori sebelum One-Hot Encoding. Setiap perubahan tercatat; nilai yang tidak dikenal tidak ditebak.
          </p>
        </div>
        {hasReport && (
          <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-ink-muted bg-surface-card rounded-xl border border-gray-200 hover:bg-gray-50">
            <Download size={13} /> CSV
          </button>
        )}
      </div>

      <div>
        <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">Missing value per variabel clustering</p>
        <div className="flex flex-wrap gap-2 text-xs">
          {ATTRS.map((a) => (
            <span key={a} className={`px-2.5 py-1 rounded-lg ${(missing[a] || 0) > 0 ? "bg-amber-50 text-amber-800" : "bg-gray-50 text-ink-muted"}`}>
              {ATTR_LABELS[a]}: <strong>{missing[a] || 0}</strong>
            </span>
          ))}
        </div>
        {summary.clustering.excluded > 0 && (
          <p className="text-[11px] text-ink-light mt-2">
            {summary.clustering.excluded} baris memiliki variabel kosong: tetap tersimpan sebagai kontak, tetapi dikeluarkan dari One-Hot Encoding &amp; K-Means.
          </p>
        )}
      </div>

      {hasReport || ATTRS.some((a) => summary.similar_values[a]?.length) ? (
        <NormalizationTables report={summary.normalization} similar={summary.similar_values} compact={false} />
      ) : (
        <p className="text-sm text-ink-muted">Belum ada laporan normalisasi. Import data untuk melihat perubahan yang dilakukan.</p>
      )}
    </section>
  );
}
