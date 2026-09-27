"use client";

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

interface Series {
  label: string;
  color: string;
  values: number[];
}

interface RewardCurveChartProps {
  /** Satu atau dua seri (kumulatif rata-rata reward per langkah), semua sepanjang jumlah langkah yang sama. */
  series: Series[];
  xLabel?: string;
}

const fmt = (v: number) => v.toFixed(3);

/**
 * Grafik garis reward kumulatif rata-rata per langkah. Dipakai untuk dua konteks:
 *  - performa CMAB nyata (satu garis, dari `reward-timeseries`)
 *  - evaluation mode (dua garis: LinUCB vs baseline statis, dari data SIMULASI)
 * Selalu dari data yang dihitung backend — tidak ada nilai contoh/hardcode.
 */
export default function RewardCurveChart({ series, xLabel = "Langkah ke-" }: RewardCurveChartProps) {
  const length = Math.max(0, ...series.map((s) => s.values.length));
  const data = Array.from({ length }, (_, i) => {
    const row: Record<string, number> = { step: i + 1 };
    series.forEach((s) => { row[s.label] = s.values[i]; });
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 16, right: 24, bottom: 24, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
        <XAxis dataKey="step" type="number" domain={["dataMin", "dataMax"]} allowDecimals={false}
          label={{ value: xLabel, position: "insideBottom", offset: -12, fontSize: 12, fill: "#6B7280" }} tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={fmt} width={52} domain={[0, "dataMax"]}
          label={{ value: "Avg reward kumulatif", angle: -90, position: "insideLeft", fontSize: 12, fill: "#6B7280" }} />
        <Tooltip formatter={(v) => fmt(Number(v))} labelFormatter={(s) => `${xLabel}${s}`} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s) => (
          <Line key={s.label} type="monotone" dataKey={s.label} stroke={s.color} strokeWidth={2.5} dot={false} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
