"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import Modal from "@/components/Modal";
import PageHeader from "@/components/ui/PageHeader";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { Plus, Send, Search, AlertTriangle, FileText, Users, Clock, Waves, Trash2 } from "lucide-react";

interface Template { id: number; name: string; body: string; variables: string[]; }
interface Contact { id: number; name: string; phone_number: string; }

const MAX_WAVES = 3;
const MAX_PER_WAVE = 20;
const DELAY_PER_CONTACT_MS = 7500;
const WAVE_DELAY_MS = 15 * 60 * 1000;

export default function NewBlastPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [blastName, setBlastName] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | "">("");
  const [waves, setWaves] = useState<number[][]>([[]]);
  const [currentWaveIdx, setCurrentWaveIdx] = useState(0);
  const [contactSearch, setContactSearch] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<"instant" | "schedule">("instant");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");

  useEffect(() => {
    async function init() {
      try {
        const [tRes, cRes] = await Promise.all([
          api.get<{ templates: Template[] }>("/api/templates"),
          api.get<{ contacts: Contact[]; pagination: any }>("/api/contacts", { params: { limit: 500 } }),
        ]);
        setTemplates(tRes.templates);
        setContacts(cRes.contacts);
      } catch (err: any) {
        setError(err?.body?.error || "Failed to load data");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
  const filteredContacts = contacts.filter(
    (c) => c.name.toLowerCase().includes(contactSearch.toLowerCase()) || c.phone_number.includes(contactSearch)
  );
  const assignedIds = new Set(waves.flat());

  function toggleContact(id: number) {
    if (assignedIds.has(id)) {
      setWaves((prev) => prev.map((w) => w.filter((c) => c !== id)));
    } else {
      setWaves((prev) => prev.map((w, i) => (i === currentWaveIdx ? [...w, id] : w)));
    }
  }

  function addWave() {
    if (waves.length >= MAX_WAVES) return;
    setWaves((prev) => [...prev, []]);
    setCurrentWaveIdx(waves.length);
  }

  function removeWave(idx: number) {
    if (waves.length <= 1) return;
    setWaves((prev) => prev.filter((_, i) => i !== idx));
    if (currentWaveIdx >= idx) setCurrentWaveIdx(Math.max(0, idx - 1));
  }

  const totalContacts = waves.reduce((sum, w) => sum + w.length, 0);
  const totalEstimateMin = waves.reduce((sum, _, i) => {
    const msgs = waves[i].length;
    const msgTime = msgs * DELAY_PER_CONTACT_MS;
    const waveDelay = i > 0 ? WAVE_DELAY_MS : 0;
    return sum + msgTime + waveDelay;
  }, 0);
  const totalEstimate = Math.ceil(totalEstimateMin / 60000);

  async function handleSubmit() {
    if (!selectedTemplateId || totalContacts === 0 || !blastName.trim()) return;
    setSending(true);
    try {
      const nonEmptyWaves = waves.filter((w) => w.length > 0).map((w) => [...w]);
      const body: any = { template_id: selectedTemplateId, waves: nonEmptyWaves };
      body.name = blastName.trim();
      if (mode === "schedule" && scheduledDate && scheduledTime) {
        body.scheduled_at = new Date(`${scheduledDate}T${scheduledTime}`).toISOString();
      }
      const res = await api.post<{ blast_id: number }>("/api/blasts", body);
      setConfirmOpen(false);
      router.push(`/blast/${res.blast_id}`);
    } catch (err: any) {
      setError(err?.body?.error || err.message || "Failed to start blast");
      setConfirmOpen(false);
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="p-6 lg:p-8 max-w-5xl mx-auto">
          <SkeletonTable rows={6} />
        </div>
      </DashboardLayout>
    );
  }

  const currentWave = waves[currentWaveIdx] || [];
  const currentCount = currentWave.length;

  return (
    <DashboardLayout>
      <div className="p-6 lg:p-8 max-w-5xl mx-auto">
        <PageHeader title="New Broadcast" subtitle="Name, template, and arrange contacts into waves" />

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-2xl px-5 py-3 mb-6 flex items-start gap-2">
            <span>⚠️</span><span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="underline shrink-0">Dismiss</button>
          </div>
        )}

        {/* Broadcast Name */}
        <section className="bg-surface-card rounded-2xl shadow-card p-6 mb-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary-100 text-primary-700 text-xs font-bold">1</span>
            <h2 className="text-sm font-semibold text-ink">Broadcast Name</h2>
          </div>
          <input type="text" value={blastName} onChange={(e) => setBlastName(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-ink placeholder-ink-light focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all"
            placeholder="e.g. Promo August - Wave 1" />
        </section>

        {/* Template */}
        <section className="bg-surface-card rounded-2xl shadow-card p-6 mb-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary-100 text-primary-700 text-xs font-bold">2</span>
            <h2 className="text-sm font-semibold text-ink">Choose Template</h2>
          </div>
          {templates.length === 0 ? (
            <p className="text-sm text-ink-muted">No templates yet. Create one first.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {templates.map((t) => (
                <label key={t.id}
                  className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                    selectedTemplateId === t.id ? "border-primary-500 bg-primary-50/50 shadow-sm" : "border-gray-200 hover:border-gray-300"
                  }`}>
                  <input type="radio" name="template" checked={selectedTemplateId === t.id}
                    onChange={() => setSelectedTemplateId(t.id)} className="mt-1 text-primary-500 hidden" />
                  <div className="w-8 h-8 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center shrink-0">
                    <FileText size={15} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{t.name}</p>
                    <p className="text-xs text-ink-muted line-clamp-2 mt-0.5">{t.body}</p>
                  </div>
                </label>
              ))}
            </div>
          )}
          {selectedTemplate && (
            <div className="bg-gray-50 rounded-xl p-4 text-sm mt-3">
              <p className="text-xs font-semibold text-ink-muted mb-2 uppercase tracking-wider">Preview</p>
              <p className="text-ink whitespace-pre-wrap">{selectedTemplate.body}</p>
              {selectedTemplate.variables?.length > 0 && (
                <div className="flex items-center gap-1 mt-2 flex-wrap">
                  {selectedTemplate.variables.map((v) => (
                    <code key={v} className="text-[10px] bg-primary-50 text-primary-700 px-2 py-0.5 rounded-lg">{'{{'}{v}{'}}'}</code>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Waves */}
        <section className="bg-surface-card rounded-2xl shadow-card p-6 mb-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary-100 text-primary-700 text-xs font-bold">3</span>
            <h2 className="text-sm font-semibold text-ink">Arrange Waves</h2>
            <span className="text-xs text-ink-muted ml-auto">{totalContacts} total</span>
          </div>

          <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
            {waves.map((w, i) => (
              <div key={i}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium cursor-pointer transition-all shrink-0 ${
                  currentWaveIdx === i ? "bg-primary-100 text-primary-700 ring-1 ring-primary-300" : "bg-gray-100 text-ink-muted hover:bg-gray-200"
                }`}
                onClick={() => setCurrentWaveIdx(i)}
              >
                <Waves size={14} /> Wave {i + 1} <span className="opacity-60">({w.length})</span>
                {waves.length > 1 && (
                  <button onClick={(e) => { e.stopPropagation(); removeWave(i); }} className="ml-0.5 text-ink-light hover:text-red-500">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
            {waves.length < MAX_WAVES && (
              <button onClick={addWave} className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 transition-all shrink-0">
                <Plus size={14} /> Wave {waves.length + 1}
              </button>
            )}
          </div>

          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-ink-muted">
              Wave {currentWaveIdx + 1}: <strong className="text-ink">{currentCount}</strong> / {MAX_PER_WAVE}
              {currentCount > 0 && <span className="ml-2 text-ink-light"><Clock size={12} className="inline" /> ~{Math.ceil((currentCount * DELAY_PER_CONTACT_MS) / 60000)} min</span>}
            </p>
          </div>

          <div className="relative mb-3">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-light" />
            <input type="text" value={contactSearch} onChange={(e) => setContactSearch(e.target.value)}
              placeholder="Search contacts..." className="w-full bg-white border border-gray-200 rounded-xl pl-10 pr-4 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all" />
          </div>

          {filteredContacts.length === 0 ? (
            <p className="text-sm text-ink-muted py-4 text-center">No contacts found.</p>
          ) : (
            <div className="max-h-48 overflow-auto border border-gray-100 rounded-xl text-sm">
              {filteredContacts.map((c) => {
                const isAssigned = assignedIds.has(c.id);
                const inCurrentWave = currentWave.includes(c.id);
                return (
                  <label key={c.id}
                    className={`flex items-center gap-3 px-4 py-2.5 border-b border-gray-50 last:border-0 transition-colors cursor-pointer ${
                      inCurrentWave ? "bg-primary-50/60" : isAssigned ? "bg-gray-50 opacity-50" : "hover:bg-primary-50/30"
                    }`}>
                    <input type="checkbox" checked={inCurrentWave} onChange={() => toggleContact(c.id)}
                      disabled={isAssigned && !inCurrentWave} className="rounded border-gray-300 text-primary-500" />
                    <div className="w-7 h-7 rounded-full bg-gray-100 text-gray-600 text-xs font-bold flex items-center justify-center shrink-0">
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="font-medium text-ink flex-1 min-w-0 truncate">{c.name}</span>
                    <span className="text-xs text-ink-muted font-mono">{c.phone_number}</span>
                    {isAssigned && !inCurrentWave && <span className="text-[10px] text-ink-light bg-gray-100 px-1.5 py-0.5 rounded">assigned</span>}
                  </label>
                );
              })}
            </div>
          )}
        </section>

        {/* Schedule */}
        <section className="bg-surface-card rounded-2xl shadow-card p-6 mb-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary-100 text-primary-700 text-xs font-bold">4</span>
            <h2 className="text-sm font-semibold text-ink">Delivery Mode</h2>
          </div>
          <div className="flex items-center gap-3 mb-4">
            <button onClick={() => setMode("instant")}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${mode === "instant" ? "bg-primary-500 text-white shadow-sm" : "bg-gray-100 text-ink-muted hover:bg-gray-200"}`}>Send Now</button>
            <button onClick={() => setMode("schedule")}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${mode === "schedule" ? "bg-primary-500 text-white shadow-sm" : "bg-gray-100 text-ink-muted hover:bg-gray-200"}`}>Schedule</button>
          </div>
          {mode === "schedule" && (
            <div className="flex flex-wrap gap-3">
              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1 uppercase tracking-wider">Date</label>
                <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)}
                  className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1 uppercase tracking-wider">Time</label>
                <input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)}
                  className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
            </div>
          )}
        </section>

        {/* Summary */}
        <div className="bg-surface-card rounded-2xl shadow-card p-4 mb-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div><p className="text-xs text-ink-muted">Name</p><p className="font-semibold text-ink">{blastName || "(not set)"}</p></div>
            <div><p className="text-xs text-ink-muted">Contacts</p><p className="font-semibold text-ink">{totalContacts}</p></div>
            <div><p className="text-xs text-ink-muted">Waves</p><p className="font-semibold text-ink">{waves.filter(w => w.length > 0).length}</p></div>
            <div><p className="text-xs text-ink-muted">Est. Time</p><p className="font-semibold text-ink">~{totalEstimate} min</p></div>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3 mb-5">
          <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-800">
            <p className="font-medium">Max {MAX_PER_WAVE} contacts per wave, max {MAX_WAVES} waves per broadcast.</p>
            <p className="mt-0.5">Each wave sent with <strong>15-20 min delay</strong> to avoid spam detection.</p>
          </div>
        </div>

        <button onClick={() => setConfirmOpen(true)}
          disabled={!blastName.trim() || !selectedTemplateId || totalContacts === 0 || (mode === "schedule" && (!scheduledDate || !scheduledTime))}
          className="flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 hover:scale-[1.02] disabled:opacity-40 transition-all shadow-sm">
          <Send size={16} /> Start Broadcast
        </button>

        <Modal open={confirmOpen} onClose={() => !sending && setConfirmOpen(false)} title="Confirm Broadcast">
          <div className="text-sm space-y-3">
            <p>Send <strong>"{blastName}"</strong> using <strong>{selectedTemplate?.name}</strong> to <strong>{totalContacts}</strong> contact(s) in <strong>{waves.filter(w => w.length > 0).length} wave(s)</strong>?</p>
            <div className="space-y-1">
              {waves.filter(w => w.length > 0).map((w, i) => (
                <p key={i} className="text-xs text-ink-muted">Wave {i + 1}: {w.length} contacts ~{Math.ceil((w.length * DELAY_PER_CONTACT_MS) / 60000)} min</p>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setConfirmOpen(false)} disabled={sending}
                className="px-4 py-2 text-sm font-medium text-ink-muted bg-gray-50 rounded-xl hover:bg-gray-100 disabled:opacity-50">Cancel</button>
              <button onClick={handleSubmit} disabled={sending}
                className="px-4 py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 disabled:opacity-50">
                {sending ? "Starting..." : "Yes, Start Broadcast"}
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </DashboardLayout>
  );
}
