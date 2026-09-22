"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import WideModal from "./WideModal";
import type { SegmentMembers } from "@/lib/segmentation";

interface MembersModalProps {
  open: boolean;
  onClose: () => void;
  runId: number | null;
  clusterNo: number | null;
}

export default function MembersModal({ open, onClose, runId, clusterNo }: MembersModalProps) {
  const [data, setData] = useState<SegmentMembers | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !runId || !clusterNo) return;
    setData(null);
    setError(null);
    api
      .get<SegmentMembers>(`/api/segmentation/runs/${runId}/segments/${clusterNo}/members`, { params: { limit: 500 } })
      .then(setData)
      .catch((err) => setError(err?.body?.error || "Gagal memuat anggota"));
  }, [open, runId, clusterNo]);

  return (
    <WideModal open={open} onClose={onClose} title={`Anggota Cluster ${clusterNo ?? ""}`}>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data && !error && <p className="text-sm text-ink-muted">Memuat…</p>}
      {data && (
        <>
          <p className="text-xs text-ink-muted mb-3">
            {data.size} anggota di cluster ini · <strong className="text-ink">{data.eligible}</strong> bisa dikirimi blast
            {data.eligible < data.size && " (sisanya diblokir atau kontaknya sudah dihapus)"}. Yang belum pernah dikirimi ditampilkan lebih dulu.
          </p>
          <div className="border border-gray-100 rounded-xl overflow-hidden">
            <div className="max-h-[50vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-ink-muted sticky top-0">
                  <tr>
                    <th className="text-left font-medium px-4 py-2">Nama</th>
                    <th className="text-left font-medium px-4 py-2">Nomor WhatsApp</th>
                    <th className="text-left font-medium px-4 py-2">Terakhir dikirimi</th>
                  </tr>
                </thead>
                <tbody>
                  {data.members.map((m) => (
                    <tr key={m.contact_id} className="border-t border-gray-50">
                      <td className="px-4 py-2 text-ink">{m.name}</td>
                      <td className="px-4 py-2 font-mono text-xs text-ink-muted">{m.phone_number}</td>
                      <td className="px-4 py-2 text-xs text-ink-muted">
                        {m.last_sent_at ? new Date(m.last_sent_at).toLocaleString() : <span className="text-primary-600">Belum pernah</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </WideModal>
  );
}
