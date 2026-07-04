"use client";

import Link from "next/link";
import { ArrowRight, TrendingUp } from "lucide-react";
import { AreaChart, Area, ResponsiveContainer } from "recharts";

const chartData = [
  { uv: 98 }, { uv: 99 }, { uv: 97 }, { uv: 100 }, { uv: 99 }, { uv: 98 }, { uv: 100 },
  { uv: 99 }, { uv: 100 }, { uv: 98 }, { uv: 99 }, { uv: 100 }, { uv: 99 }, { uv: 100 },
  { uv: 99 }, { uv: 100 }, { uv: 100 }, { uv: 99 }, { uv: 100 }, { uv: 99 },
];

export default function StatsSection() {
  return (
    <section className="py-20 md:py-28 bg-slate-50/60">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight mb-3">
            Dampak yang Bisa <span className="font-serif-italic text-primary-500 font-normal">Kamu Ukur</span>
          </h2>
          <p className="text-gray-500 max-w-lg mx-auto">
            Metrik nyata yang bikin broadcast kamu makin optimal.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {/* Card 1 — Big stat */}
          <div className="bg-white border border-slate-100 rounded-2xl p-6 transition-all hover:shadow-md">
            <span className="inline-block px-2.5 py-0.5 bg-primary-50 text-primary-700 text-[10px] font-bold rounded-full mb-3">Total Pesan</span>
            <p className="text-4xl font-bold text-gray-900 mb-1">15.000+</p>
            <p className="text-sm text-gray-500">Kontak Terkirim</p>
            <p className="text-xs text-gray-400 mt-2">Sejak Januari 2026</p>
          </div>

          {/* Card 2 — Stat with mini CTA */}
          <div className="bg-white border border-slate-100 rounded-2xl p-6 transition-all hover:shadow-md">
            <span className="inline-block px-2.5 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-bold rounded-full mb-3">Delivery Rate</span>
            <p className="text-4xl font-bold text-gray-900 mb-1">95%</p>
            <p className="text-sm text-gray-500 mb-4">Pesan berhasil terkirim</p>
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-500 hover:text-primary-700 transition-all"
            >
              Coba Sekarang <ArrowRight size={12} />
            </Link>
          </div>

          {/* Card 3 — Mini chart */}
          <div className="bg-white border border-slate-100 rounded-2xl p-6 transition-all hover:shadow-md">
            <span className="inline-block px-2.5 py-0.5 bg-violet-50 text-violet-700 text-[10px] font-bold rounded-full mb-3">Uptime</span>
            <p className="text-4xl font-bold text-gray-900 mb-1">99.9%</p>
            <p className="text-sm text-gray-500 mb-3">30 Hari Terakhir</p>
            <div className="h-12">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="uptimeGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22C55E" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#22C55E" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="uv" stroke="#22C55E" strokeWidth={2} fill="url(#uptimeGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
