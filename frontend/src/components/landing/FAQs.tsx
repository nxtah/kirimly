"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

const FAQS = [
  {
    q: "Apakah WA saya bisa kena banned?",
    a: "Kirimly dirancang khusus untuk meminimalkan risiko banned. Sistem wave membatasi 20 kontak per gelombang dengan delay acak 5-10 detik antar pesan dan jeda 15-20 menit antar gelombang. Ini meniru perilaku kirim pesan manusiawi.",
  },
  {
    q: "Berapa maksimal kontak yang bisa dikirim?",
    a: "Maksimal 20 kontak per wave dan 3 wave per broadcast (total 60 kontak per broadcast). Untuk mengirim ke lebih banyak kontak, Anda bisa membuat broadcast baru secara bertahap.",
  },
  {
    q: "Apakah bisa untuk tim?",
    a: "Ya! Kirimly multi-tenant — setiap user punya sesi WA sendiri. Cocok untuk agensi atau tim marketing yang manage banyak nomor WA sekaligus.",
  },
  {
    q: "Bagaimana cara memulai?",
    a: "Cukup daftar, login, scan QR Whatsapp, import kontak, buat template, dan kirim broadcast. Semua bisa dilakukan dalam 5 menit.",
  },
];

export default function FAQs() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <section id="faq" className="py-20 md:py-28">
      <div className="max-w-3xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight mb-3">
            Pertanyaan <span className="text-primary-500">Umum</span>
          </h2>
        </div>

        <div className="space-y-2">
          {FAQS.map((faq, i) => (
            <div
              key={i}
              className="bg-white border border-gray-100 rounded-2xl overflow-hidden transition-all hover:border-gray-200"
            >
              <button
                onClick={() => setOpenIdx(openIdx === i ? null : i)}
                className="w-full flex items-center justify-between px-5 py-4 text-left text-sm font-semibold text-gray-900 transition-all"
              >
                {faq.q}
                <ChevronDown
                  size={16}
                  className={`text-gray-400 transition-transform duration-200 ${
                    openIdx === i ? "rotate-180" : ""
                  }`}
                />
              </button>
              {openIdx === i && (
                <div className="px-5 pb-4 text-sm text-gray-500 leading-relaxed">
                  {faq.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
