// Tipe & helper untuk fitur segmentasi calon mahasiswa (K-Means).

export const ATTRS = ["program_studi", "asal_sekolah", "jurusan_sekolah", "domisili"] as const;
export type Attr = (typeof ATTRS)[number];

export const ATTR_LABELS: Record<Attr, string> = {
  program_studi: "Minat Program Studi",
  asal_sekolah: "Asal Sekolah",
  jurusan_sekolah: "Jurusan Sekolah",
  domisili: "Domisili",
};

export type FieldKey = "name" | "phone_number" | Attr;

export const FIELD_LABELS: Record<FieldKey, string> = {
  name: "Nama",
  phone_number: "Nomor WhatsApp",
  ...ATTR_LABELS,
};

export const FIELD_KEYS: FieldKey[] = ["name", "phone_number", ...ATTRS];
export const REQUIRED_FIELDS: FieldKey[] = ["name", "phone_number"];

export type ColumnMap = Record<FieldKey, string | null>;
export type ImportRow = Record<FieldKey, string>;

/* ── API types ── */

export interface DominantValue { value: string; count: number; percent: number }
export interface SegmentProfile {
  size: number;
  attributes: Record<Attr, DominantValue[]>;
  /** Distribusi penuh per variabel (run lama hanya punya `attributes` top-3). */
  distribution?: Record<Attr, DominantValue[]>;
  dominant: Record<Attr, string | null>;
}
export interface Segment { cluster_no: number; size: number; profile: SegmentProfile }

export interface EvalRow {
  k: number;
  inertia: number;
  silhouette: number | null;
  davies_bouldin: number | null;
}
export interface Recommendation {
  k: number;
  agreement: "all" | "majority" | "none" | "single";
  needs_user_decision: boolean;
  per_metric: { elbow?: number | null; silhouette?: number | null; davies_bouldin?: number | null };
  votes: Record<string, number>;
  rationale: string;
}
export interface SuggestResult {
  n_samples: number;
  feature_count: number;
  scores: EvalRow[];
  recommendation: Recommendation | null;
  recommended: number | null;
}

export interface RunSummary {
  id: number; name: string | null; k: number; n_samples: number;
  silhouette: number | null; davies_bouldin: number | null; inertia: number | null; created_at: string;
}
export interface PreprocessingSnapshot {
  total_prospects: number;
  used_for_clustering: number;
  excluded_missing: number;
  feature_count: number;
  variables: string[];
  imports: {
    count: number; total_rows: number; valid_rows: number; invalid_rows: number; duplicate_rows: number;
    missing: Record<Attr, number>;
  };
}
export interface RunDetail extends RunSummary {
  iterations?: number | null;
  seed?: number | null;
  evaluation?: { scores: EvalRow[]; recommendation: Recommendation | null } | null;
  preprocessing?: PreprocessingSnapshot | null;
  params?: { feature_count?: number } | null;
  segments: Segment[];
}

export interface SegmentMember {
  contact_id: number; name: string; phone_number: string; last_sent_at: string | null;
}
export interface SegmentMembers {
  cluster_no: number; size: number; eligible: number; members: SegmentMember[];
}
export interface RunDetailMember {
  cluster_no: number; prospect_id: number; name: string; phone_number: string;
  program_studi: string; asal_sekolah: string; jurusan_sekolah: string; domisili: string;
}

export type NormStatus = "canonical" | "mapped" | "ambiguous" | "unrecognized" | "missing";
export interface NormChange { original: string; value: string; status: NormStatus; count: number }
export interface NormAttr {
  changes: NormChange[];
  unrecognized: { value: string; count: number }[];
  totals: Partial<Record<NormStatus, number>>;
}
export type NormReport = Partial<Record<Attr, NormAttr>>;
export interface SimilarPair { value: string; count: number; similar_to: string; similar_count: number }

export interface ImportSummary {
  total: number; valid: number; imported: number; updated: number; invalid: number; duplicates: number;
  missing_attributes: Record<Attr, number>;
  excluded_from_clustering: number;
  phone_fixed: number;
}
export interface ImportError { index: number; name: string; phone: string; code: string; reason: string }
export interface ImportBatchResult {
  import_id: number | null;
  dry_run: boolean;
  summary: ImportSummary;
  normalization: NormReport;
  errors: ImportError[];
}

export interface ImportSource { id: number; name: string | null; sheets: { name: string; rows: number; used: boolean }[]; rows: number; created_at: string }
export interface ProspectSummary {
  total: number;
  created_contacts: number;
  distribution: Record<Attr, { value: string; count: number }[]>;
  clustering: { complete: number; excluded: number; feature_count: number; features_by_attr: Record<Attr, number> };
  imports: {
    count: number; total_rows: number; valid_rows: number; invalid_rows: number; duplicate_rows: number;
    missing: Record<Attr, number>; sources: ImportSource[]; last_at: string | null;
  };
  normalization: NormReport;
  similar_values: Record<Attr, SimilarPair[]>;
}

export const STATUS_LABELS: Record<NormStatus, string> = {
  canonical: "Sudah baku",
  mapped: "Dipetakan kamus",
  ambiguous: "Ambigu — perlu ditinjau",
  unrecognized: "Tidak ada di kamus",
  missing: "Kosong",
};

/* ── Deteksi kolom CSV/Excel (termasuk judul kolom hasil ekspor Google Form) ── */

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const has = (h: string, keys: string[]) => keys.some((k) => h.includes(k));

// Urutan penting: field yang lebih spesifik diklaim lebih dulu.
const RULES: { field: FieldKey; test: (h: string) => boolean }[] = [
  { field: "phone_number", test: (h) => has(h, ["whatsapp", "nowa", "nomorwa", "phone", "telepon", "telp", "nohp", "nomorhp", "nomor"]) || h === "hp" || h === "wa" },
  { field: "jurusan_sekolah", test: (h) => h.includes("jurusan") && has(h, ["sekolah", "sma", "smk", "asal"]) },
  { field: "program_studi", test: (h) => has(h, ["programstudi", "prodi", "minat", "diminati", "peminatan", "fakultas"]) && !h.includes("sekolah") },
  { field: "asal_sekolah", test: (h) => (has(h, ["sekolah", "asalsma", "asalsmk", "smasmk"]) && !h.includes("jurusan")) },
  { field: "domisili", test: (h) => has(h, ["domisili", "kota", "kabupaten", "tempattinggal", "alamat", "asaldaerah"]) && !h.includes("sekolah") },
  { field: "name", test: (h) => (h.includes("nama") && !has(h, ["sekolah", "orangtua", "ortu", "wali"])) || h === "name" },
];

export function detectColumns(headers: string[]): ColumnMap {
  const map = Object.fromEntries(FIELD_KEYS.map((f) => [f, null])) as ColumnMap;
  const claimed = new Set<string>();

  for (const rule of RULES) {
    const hit = headers.find((h) => !claimed.has(h) && rule.test(squash(h)));
    if (hit) {
      map[rule.field] = hit;
      claimed.add(hit);
    }
  }
  return map;
}

export function mapRows(rows: Record<string, string>[], map: ColumnMap): ImportRow[] {
  return rows.map((r) => {
    const out = {} as ImportRow;
    for (const f of FIELD_KEYS) out[f] = map[f] ? String(r[map[f] as string] ?? "").trim() : "";
    return out;
  });
}

/** Pengecekan ringan di browser untuk preview; validasi sesungguhnya dilakukan server. */
export function quickCheck(row: ImportRow): string | null {
  if (!row.name || !row.phone_number) return "Nama atau nomor WhatsApp kosong";
  const digits = row.phone_number.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 15) return "Format nomor tidak valid";
  return null;
}

/* ── Spreadsheet: multi-sheet, deteksi baris header ── */

export interface ParsedSheet {
  name: string;
  /** indeks baris (0-based) tempat header ditemukan */
  headerRowIndex: number;
  headers: string[];
  rows: Record<string, string>[];
  map: ColumnMap;
  missingRequired: FieldKey[];
  missingAttrs: Attr[];
  /** bisa diimpor (Nama & Nomor terdeteksi, ada baris data) */
  usable: boolean;
  /** dicentang otomatis: usable DAN keempat variabel clustering terdeteksi */
  auto: boolean;
  reason: string | null;
}

export function cellToString(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return "";
  return String(v).trim();
}

const HEADER_SCAN_ROWS = 10;

/** Cari baris header: baris (dalam 10 baris pertama) yang kolomnya paling banyak cocok dengan 6 field. */
export function detectHeaderRow(matrix: string[][]): { index: number; map: ColumnMap } | null {
  let best: { index: number; map: ColumnMap; score: number } | null = null;
  for (let i = 0; i < Math.min(HEADER_SCAN_ROWS, matrix.length); i++) {
    const headers = matrix[i].filter(Boolean);
    if (headers.length < 3) continue;
    const map = detectColumns(headers);
    const score = FIELD_KEYS.filter((f) => map[f]).length;
    if (score >= 2 && (!best || score > best.score)) best = { index: i, map, score };
  }
  return best ? { index: best.index, map: best.map } : null;
}

/** Bangun ParsedSheet dari matriks sel mentah. */
export function buildSheet(name: string, raw: unknown[][]): ParsedSheet {
  const matrix = raw.map((r) => (Array.isArray(r) ? r.map(cellToString) : []));
  const empty: ParsedSheet = {
    name, headerRowIndex: -1, headers: [], rows: [], map: Object.fromEntries(FIELD_KEYS.map((f) => [f, null])) as ColumnMap,
    missingRequired: [...REQUIRED_FIELDS], missingAttrs: [...ATTRS], usable: false, auto: false, reason: null,
  };

  const found = detectHeaderRow(matrix);
  if (!found) return { ...empty, reason: "Header tidak terdeteksi (kolom Nama & Nomor WhatsApp tidak ditemukan)" };

  // Nama header dibuat unik agar kolom bernama sama tidak saling menimpa
  const seen = new Map<string, number>();
  const headers = matrix[found.index].map((h, i) => {
    const base = h || `Kolom ${i + 1}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });

  // Pemetaan dihitung ulang pada header yang sudah unik
  const map = detectColumns(headers.filter((h) => !h.startsWith("Kolom ")));
  const rows: Record<string, string>[] = [];
  for (const cells of matrix.slice(found.index + 1)) {
    if (cells.every((c) => !c)) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    rows.push(row);
  }

  const missingRequired = REQUIRED_FIELDS.filter((f) => !map[f]);
  const missingAttrs = ATTRS.filter((a) => !map[a]);
  const usable = missingRequired.length === 0 && rows.length > 0;
  const reason = missingRequired.length > 0
    ? `Kolom wajib tidak ditemukan: ${missingRequired.map((f) => FIELD_LABELS[f]).join(", ")}`
    : rows.length === 0 ? "Tidak ada baris data" : null;

  return {
    name, headerRowIndex: found.index, headers, rows, map, missingRequired, missingAttrs,
    usable, auto: usable && missingAttrs.length === 0, reason,
  };
}

export interface ParsedFile { sourceName: string; sheets: ParsedSheet[] }

/** Baca .xlsx (semua sheet) atau .csv/.tsv (satu sheet). Parsing terjadi di browser. */
export async function parseSpreadsheetFile(file: File): Promise<ParsedFile> {
  const lower = file.name.toLowerCase();

  if (lower.endsWith(".xlsx")) {
    const { default: readXlsxFile } = await import("read-excel-file/browser");
    const sheets = await readXlsxFile(file);
    return { sourceName: file.name, sheets: sheets.map((s) => buildSheet(s.sheet, s.data as unknown[][])) };
  }
  if (lower.endsWith(".xls")) {
    throw new Error("Format .xls (Excel lama) tidak didukung. Buka di Excel lalu simpan sebagai .xlsx atau .csv.");
  }

  // .csv / .tsv / .txt — delimiter (koma, titik koma, tab) dideteksi otomatis oleh papaparse
  const Papa = (await import("papaparse")).default;
  const matrix = await new Promise<string[][]>((resolve, reject) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: "greedy",
      complete: (res) => resolve(res.data as string[][]),
      error: (err) => reject(new Error(err.message || "Gagal membaca file")),
    });
  });
  return { sourceName: file.name, sheets: [buildSheet(file.name, matrix)] };
}

/** Kunci pembanding nomor untuk membuang duplikat di sisi client (mirror aturan server). */
export function phoneKey(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0")) return "62" + digits.slice(1);
  if (/^8[1-9]\d{7,10}$/.test(digits)) return "62" + digits;
  return digits;
}

export interface PreparedImport {
  rows: ImportRow[];
  /** duplikat (nomor sama) yang dibuang di sisi client, antar-sheet maupun dalam satu sheet */
  extraDuplicates: number;
  perSheet: { name: string; rows: number; used: boolean }[];
}

/** Gabungkan sheet terpilih menjadi satu daftar baris siap kirim; nomor duplikat dibuang & dihitung. */
export function prepareImport(sheets: ParsedSheet[], selected: Set<string>): PreparedImport {
  const seen = new Set<string>();
  const rows: ImportRow[] = [];
  let extraDuplicates = 0;
  const perSheet: PreparedImport["perSheet"] = [];

  for (const sheet of sheets) {
    const used = selected.has(sheet.name);
    perSheet.push({ name: sheet.name, rows: sheet.rows.length, used });
    if (!used) continue;

    for (const row of mapRows(sheet.rows, sheet.map)) {
      if (FIELD_KEYS.every((f) => !row[f])) continue;
      // Hanya nomor berformat valid (10–15 digit) yang dianggap duplikat; nomor rusak dibiarkan lolos
      // ke server agar dilaporkan sebagai INVALID (bukan salah dikategorikan sebagai duplikat).
      const key = row.phone_number ? phoneKey(row.phone_number) : "";
      const dedupable = key.length >= 10 && key.length <= 15;
      if (dedupable && seen.has(key)) { extraDuplicates++; continue; }
      if (dedupable) seen.add(key);
      rows.push(row);
    }
  }
  return { rows, extraDuplicates, perSheet };
}

/** Gabungkan laporan normalisasi antar-batch (pratinjau di browser). */
export function mergeNormReports(a: NormReport, b: NormReport): NormReport {
  const out: NormReport = {};
  for (const attr of ATTRS) {
    const x = a[attr]; const y = b[attr];
    if (!x && !y) continue;

    const changes = new Map<string, NormChange>();
    for (const c of [...(x?.changes || []), ...(y?.changes || [])]) {
      const key = `${c.original}\u0000${c.value}\u0000${c.status}`;
      const cur = changes.get(key);
      changes.set(key, cur ? { ...cur, count: cur.count + c.count } : { ...c });
    }
    const unrec = new Map<string, number>();
    for (const u of [...(x?.unrecognized || []), ...(y?.unrecognized || [])]) unrec.set(u.value, (unrec.get(u.value) || 0) + u.count);

    const totals: NormAttr["totals"] = { ...(x?.totals || {}) };
    for (const [s, n] of Object.entries(y?.totals || {})) totals[s as NormStatus] = (totals[s as NormStatus] || 0) + (n || 0);

    out[attr] = {
      changes: [...changes.values()].sort((p, q) => q.count - p.count),
      unrecognized: [...unrec.entries()].map(([value, count]) => ({ value, count })).sort((p, q) => q.count - p.count),
      totals,
    };
  }
  return out;
}
