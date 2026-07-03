import type { ReactNode } from "react";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  iconBg?: string;
  highlighted?: boolean;
  trend?: { value: number; positive: boolean };
  className?: string;
}

export default function StatCard({
  title,
  value,
  subtitle,
  icon,
  iconBg = "bg-primary-100 text-primary-600",
  highlighted,
  trend,
  className = "",
}: StatCardProps) {
  return (
    <div
      className={`relative bg-surface-card rounded-2xl shadow-sm p-6 transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 group ${
        highlighted
          ? "ring-2 ring-primary-500 bg-gradient-to-br from-surface-card to-primary-50/40"
          : ""
      } ${className}`}
    >
      {/* Decorative gradient dot for highlighted cards */}
      {highlighted && (
        <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-primary-500/5 to-transparent rounded-bl-full pointer-events-none" />
      )}

      {icon && (
        <div className={`absolute top-4 right-4 w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 group-hover:scale-110 ${iconBg}`}>
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-ink-muted mb-1.5 tracking-wide">{title}</p>
      <p className={`text-4xl font-bold tracking-tight ${
        highlighted ? "text-primary-700" : "text-ink"
      }`}>{value}</p>
      {subtitle && (
        <p className="text-xs text-ink-light mt-1.5">{subtitle}</p>
      )}
      {trend && (
        <p className={`text-xs font-semibold mt-3 flex items-center gap-1 ${
          trend.positive ? "text-primary-600" : "text-red-500"
        }`}>
          <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full ${
            trend.positive ? "bg-primary-100" : "bg-red-100"
          }`}>
            {trend.positive ? "↑" : "↓"}
          </span>
          <span>{trend.value}% from last period</span>
        </p>
      )}
    </div>
  );
}
