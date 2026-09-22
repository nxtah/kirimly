"use client";

import { Send, Users } from "lucide-react";
import ProgressBarList from "@/components/ui/ProgressBarList";
import { ATTRS, ATTR_LABELS, type Segment } from "@/lib/segmentation";

interface ClusterCardProps {
  segment: Segment;
  total: number;
  color: string;
  onViewMembers: () => void;
  onSendBlast: () => void;
}

export default function ClusterCard({ segment, total, color, onViewMembers, onSendBlast }: ClusterCardProps) {
  const pct = total > 0 ? Math.round((segment.size / total) * 100) : 0;

  return (
    <div className="bg-surface-card rounded-2xl shadow-card p-5 flex flex-col">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl text-white text-sm font-bold flex items-center justify-center" style={{ backgroundColor: color }}>
            {segment.cluster_no}
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">Cluster {segment.cluster_no}</p>
            <p className="text-xs text-ink-muted">{segment.size} anggota · {pct}% dari total</p>
          </div>
        </div>
      </div>

      <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">Karakteristik dominan</p>
      <div className="space-y-4 flex-1">
        {ATTRS.map((attr) => {
          const top = segment.profile.attributes[attr] || [];
          return (
            <div key={attr}>
              <p className="text-xs text-ink-muted mb-1.5">{ATTR_LABELS[attr]}</p>
              <ProgressBarList
                items={top.map((t) => ({ label: t.value, value: t.percent, max: 100, suffix: "%", color }))}
              />
            </div>
          );
        })}
      </div>

      <div className="flex gap-2 mt-5 pt-4 border-t border-gray-100">
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
