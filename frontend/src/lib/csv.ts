// Unduh data sebagai CSV (untuk lampiran dokumentasi TA). Berjalan sepenuhnya di browser.

type Cell = string | number | null | undefined;

function escapeCell(v: Cell): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** BOM di depan supaya Excel membaca UTF-8 (huruf berdiakritik / karakter khusus) dengan benar. */
export function downloadCsv(filename: string, rows: Cell[][]): void {
  const csv = "﻿" + rows.map((r) => r.map(escapeCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Angka desimal dengan titik (aman dibaca Excel/SPSS/Python) atau string kosong bila null. */
export function num(v: number | null | undefined, digits = 4): string {
  return v == null || !Number.isFinite(v) ? "" : v.toFixed(digits);
}
