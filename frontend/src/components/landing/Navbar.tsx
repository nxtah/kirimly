"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

const NAV_LINKS = [
  { label: "Fitur", href: "#features" },
  { label: "Cara Kerja", href: "#how-it-works" },
  { label: "Testimoni", href: "#showcase" },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollTo = (id: string) => {
    setMobileOpen(false);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <header className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${scrolled ? "bg-white/95 backdrop-blur-md border-b border-slate-100" : "bg-white"}`}>
      <nav className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5">
          <img src="/logo-kirimly.png" alt="Kirimly" className="w-10 h-10 rounded-xl object-cover" />
          <span className="text-lg font-bold text-gray-900 tracking-tight">Kirimly</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map((link) => (
            <button
              key={link.label}
              onClick={() => scrollTo(link.href.slice(1))}
              className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-900 rounded-lg hover:bg-slate-50 transition-all">
              {link.label}
            </button>
          ))}
        </div>

        {/* Desktop CTA */}
        <Link
          href="/login"
          className="hidden md:inline-flex px-5 py-2 text-sm font-semibold text-white bg-primary-500 rounded-full hover:bg-primary-700 hover:scale-[1.02] transition-all shadow-sm">
          Coba Gratis
        </Link>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden p-2 text-gray-500 hover:text-gray-900 rounded-lg hover:bg-slate-50 transition-all">
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </nav>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden bg-white border-t border-slate-100 px-6 pb-6 pt-2">
          <div className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <button
                key={link.label}
                onClick={() => scrollTo(link.href.slice(1))}
                className="w-full text-left px-4 py-3 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-slate-50 rounded-xl transition-all">
                {link.label}
              </button>
            ))}
            <hr className="my-2 border-slate-100" />
            <Link
              href="/login"
              onClick={() => setMobileOpen(false)}
              className="w-full text-center px-4 py-2.5 text-sm font-semibold text-white bg-primary-500 rounded-full hover:bg-primary-700 transition-all">
              Coba Gratis
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
