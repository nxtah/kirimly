"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import ConfirmDialog from "@/components/ConfirmDialog";

interface Prospect {
  id: number; name: string; phone_number: string;
  program_studi: string; asal_sekolah: string; jurusan_sekolah: string; domisili: string;
}
interface ListRes {
  prospects: Prospect[];
  pagination: { page: number; total: number; total_pages: number };
}

interface ProspectsTableProps {
  refreshKey: number;
  onChanged: () => void;
}

export default function ProspectsTable({ refreshKey, onChanged }: ProspectsTableProps) {
  const [data, setData] = useState<ListRes | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Prospect | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async (p: number, q: string) => {
    try {
      setData(await api.get<ListRes>("/api/segmentation/prospects", { params: { page: p, limit: 10, search: q || undefined } }));
      setError(null);
    } catch (err: any) {
      setError(err?.body?.error || "Gagal memuat data");
    }
  }, []);

  useEffect(() => { load(page, search); }, [load, page, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function onSearch(v: string) {
    setSearch(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { setPage(1); load(1, v); }, 350);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.del(`/api/segmentation/prospects/${deleteTarget.id}`);
      setDeleteTarget(null);
      onChanged();
    } catch (err: any) {
      setError(err?.body?.error || "Gagal menghapus");
    } finally {
      setDeleting(false);
    }
  }

  const totalPages = data?.pagination.total_pages || 1;

  return (
    <div className="bg-surface-card rounded-2xl shadow-card p-5">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-ink">Data Calon Mahasiswa</p>
          <p className="text-xs text-ink-muted mt-0.5">{data?.pagination.total ?? 0} data</p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-light" />
          <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Cari nama, sekolah, kota…"
            className="w-full bg-white border border-gray-200 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
        </div>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-ink-muted">
            <tr className="border-b border-gray-100">
              {["Nama", "Nomor", "Program Studi", "Asal Sekolah", "Jurusan", "Domisili", ""].map((h) => (
                <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.prospects.map((p) => (
              <tr key={p.id} className="border-b border-gray-50 last:border-0">
                <td className="px-3 py-2 font-medium text-ink whitespace-nowrap">{p.name}</td>
                <td className="px-3 py-2 font-mono text-xs text-ink-muted">{p.phone_number}</td>
                <td className="px-3 py-2 whitespace-nowrap">{p.program_studi}</td>
                <td className="px-3 py-2 whitespace-nowrap">{p.asal_sekolah}</td>
                <td className="px-3 py-2 whitespace-nowrap">{p.jurusan_sekolah}</td>
                <td className="px-3 py-2 whitespace-nowrap">{p.domisili}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => setDeleteTarget(p)} className="text-ink-light hover:text-red-500 transition-colors" title="Hapus">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {data && data.prospects.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-ink-muted">Belum ada data. Import CSV untuk memulai.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-xs text-ink-muted">
          <span>Halaman {page} dari {totalPages}</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 disabled:opacity-40">Sebelumnya</button>
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="px-3 py-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 disabled:opacity-40">Berikutnya</button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Hapus data calon mahasiswa"
        message={`Hapus ${deleteTarget?.name} dari data segmentasi? Kontaknya di daftar Contacts tidak ikut terhapus, dan hasil cluster lama yang memuatnya akan berkurang anggotanya.`}
        loading={deleting}
      />
    </div>
  );
}
