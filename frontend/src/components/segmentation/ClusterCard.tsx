"use client";

import { useState } from "react";
import { Send, Users } from "lucide-react";
import { ATTRS, ATTR_LABELS, type Attr, type DominantValue, type Segment } from "@/lib/segmentation";

interface ClusterCardProps {
  segment: Segment;
  total: number;
  color: string;
  onViewMembers: () => void;
  onSendBlast: () => void;
}

const PREVIEW_ROWS = 5;

/** Distribusi satu variabel: kategori, jumlah, persentase (5 teratas; sisanya bisa dibuka). */
function DistributionTable({ attr, items, size, color }: { attr: Attr; items: DominantValue[]; size: number; color: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, PREVIEW_ROWS);
  const hidden = items.length - shown.length;

  return (
    <div>
      <p className="text-xs font-semibold text-ink mb-1.5">{ATTR_LABELS[attr]} <span className="font-normal text-ink-light">({items.length} kategori)</span></p>
      <table className="w-full text-xs">
        <thead className="text-ink-muted">
          <tr className="border-b border-gray-100">
            <th className="text-left font-medium py-1">Kategori</th>
            <th className="text-right font-medium py-1 w-12">Jumlah</th>
            <th className="text-right font-medium py-1 w-14">%</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((it) => (
            <tr key={it.value} className="border-b border-gray-50 last:border-0">
              <td className="py-1 pr-2 text-ink">
                <div className="truncate max-w-[180px]" title={it.value}>{it.value}</div>
                <div className="h-1 bg-gray-100 rounded-full mt-0.5 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(it.percent, 100)}%`, backgroundColor: color }} />
                </div>
              </td>
              <td className="py-1 text-right tabular-nums">{it.count}</td>
              <td className="py-1 text-right tabular-nums">{it.percent.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(hidden > 0 || all) && items.length > PREVIEW_ROWS && (
        <button onClick={() => setAll(!all)} className="text-[11px] text-primary-600 hover:underline mt-1">
          {all ? "Ringkas" : `Lihat ${hidden} kategori lain`}
        </button>
      )}
      <p className="text-[10px] text-ink-light mt-0.5">Total {size} anggota</p>
    </div>
  );
}

/** Detail Cluster: distribusi keempat variabel + aksi. Tidak mengklaim seluruh anggota berkategori sama. */
export default function ClusterCard({ segment, total, color, onViewMembers, onSendBlast }: ClusterCardProps) {
  const pct = total > 0 ? ((segment.size / total) * 100).toFixed(1) : "0";

  return (
    <div className="bg-surface-card rounded-2xl shadow-card p-5 flex flex-col">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl text-white text-sm font-bold flex items-center justify-center" style={{ backgroundColor: color }}>
          {segment.cluster_no}
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">Cluster {segment.cluster_no}</p>
          <p className="text-xs text-ink-muted">{segment.size} anggota · {pct}% dari total</p>
        </div>
      </div>

      <div className="space-y-5 flex-1">
        {ATTRS.map((attr) => {
          // run lama hanya menyimpan top-3 (attributes); run baru menyimpan distribusi penuh
          const items = segment.profile.distribution?.[attr] ?? segment.profile.attributes[attr] ?? [];
          return <DistributionTable key={attr} attr={attr} items={items} size={segment.size} color={color} />;
        })}
      </div>

      <p className="text-[10px] text-ink-light mt-4">
        Anggota satu cluster mirip secara keseluruhan pada 4 variabel, tidak harus memiliki kategori yang sama pada setiap variabel.
      </p>

      <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100">
        <button onClick={onViewMembers}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-ink-muted bg-gray-50 rounded-xl hover:bg-gray-100 transition-all">
          <Users size={14} /> Lihat Anggota
        </button>
        <button onClick={onSendBlast}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 transition-all shadow-sm">
          <Send size={14} /> Kirim Blast
        </button>
      </div>
    </div>
  );
}
