"use client";

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceDot } from "recharts";
import type { EvalRow } from "@/lib/segmentation";

interface ElbowChartProps {
  scores: EvalRow[];
  /** K hasil metode Elbow (titik siku) — ditandai pada grafik */
  elbowK?: number | null;
  /** K yang saat ini dipilih pengguna */
  selectedK?: number | null;
}

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));

/** Grafik Elbow: K (sumbu X) vs Inertia/SSE (sumbu Y), dari hasil perhitungan aktual — bukan data contoh. */
export default function ElbowChart({ scores, elbowK, selectedK }: ElbowChartProps) {
  const data = scores.map((s) => ({ k: s.k, sse: s.inertia }));
  const at = (k?: number | null) => data.find((d) => d.k === k);
  const elbow = at(elbowK);
  const selected = at(selectedK);

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 16, right: 24, bottom: 24, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis dataKey="k" type="number" domain={["dataMin", "dataMax"]} ticks={data.map((d) => d.k)} allowDecimals={false}
            label={{ value: "Jumlah cluster (K)", position: "insideBottom", offset: -12, fontSize: 12, fill: "#6B7280" }} tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} tickFormatter={fmt} width={48}
            label={{ value: "Inertia / SSE", angle: -90, position: "insideLeft", fontSize: 12, fill: "#6B7280" }} />
          <Tooltip formatter={(v) => [fmt(Number(v)), "SSE"]} labelFormatter={(k) => `K = ${k}`} />
          <Line type="monotone" dataKey="sse" stroke="#22C55E" strokeWidth={2.5} dot={{ r: 4, fill: "#22C55E" }} isAnimationActive={false} />
          {elbow && <ReferenceDot x={elbow.k} y={elbow.sse} r={9} fill="none" stroke="#F59E0B" strokeWidth={2.5} />}
          {selected && <ReferenceDot x={selected.k} y={selected.sse} r={5} fill="#111827" stroke="none" />}
        </LineChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-4 justify-center text-[11px] text-ink-muted -mt-1">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-primary-500" /> SSE per K</span>
        {elbow && <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full border-2 border-amber-500" /> Titik siku (Elbow): K = {elbow.k}</span>}
        {selected && <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-gray-900" /> K dipilih: {selected.k}</span>}
      </div>
    </div>
  );
}
