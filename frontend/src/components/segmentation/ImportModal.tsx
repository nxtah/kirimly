"use client";

import { useMemo, useState } from "react";
import { Upload, Download, AlertTriangle, CheckCircle2, FileSpreadsheet, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import WideModal from "./WideModal";
import NormalizationTables from "./NormalizationTables";
import {
  ATTRS,
  FIELD_KEYS,
  FIELD_LABELS,
  REQUIRED_FIELDS,
  mergeNormReports,
  parseSpreadsheetFile,
  prepareImport,
  type ColumnMap,
  type FieldKey,
  type ImportBatchResult,
  type ImportError,
  type NormReport,
  type ParsedFile,
  type ParsedSheet,
  type PreparedImport,
} from "@/lib/segmentation";

const BATCH_SIZE = 500; // sama dengan batas server (body parser global 1 MB)
const IMPORT_URL = "/api/segmentation/prospects/import";

type ExistingMode = "append" | "replace" | "replace_contacts";
type Step = "pick" | "review" | "preview" | "done";

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  existingTotal: number;            // jumlah data yang sudah ada
  existingCreatedContacts: number;  // kontak yang dibuat oleh import sebelumnya
}

interface Aggregate {
  total: number; valid: number; invalid: number; duplicates: number;
  missingRows: number; phoneFixed: number;
  missing: Record<string, number>;
  normalization: NormReport;
  errors: ImportError[];
}

const emptyAgg = (): Aggregate => ({
  total: 0, valid: 0, invalid: 0, duplicates: 0, missingRows: 0, phoneFixed: 0,
  missing: Object.fromEntries(ATTRS.map((a) => [a, 0])), normalization: {}, errors: [],
});

export default function ImportModal({ open, onClose, onDone, existingTotal, existingCreatedContacts }: ImportModalProps) {
  const [step, setStep] = useState<Step>("pick");
  const [mode, setMode] = useState<ExistingMode>("append");
  const [parsing, setParsing] = useState(false);
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openMap, setOpenMap] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedImport | null>(null);
  const [agg, setAgg] = useState<Aggregate | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setStep("pick"); setMode("append"); setParsing(false); setFile(null); setSheets([]); setSelected(new Set());
    setOpenMap(null); setPrepared(null); setAgg(null); setBusy(false); setProgress(0); setError(null);
  }

  function handleClose() {
    if (busy) return;
    const finished = step === "done";
    reset();
    onClose();
    if (finished) onDone();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    reset();
    setParsing(true);
    try {
      const parsed = await parseSpreadsheetFile(f);
      setFile(parsed);
      setSheets(parsed.sheets);
      const auto = parsed.sheets.filter((s) => s.auto).map((s) => s.name);
      const fallback = parsed.sheets.filter((s) => s.usable).map((s) => s.name);
      setSelected(new Set(auto.length > 0 ? auto : fallback));
      setStep("review");
    } catch (err: any) {
      setError(err?.message || "Gagal membaca file");
    } finally {
      setParsing(false);
    }
  }

  function toggleSheet(name: string) {
    setSelected((prev) => {
      const s = new Set(prev);
      if (s.has(name)) s.delete(name); else s.add(name);
      return s;
    });
  }

  function setMapping(sheetName: string, field: FieldKey, header: string | null) {
    setSheets((prev) => prev.map((s) => {
      if (s.name !== sheetName) return s;
      const map: ColumnMap = { ...s.map, [field]: header };
      const missingRequired = REQUIRED_FIELDS.filter((f) => !map[f]);
      const missingAttrs = ATTRS.filter((a) => !map[a]);
      const usable = missingRequired.length === 0 && s.rows.length > 0;
      return { ...s, map, missingRequired, missingAttrs, usable, auto: usable && missingAttrs.length === 0, reason: missingRequired.length ? `Kolom wajib tidak ditemukan: ${missingRequired.map((f) => FIELD_LABELS[f]).join(", ")}` : null };
    }));
  }

  const selectedSheets = useMemo(() => sheets.filter((s) => selected.has(s.name)), [sheets, selected]);
  const selectedUnusable = selectedSheets.filter((s) => !s.usable);
  const canPreview = selectedSheets.length > 0 && selectedUnusable.length === 0;

  async function runPreview() {
    if (!canPreview) return;
    setBusy(true); setError(null); setProgress(0);
    const prep = prepareImport(sheets, selected);
    setPrepared(prep);

    const total = emptyAgg();
    total.total = prep.extraDuplicates;
    total.duplicates = prep.extraDuplicates;
    try {
      for (let i = 0; i < prep.rows.length; i += BATCH_SIZE) {
        const res = await api.post<ImportBatchResult>(IMPORT_URL, { rows: prep.rows.slice(i, i + BATCH_SIZE) }, { params: { dry_run: "true" } });
        const s = res.summary;
        total.total += s.total; total.valid += s.valid; total.invalid += s.invalid; total.duplicates += s.duplicates;
        total.missingRows += s.imputed_rows; total.phoneFixed += s.phone_fixed;
        for (const [k, v] of Object.entries(s.missing_attributes)) total.missing[k] = (total.missing[k] || 0) + v;
        total.normalization = mergeNormReports(total.normalization, res.normalization);
        total.errors = [...total.errors, ...res.errors].slice(0, 200);
        setProgress(Math.min(i + BATCH_SIZE, prep.rows.length));
      }
      setAgg(total);
      setStep("preview");
    } catch (err: any) {
      setError(err?.body?.error || err.message || "Pratinjau gagal");
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!prepared || !file) return;
    setBusy(true); setError(null); setProgress(0);
    try {
      // "Ganti data lama": kosongkan dataset (dan hasil cluster) dulu sebelum mengimpor file ini
      if (mode !== "append" && (existingTotal > 0 || existingCreatedContacts > 0)) {
        await api.del("/api/segmentation/prospects", { params: { delete_contacts: mode === "replace_contacts" ? "true" : undefined } });
      }

      // Semua batch diproses: tiap batch dicoba ulang sekali; batch yang tetap gagal dicatat dan
      // import DILANJUTKAN ke batch berikutnya (data yang sudah masuk tidak hilang).
      let importId: number | null = null;
      const failed: string[] = [];
      for (let i = 0; i < prepared.rows.length; i += BATCH_SIZE) {
        const body: Record<string, unknown> = { rows: prepared.rows.slice(i, i + BATCH_SIZE) };
        if (importId) body.import_id = importId;
        else body.meta = { source_name: file.sourceName, sheets: prepared.perSheet, extra_duplicates: prepared.extraDuplicates };
        let lastErr = "";
        let ok = false;
        for (let attempt = 0; attempt < 2 && !ok; attempt++) {
          try {
            const res: ImportBatchResult = await api.post<ImportBatchResult>(IMPORT_URL, body);
            importId = res.import_id;
            ok = true;
          } catch (err: any) {
            lastErr = err?.body?.error || err?.message || "gagal";
          }
        }
        if (!ok) failed.push(`baris ${i + 1}–${Math.min(i + BATCH_SIZE, prepared.rows.length)} (${lastErr})`);
        setProgress(Math.min(i + BATCH_SIZE, prepared.rows.length));
      }
      if (failed.length > 0) setError(`${failed.length} batch gagal diimpor: ${failed.join("; ")}. Batch lainnya berhasil tersimpan.`);
      setStep("done");
    } catch (err: any) {
      setError(err?.body?.error || err.message || "Import gagal");
    } finally {
      setBusy(false);
    }
  }

  return (
    <WideModal open={open} onClose={handleClose} title="Import Data Calon Mahasiswa (Excel / CSV)">
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-2.5 mb-4">{error}</div>}

      {/* ── 1. Pilih file ── */}
      {step === "pick" && (
        <>
          <div className="bg-primary-50/60 border border-primary-100 rounded-xl p-3 text-xs text-ink-muted mb-4">
            <p>
              Mendukung <strong>.xlsx (banyak sheet)</strong>, .csv, dan .tsv. Sistem mendeteksi otomatis semua sheet, baris header, dan kolom
              (<strong>Nama</strong>, <strong>Nomor WhatsApp</strong>, <strong>Minat Program Studi</strong>, <strong>Asal Sekolah</strong>,{" "}
              <strong>Jurusan Sekolah</strong>, <strong>Domisili</strong>). Hasil ekspor Google Form / Google Sheets bisa langsung dipakai.
              Nama &amp; nomor hanya identitas, tidak ikut perhitungan cluster.
            </p>
            <div className="flex flex-wrap gap-x-4 mt-2">
              <a href="/template-calon-mahasiswa.xlsx" download className="inline-flex items-center gap-1 font-medium text-primary-700 hover:underline">
                <Download size={12} /> Template Excel (2 sheet)
              </a>
              <a href="/template-calon-mahasiswa.csv" download className="inline-flex items-center gap-1 font-medium text-primary-700 hover:underline">
                <Download size={12} /> Template CSV
              </a>
            </div>
          </div>
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-xl py-8 cursor-pointer hover:border-primary-400 hover:bg-primary-50/30 transition-all text-sm text-ink-muted">
            {parsing ? <Loader2 size={22} className="animate-spin" /> : <Upload size={22} />}
            <span>{parsing ? "Membaca file…" : "Pilih file .xlsx / .csv / .tsv"}</span>
            <input type="file" accept=".xlsx,.csv,.tsv,.txt" onChange={handleFile} disabled={parsing} className="hidden" />
          </label>
        </>
      )}

      {/* ── 2. Tinjau sheet & pemetaan kolom ── */}
      {step === "review" && file && (
        <div className="space-y-5">
          <div className="flex items-center gap-2 text-sm">
            <FileSpreadsheet size={18} className="text-primary-600" />
            <span className="font-medium text-ink">{file.sourceName}</span>
            <span className="text-ink-muted">— {sheets.length} sheet terdeteksi</span>
          </div>

          <div className="border border-gray-100 rounded-xl overflow-hidden">
            {sheets.map((s) => {
              const isSel = selected.has(s.name);
              const mapped = FIELD_KEYS.filter((f) => s.map[f]).length;
              return (
                <div key={s.name} className="border-b border-gray-50 last:border-0">
                  <div className={`flex items-start gap-3 px-4 py-3 ${isSel ? "bg-primary-50/40" : ""}`}>
                    <input type="checkbox" checked={isSel} disabled={!s.usable} onChange={() => toggleSheet(s.name)} className="mt-1 rounded border-gray-300 text-primary-500" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-ink">{s.name}</span>
                        <span className="text-xs text-ink-muted">{s.rows.length} baris data</span>
                        {s.headerRowIndex >= 0 && <span className="text-xs text-ink-light">header di baris #{s.headerRowIndex + 1}</span>}
                        {s.usable && <span className="text-xs text-ink-muted">· {mapped}/{FIELD_KEYS.length} kolom terdeteksi</span>}
                      </div>
                      {!s.usable && <p className="text-xs text-red-600 mt-1">Dilewati: {s.reason}</p>}
                      {s.usable && s.missingAttrs.length > 0 && (
                        <p className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                          <AlertTriangle size={12} /> Tanpa kolom {s.missingAttrs.map((a) => FIELD_LABELS[a]).join(", ")} — nilainya akan diisi <strong>&quot;Tidak Diketahui&quot;</strong> dan tetap ikut clustering.
                        </p>
                      )}
                    </div>
                    {s.headers.length > 0 && (
                      <button onClick={() => setOpenMap(openMap === s.name ? null : s.name)} className="text-xs text-primary-600 hover:underline flex items-center gap-0.5 shrink-0">
                        {openMap === s.name ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Pemetaan kolom
                      </button>
                    )}
                  </div>

                  {openMap === s.name && (
                    <div className="px-4 pb-4 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-2 bg-gray-50/50">
                      {FIELD_KEYS.map((f) => (
                        <div key={f} className="flex items-center gap-2 text-sm">
                          <span className="w-40 shrink-0 text-ink text-xs">{FIELD_LABELS[f]}{REQUIRED_FIELDS.includes(f) && <span className="text-red-500"> *</span>}</span>
                          <select value={s.map[f] ?? ""} onChange={(e) => setMapping(s.name, f, e.target.value || null)}
                            className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-primary-500">
                            <option value="">— tidak ada —</option>
                            {s.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                          </select>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {sheets.length > 1 && (
            <p className="text-[11px] text-ink-light">
              Sheet yang dicentang digabung menjadi satu dataset. Nomor WhatsApp yang sama antar-sheet dihitung sebagai duplikat (baris pertama dipakai).
            </p>
          )}

          {(existingTotal > 0 || existingCreatedContacts > 0) && (
            <div>
              <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
                {existingTotal > 0 ? `Sudah ada ${existingTotal} data — apa yang dilakukan?` : "Ada kontak hasil import sebelumnya — apa yang dilakukan?"}
              </p>
              <div className="space-y-2">
                {([
                  ["append", "Tambahkan ke data lama", "Nomor yang sama diperbarui, nomor baru ditambahkan. Hasil cluster lama tetap tersimpan."],
                  ["replace", "Ganti data lama", "Hapus semua data, hasil cluster, dan riwayat import lama dulu, lalu impor file ini. Kontak di menu Contacts tetap ada."],
                  ...(existingCreatedContacts > 0
                    ? [["replace_contacts", "Ganti data lama + hapus kontak hasil import sebelumnya", `Sama seperti di atas, dan ${existingCreatedContacts} kontak yang dibuat otomatis oleh import sebelumnya ikut dihapus (kontak lama Anda aman).`]]
                    : []),
                ] as [ExistingMode, string, string][]).map(([value, label, hint]) => (
                  <label key={value} className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${mode === value ? "border-primary-500 bg-primary-50/50" : "border-gray-200 hover:bg-gray-50"}`}>
                    <input type="radio" name="existing-mode" checked={mode === value} onChange={() => setMode(value)} className="mt-0.5 text-primary-500" />
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
            <span className="text-xs text-ink-muted">{busy && `Memeriksa data… ${progress}`}</span>
            <div className="flex gap-2">
              <button onClick={reset} disabled={busy} className="px-4 py-2 text-sm font-medium text-ink-muted bg-gray-50 rounded-xl hover:bg-gray-100 disabled:opacity-50">Ganti file</button>
              <button onClick={runPreview} disabled={busy || !canPreview}
                className="px-4 py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 disabled:opacity-40">
                {busy ? "Memeriksa…" : "Pratinjau Preprocessing"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 3. Pratinjau preprocessing ── */}
      {step === "preview" && agg && prepared && (
        <div className="space-y-5">
          <div>
            <p className="text-sm font-semibold text-ink mb-3">Preprocessing Summary <span className="font-normal text-ink-muted">(pratinjau — belum ada yang disimpan)</span></p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                ["Total data awal", agg.total, "baris dari sheet terpilih"],
                ["Data valid", agg.valid, "lolos validasi nama & nomor"],
                ["Data invalid", agg.invalid, "ditolak (lihat alasan)"],
                ["Data duplikat", agg.duplicates, "nomor WhatsApp sama"],
                ["Missing value", agg.missingRows, "baris diisi Tidak Diketahui"],
                ["Nomor diperbaiki", agg.phoneFixed, "nol depan hilang (Excel)"],
              ].map(([label, value, hint]) => (
                <div key={label as string} className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-ink-muted">{label}</p>
                  <p className="text-xl font-bold text-ink">{value}</p>
                  <p className="text-[11px] text-ink-light">{hint}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">Missing value per variabel clustering</p>
            <div className="flex flex-wrap gap-2 text-xs">
              {ATTRS.map((a) => (
                <span key={a} className={`px-2.5 py-1 rounded-lg ${agg.missing[a] > 0 ? "bg-amber-50 text-amber-800" : "bg-gray-50 text-ink-muted"}`}>
                  {FIELD_LABELS[a]}: <strong>{agg.missing[a]}</strong>
                </span>
              ))}
            </div>
            {agg.missingRows > 0 && (
              <p className="text-[11px] text-ink-light mt-2">
                Variabel kosong diimputasi &quot;Tidak Diketahui&quot; (tetap dicatat sebagai missing value) sehingga seluruh data valid ikut One-Hot Encoding &amp; K-Means.
              </p>
            )}
          </div>

          {agg.errors.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">Data invalid ({agg.invalid})</p>
              <div className="max-h-32 overflow-auto border border-gray-100 rounded-xl text-xs">
                {agg.errors.slice(0, 30).map((e, i) => (
                  <div key={i} className="px-3 py-1.5 border-b border-gray-50 last:border-0 flex gap-2">
                    <span className="font-medium text-ink shrink-0">{e.name}</span>
                    <span className="font-mono text-ink-muted shrink-0">{e.phone}</span>
                    <span className="text-red-600">{e.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <NormalizationTables report={agg.normalization} compact />

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-ink-muted">{busy && `Menyimpan… ${progress}/${prepared.rows.length}`}</span>
            <div className="flex gap-2">
              <button onClick={() => setStep("review")} disabled={busy} className="px-4 py-2 text-sm font-medium text-ink-muted bg-gray-50 rounded-xl hover:bg-gray-100 disabled:opacity-50">Kembali</button>
              <button onClick={runImport} disabled={busy || agg.valid === 0}
                className="px-4 py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 disabled:opacity-40">
                {busy ? "Menyimpan…" : `Simpan ${agg.valid} data`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 4. Selesai ── */}
      {step === "done" && agg && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 bg-primary-50 border border-primary-200 rounded-xl p-4">
            <CheckCircle2 className="text-primary-600 shrink-0 mt-0.5" size={20} />
            <div className="text-sm text-ink">
              <p className="font-semibold">Import selesai</p>
              <p className="text-ink-muted mt-1">
                {agg.valid} data valid disimpan · {agg.invalid} tidak valid · {agg.duplicates} duplikat dilewati
                {agg.missingRows > 0 && ` · ${agg.missingRows} baris missing value diimputasi`}
              </p>
              <p className="text-xs text-ink-muted mt-2">Ringkasan lengkap tersedia di bagian <strong>Preprocessing Summary</strong> halaman ini. Data juga ditambahkan ke daftar Contacts.</p>
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={handleClose} className="px-4 py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600">Selesai</button>
          </div>
        </div>
      )}
    </WideModal>
  );
}
