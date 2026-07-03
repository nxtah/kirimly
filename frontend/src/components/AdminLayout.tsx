"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import ProtectedRoute from "./ProtectedRoute";
import {
  LayoutDashboard,
  Users,
  Radio,
  LogOut,
  ChevronDown,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/monitoring", label: "Monitoring", icon: Radio },
];

function AdminSidebar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const initials = (user?.display_name || user?.username || "A").slice(0, 2).toUpperCase();
  const sidebarW = collapsed ? "w-20" : "w-64";

  return (
    <div className="h-screen bg-gray-950 flex overflow-hidden">
      {/* Desktop sidebar */}
      <aside className={`hidden lg:flex ${sidebarW} bg-gray-950 border-r border-gray-800 flex-col shrink-0 transition-all duration-300`}>
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          {!collapsed && (
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">Kirimly</h1>
              <p className="text-xs text-gray-500 mt-0.5">Admin Panel</p>
            </div>
          )}
          <button onClick={() => setCollapsed(!collapsed)}
            className="p-1.5 text-gray-500 hover:text-white rounded-lg hover:bg-gray-800 transition-all">
            {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <a key={item.href} href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                  isActive ? "bg-primary-600 text-white shadow-sm" : "text-gray-400 hover:bg-gray-800 hover:text-white"
                } ${collapsed ? "justify-center px-2" : ""}`}
                title={collapsed ? item.label : undefined}
              >
                <Icon size={20} className="shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </a>
            );
          })}
        </nav>

        <div className="border-t border-gray-800 relative" ref={dropdownRef}>
          {collapsed ? (
            <div className="p-3">
              <button onClick={() => setDropdownOpen(!dropdownOpen)}
                className="w-full flex justify-center p-2 rounded-xl hover:bg-gray-800 transition-all">
                <div className="w-8 h-8 rounded-full bg-primary-500 text-white text-sm font-bold flex items-center justify-center">{initials}</div>
              </button>
            </div>
          ) : (
            <button onClick={() => setDropdownOpen(!dropdownOpen)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800 transition-all">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-full bg-primary-500 text-white text-sm font-bold flex items-center justify-center shrink-0">{initials}</div>
                <div className="text-left min-w-0">
                  <p className="text-sm font-medium text-white truncate">{user?.display_name || user?.username}</p>
                  <p className="text-xs text-gray-500 truncate">{user?.username}</p>
                </div>
              </div>
              <ChevronDown size={14} className="text-gray-500 shrink-0" />
            </button>
          )}
          {dropdownOpen && (
            <div className="absolute bottom-full left-3 right-3 mb-2 bg-gray-900 rounded-2xl shadow-card-heavy border border-gray-800 py-1">
              <button onClick={() => { logout(); router.push("/login"); }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-400 hover:bg-gray-800 transition-colors rounded-xl">
                <LogOut size={14} /> Sign out
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile floating bottom nav */}
      <nav className="fixed bottom-3 inset-x-3 z-40 lg:hidden">
        <div className="bg-gray-900/80 backdrop-blur-xl border border-gray-800/50 shadow-lg shadow-black/10 rounded-2xl px-2 py-1.5">
          <div className="flex items-center justify-around">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <a key={item.href} href={item.href}
                  className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-[10px] font-medium transition-all duration-200 ${
                    isActive ? "text-primary-400 bg-gray-800" : "text-gray-500 hover:text-gray-300"
                  }`}>
                  <Icon size={20} />
                  <span>{item.label}</span>
                </a>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="flex-1 overflow-y-auto bg-gray-50 pb-20 lg:pb-0">{children}</main>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute requiredRole="admin">
      <AdminSidebar>{children}</AdminSidebar>
    </ProtectedRoute>
  );
}
