"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import Modal from "@/components/Modal";
import ConfirmDialog from "@/components/ConfirmDialog";
import PageHeader from "@/components/ui/PageHeader";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { Plus, Pencil, Trash2, FileText } from "lucide-react";

/* ── Types ── */
interface Template {
  id: number; name: string; category: string; body: string; variables: string[];
  created_at: string; updated_at: string;
}

interface TemplateListRes { templates: Template[] }

/* ─────── Component ─────── */
export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [formName, setFormName] = useState("");
  const [formBody, setFormBody] = useState("");
  const [formCategory, setFormCategory] = useState("general");
  const [saving, setSaving] = useState(false);

  const [editTarget, setEditTarget] = useState<Template | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchTemplates = useCallback(async () => {
    setLoading(true); setError(null);
    try { const data = await api.get<TemplateListRes>("/api/templates"); setTemplates(data.templates); }
    catch (err: any) { setError(err?.body?.error || "Failed to load templates"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  function resetForm() { setFormName(""); setFormBody(""); setFormCategory("general"); }
  function extractedVariables(body: string): string[] {
    const m = body.match(/\{\{(\w+)\}\}/g);
    return m ? [...new Set(m.map((v) => v.replace(/[{}]/g, "")))] : [];
  }

  async function handleCreate() {
    if (!formName.trim() || !formBody.trim()) return;
    setSaving(true);
    try {
      await api.post("/api/templates", { name: formName.trim(), body: formBody.trim(), category: formCategory });
      setShowCreate(false); resetForm(); fetchTemplates();
    } catch (err: any) { setError(err?.body?.error || "Failed to create template"); }
    finally { setSaving(false); }
  }

  function openEdit(t: Template) {
    setEditTarget(t); setFormName(t.name); setFormBody(t.body); setFormCategory(t.category || "general");
  }
  async function handleEdit() {
    if (!editTarget || !formName.trim() || !formBody.trim()) return;
    setSaving(true);
    try {
      await api.put(`/api/templates/${editTarget.id}`, { name: formName.trim(), body: formBody.trim(), category: formCategory });
      setEditTarget(null); resetForm(); fetchTemplates();
    } catch (err: any) { setError(err?.body?.error || "Failed to update template"); }
    finally { setSaving(false); }
  }
  function closeEdit() { setEditTarget(null); resetForm(); }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try { await api.del(`/api/templates/${deleteTarget.id}`); setDeleteTarget(null); fetchTemplates(); }
    catch (err: any) { setError(err?.body?.error || "Failed to delete template"); }
    finally { setDeleting(false); }
  }

  const isEdit = !!editTarget;
  const currentVars = extractedVariables(isEdit ? formBody : formBody);

  return (
    <DashboardLayout>
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <PageHeader
          title="Templates"
          subtitle={`${templates.length} message templates`}
          actions={
            <button onClick={() => { setShowCreate(true); resetForm(); }}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 hover:scale-[1.02] transition-all shadow-sm">
              <Plus size={16} /> Create Template
            </button>
          }
        />

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-2xl px-5 py-3 mb-6 flex items-start gap-2">
            <span>⚠️</span><span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="underline shrink-0">Dismiss</button>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <SkeletonTable rows={4} />
            <SkeletonTable rows={4} />
          </div>
        ) : templates.length === 0 ? (
          <div className="bg-surface-card rounded-2xl shadow-card p-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary-100 text-primary-600 flex items-center justify-center mx-auto mb-4">
              <FileText size={32} />
            </div>
            <h2 className="text-lg font-semibold text-ink mb-1">No templates yet</h2>
            <p className="text-sm text-ink-muted mb-6 max-w-sm mx-auto">
              Create your first message template to personalize your broadcasts.
            </p>
            <button onClick={() => { setShowCreate(true); resetForm(); }}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 hover:scale-[1.02] transition-all shadow-sm">
              <Plus size={16} /> Create Template
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {templates.map((t) => (
              <div key={t.id} className="bg-surface-card rounded-2xl shadow-card p-5 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center shrink-0">
                      <FileText size={16} />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-ink">{t.name}</h3>
                      {t.category !== "general" && (
                        <span className="text-[10px] font-medium text-ink-light bg-gray-100 px-1.5 py-0.5 rounded">{t.category}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => openEdit(t)}
                      className="p-2 text-ink-light hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-all">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => setDeleteTarget(t)}
                      className="p-2 text-ink-light hover:text-red-600 hover:bg-red-50 rounded-lg transition-all">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-ink-muted leading-relaxed line-clamp-3 mb-3">
                  {t.body}
                </p>
                {t.variables && t.variables.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {t.variables.map((v) => (
                      <code key={v} className="text-[10px] font-medium bg-primary-50 text-primary-700 px-2 py-0.5 rounded-lg">
                        {'{{'}{v}{'}}'}
                      </code>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Create Modal */}
        <Modal open={showCreate} onClose={() => { setShowCreate(false); resetForm(); }} title="Create Template">
          <TemplateForm name={formName} onNameChange={setFormName} body={formBody} onBodyChange={setFormBody} category={formCategory} onCategoryChange={setFormCategory} />
          {currentVars.length > 0 && (
            <div className="mt-3 flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-ink-muted">Detected:</span>
              {currentVars.map((v) => (
                <code key={v} className="text-[10px] bg-primary-50 text-primary-700 px-1.5 py-0.5 rounded-lg">{'{{'}{v}{'}}'}</code>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => { setShowCreate(false); resetForm(); }}
              className="px-4 py-2 text-sm font-medium text-ink-muted bg-gray-50 rounded-xl hover:bg-gray-100 transition-all">Cancel</button>
            <button onClick={handleCreate} disabled={saving || !formName.trim() || !formBody.trim()}
              className="px-4 py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 disabled:opacity-50 transition-all">
              {saving ? "Saving..." : "Create"}
            </button>
          </div>
        </Modal>

        {/* Edit Modal */}
        <Modal open={isEdit} onClose={closeEdit} title="Edit Template">
          <TemplateForm name={formName} onNameChange={setFormName} body={formBody} onBodyChange={setFormBody} category={formCategory} onCategoryChange={setFormCategory} />
          {currentVars.length > 0 && (
            <div className="mt-3 flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-ink-muted">Detected:</span>
              {currentVars.map((v) => (
                <code key={v} className="text-[10px] bg-primary-50 text-primary-700 px-1.5 py-0.5 rounded-lg">{'{{'}{v}{'}}'}</code>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={closeEdit}
              className="px-4 py-2 text-sm font-medium text-ink-muted bg-gray-50 rounded-xl hover:bg-gray-100 transition-all">Cancel</button>
            <button onClick={handleEdit} disabled={saving || !formName.trim() || !formBody.trim()}
              className="px-4 py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 disabled:opacity-50 transition-all">
              {saving ? "Saving..." : "Update"}
            </button>
          </div>
        </Modal>

        {/* Delete Confirm */}
        <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete}
          title="Delete Template" message={`Delete "${deleteTarget?.name}"?`} loading={deleting} />
      </div>
    </DashboardLayout>
  );
}

function TemplateForm({ name, onNameChange, body, onBodyChange, category, onCategoryChange }: {
  name: string; onNameChange: (v: string) => void;
  body: string; onBodyChange: (v: string) => void;
  category: string; onCategoryChange: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-ink-muted mb-1 uppercase tracking-wider">Template Name *</label>
        <input value={name} onChange={(e) => onNameChange(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-ink placeholder-ink-light focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all" placeholder="e.g. Promo January" />
      </div>
      <div>
        <label className="block text-xs font-semibold text-ink-muted mb-1 uppercase tracking-wider">Category</label>
        <select value={category} onChange={(e) => onCategoryChange(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all">
          <option value="general">General</option>
          <option value="promo">Promo</option>
          <option value="info">Info</option>
          <option value="reminder">Reminder</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-semibold text-ink-muted mb-1 uppercase tracking-wider">Message Body *</label>
        <textarea value={body} onChange={(e) => onBodyChange(e.target.value)} rows={6}
          className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-ink placeholder-ink-light focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all resize-y"
          placeholder="Halo {{nama}}, kami punya promo spesial untuk Anda!" />
        <p className="text-xs text-ink-light mt-1.5">
          Use <code className="bg-primary-50 text-primary-700 px-1.5 py-0.5 rounded text-[10px] font-medium">{'{{nama}}'}</code> to personalize contact&apos;s name.
        </p>
      </div>
    </div>
  );
}
