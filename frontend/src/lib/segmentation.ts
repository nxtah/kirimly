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
  dominant: Record<Attr, string | null>;
}
export interface Segment { cluster_no: number; size: number; profile: SegmentProfile }
export interface RunSummary {
  id: number; name: string | null; k: number; n_samples: number;
  silhouette: number | null; inertia: number | null; created_at: string;
}
export interface RunDetail extends RunSummary { segments: Segment[] }
export interface SuggestResult {
  n_samples: number;
  recommended: number | null;
  scores: { k: number; silhouette: number; inertia: number }[];
}
export interface SegmentMember {
  contact_id: number; name: string; phone_number: string; last_sent_at: string | null;
}
export interface SegmentMembers {
  cluster_no: number; size: number; eligible: number; members: SegmentMember[];
}
export interface ImportSummary {
  total: number; imported: number; updated: number; invalid: number; duplicates: number;
  missing_attributes: Record<Attr, number>;
}

/* ── Deteksi kolom CSV (termasuk judul kolom hasil ekspor Google Form) ── */

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
