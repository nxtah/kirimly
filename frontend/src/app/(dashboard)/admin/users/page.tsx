"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import AdminLayout from "@/components/AdminLayout";
import Modal from "@/components/Modal";
import ConfirmDialog from "@/components/ConfirmDialog";
import PageHeader from "@/components/ui/PageHeader";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { Plus, Pencil, Trash2, User, Smartphone } from "lucide-react";

interface AdminUser {
  id: number; username: string; display_name: string | null; role: string;
  is_active: boolean; wa_status: string | null; wa_connected: boolean;
  phone_number: string | null; last_login_at: string | null;
  contact_count: number; template_count: number; blast_count: number;
  created_at: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [formUser, setFormUser] = useState("");
  const [formPass, setFormPass] = useState("");
  const [saving, setSaving] = useState(false);
  const [createdInfo, setCreatedInfo] = useState<{ username: string; password: string } | null>(null);

  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [editPass, setEditPass] = useState("");
  const [editActive, setEditActive] = useState(true);

  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try { const d = await api.get<{ users: AdminUser[] }>("/api/admin/users"); setUsers(d.users); }
    catch { setError("Failed to load users"); } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  async function handleCreate() {
    if (!formUser.trim() || formPass.length < 6) return;
    setSaving(true);
    try { await api.post("/api/admin/users", { username: formUser.trim(), password: formPass }); setCreatedInfo({ username: formUser.trim(), password: formPass }); fetchUsers(); }
    catch (err: any) { setError(err?.body?.error || "Create failed"); } finally { setSaving(false); }
  }

  async function handleEdit() {
    if (!editTarget) return;
    setSaving(true);
    try { const body: any = {}; if (editPass) body.password = editPass; body.is_active = editActive; await api.put(`/api/admin/users/${editTarget.id}`, body); setEditTarget(null); setEditPass(""); fetchUsers(); }
    catch (err: any) { setError(err?.body?.error || "Update failed"); } finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try { await api.del(`/api/admin/users/${deleteTarget.id}`); setDeleteTarget(null); fetchUsers(); }
    catch (err: any) { setError(err?.body?.error || "Delete failed"); } finally { setDeleting(false); }
  }

  return (
    <AdminLayout>
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <PageHeader
          title="Users"
          subtitle={`${users.length} registered user(s)`}
          hideAvatar
          actions={
            <button onClick={() => { setShowCreate(true); setCreatedInfo(null); setFormUser(""); setFormPass(""); }}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 hover:scale-[1.02] transition-all shadow-sm">
              <Plus size={16} /> Add User
            </button>
          }
        />

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-2xl px-5 py-3 mb-6 flex items-start gap-2">
            <span>⚠️</span><span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="underline shrink-0">Dismiss</button>
          </div>
        )}

        {loading ? <SkeletonTable rows={5} /> : (
          <div className="bg-surface-card rounded-2xl shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">User</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Status</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">WA</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Last Login</th>
                    <th className="text-right px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Contacts</th>
                    <th className="text-right px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Templates</th>
                    <th className="text-right px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Blasts</th>
                    <th className="text-right px-4 py-3 font-semibold text-xs text-ink-muted uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-gray-50 last:border-0 hover:bg-primary-50/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-600 text-sm font-bold flex items-center justify-center shrink-0">
                            {u.username.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-ink">{u.username}</p>
                            {u.display_name && <p className="text-xs text-ink-light">{u.display_name}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-lg text-xs font-medium ${u.is_active ? "bg-primary-100 text-primary-700" : "bg-red-100 text-red-700"}`}>
                          {u.is_active ? "active" : "disabled"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-xs ${u.wa_connected ? "text-primary-600" : "text-ink-muted"}`}>
                          <Smartphone size={12} />
                          {u.wa_status || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-muted">{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "—"}</td>
                      <td className="px-4 py-3 text-right text-ink">{u.contact_count}</td>
                      <td className="px-4 py-3 text-right text-ink">{u.template_count}</td>
                      <td className="px-4 py-3 text-right text-ink">{u.blast_count}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button onClick={() => { setEditTarget(u); setEditPass(""); setEditActive(u.is_active); }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-primary-600 bg-primary-50 rounded-lg hover:bg-primary-100 transition-all mr-1">
                          <Pencil size={12} /> Edit
                        </button>
                        <button onClick={() => setDeleteTarget(u)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-all">
                          <Trash2 size={12} /> Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Create Modal */}
        <Modal open={showCreate && !createdInfo} onClose={() => setShowCreate(false)} title="Add User">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-ink-muted mb-1 uppercase tracking-wider">Username *</label>
              <input value={formUser} onChange={(e) => setFormUser(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-ink placeholder-ink-light focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all" placeholder="Username" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-muted mb-1 uppercase tracking-wider">Password (min 6 chars) *</label>
              <input type="text" value={formPass} onChange={(e) => setFormPass(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-ink placeholder-ink-light focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all" placeholder="min 6 characters" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm font-medium text-ink-muted bg-gray-50 rounded-xl hover:bg-gray-100 transition-all">Cancel</button>
              <button onClick={handleCreate} disabled={saving || !formUser.trim() || formPass.length < 6}
                className="px-4 py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 disabled:opacity-50 transition-all">Create</button>
            </div>
          </div>
        </Modal>

        {/* Created success */}
        <Modal open={!!createdInfo} onClose={() => { setShowCreate(false); setCreatedInfo(null); }} title="User Created">
          <div className="text-sm space-y-3">
            <div className="bg-primary-50 border border-primary-200 text-primary-700 rounded-xl px-4 py-3 font-medium">
              Account created successfully!
            </div>
            <div><p className="text-xs text-ink-muted">Username</p><p className="font-mono font-semibold text-ink">{createdInfo?.username}</p></div>
            <div><p className="text-xs text-ink-muted">Password</p><p className="font-mono font-semibold text-ink">{createdInfo?.password}</p></div>
            <p className="text-xs text-amber-600">⚠️ Copy these now. You won't see them again.</p>
            <button onClick={() => { setShowCreate(false); setCreatedInfo(null); }}
              className="px-4 py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl">Done</button>
          </div>
        </Modal>

        {/* Edit Modal */}
        <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title={`Edit: ${editTarget?.username}`}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-ink-muted mb-1 uppercase tracking-wider">New Password (leave empty to keep current)</label>
              <input type="text" value={editPass} onChange={(e) => setEditPass(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-ink placeholder-ink-light focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all" placeholder="New password" />
            </div>
            <label className="flex items-center gap-2.5 text-sm">
              <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} className="rounded border-gray-300 text-primary-500 focus:ring-primary-500" />
              <span className="text-ink">Account active</span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditTarget(null)} className="px-4 py-2 text-sm font-medium text-ink-muted bg-gray-50 rounded-xl hover:bg-gray-100 transition-all">Cancel</button>
              <button onClick={handleEdit} disabled={saving} className="px-4 py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 disabled:opacity-50 transition-all">
                {saving ? "Saving..." : "Update"}
              </button>
            </div>
          </div>
        </Modal>

        {/* Delete Confirm */}
        <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete}
          title="Delete User" message={`Delete "${deleteTarget?.username}"? This permanently removes their account and all related data.`} loading={deleting} />
      </div>
    </AdminLayout>
  );
}
