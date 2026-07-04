"use client";

import Link from "next/link";
import { ArrowRight, Smartphone, ShieldCheck, Users } from "lucide-react";

export default function Hero() {
  return (
    <section className="relative pt-28 pb-16 md:pt-36 md:pb-24 overflow-hidden">
      {/* Soft bg gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary-50/40 via-white to-primary-50/20 pointer-events-none" />

      <div className="relative max-w-6xl mx-auto px-6 grid md:grid-cols-2 gap-12 md:gap-16 items-center">
        {/* Left */}
        <div>
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-primary-50 border border-primary-200 rounded-full px-4 py-1.5 text-xs font-semibold text-primary-700 mb-6">
            <span className="w-2 h-2 rounded-full bg-primary-500" />
            Broadcast WhatsApp Tanpa Ribet
          </div>

          {/* Headline with serif italic accent */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 tracking-tight leading-[1.1] mb-5">
            Kirim Broadcast{" "}
            <span className="font-serif-italic text-primary-500 font-normal">WhatsApp</span>{" "}
            Ke Banyak Kontak{" "}
            <span className="font-serif-italic text-primary-500 font-normal">Sekali Klik</span>
          </h1>

          <p className="text-base sm:text-lg text-gray-500 leading-relaxed max-w-lg mb-8">
            Kirimly membantu pelaku UMKM, freelancer, dan komunitas mengirim pesan
            broadcast ke ratusan kontak WhatsApp secara aman — tanpa kena banned,
            tanpa ribet.
          </p>

          {/* CTA buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-primary-500 rounded-full hover:bg-primary-700 hover:scale-[1.02] transition-all shadow-sm"
            >
              Mulai Sekarang <ArrowRight size={16} />
            </Link>
            <button
              onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })}
              className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-gray-600 hover:text-gray-900 transition-all"
            >
              Pelajari Lebih Lanjut &rarr;
            </button>
          </div>
        </div>

        {/* Right — Abstract illustration with annotation labels */}
        <div className="relative hidden md:flex items-center justify-center h-[420px]">
          {/* Large morphing blob */}
          <svg className="absolute w-80 h-80" viewBox="0 0 400 400" fill="none">
            <defs>
              <linearGradient id="blob-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#22C55E" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#22C55E" stopOpacity="0.08" />
              </linearGradient>
            </defs>
            <circle cx="200" cy="200" r="180" fill="url(#blob-grad)" className="animate-pulse" />
          </svg>

          {/* Floating phone-like shape */}
          <div className="absolute w-32 h-56 bg-white/70 backdrop-blur-md border border-slate-200 rounded-3xl shadow-xl rotate-[8deg] translate-x-4 -translate-y-2">
            <div className="px-3 pt-4 space-y-1.5">
              <div className="h-2 w-10 bg-primary-200 rounded-full" />
              <div className="h-1.5 w-16 bg-slate-200 rounded-full" />
              <div className="h-1.5 w-12 bg-slate-100 rounded-full" />
              <div className="pt-3 space-y-1">
                <div className="h-5 bg-primary-100 rounded-lg flex items-center px-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 ml-0.5" />
                </div>
                <div className="h-4 bg-green-100 rounded-lg" />
                <div className="h-4 bg-slate-100 rounded-lg" />
              </div>
            </div>
          </div>

          {/* Secondary shape — chat bubble */}
          <div className="absolute w-24 h-24 bg-primary-50/80 backdrop-blur-sm border border-primary-200 rounded-2xl -rotate-6 -translate-x-24 translate-y-16 flex items-center justify-center">
            <svg className="w-10 h-10 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
            </svg>
          </div>

          {/* Decorative dots grid */}
          <div className="absolute translate-x-28 translate-y-24 grid grid-cols-4 gap-1.5">
            {[...Array(16)].map((_, i) => (
              <div key={i} className="w-1.5 h-1.5 rounded-full bg-primary-300/40" />
            ))}
          </div>

          {/* Annotation Label 1 — top right */}
          <div className="absolute top-4 right-0 bg-white/90 backdrop-blur-sm border border-slate-200 shadow-sm rounded-full px-3 py-1.5 text-xs font-medium text-gray-700 flex items-center gap-1.5">
            <ShieldCheck size={12} className="text-primary-500" />
            Anti-Banned
          </div>

          {/* Annotation Label 2 — mid left */}
          <div className="absolute top-1/2 -translate-y-1/2 -left-4 bg-white/90 backdrop-blur-sm border border-slate-200 shadow-sm rounded-full px-3 py-1.5 text-xs font-medium text-gray-700 flex items-center gap-1.5">
            <Smartphone size={12} className="text-primary-500" />
            Multi Akun
          </div>

          {/* Annotation label 3 — bottom */}
          <div className="absolute bottom-0 translate-x-8 bg-white/90 backdrop-blur-sm border border-slate-200 shadow-sm rounded-full px-3 py-1.5 text-xs font-medium text-gray-700 flex items-center gap-1.5">
            <Users size={12} className="text-primary-500" />
            Real-Time Tracking
          </div>

          {/* Annotation connecting lines */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 500 420">
            <line x1="320" y1="40" x2="250" y2="80" stroke="#CBD5E1" strokeWidth="1" strokeDasharray="3 3" />
            <line x1="75" y1="210" x2="130" y2="230" stroke="#CBD5E1" strokeWidth="1" strokeDasharray="3 3" />
            <line x1="250" y1="390" x2="220" y2="340" stroke="#CBD5E1" strokeWidth="1" strokeDasharray="3 3" />
          </svg>
        </div>
      </div>
    </section>
  );
}
