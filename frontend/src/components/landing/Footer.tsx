"use client";

import Link from "next/link";

export default function Footer() {
  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <footer className="border-t border-slate-100 bg-white py-12">
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-2.5">
            <img src="/logo-kirimly.png" alt="Kirimly" className="w-9 h-9 rounded-lg" />
            <span className="text-sm font-bold text-gray-900">Kirimly</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-gray-500">
            <button onClick={() => scrollTo("features")} className="hover:text-gray-900 transition-colors">Fitur</button>
            <button onClick={() => scrollTo("how-it-works")} className="hover:text-gray-900 transition-colors">Cara Kerja</button>
            <button onClick={() => scrollTo("showcase")} className="hover:text-gray-900 transition-colors">Testimoni</button>
            <span className="hover:text-gray-900 cursor-pointer transition-colors">Kebijakan Privasi</span>
          </div>
        </div>
        <div className="border-t border-slate-100 pt-6 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-gray-400">
          <p>&copy; {new Date().getFullYear()} Kirimly. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <Link href="/login" className="hover:text-gray-600 transition-colors">Masuk</Link>
            <Link href="/admin/login" className="hover:text-gray-600 transition-colors">Admin</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
