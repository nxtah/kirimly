"use client";

import Link from "next/link";
import { ArrowRight, MessageSquareText } from "lucide-react";

export default function CTASplitSection() {
  return (
    <section className="py-20 md:py-28 px-6">
      <div className="max-w-5xl mx-auto grid md:grid-cols-2 rounded-2xl overflow-hidden shadow-xl">
        {/* Left — blue card */}
        <div className="bg-primary-500 p-10 md:p-14 flex flex-col justify-center relative overflow-hidden">
          <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/5" />
          <div className="absolute -bottom-10 -left-10 w-32 h-32 rounded-full bg-primary-400/10" />

          <div className="relative">
            <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold text-white tracking-tight mb-4 leading-tight">
              Siap Kirim Broadcast{" "}
              <span className="font-serif-italic font-normal">Tanpa Ribet?</span>
            </h2>
            <p className="text-primary-100 text-sm max-w-sm mb-8">
              Gratis dicoba sekarang. Tidak perlu kartu kredit. Mulai kirim pesan ke kontak Anda dalam hitungan menit.
            </p>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-primary-700 bg-white rounded-full hover:bg-primary-50 hover:scale-[1.02] transition-all shadow-sm"
            >
              Mulai Gratis <ArrowRight size={16} />
            </Link>
          </div>
        </div>

        {/* Right — illustration section */}
        <div className="bg-gradient-to-br from-slate-50 to-slate-100 p-10 md:p-14 flex items-center justify-center relative overflow-hidden">
          <div className="absolute top-[-20%] right-[-10%] w-64 h-64 rounded-full bg-primary-200/20 blur-3xl" />
          <div className="absolute bottom-[-10%] left-[-5%] w-48 h-48 rounded-full bg-primary-300/15 blur-3xl" />

          <div className="relative flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-2xl bg-white shadow-md border border-slate-100 flex items-center justify-center mb-4">
              <MessageSquareText size={32} className="text-primary-500" />
            </div>
            <p className="text-sm font-bold text-gray-900 mb-1">Bergabung dengan</p>
            <p className="text-3xl font-bold text-primary-500">50+</p>
            <p className="text-xs text-gray-500 mt-1">Pengguna aktif</p>
          </div>
        </div>
      </div>
    </section>
  );
}
