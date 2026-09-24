"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { api } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import WideModal from "./WideModal";
import type { RunDetailMember } from "@/lib/segmentation";

interface MembersModalProps {
  open: boolean;
  onClose: () => void;
  runId: number | null;
  clusterNo: number | null;
}

interface DetailsRes {
  members: RunDetailMember[];
  pagination: { page: number; total: number; total_pages: number };
}

const PAGE_SIZE = 20;

/** Detail anggota cluster: nama, nomor, keempat variabel, dan label cluster (untuk analisis & dokumentasi). */
export default function MembersModal({ open, onClose, runId, clusterNo }: MembersModalProps) {
  const [data, setData] = useState<DetailsRes | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { if (open) setPage(1); }, [open, runId, clusterNo]);

  useEffect(() => {
    if (!open || !runId || !clusterNo) return;
    setData(null);
    setError(null);
    api
      .get<DetailsRes>(`/api/segmentation/runs/${runId}/details`, { params: { cluster: clusterNo, page, limit: PAGE_SIZE } })
      .then(setData)
      .catch((err) => setError(err?.body?.error || "Gagal memuat anggota"));
  }, [open, runId, clusterNo, page]);

  async function exportAll() {
    if (!runId) return;
    setExporting(true);
    try {
      const res = await api.get<DetailsRes>(`/api/segmentation/runs/${runId}/details`, { params: { cluster: clusterNo ?? undefined, limit: 5000 } });
      downloadCsv(`anggota-cluster${clusterNo ? `-${clusterNo}` : ""}-run-${runId}.csv`, [
        ["Nama", "Nomor_WhatsApp", "Minat_Program_Studi", "Asal_Sekolah", "Jurusan_Sekolah", "Domisili", "Cluster"],
        ...res.members.map((m) => [m.name, m.phone_number, m.program_studi, m.asal_sekolah, m.jurusan_sekolah, m.domisili, m.cluster_no]),
      ]);
    } catch (err: any) {
      setError(err?.body?.error || "Gagal mengunduh");
    } finally {
      setExporting(false);
    }
  }

  const totalPages = data?.pagination.total_pages || 1;

  return (
    <WideModal open={open} onClose={onClose} title={`Anggota Cluster ${clusterNo ?? ""}`}>
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      {!data && !error && <p className="text-sm text-ink-muted">Memuat…</p>}
      {data && (
        <>
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <p className="text-xs text-ink-muted"><strong className="text-ink">{data.pagination.total}</strong> anggota di cluster ini</p>
            <button onClick={exportAll} disabled={exporting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-ink-muted bg-surface-card rounded-xl border border-gray-200 hover:bg-gray-50 disabled:opacity-50">
              <Download size={13} /> {exporting ? "Menyiapkan…" : "Unduh CSV"}
            </button>
          </div>
          <div className="border border-gray-100 rounded-xl overflow-hidden">
            <div className="max-h-[52vh] overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-ink-muted sticky top-0">
                  <tr>
                    {["Nama", "Nomor WhatsApp", "Minat Program Studi", "Asal Sekolah", "Jurusan Sekolah", "Domisili", "Cluster"].map((h) => (
                      <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.members.map((m) => (
                    <tr key={m.prospect_id} className="border-t border-gray-50">
                      <td className="px-3 py-2 text-ink whitespace-nowrap">{m.name}</td>
                      <td className="px-3 py-2 font-mono text-ink-muted whitespace-nowrap">{m.phone_number}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{m.program_studi}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{m.asal_sekolah}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{m.jurusan_sekolah}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{m.domisili}</td>
                      <td className="px-3 py-2 font-semibold text-ink">{m.cluster_no}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-3 text-xs text-ink-muted">
              <span>Halaman {page} dari {totalPages}</span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 disabled:opacity-40">Sebelumnya</button>
                <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="px-3 py-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 disabled:opacity-40">Berikutnya</button>
              </div>
            </div>
          )}
        </>
      )}
    </WideModal>
  );
}
