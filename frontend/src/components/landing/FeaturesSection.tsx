"use client";

import { Send, Users, BarChart3 } from "lucide-react";

const FEATURES = [
  {
    icon: Send,
    title: "Kirim Massal Tanpa Banned",
    desc: "Sistem wave otomatis: kirim max 20 kontak per wave, delay acak 5-10 detik, jeda 15-20 menit antar wave. WA Anda aman.",
    color: "from-primary-400 to-emerald-500",
  },
  {
    icon: Users,
    title: "Multi Akun WhatsApp",
    desc: "Setiap user punya nomor WhatsApp sendiri. Scan QR sekali, sesi tersimpan otomatis. Cocok untuk tim dan agensi.",
    color: "from-violet-400 to-purple-500",
  },
  {
    icon: BarChart3,
    title: "Tracking Real-Time",
    desc: "Pantau status terkirim, delivered, dibaca, hingga dibalas. Lihat log lengkap per kontak dan ekspor ke CSV.",
    color: "from-primary-400 to-cyan-500",
  },
];

export default function FeaturesSection() {
  return (
    <section id="features" className="py-20 md:py-28">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight mb-3">
            Fitur <span className="text-primary-500">Unggulan</span>
          </h2>
          <p className="text-gray-500 max-w-lg mx-auto">
            Dibangun khusus untuk kebutuhan broadcast WhatsApp yang aman,
            terukur, dan profesional.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.title}
                className="group bg-white border border-gray-100 rounded-2xl p-8 transition-all duration-300 hover:border-primary-200 hover:shadow-sm hover:-translate-y-1"
              >
                <div
                  className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${f.color} flex items-center justify-center mb-5 shadow-sm`}
                >
                  <Icon size={22} className="text-white" />
                </div>
                <h3 className="text-sm font-bold text-gray-900 mb-2">
                  {f.title}
                </h3>
                <p className="text-sm text-gray-500 leading-relaxed">
                  {f.desc}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
