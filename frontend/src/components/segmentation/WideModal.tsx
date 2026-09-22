"use client";

import type { ReactNode } from "react";

interface WideModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

// Modal lebar untuk preview import & daftar anggota (Modal bawaan dibatasi max-w-md).
export default function WideModal({ open, onClose, title, children }: WideModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-white flex items-center justify-between px-5 py-3 border-b border-gray-100 z-10">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none">
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
