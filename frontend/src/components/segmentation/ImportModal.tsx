"use client";

import { useState } from "react";
import Papa from "papaparse";
import { Upload, Download, AlertTriangle, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import WideModal from "./WideModal";
import {
  FIELD_KEYS,
  FIELD_LABELS,
  REQUIRED_FIELDS,
  detectColumns,
  mapRows,
  quickCheck,
  type ColumnMap,
  type FieldKey,
  type ImportRow,
  type ImportSummary,
} from "@/lib/segmentation";

const BATCH_SIZE = 500; // sama dengan batas server (body parser global 1 MB)

type ExistingMode = "append" | "replace" | "replace_contacts";

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  existingTotal: number;            // jumlah data yang sudah ada
  existingCreatedContacts: number;  // kontak yang dibuat oleh import sebelumnya
}

interface FinalResult {
  imported: number; updated: number; invalid: number; duplicates: number;
  missing: Record<string, number>;
}

export default function ImportModal({ open, onClose, onDone, existingTotal, existingCreatedContacts }: ImportModalProps) {
  const [mode, setMode] = useState<ExistingMode>("append");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [raw, setRaw] = useState<Record<string, string>[]>([]);
  const [map, setMap] = useState<ColumnMap | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<FinalResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setMode("append"); setFileName(""); setHeaders([]); setRaw([]); setMap(null);
    setImporting(false); setProgress(0); setResult(null); setError(null);
  }

  function handleClose() {
    if (importing) return;
    const finished = !!result;
    reset();
    onClose();
    if (finished) onDone();
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    reset();
    setFileName(file.name);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete(res) {
        const cols = (res.meta.fields || []).filter(Boolean);
        setHeaders(cols);
        setRaw(res.data);
        setMap(detectColumns(cols));
      },
      error() {
        setError("Gagal membaca file CSV");
      },
    });
    e.target.value = "";
  }

  const rows: ImportRow[] = map ? mapRows(raw, map) : [];
  const checks = rows.map(quickCheck);
  const validCount = checks.filter((c) => !c).length;
  const missingRequired = map ? REQUIRED_FIELDS.filter((f) => !map[f]) : [];
  const unmappedAttrs = map ? FIELD_KEYS.filter((f) => !REQUIRED_FIELDS.includes(f) && !map[f]) : [];

  async function handleImport() {
    if (!map || missingRequired.length > 0 || rows.length === 0) return;
    setImporting(true);
    setError(null);
    setProgress(0);

    const total: FinalResult = { imported: 0, updated: 0, invalid: 0, duplicates: 0, missing: {} };
    try {
      // "Ganti data lama": kosongkan dataset (dan hasil cluster) dulu sebelum mengimpor file ini
      if (mode !== "append" && (existingTotal > 0 || existingCreatedContacts > 0)) {
        await api.del("/api/segmentation/prospects", {
          params: { delete_contacts: mode === "replace_contacts" ? "true" : undefined },
        });
      }

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const res = await api.post<{ summary: ImportSummary }>("/api/segmentation/prospects/import", { rows: batch });
        const s = res.summary;
        total.imported += s.imported;
        total.updated += s.updated;
        total.invalid += s.invalid;
        total.duplicates += s.duplicates;
        for (const [k, v] of Object.entries(s.missing_attributes)) total.missing[k] = (total.missing[k] || 0) + v;
        setProgress(Math.min(i + BATCH_SIZE, rows.length));
      }
      setResult(total);
    } catch (err: any) {
      setError(err?.body?.error || err.message || "Import gagal");
      // sebagian batch mungkin sudah masuk — tampilkan agar user tahu
      if (total.imported + total.updated > 0) setResult(total);
    } finally {
      setImporting(false);
    }
  }

  return (
    <WideModal open={open} onClose={handleClose} title="Import Data Calon Mahasiswa (CSV)">
      {/* Panduan */}
      <div className="bg-primary-50/60 border border-primary-100 rounded-xl p-3 text-xs text-ink-muted mb-4">
        <p>
          Upload CSV dengan kolom: <strong>Nama</strong>, <strong>Nomor WhatsApp</strong>, <strong>Minat Program Studi</strong>,{" "}
          <strong>Asal Sekolah</strong>, <strong>Jurusan Sekolah</strong>, <strong>Domisili</strong>. File ekspor Google Form
          (Responses → Download .csv) bisa langsung dipakai. Nama &amp; nomor hanya identitas kontak, tidak ikut perhitungan cluster.
        </p>
        <a href="/template-calon-mahasiswa.csv" download className="inline-flex items-center gap-1 mt-2 font-medium text-primary-700 hover:underline">
          <Download size={12} /> Unduh template CSV
        </a>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-2.5 mb-4">{error}</div>
      )}

      {/* Hasil */}
      {result ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 bg-primary-50 border border-primary-200 rounded-xl p-4">
            <CheckCircle2 className="text-primary-600 shrink-0 mt-0.5" size={20} />
            <div className="text-sm text-ink">
              <p className="font-semibold">Import selesai</p>
              <p className="text-ink-muted mt-1">
                {result.imported} baru · {result.updated} diperbarui · {result.duplicates} duplikat dilewati · {result.invalid} tidak valid
              </p>
              {Object.values(result.missing).some((v) => v > 0) && (
                <p className="text-xs text-amber-700 mt-2">
                  Atribut kosong diisi &quot;Tidak Diketahui&quot;:{" "}
                  {Object.entries(result.missing).filter(([, v]) => v > 0)
                    .map(([k, v]) => `${FIELD_LABELS[k as FieldKey] || k} (${v})`).join(", ")}
                </p>
              )}
              <p className="text-xs text-ink-muted mt-2">Data juga otomatis ditambahkan ke daftar Contacts.</p>
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={handleClose} className="px-4 py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600">
              Selesai
            </button>
          </div>
        </div>
      ) : (
        <>
          <label className="flex items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-xl py-6 cursor-pointer hover:border-primary-400 hover:bg-primary-50/30 transition-all text-sm text-ink-muted">
            <Upload size={18} />
            {fileName ? <span className="font-medium text-ink">{fileName}</span> : <span>Pilih file CSV</span>}
            <input type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
          </label>

          {map && (
            <div className="mt-5 space-y-5">
              {/* Pemetaan kolom */}
              <div>
                <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">Pemetaan kolom</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {FIELD_KEYS.map((f) => (
                    <div key={f} className="flex items-center gap-2 text-sm">
                      <span className="w-40 shrink-0 text-ink">
                        {FIELD_LABELS[f]}
                        {REQUIRED_FIELDS.includes(f) && <span className="text-red-500"> *</span>}
                      </span>
                      <select
                        value={map[f] ?? ""}
                        onChange={(e) => setMap({ ...map, [f]: e.target.value || null })}
                        className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                      >
                        <option value="">— tidak ada —</option>
                        {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                {missingRequired.length > 0 && (
                  <p className="flex items-center gap-1.5 text-xs text-red-600 mt-2">
                    <AlertTriangle size={13} /> Kolom wajib belum dipetakan: {missingRequired.map((f) => FIELD_LABELS[f]).join(", ")}
                  </p>
                )}
                {unmappedAttrs.length > 0 && missingRequired.length === 0 && (
                  <p className="flex items-center gap-1.5 text-xs text-amber-700 mt-2">
                    <AlertTriangle size={13} /> Tanpa kolom {unmappedAttrs.map((f) => FIELD_LABELS[f]).join(", ")} — nilainya diisi &quot;Tidak Diketahui&quot;
                    dan atribut itu tidak membedakan cluster.
                  </p>
                )}
              </div>

              {/* Preview */}
              <div>
                <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
                  Preview — {rows.length} baris ({validCount} lolos pengecekan awal
                  {rows.length - validCount > 0 && <span className="text-red-600">, {rows.length - validCount} bermasalah</span>})
                </p>
                <div className="overflow-x-auto border border-gray-100 rounded-xl">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-ink-muted">
                      <tr>{FIELD_KEYS.map((f) => <th key={f} className="text-left font-medium px-3 py-2 whitespace-nowrap">{FIELD_LABELS[f]}</th>)}<th className="px-3 py-2" /></tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 6).map((r, i) => (
                        <tr key={i} className="border-t border-gray-50">
                          {FIELD_KEYS.map((f) => <td key={f} className="px-3 py-1.5 whitespace-nowrap max-w-[160px] truncate">{r[f] || <span className="text-ink-light">—</span>}</td>)}
                          <td className="px-3 py-1.5 text-red-600 whitespace-nowrap">{checks[i]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-ink-light mt-2">
                  Pembersihan & standardisasi (huruf, singkatan sekolah, jurusan, kota) dilakukan otomatis saat import; nomor duplikat dilewati.
                </p>
              </div>

              {/* Data yang sudah ada: tambah atau ganti */}
              {(existingTotal > 0 || existingCreatedContacts > 0) && (
                <div>
                  <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
                    {existingTotal > 0 ? `Sudah ada ${existingTotal} data — apa yang dilakukan?` : "Ada kontak hasil import sebelumnya — apa yang dilakukan?"}
                  </p>
                  <div className="space-y-2">
                    {([
                      ["append", "Tambahkan ke data lama", "Nomor yang sama diperbarui, nomor baru ditambahkan. Hasil cluster lama tetap tersimpan."],
                      ["replace", "Ganti data lama", "Hapus semua data & hasil cluster lama dulu, lalu impor file ini. Kontak di menu Contacts tetap ada."],
                      ...(existingCreatedContacts > 0
                        ? [["replace_contacts", "Ganti data lama + hapus kontak hasil import sebelumnya", `Sama seperti di atas, dan ${existingCreatedContacts} kontak yang dibuat otomatis oleh import sebelumnya ikut dihapus (kontak lama Anda aman).`]]
                        : []),
                    ] as [ExistingMode, string, string][]).map(([value, label, hint]) => (
                      <label key={value}
                        className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                          mode === value ? "border-primary-500 bg-primary-50/50" : "border-gray-200 hover:bg-gray-50"
                        }`}>
                        <input type="radio" name="existing-mode" checked={mode === value} onChange={() => setMode(value)}
                          className="mt-0.5 text-primary-500" />
                        <span className="text-sm">
                          <span className="font-medium text-ink">{label}</span>
                          <span className="block text-xs text-ink-muted mt-0.5">{hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-ink-muted">
                  {importing && `Mengimpor… ${progress}/${rows.length}`}
                </span>
                <div className="flex gap-2">
                  <button onClick={handleClose} disabled={importing}
                    className="px-4 py-2 text-sm font-medium text-ink-muted bg-gray-50 rounded-xl hover:bg-gray-100 disabled:opacity-50">
                    Batal
                  </button>
                  <button onClick={handleImport} disabled={importing || missingRequired.length > 0 || rows.length === 0}
                    className="px-4 py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 disabled:opacity-40">
                    {importing ? "Mengimpor…" : `Import ${rows.length} baris`}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </WideModal>
  );
}
