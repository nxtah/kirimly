interface ProgressBarListProps {
  items: {
    label: string;
    value: number;
    max?: number;
    color?: string;
    suffix?: string;
  }[];
  className?: string;
}

export default function ProgressBarList({
  items,
  className = "",
}: ProgressBarListProps) {
  return (
    <div className={`space-y-3 ${className}`}>
      {items.map((item) => {
        const max = item.max ?? 100;
        const pct = Math.min(Math.round((item.value / max) * 100), 100);
        return (
          <div key={item.label}>
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-ink">{item.label}</span>
              <span className="font-semibold text-ink">
                {item.value}
                {item.suffix}
              </span>
            </div>
            <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${pct}%`,
                  backgroundColor: item.color || "#22C55E",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
