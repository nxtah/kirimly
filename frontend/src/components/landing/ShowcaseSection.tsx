"use client";

import { Zap, BarChart3, Globe, Smartphone, MessageSquare, Shield } from "lucide-react";

const ITEMS = [
  { icon: Zap, title: "Kirim 20 Kontak per Wave", desc: "Delay acak 5-10 detik, jeda 15-20 menit antar wave", color: "text-primary-500 bg-primary-50" },
  { icon: BarChart3, title: "Tracking Real-Time", desc: "Pantau status delivered, read, replied live", color: "text-emerald-600 bg-emerald-50" },
  { icon: Globe, title: "Multi-Akun", desc: "Setiap user punya sesi WA sendiri, scan QR sekali", color: "text-violet-600 bg-violet-50" },
  { icon: Smartphone, title: "QR Scan Persist", desc: "Sesi tersimpan — restart server gak perlu scan ulang", color: "text-orange-600 bg-orange-50" },
  { icon: MessageSquare, title: "Template Personalisasi", desc: "Gunakan {{nama}} untuk sapaan otomatis per kontak", color: "text-cyan-600 bg-cyan-50" },
  { icon: Shield, title: "Aman & Anti-Banned", desc: "Sistem wave dirancang khusus agar WA tetap aman", color: "text-rose-600 bg-rose-50" },
];

export default function ShowcaseSection() {
  return (
    <section id="showcase" className="py-20 md:py-28">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight mb-3">
            Fitur <span className="font-serif-italic text-primary-500 font-normal">Unggulan</span>
          </h2>
          <p className="text-gray-500 max-w-lg mx-auto">
            Dibangun khusus untuk broadcast WhatsApp yang aman & profesional.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ITEMS.map((item, i) => {
            const Icon = item.icon;
            const isHighlighted = i === 0;
            return (
              <div
                key={item.title}
                className={`rounded-2xl p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-md ${
                  isHighlighted
                    ? "bg-primary-500 text-white ring-2 ring-primary-500"
                    : "bg-white border border-slate-100"
                }`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${
                  isHighlighted ? "bg-white/15" : item.color
                }`}>
                  <Icon size={18} className={isHighlighted ? "text-white" : ""} />
                </div>
                <h3 className={`text-sm font-bold mb-1 ${isHighlighted ? "text-white" : "text-gray-900"}`}>
                  {item.title}
                </h3>
                <p className={`text-xs leading-relaxed ${isHighlighted ? "text-primary-100" : "text-gray-500"}`}>
                  {item.desc}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
