"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";

interface ResetDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (deleteContacts: boolean) => void;
  total: number;
  createdContacts: number;
  loading: boolean;
}

export default function ResetDialog({ open, onClose, onConfirm, total, createdContacts, loading }: ResetDialogProps) {
  const [deleteContacts, setDeleteContacts] = useState(false);

  useEffect(() => { if (open) setDeleteContacts(false); }, [open]);

  return (
    <Modal open={open} onClose={() => !loading && onClose()} title="Reset data segmentasi">
      <div className="text-sm text-gray-600 space-y-3">
        {total > 0 ? (
          <p>
            Yang akan dihapus: <strong className="text-gray-900">{total} data calon mahasiswa</strong> dan{" "}
            <strong className="text-gray-900">semua hasil cluster</strong> (hasil cluster hanya berlaku untuk data ini).
          </p>
        ) : (
          <p>Tidak ada data calon mahasiswa yang tersisa. Anda masih bisa membersihkan kontak hasil import di bawah.</p>
        )}
        <p className="text-xs text-gray-500">
          Kontak di menu Contacts dan riwayat blast <strong>tidak ikut terhapus</strong>, kecuali Anda mencentang opsi di bawah.
        </p>

        {createdContacts > 0 && (
          <label className="flex items-start gap-2.5 p-3 rounded-xl border border-gray-200 cursor-pointer hover:bg-gray-50">
            <input type="checkbox" checked={deleteContacts} onChange={(e) => setDeleteContacts(e.target.checked)}
              className="mt-0.5 rounded border-gray-300 text-primary-500" />
            <span className="text-xs text-gray-700">
              Hapus juga <strong>{createdContacts} kontak</strong> yang dibuat otomatis oleh import (dari semua import sebelumnya) dari Contacts.
              <span className="block text-gray-500 mt-0.5">Kontak yang sudah Anda punya sebelumnya tidak akan disentuh. Riwayat blast tetap tersimpan.</span>
            </span>
          </label>
        )}
      </div>

      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} disabled={loading}
          className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-md transition-colors disabled:opacity-50">
          Batal
        </button>
        <button onClick={() => onConfirm(deleteContacts)} disabled={loading}
          className="px-3 py-1.5 text-sm text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors disabled:opacity-50">
          {loading ? "Menghapus…" : "Reset Data"}
        </button>
      </div>
    </Modal>
  );
}
