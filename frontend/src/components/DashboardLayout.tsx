"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import {
  LayoutDashboard,
  Users,
  MessageSquareText,
  Send,
  ClipboardList,
  Network,
  Brain,
  LogOut,
  ChevronDown,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/templates", label: "Templates", icon: MessageSquareText },
  { href: "/segmentation", label: "Segments", icon: Network },
  { href: "/blast", label: "Blasts", icon: Send },
  { href: "/cmab", label: "CMAB", icon: Brain },
  { href: "/logs", label: "Logs", icon: ClipboardList },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const initials = (user?.display_name || user?.username || "U").slice(0, 2).toUpperCase();
  const sidebarW = collapsed ? "w-20" : "w-60";

  return (
    <div className="h-screen bg-surface flex overflow-hidden">
      {/* ── Desktop sidebar ── */}
      <aside
        className={`hidden lg:flex ${sidebarW} bg-surface-card border-r border-gray-200 flex-col shrink-0 transition-all duration-300`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          {!collapsed && (
            <div>
              <h1 className="text-xl font-bold text-ink tracking-tight">Kirimly</h1>
              <p className="text-xs text-ink-light mt-0.5 truncate">
                {user?.display_name || user?.username}
              </p>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1.5 text-ink-light hover:text-ink rounded-lg hover:bg-gray-100 transition-all"
          >
            {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <a
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? "bg-primary-50 text-primary-700 shadow-sm"
                    : "text-ink-muted hover:bg-gray-100 hover:text-ink"
                } ${collapsed ? "justify-center px-2" : ""}`}
                title={collapsed ? item.label : undefined}
              >
                <Icon size={20} className={isActive ? "text-primary-500" : "shrink-0"} />
                {!collapsed && <span>{item.label}</span>}
              </a>
            );
          })}
        </nav>

        {/* Bottom */}
        <div className="p-3 border-t border-gray-100 relative" ref={dropdownRef}>
          {collapsed ? (
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="w-full flex items-center justify-center p-2 rounded-xl hover:bg-gray-100 transition-all"
            >
              <div className="w-8 h-8 rounded-full bg-primary-500 text-white text-sm font-bold flex items-center justify-center">
                {initials}
              </div>
            </button>
          ) : (
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-gray-100 transition-all"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-full bg-primary-500 text-white text-sm font-bold flex items-center justify-center shrink-0">
                  {initials}
                </div>
                <div className="text-left min-w-0">
                  <p className="text-sm font-medium text-ink truncate">
                    {user?.display_name || user?.username}
                  </p>
                  <p className="text-xs text-ink-light truncate">{user?.username}</p>
                </div>
              </div>
              <ChevronDown size={14} className="text-ink-light shrink-0" />
            </button>
          )}

          {dropdownOpen && (
            <div className="absolute bottom-full left-3 right-3 mb-2 bg-surface-card rounded-2xl shadow-card-heavy border border-gray-100 py-1">
              <button
                onClick={() => { logout(); router.push("/login"); }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors rounded-xl"
              >
                <LogOut size={14} /> Sign out
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ── Mobile floating bottom nav ── */}
      <nav className="fixed bottom-3 inset-x-3 z-40 lg:hidden">
        <div className="bg-white/80 backdrop-blur-xl border border-white/30 shadow-lg shadow-black/5 rounded-2xl px-1.5 py-1.5 overflow-x-auto">
          <div className="flex items-center justify-around gap-0.5 min-w-max">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <a
                  key={item.href}
                  href={item.href}
                  className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl text-[10px] font-medium transition-all duration-200 shrink-0 ${
                    isActive
                      ? "text-primary-600 bg-primary-50 shadow-sm"
                      : "text-ink-light hover:text-ink-muted"
                  }`}
                >
                  <Icon size={20} />
                  <span>{item.label}</span>
                </a>
              );
            })}
          </div>
        </div>
      </nav>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-y-auto pb-20 lg:pb-0">
        {children}
      </main>
    </div>
  );
}
