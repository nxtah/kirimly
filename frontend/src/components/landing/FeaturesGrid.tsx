"use client";

import Link from "next/link";
import { ArrowRight, Send, CalendarCheck, HeadphonesIcon, ShieldCheck } from "lucide-react";

const FEATURES = [
  {
    num: "01",
    title: "Kirim Massal",
    desc: "System wave otomatis — max 20 kontak per wave, delay acak 5-10 detik, jeda 15-20 menit antar wave. WA Anda aman dari banned.",
    highlighted: true,
    icon: Send,
  },
  {
    num: "02",
    title: "Jadwalkan Blast",
    desc: "Tentukan tanggal dan jam kirim. Blast otomatis berjalan sesuai jadwal — pas banget buat campaign terprogram.",
    highlighted: false,
    icon: CalendarCheck,
  },
  {
    num: "03",
    title: "Support 24/7",
    desc: "Sistem berjalan stabil 99.9% uptime. Sesi WA persist walau server restart — tidak perlu scan QR ulang.",
    highlighted: false,
    icon: HeadphonesIcon,
  },
  {
    num: "04",
    title: "Keamanan Data",
    desc: "Data kontak & sesi WA terisolasi per user. Enkripsi end-to-end. Setiap tenant punya ruang amannya sendiri.",
    highlighted: false,
    icon: ShieldCheck,
  },
];

export default function FeaturesGrid() {
  return (
    <section id="features" className="py-20 md:py-28 bg-slate-50/60">
      <div className="max-w-6xl mx-auto px-6">
        {/* Section heading */}
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight mb-3">
            Semua yang <span className="font-serif-italic text-primary-500 font-normal">Kamu Butuhkan</span>
          </h2>
          <p className="text-gray-500 max-w-lg mx-auto">
            Dari kirim massal hingga pantau hasil — semua dalam satu platform.
          </p>
        </div>

        {/* Grid 4 cards — first card highlighted (solid blue) */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return f.highlighted ? (
              /* Highlighted card — solid blue */
              <div
                key={f.num}
                className="relative bg-primary-500 rounded-2xl p-6 md:p-7 text-white overflow-hidden group hover:-translate-y-1 transition-transform duration-300"
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-bl-full" />
                <div className="relative z-10 flex flex-col h-full">
                  <span className="text-2xl font-mono font-bold text-white/20 mb-4">{f.num}</span>
                  <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center mb-4">
                    <Icon size={20} className="text-white" />
                  </div>
                  <h3 className="text-base font-bold mb-2">{f.title}</h3>
                  <p className="text-sm text-primary-100 leading-relaxed flex-1">{f.desc}</p>
                  <Link
                    href="/login"
                    className="inline-flex items-center gap-1.5 mt-4 text-xs font-semibold text-white bg-white/15 rounded-full px-3.5 py-1.5 w-fit hover:bg-white/25 transition-all"
                  >
                    Pelajari lebih lanjut <ArrowRight size={12} />
                  </Link>
                </div>
              </div>
            ) : (
              /* Regular card — white */
              <div
                key={f.num}
                className="relative bg-white border border-slate-100 rounded-2xl p-6 md:p-7 group hover:shadow-md hover:-translate-y-1 transition-all duration-300"
              >
                <span className="absolute top-4 right-4 text-lg font-mono font-bold text-slate-200">{f.num}</span>
                <div className="w-10 h-10 rounded-xl bg-primary-50 text-primary-500 flex items-center justify-center mb-4">
                  <Icon size={20} />
                </div>
                <h3 className="text-base font-bold text-gray-900 mb-2">{f.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
