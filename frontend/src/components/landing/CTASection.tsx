"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default function CTASection() {
  return (
    <section className="pb-20 md:pb-28 px-6">
      <div className="max-w-3xl mx-auto text-center bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl p-12 md:p-16 shadow-xl relative overflow-hidden">
        <div className="absolute top-[-20%] right-[-10%] w-64 h-64 rounded-full bg-primary-500/10 blur-3xl" />
        <div className="absolute bottom-[-30%] left-[-5%] w-48 h-48 rounded-full bg-emerald-500/10 blur-3xl" />

        <div className="relative">
          <h2 className="text-2xl md:text-4xl font-bold text-white mb-4 tracking-tight">
            Siap Kirim Broadcast Tanpa Ribet?
          </h2>
          <p className="text-gray-400 text-sm max-w-md mx-auto mb-8">
            Gratis dicoba sekarang. Tidak perlu kartu kredit. Mulai kirim pesan
            ke kontak Anda dalam hitungan menit.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-gray-900 bg-white rounded-full hover:bg-gray-50 hover:scale-[1.02] transition-all shadow-lg"
          >
            Mulai Gratis <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </section>
  );
}
