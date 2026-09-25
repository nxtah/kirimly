"use client";

import { FileSpreadsheet } from "lucide-react";
import StatCard from "@/components/ui/StatCard";
import { ATTRS, ATTR_LABELS, type ProspectSummary } from "@/lib/segmentation";

/** Data Summary: total awal, valid, invalid, duplikat, missing, dipakai clustering, jumlah fitur One-Hot. */
export default function DataSummary({ summary }: { summary: ProspectSummary }) {
  const hasLog = summary.imports.count > 0;
  const c = summary.clustering;

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Total Data Awal" value={hasLog ? summary.imports.total_rows : summary.total} subtitle={hasLog ? "baris pada file yang diimpor" : "tersimpan (tanpa riwayat import)"} highlighted />
        <StatCard title="Data Valid" value={hasLog ? summary.imports.valid_rows : summary.total} subtitle="lolos validasi nama & nomor" />
        <StatCard title="Data Invalid" value={hasLog ? summary.imports.invalid_rows : "—"} subtitle="ditolak saat import" />
        <StatCard title="Data Duplikat" value={hasLog ? summary.imports.duplicate_rows : "—"} subtitle="nomor WhatsApp sama" />
        <StatCard title="Missing Value" value={c.imputed} subtitle={`baris diisi "Tidak Diketahui"`} />
        <StatCard title="Dipakai Clustering" value={c.complete} subtitle="seluruh data valid" highlighted />
        <StatCard title="Fitur One-Hot" value={c.feature_count} subtitle="hanya 4 variabel clustering" />
        <StatCard title="Variabel" value={ATTRS.length} subtitle="nama & nomor tidak dipakai" />
      </div>

      {c.feature_count > 0 && (
        <div className="bg-surface-card rounded-2xl shadow-card p-4">
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">Fitur hasil One-Hot Encoding per variabel</p>
          <div className="flex flex-wrap gap-2 text-xs">
            {ATTRS.map((a) => (
              <span key={a} className="px-2.5 py-1 rounded-lg bg-gray-50 text-ink-muted">
                {ATTR_LABELS[a]}: <strong className="text-ink">{c.features_by_attr[a]}</strong> fitur
              </span>
            ))}
          </div>
          <p className="text-[11px] text-ink-light mt-2">
            Kategori yang sangat jarang muncul digabung ke satu fitur &quot;Lainnya&quot; hanya untuk perhitungan; profil cluster tetap memakai nilai aslinya.
          </p>
        </div>
      )}

      {hasLog && (
        <div className="bg-surface-card rounded-2xl shadow-card p-4">
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">Sumber data</p>
          <div className="space-y-2">
            {summary.imports.sources.map((s) => (
              <div key={s.id} className="flex items-start gap-2 text-sm">
                <FileSpreadsheet size={15} className="text-primary-600 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <span className="font-medium text-ink">{s.name || "(tanpa nama file)"}</span>
                  <span className="text-ink-muted"> · {s.rows} baris · {new Date(s.created_at).toLocaleString()}</span>
                  {s.sheets.length > 0 && (
                    <p className="text-xs text-ink-muted">
                      Sheet: {s.sheets.map((sh) => `${sh.name} (${sh.rows}${sh.used ? "" : ", tidak dipakai"})`).join(" · ")}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
