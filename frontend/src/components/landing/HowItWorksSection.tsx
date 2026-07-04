"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock } from "lucide-react";

const STEPS = [
  {
    num: "01",
    title: "Scan QR WhatsApp",
    desc: "Login ke Kirimly, scan QR code dari HP. Cukup sekali — sesi tersimpan otomatis meski server restart.",
  },
  {
    num: "02",
    title: "Import Kontak & Buat Template",
    desc: "Upload CSV kontak atau tambah manual. Buat template pesan dengan {{nama}} untuk personalisasi otomatis.",
  },
  {
    num: "03",
    title: "Kirim & Pantau Hasilnya",
    desc: "Atur wave, jadwal, lalu kirim. Lihat status delivered, read, replied secara real-time di dashboard.",
  },
];

const MOCK_CONTACTS = [
  { name: "Ahmad Fauzi", status: "Terkirim", badge: "bg-green-100 text-green-700" },
  { name: "Siti Rahma", status: "Terjadwal", badge: "bg-primary-100 text-primary-700" },
  { name: "Budi Santoso", status: "Dibaca", badge: "bg-emerald-100 text-emerald-700" },
  { name: "Dewi Lestari", status: "Terkirim", badge: "bg-green-100 text-green-700" },
  { name: "Rudi Hermawan", status: "Terjadwal", badge: "bg-primary-100 text-primary-700" },
];

export default function HowItWorksSection() {
  return (
    <section id="how-it-works" className="py-20 md:py-28">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight mb-3">
            Tiga Langkah <span className="font-serif-italic text-primary-500 font-normal">Mudah</span>
          </h2>
          <p className="text-gray-500 max-w-lg mx-auto">
            Dari nol hingga broadcast pertama dalam hitungan menit.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-10 md:gap-16 items-start">
          {/* Left — step list */}
          <div className="space-y-8">
            {STEPS.map((step) => (
              <div key={step.num} className="flex gap-5">
                <span className="text-3xl md:text-4xl font-mono font-bold text-slate-200 leading-none shrink-0">
                  {step.num}
                </span>
                <div>
                  <h3 className="text-sm font-bold text-gray-900 mb-1">{step.title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}

            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-primary-500 rounded-full hover:bg-primary-700 hover:scale-[1.02] transition-all shadow-sm"
            >
              Mulai Sekarang <ArrowRight size={16} />
            </Link>
          </div>

          {/* Right — mockup card */}
          <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
              </div>
              <span className="text-[10px] text-slate-400 font-mono">Daftar Kontak · Kirimly</span>
            </div>
            <div className="space-y-1">
              {MOCK_CONTACTS.map((c) => (
                <div key={c.name} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-primary-100 text-primary-700 text-[10px] font-bold flex items-center justify-center">
                      {c.name.charAt(0)}
                    </div>
                    <span className="text-sm text-gray-700">{c.name}</span>
                  </div>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${c.badge}`}>
                    {c.status === "Terkirim" && <CheckCircle2 size={10} />}
                    {c.status === "Terjadwal" && <Clock size={10} />}
                    {c.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
