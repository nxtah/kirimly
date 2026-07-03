"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Papa from "papaparse";
import { api } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import Modal from "@/components/Modal";
import ConfirmDialog from "@/components/ConfirmDialog";
import PageHeader from "@/components/ui/PageHeader";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { Search, Plus, Upload, Trash2, Pencil, Phone, User, FileDown, Users } from "lucide-react";

/* ── Types ── */
interface Contact {
  id: number;
  name: string;
  phone_number: string;
  notes: string | null;
  is_blocked: boolean;
  last_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

interface ContactListRes {
  contacts: Contact[];
  pagination: Pagination;
}

interface ImportPreview {
  name: string;
  phone_number: string;
  valid: boolean;
  reason?: string;
}

/* ── Helpers ── */
function normalizePhone(input: string): string {
  let cleaned = input.replace(/[^\d]/g, "");
  if (cleaned.startsWith("0")) cleaned = "62" + cleaned.slice(1);
  return cleaned;
}

function isValidPhone(input: string): boolean {
  const n = normalizePhone(input);
  return n.length >= 10 && n.length <= 15;
}

const STATUS_BG = "bg-primary-50 text-primary-700 ring-1 ring-primary-200";

/* ─────── Component ─────── */
export default function ContactsPage() {
  /* ── State ── */
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* Modal create */
  const [showCreate, setShowCreate] = useState(false);
  const [formName, setFormName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [saving, setSaving] = useState(false);

  /* Modal edit */
  const [editTarget, setEditTarget] = useState<Contact | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editNotes, setEditNotes] = useState("");

  /* Confirm delete */
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);

  /* Bulk */
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showBulkDelete, setShowBulkDelete] = useState(false);

  /* Import */
  const [showImport, setShowImport] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  /* ── Fetch ── */
  const fetchContacts = useCallback(async (p: number, q: string) => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = { page: p, limit: 20 };
      if (q.trim()) params.search = q.trim();
      const data = await api.get<ContactListRes>("/api/contacts", { params });
      setContacts(data.contacts);
      setPagination(data.pagination);
    } catch (err: any) {
      setError(err?.body?.error || err.message || "Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContacts(page, search);
  }, [page, fetchContacts]);

  /* Search debounce */
  function onSearchChange(val: string) {
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setPage(1);
      fetchContacts(1, val);
    }, 400);
  }

  /* ── Create ── */
  async function handleCreate() {
    if (!formName.trim()) return;
    const phone = normalizePhone(formPhone);
    if (!isValidPhone(formPhone)) return;

    setSaving(true);
    try {
      await api.post("/api/contacts", {
        name: formName.trim(),
        phone_number: phone,
        notes: formNotes.trim() || undefined,
      });
      setShowCreate(false);
      resetForm();
      fetchContacts(page, search);
    } catch (err: any) {
      setError(err?.body?.error || "Failed to create contact");
    } finally {
      setSaving(false);
    }
  }
  function resetForm() {
    setFormName("");
    setFormPhone("");
    setFormNotes("");
  }

  /* ── Edit ── */
  function openEdit(c: Contact) {
    setEditTarget(c);
    setEditName(c.name);
    setEditPhone(c.phone_number);
    setEditNotes(c.notes || "");
  }
  async function handleEdit() {
    if (!editTarget || !editName.trim()) return;
    setSaving(true);
    try {
      await api.put(`/api/contacts/${editTarget.id}`, {
        name: editName.trim(),
        phone_number: editPhone,
        notes: editNotes.trim() || undefined,
      });
      setEditTarget(null);
      fetchContacts(page, search);
    } catch (err: any) {
      setError(err?.body?.error || "Failed to update contact");
    } finally {
      setSaving(false);
    }
  }

  /* ── Delete ── */
  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.del(`/api/contacts/${deleteTarget.id}`);
      setDeleteTarget(null);
      setSelected((prev) => { const s = new Set(prev); s.delete(deleteTarget.id); return s; });
      fetchContacts(page, search);
    } catch (err: any) {
      setError(err?.body?.error || "Failed to delete contact");
    } finally {
      setDeleting(false);
    }
  }

  /* ── Bulk delete ── */
  async function handleBulkDelete() {
    setDeleting(true);
    try {
      await api.del("/api/contacts/bulk", {
        body: JSON.stringify({ ids: [...selected] }),
        headers: { "Content-Type": "application/json" },
      } as any);
      setShowBulkDelete(false);
      setSelected(new Set());
      fetchContacts(page, search);
    } catch (err: any) {
      setError(err?.body?.error || "Failed to delete contacts");
    } finally {
      setDeleting(false);
    }
  }

  /* ── Toggle select ── */
  function toggleSelect(id: number) {
    setSelected((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }
  function toggleAll() {
    if (selected.size === contacts.length) setSelected(new Set());
    else setSelected(new Set(contacts.map((c) => c.id)));
  }

  /* ── Import CSV ── */
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportResult(null);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        const rows = results.data as any[];
        const preview: ImportPreview[] = rows.map((r: any, i: number) => {
          const name = (r.name || r.Nama || r.nama || "").trim();
          const phone = (r.phone_number || r.phone || r.Phone || r.nomor || r.No || "").trim();
          if (!name || !phone) return { name: name || "(empty)", phone_number: phone || "(empty)", valid: false, reason: "Missing name or phone" };
          if (!isValidPhone(phone)) return { name, phone_number: phone, valid: false, reason: "Invalid phone format" };
          return { name, phone_number: normalizePhone(phone), valid: true };
        });
        setImportPreview(preview);
      },
      error() {
        setError("Failed to parse CSV file");
      },
    });
  }

  async function handleImport() {
    if (!importPreview) return;
    const valid = importPreview.filter((r) => r.valid).map((r) => ({
      name: r.name,
      phone_number: r.phone_number,
    }));
    if (valid.length === 0) return;

    setImporting(true);
    try {
      const res = await api.post<{ message: string; summary: { imported: number; duplicates: number; invalid: number } }>(
        "/api/contacts/import",
        { contacts: valid }
      );
      setImportResult(
        `${res.summary.imported} imported, ${res.summary.duplicates} duplicates, ${res.summary.invalid} skipped`
      );
      setImportPreview(null);
      fetchContacts(page, search);
    } catch (err: any) {
      setError(err?.body?.error || "Import failed");
    } finally {
      setImporting(false);
    }
  }

  /* ── Render ── */
  const LIMIT = 20;
  const totalPages = pagination?.total_pages || 1;

  return (
    <DashboardLayout>
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <PageHeader
          title="Contacts"
          subtitle={`${pagination?.total || 0} total contacts`}
          actions={
            <div className="flex gap-2">
              <button
                onClick={() => { setShowImport(true); setImportPreview(null); setImportResult(null); }}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-ink-muted bg-surface-card rounded-xl border border-gray-200 hover:bg-gray-50 hover:scale-[1.02] transition-all shadow-sm"
              >
                <Upload size={16} />
                <span className="hidden sm:inline">Import CSV</span>
              </button>
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 hover:scale-[1.02] transition-all shadow-sm"
              >
                <Plus size={16} />
                <span>Add Contact</span>
              </button>
            </div>
          }
        />

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-2xl px-5 py-3 mb-6 flex items-start gap-2">
            <span>⚠️</span>
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="underline shrink-0">Dismiss</button>
          </div>
        )}

        {/* Search + bulk delete */}
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-light" />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search by name or number..."
              className="w-full bg-surface-card border border-gray-200 rounded-xl pl-10 pr-4 py-2.5 text-sm text-ink placeholder-ink-light focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
            />
          </div>
          {selected.size > 0 && (
            <button
              onClick={() => setShowBulkDelete(true)}
              className="flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700 bg-red-50 px-3 py-2 rounded-xl hover:bg-red-100 transition-all"
            >
              <Trash2 size={14} />
              Delete {selected.size}
            </button>
          )}
        </div>

        {/* Table */}
        {loading ? (
          <SkeletonTable rows={5} />
        ) : contacts.length === 0 && !search ? (
          <div className="bg-surface-card rounded-2xl shadow-card p-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary-100 text-primary-600 flex items-center justify-center mx-auto mb-4">
              <Users size={32} />
            </div>
            <h2 className="text-lg font-semibold text-ink mb-1">No contacts yet</h2>
            <p className="text-sm text-ink-muted mb-6 max-w-sm mx-auto">
              Add your first contact manually or import from a CSV file to get started.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 hover:scale-[1.02] transition-all shadow-sm">
                <Plus size={16} /> Add Contact
              </button>
              <button onClick={() => { setShowImport(true); setImportPreview(null); setImportResult(null); }}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-ink-muted bg-surface-card border border-gray-200 rounded-xl hover:bg-gray-50 hover:scale-[1.02] transition-all">
                <Upload size={16} /> Import CSV
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-surface-card rounded-2xl shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={contacts.length > 0 && selected.size === contacts.length}
                        onChange={toggleAll}
                        className="rounded border-gray-300 text-primary-500 focus:ring-primary-500"
                      />
                    </th>
                    <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Name</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Phone</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Notes</th>
                    <th className="text-right px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c) => (
                    <tr key={c.id} className="border-b border-gray-50 last:border-0 hover:bg-primary-50/40 transition-colors">
                      <td className="px-4 py-3.5">
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={() => toggleSelect(c.id)}
                          className="rounded border-gray-300 text-primary-500 focus:ring-primary-500"
                        />
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center text-sm font-bold shrink-0">
                            {c.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-medium text-ink">{c.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="inline-flex items-center gap-1.5 text-xs font-mono text-ink-muted bg-gray-50 rounded-lg px-2.5 py-1">
                          <Phone size={12} />
                          {c.phone_number}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-ink-light max-w-[180px] truncate">{c.notes || "—"}</td>
                      <td className="px-4 py-3.5 text-right">
                        <button onClick={() => openEdit(c)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary-600 bg-primary-50 rounded-lg hover:bg-primary-100 transition-all mr-1.5">
                          <Pencil size={12} /> Edit
                        </button>
                        <button onClick={() => setDeleteTarget(c)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-all">
                          <Trash2 size={12} /> Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50">
              <span className="text-xs text-ink-muted">
                {pagination ? `${(pagination.page - 1) * LIMIT + 1}–${Math.min(pagination.page * LIMIT, pagination.total)} of ${pagination.total}` : ""}
              </span>
              <div className="flex gap-1.5">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1.5 text-xs font-medium text-ink-muted bg-white border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-all"
                >
                  Prev
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="px-3 py-1.5 text-xs font-medium text-ink-muted bg-white border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-all"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ───── Modals ───── */}

        {/* Create */}
        <Modal open={showCreate} onClose={() => { setShowCreate(false); resetForm(); }} title="Add Contact">
          <ContactForm
            name={formName} onNameChange={setFormName}
            phone={formPhone} onPhoneChange={setFormPhone}
            notes={formNotes} onNotesChange={setFormNotes}
          />
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => { setShowCreate(false); resetForm(); }}
              className="px-4 py-2 text-sm font-medium text-ink-muted bg-gray-50 rounded-xl hover:bg-gray-100 transition-all">Cancel</button>
            <button onClick={handleCreate} disabled={saving || !formName.trim() || !isValidPhone(formPhone)}
              className="px-4 py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 disabled:opacity-50 transition-all">
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </Modal>

        {/* Edit */}
        <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Edit Contact">
          <ContactForm
            name={editName} onNameChange={setEditName}
            phone={editPhone} onPhoneChange={setEditPhone}
            notes={editNotes} onNotesChange={setEditNotes}
          />
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setEditTarget(null)}
              className="px-4 py-2 text-sm font-medium text-ink-muted bg-gray-50 rounded-xl hover:bg-gray-100 transition-all">Cancel</button>
            <button onClick={handleEdit} disabled={saving || !editName.trim()}
              className="px-4 py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 disabled:opacity-50 transition-all">
              {saving ? "Saving..." : "Update"}
            </button>
          </div>
        </Modal>

        {/* Delete confirm */}
        <ConfirmDialog
          open={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
          title="Delete Contact"
          message={`Are you sure you want to delete "${deleteTarget?.name}"?`}
          loading={deleting}
        />

        {/* Bulk delete confirm */}
        <ConfirmDialog
          open={showBulkDelete}
          onClose={() => setShowBulkDelete(false)}
          onConfirm={handleBulkDelete}
          title="Delete Contacts"
          message={`Are you sure you want to delete ${selected.size} contact(s)?`}
          loading={deleting}
        />

        {/* Import modal */}
        <Modal open={showImport} onClose={() => { setShowImport(false); setImportPreview(null); setImportResult(null); }} title="Import from CSV">
          {importResult ? (
            <div>
              <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-xl px-4 py-3 mb-4">{importResult}</div>
              <button onClick={() => { setShowImport(false); setImportPreview(null); setImportResult(null); }}
                className="px-4 py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl">Done</button>
            </div>
          ) : importPreview ? (
            <div>
              <p className="text-sm text-ink-muted mb-3">
                {importPreview.length} rows found. {importPreview.filter(r => r.valid).length} valid, {importPreview.filter(r => !r.valid).length} invalid.
              </p>
              <div className="max-h-48 overflow-auto border border-gray-200 rounded-xl text-sm mb-4">
                <table className="min-w-full">
                  <thead><tr className="bg-gray-50"><th className="text-left px-3 py-2 font-medium text-ink-muted text-xs">Name</th><th className="text-left px-3 py-2 font-medium text-ink-muted text-xs">Phone</th><th className="text-left px-3 py-2 font-medium text-ink-muted text-xs">Status</th></tr></thead>
                  <tbody>
                    {importPreview.map((r, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-3 py-2 text-xs">{r.name}</td>
                        <td className="px-3 py-2 text-xs font-mono">{r.phone_number}</td>
                        <td className={`px-3 py-2 text-xs ${r.valid ? "text-primary-600" : "text-red-500"}`}>{r.valid ? "✓" : r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setImportPreview(null)} className="px-4 py-2 text-sm font-medium text-ink-muted bg-gray-50 rounded-xl hover:bg-gray-100 transition-all">Back</button>
                <button onClick={handleImport} disabled={importing || importPreview.filter(r => r.valid).length === 0}
                  className="px-4 py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 disabled:opacity-50 transition-all">
                  {importing ? "Importing..." : `Import ${importPreview.filter(r => r.valid).length} contact(s)`}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm text-ink-muted mb-3">Upload a CSV file with headers: <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">name</code>, <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">phone_number</code></p>
              <label className="flex items-center justify-center gap-2 w-full border-2 border-dashed border-gray-200 rounded-xl px-4 py-6 cursor-pointer hover:border-primary-300 hover:bg-primary-50/30 transition-all">
                <FileDown size={20} className="text-ink-muted" />
                <span className="text-sm text-ink-muted">Choose CSV file</span>
                <input type="file" accept=".csv" onChange={handleFile} className="hidden" />
              </label>
            </div>
          )}
        </Modal>
      </div>
    </DashboardLayout>
  );
}

/* ── Contact Form sub-component ── */
function ContactForm({
  name, onNameChange, phone, onPhoneChange, notes, onNotesChange,
}: {
  name: string; onNameChange: (v: string) => void;
  phone: string; onPhoneChange: (v: string) => void;
  notes: string; onNotesChange: (v: string) => void;
}) {
  const phoneError = phone && phone.replace(/[^\d]/g, "").length > 0 && !isValidPhone(phone);
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-ink-muted mb-1 uppercase tracking-wider">Name *</label>
        <input value={name} onChange={(e) => onNameChange(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-ink placeholder-ink-light focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all" placeholder="Contact name" />
      </div>
      <div>
        <label className="block text-xs font-semibold text-ink-muted mb-1 uppercase tracking-wider">Phone Number *</label>
        <input value={phone} onChange={(e) => onPhoneChange(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-ink placeholder-ink-light focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all" placeholder="0812xxxx or 62812xxxx" />
        {phoneError && <p className="text-xs text-red-500 mt-1">Invalid phone number (min 10 digits)</p>}
        {!phoneError && phone && <p className="text-xs text-ink-light mt-1">Normalized: {normalizePhone(phone) || "..."}</p>}
      </div>
      <div>
        <label className="block text-xs font-semibold text-ink-muted mb-1 uppercase tracking-wider">Notes</label>
        <textarea value={notes} onChange={(e) => onNotesChange(e.target.value)} rows={2}
          className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-ink placeholder-ink-light focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all resize-none" placeholder="Optional notes" />
      </div>
    </div>
  );
}
