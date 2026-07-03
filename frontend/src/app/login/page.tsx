"use client";

import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, MessageSquareText, Eye, EyeOff, Sparkles } from "lucide-react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user?.role === "user") router.replace("/connect-wa");
    else if (user?.role === "admin") router.replace("/admin/dashboard");
  }, [user, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim()) return setError("Username is required");
    if (!password) return setError("Password is required");

    setLoading(true);
    try {
      const data = await login(username, password);
      if (data.user.role !== "user") {
        setError("Admin accounts cannot log in here. Use /admin/login instead.");
        return;
      }
      router.replace("/connect-wa");
    } catch (err: any) {
      setError(err?.body?.error || err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-900 via-primary-700 to-primary-500 flex items-center justify-center px-4 relative overflow-hidden">
      {/* Decorative blobs */}
      <div className="absolute top-[-10%] left-[-5%] w-[500px] h-[500px] rounded-full bg-white/5 blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-15%] right-[-10%] w-[600px] h-[600px] rounded-full bg-emerald-300/10 blur-3xl pointer-events-none" />
      <div className="absolute top-[30%] right-[-8%] w-[300px] h-[300px] rounded-full bg-emerald-200/8 blur-3xl pointer-events-none" />

      {/* Grid pattern overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:64px_64px] pointer-events-none" />

      <div className="w-full max-w-sm relative z-10">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/15 backdrop-blur-sm text-white shadow-xl mb-5 ring-1 ring-white/20">
            <MessageSquareText size={30} />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Kirimly</h1>
          <p className="text-sm text-emerald-100/80 mt-1.5">Multi-tenant WhatsApp broadcast</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white/10 backdrop-blur-xl rounded-3xl p-7 space-y-5 ring-1 ring-white/20 shadow-2xl">
          {/* Header accent */}
          <div className="flex items-center gap-2.5 mb-1">
            <Sparkles size={16} className="text-emerald-200" />
            <span className="text-xs font-medium text-emerald-100/80 uppercase tracking-widest">Sign in</span>
          </div>

          {error && (
            <div className="bg-red-400/15 border border-red-400/30 text-red-100 text-sm rounded-2xl px-4 py-3 flex items-start gap-2.5 backdrop-blur-sm">
              <span className="mt-0.5 shrink-0 text-red-200">&#9888;</span>
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} className="text-red-200/70 hover:text-red-100 underline shrink-0">Dismiss</button>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="username" className="block text-xs font-semibold text-emerald-100/80 uppercase tracking-wider">
              Username
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-white/10 border border-white/20 rounded-2xl px-4 py-3 text-sm text-white placeholder-emerald-200/40 focus:outline-none focus:ring-2 focus:ring-emerald-300/50 focus:border-emerald-300/50 disabled:opacity-50 transition-all backdrop-blur-sm"
              placeholder="Enter your username"
              disabled={loading}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="block text-xs font-semibold text-emerald-100/80 uppercase tracking-wider">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPass ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-2xl px-4 py-3 text-sm text-white placeholder-emerald-200/40 focus:outline-none focus:ring-2 focus:ring-emerald-300/50 focus:border-emerald-300/50 disabled:opacity-50 transition-all backdrop-blur-sm pr-11"
                placeholder="Enter your password"
                disabled={loading}
              />
              <button type="button" onClick={() => setShowPass(!showPass)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-emerald-200/50 hover:text-emerald-200 transition-colors">
                {showPass ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading}
            className="w-full flex items-center justify-center gap-2.5 bg-white text-emerald-800 rounded-2xl px-4 py-3 text-sm font-bold hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-emerald-700 disabled:opacity-50 transition-all shadow-lg shadow-emerald-900/20 hover:shadow-xl active:scale-[0.98]">
            {loading ? (
              <><Loader2 size={17} className="animate-spin" /> Signing in...</>
            ) : (
              <><MessageSquareText size={17} /> Sign in</>
            )}
          </button>
        </form>

        <p className="text-center text-xs text-emerald-200/40 mt-8 tracking-wide">
          &copy; 2026 Kirimly &middot; All rights reserved
        </p>
      </div>
    </div>
  );
}
