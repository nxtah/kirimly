"use client";

import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, Shield, Eye, EyeOff, Sparkles } from "lucide-react";

export default function AdminLoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user?.role === "admin") router.replace("/admin/dashboard");
  }, [user, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim()) return setError("Username is required");
    if (!password) return setError("Password is required");

    setLoading(true);
    try {
      const data = await login(username, password);
      if (data.user.role !== "admin") {
        setError("This account is not an admin");
        return;
      }
      router.replace("/admin/dashboard");
    } catch (err: any) {
      setError(err?.body?.error || err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex items-center justify-center px-4 relative overflow-hidden">
      {/* Decorative blobs */}
      <div className="absolute top-[-8%] left-[-3%] w-[450px] h-[450px] rounded-full bg-emerald-500/5 blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-12%] right-[-5%] w-[500px] h-[500px] rounded-full bg-emerald-400/5 blur-3xl pointer-events-none" />

      {/* Grid pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px] pointer-events-none" />

      <div className="w-full max-w-sm relative z-10">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/15 backdrop-blur-sm text-emerald-400 shadow-xl mb-5 ring-1 ring-emerald-500/20">
            <Shield size={30} />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Kirimly</h1>
          <p className="text-sm text-gray-400 mt-1.5">Admin panel</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white/5 backdrop-blur-xl rounded-3xl p-7 space-y-5 ring-1 ring-white/10 shadow-2xl">
          <div className="flex items-center gap-2.5 mb-1">
            <Sparkles size={16} className="text-emerald-400/60" />
            <span className="text-xs font-medium text-gray-400 uppercase tracking-widest">Admin sign in</span>
          </div>

          {error && (
            <div className="bg-red-400/10 border border-red-400/20 text-red-300 text-sm rounded-2xl px-4 py-3 flex items-start gap-2.5 backdrop-blur-sm">
              <span className="mt-0.5 shrink-0 text-red-300">&#9888;</span>
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} className="text-red-300/60 hover:text-red-200 underline shrink-0">Dismiss</button>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="admin-username" className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Username
            </label>
            <input
              id="admin-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400/30 disabled:opacity-50 transition-all backdrop-blur-sm"
              placeholder="Admin username"
              disabled={loading}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="admin-password" className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Password
            </label>
            <div className="relative">
              <input
                id="admin-password"
                type={showPass ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400/30 disabled:opacity-50 transition-all backdrop-blur-sm pr-11"
                placeholder="Enter admin password"
                disabled={loading}
              />
              <button type="button" onClick={() => setShowPass(!showPass)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors">
                {showPass ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading}
            className="w-full flex items-center justify-center gap-2.5 bg-emerald-500 text-white rounded-2xl px-4 py-3 text-sm font-bold hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/50 focus:ring-offset-2 focus:ring-offset-gray-900 disabled:opacity-50 transition-all shadow-lg shadow-emerald-500/20 hover:shadow-xl active:scale-[0.98]">
            {loading ? (
              <><Loader2 size={17} className="animate-spin" /> Signing in...</>
            ) : (
              <><Shield size={17} /> Sign in as Admin</>
            )}
          </button>
        </form>

        <p className="text-center text-xs text-gray-600 mt-8 tracking-wide">
          Admin access only &middot; Kirimly 2026
        </p>
      </div>
    </div>
  );
}
