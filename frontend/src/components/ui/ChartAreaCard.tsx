"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface ChartAreaCardProps {
  title: string;
  subtitle?: string;
  data: any[];
  dataKey: string;
  xKey?: string;
  color?: string;
  formatValue?: (v: number) => string;
  className?: string;
}

function CustomTooltip({ active, payload, label, formatValue }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-card-heavy">
      <p className="text-gray-400 mb-0.5">{label}</p>
      <p className="font-semibold">
        {formatValue ? formatValue(payload[0].value) : payload[0].value}
      </p>
    </div>
  );
}

export default function ChartAreaCard({
  title,
  subtitle,
  data,
  dataKey,
  xKey = "name",
  color = "#22C55E",
  formatValue,
  className = "",
}: ChartAreaCardProps) {
  return (
    <div
      className={`bg-surface-card rounded-2xl shadow-card p-5 ${className}`}
    >
      <div className="mb-4">
        <p className="text-sm font-semibold text-ink">{title}</p>
        {subtitle && (
          <p className="text-xs text-ink-muted mt-0.5">{subtitle}</p>
        )}
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id={`gradient-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
          <XAxis
            dataKey={xKey}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "#9CA3AF" }}
            dy={8}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "#9CA3AF" }}
            dx={-4}
          />
          <Tooltip
            content={<CustomTooltip formatValue={formatValue} />}
            cursor={{ stroke: "#22C55E", strokeWidth: 1, strokeDasharray: "4 4" }}
          />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            fill={`url(#gradient-${dataKey})`}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
