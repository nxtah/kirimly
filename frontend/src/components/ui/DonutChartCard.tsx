"use client";

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from "recharts";

interface DonutChartCardProps {
  title: string;
  subtitle?: string;
  data: { name: string; value: number; color?: string }[];
  colors?: string[];
  formatValue?: (v: number) => string;
  className?: string;
}

const DEFAULT_COLORS = ["#22C55E", "#86EFAC", "#FBBF24", "#F87171", "#A78BFA", "#38BDF8"];

function CustomTooltip({ active, payload, formatValue }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-card-heavy">
      <p className="font-semibold">{d.name}</p>
      <p className="text-gray-300 mt-0.5">
        {formatValue ? formatValue(d.value) : d.value}
      </p>
    </div>
  );
}

export default function DonutChartCard({
  title,
  subtitle,
  data,
  colors = DEFAULT_COLORS,
  formatValue,
  className = "",
}: DonutChartCardProps) {
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div
      className={`bg-surface-card rounded-2xl shadow-card p-5 ${className}`}
    >
      <div className="mb-3">
        <p className="text-sm font-semibold text-ink">{title}</p>
        {subtitle && (
          <p className="text-xs text-ink-muted mt-0.5">{subtitle}</p>
        )}
      </div>
      <div className="flex flex-col items-center">
        <ResponsiveContainer width="100%" height={180}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={80}
              paddingAngle={3}
              dataKey="value"
              stroke="none"
            >
              {data.map((_, i) => (
                <Cell
                  key={i}
                  fill={data[i]?.color || colors[i % colors.length]}
                />
              ))}
            </Pie>
            <Tooltip
              content={<CustomTooltip formatValue={formatValue} />}
            />
          </PieChart>
        </ResponsiveContainer>
        {/* Legend */}
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 mt-2">
          {data.map((d, i) => (
            <div key={d.name} className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: d.color || colors[i % colors.length] }}
              />
              <span className="text-xs text-ink-muted">{d.name}</span>
              <span className="text-xs font-medium text-ink">
                {total > 0 ? Math.round((d.value / total) * 100) : 0}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
