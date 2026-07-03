"use client";

import { useAuth } from "@/hooks/useAuth";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  hideAvatar?: boolean;
}

export default function PageHeader({
  title,
  subtitle,
  actions,
  hideAvatar,
}: PageHeaderProps) {
  const { user } = useAuth();
  const initials = (user?.display_name || user?.username || "U")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-xl font-bold text-ink">{title}</h1>
        {subtitle && <p className="text-sm text-ink-muted mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3">
        {actions}
        {!hideAvatar && (
          <div className="flex items-center gap-2 bg-surface-card rounded-full pl-3 pr-1 py-1 shadow-card">
            <span className="text-xs text-ink-muted hidden sm:inline">
              {user?.display_name || user?.username}
            </span>
            <div className="w-8 h-8 rounded-full bg-primary-500 text-white text-sm font-bold flex items-center justify-center">
              {initials}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
