"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Sparkles, Play, Trash2, Info, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import ConfirmDialog from "@/components/ConfirmDialog";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import DonutChartCard from "@/components/ui/DonutChartCard";
import ProgressBarList from "@/components/ui/ProgressBarList";
import { SkeletonCard, SkeletonTable } from "@/components/ui/Skeleton";
import ImportModal from "@/components/segmentation/ImportModal";
import ResetDialog from "@/components/segmentation/ResetDialog";
import ClusterCard from "@/components/segmentation/ClusterCard";
import MembersModal from "@/components/segmentation/MembersModal";
import ProspectsTable from "@/components/segmentation/ProspectsTable";
import {
  ATTRS,
  ATTR_LABELS,
  type Attr,
  type RunDetail,
  type RunSummary,
  type SuggestResult,
} from "@/lib/segmentation";

const CLUSTER_COLORS = ["#22C55E", "#38BDF8", "#FBBF24", "#A78BFA", "#F87171", "#14B8A6", "#F97316", "#EC4899", "#64748B", "#84CC16"];

interface Summary {
  total: number;
  created_contacts: number;
  distribution: Record<Attr, { value: string; count: number }[]>;
}

export default function SegmentationPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [k, setK] = useState(3);
  const [runName, setRunName] = useState("");
  const [suggest, setSuggest] = useState<SuggestResult | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [running, setRunning] = useState(false);

  const [membersFor, setMembersFor] = useState<number | null>(null);
  const [deleteRun, setDeleteRun] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const loadRun = useCallback(async (id: number) => {
    try {
      const d = await api.get<{ run: RunDetail }>(`/api/segmentation/runs/${id}`);
      setRun(d.run);
    } catch (err: any) {
      setError(err?.body?.error || "Gagal memuat hasil cluster");
    }
  }, []);

  const loadAll = useCallback(async (selectRunId?: number) => {
    try {
      const [s, r] = await Promise.all([
        api.get<Summary>("/api/segmentation/prospects/summary"),
        api.get<{ runs: RunSummary[] }>("/api/segmentation/runs"),
      ]);
      setSummary(s);
      setRuns(r.runs);
      const target = selectRunId ?? r.runs[0]?.id;
      if (target) await loadRun(target);
      else setRun(null);
    } catch (err: any) {
      setError(err?.body?.error || "Gagal memuat data");
    } finally {
      setLoading(false);
    }
  }, [loadRun]);

  useEffect(() => { loadAll(); }, [loadAll]);

  function dataChanged() {
    setSuggest(null);
    setRefreshKey((n) => n + 1);
    loadAll(run?.id);
  }

  async function handleSuggest() {
    setSuggesting(true);
    setError(null);
    try {
      const res = await api.get<SuggestResult>("/api/segmentation/suggest-k", { params: { max: 8 } });
      setSuggest(res);
      if (res.recommended) setK(res.recommended);
    } catch (err: any) {
      setError(err?.body?.error || "Gagal menghitung saran K");
    } finally {
      setSuggesting(false);
    }
  }

  async function handleRun() {
    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.post<{ run: RunDetail }>("/api/segmentation/runs", { k, name: runName.trim() || undefined });
      setRunName("");
      setNotice(`Clustering selesai: ${res.run.segments.length} cluster dari ${res.run.n_samples} data.`);
      await loadAll(res.run.id);
    } catch (err: any) {
      setError(err?.body?.error || "Clustering gagal");
    } finally {
      setRunning(false);
    }
  }

  async function handleReset(deleteContacts: boolean) {
    setResetting(true);
    setError(null);
    try {
      const res = await api.del<{ message: string }>("/api/segmentation/prospects", {
        params: { delete_contacts: deleteContacts ? "true" : undefined },
      });
      setResetOpen(false);
      setSuggest(null);
      setRun(null);
      setNotice(res.message);
      setRefreshKey((n) => n + 1);
      await loadAll();
    } catch (err: any) {
      setError(err?.body?.error || "Reset gagal");
    } finally {
      setResetting(false);
    }
  }

  async function handleDeleteRun() {
    if (!run) return;
    setDeleting(true);
    try {
      await api.del(`/api/segmentation/runs/${run.id}`);
      setDeleteRun(false);
      await loadAll();
    } catch (err: any) {
      setError(err?.body?.error || "Gagal menghapus");
    } finally {
      setDeleting(false);
    }
  }

  const total = summary?.total ?? 0;
  const canRun = total >= 2 && !running;

  return (
    <DashboardLayout>
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <PageHeader
          title="Segmentation"
          subtitle="Kelompokkan calon mahasiswa dengan K-Means lalu kirim blast ke cluster pilihan"
          actions={
            <div className="flex items-center gap-2">
              {(total > 0 || (summary?.created_contacts ?? 0) > 0) && (
                <button onClick={() => setResetOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 bg-surface-card rounded-xl border border-red-200 hover:bg-red-50 transition-all shadow-sm">
                  <RotateCcw size={15} /> Reset Data
                </button>
              )}
              <button onClick={() => setImportOpen(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 hover:scale-[1.02] transition-all shadow-sm">
                <Upload size={16} /> Import CSV
              </button>
            </div>
          }
        />

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-2xl px-5 py-3 mb-6 flex items-start gap-2">
            <span>⚠️</span><span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="underline shrink-0">Dismiss</button>
          </div>
        )}
        {notice && (
          <div className="bg-primary-50 border border-primary-200 text-primary-800 text-sm rounded-2xl px-5 py-3 mb-6 flex items-start gap-2">
            <span className="flex-1">{notice}</span>
            <button onClick={() => setNotice(null)} className="underline shrink-0">Tutup</button>
          </div>
        )}

        {loading ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
            <SkeletonTable rows={5} />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Ringkasan */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard title="Calon Mahasiswa" value={total} subtitle="data siap di-cluster" highlighted />
              <StatCard title="Cluster" value={run ? run.segments.length : "—"} subtitle={run ? (run.name || `Run #${run.id}`) : "belum ada hasil"} />
              <StatCard
                title="Silhouette Score"
                value={run?.silhouette != null ? run.silhouette.toFixed(2) : "—"}
                subtitle="makin mendekati 1 makin terpisah jelas"
              />
            </div>

            {/* Ringkasan data */}
            {total > 0 && summary && (
              <div className="bg-surface-card rounded-2xl shadow-card p-5">
                <p className="text-sm font-semibold text-ink mb-4">Komposisi Data</p>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                  {ATTRS.map((attr) => (
                    <div key={attr}>
                      <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">{ATTR_LABELS[attr]}</p>
                      <ProgressBarList
                        items={summary.distribution[attr].slice(0, 5).map((d) => ({ label: d.value, value: d.count, max: total }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Jalankan clustering */}
            <div className="bg-surface-card rounded-2xl shadow-card p-5">
              <p className="text-sm font-semibold text-ink mb-1">Jalankan K-Means</p>
              <p className="text-xs text-ink-muted mb-4">
                Variabel: minat program studi, asal sekolah, jurusan sekolah, dan domisili (One-Hot Encoding). Nama &amp; nomor tidak ikut perhitungan.
              </p>

              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink-muted mb-1 uppercase tracking-wider">Jumlah cluster (K)</label>
                  <input type="number" min={2} max={10} value={k}
                    onChange={(e) => setK(Math.min(10, Math.max(2, parseInt(e.target.value, 10) || 2)))}
                    className="w-28 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div className="flex-1 min-w-[180px]">
                  <label className="block text-xs font-semibold text-ink-muted mb-1 uppercase tracking-wider">Nama (opsional)</label>
                  <input value={runName} onChange={(e) => setRunName(e.target.value)} placeholder="mis. Segmentasi PMB Gelombang 1"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <button onClick={handleSuggest} disabled={suggesting || total < 3}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-ink-muted bg-surface-card rounded-xl border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition-all">
                  <Sparkles size={15} /> {suggesting ? "Menghitung…" : "Sarankan K"}
                </button>
                <button onClick={handleRun} disabled={!canRun}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 disabled:opacity-40 transition-all shadow-sm">
                  <Play size={15} /> {running ? "Memproses…" : "Jalankan"}
                </button>
              </div>

              {total < 2 && (
                <p className="flex items-center gap-1.5 text-xs text-ink-muted mt-3"><Info size={13} /> Import data calon mahasiswa dulu.</p>
              )}

              {suggest && (
                <div className="mt-5 border-t border-gray-100 pt-4">
                  <p className="text-xs text-ink-muted mb-3">
                    Saran berdasarkan silhouette score ({suggest.n_samples} data).{" "}
                    {suggest.recommended && <>Rekomendasi: <strong className="text-ink">K = {suggest.recommended}</strong>.</>}{" "}
                    Klik salah satu untuk memakainya.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {suggest.scores.map((s) => (
                      <button key={s.k} onClick={() => setK(s.k)}
                        className={`px-3 py-2 rounded-xl text-xs transition-all border ${
                          k === s.k ? "border-primary-500 bg-primary-50" : "border-gray-200 hover:bg-gray-50"
                        }`}>
                        <span className="font-semibold text-ink">K = {s.k}</span>
                        <span className="text-ink-muted ml-2">{s.silhouette.toFixed(2)}</span>
                        {s.k === suggest.recommended && <span className="ml-2 text-primary-600 font-semibold">★ terbaik</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Hasil */}
            {run ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold text-ink">Hasil Cluster</p>
                    <p className="text-xs text-ink-muted">
                      {run.n_samples} data · {new Date(run.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select value={run.id} onChange={(e) => loadRun(Number(e.target.value))}
                      className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white max-w-[260px] focus:outline-none focus:ring-2 focus:ring-primary-500">
                      {runs.map((r) => (
                        <option key={r.id} value={r.id}>{r.name || `Run #${r.id}`} (K={r.k})</option>
                      ))}
                    </select>
                    <button onClick={() => setDeleteRun(true)} title="Hapus hasil ini"
                      className="p-2 text-ink-light hover:text-red-500 rounded-xl hover:bg-red-50 transition-all">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <DonutChartCard
                    title="Ukuran Cluster"
                    subtitle="Jumlah anggota per cluster"
                    data={run.segments.map((s) => ({
                      name: `Cluster ${s.cluster_no}`,
                      value: s.size,
                      color: CLUSTER_COLORS[(s.cluster_no - 1) % CLUSTER_COLORS.length],
                    }))}
                    formatValue={(v) => `${v} anggota`}
                  />
                  <div className="lg:col-span-2 bg-surface-card rounded-2xl shadow-card p-5">
                    <p className="text-sm font-semibold text-ink mb-4">Ringkasan Cluster</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-xs text-ink-muted">
                          <tr className="border-b border-gray-100">
                            <th className="text-left font-medium px-3 py-2">Cluster</th>
                            <th className="text-left font-medium px-3 py-2">Anggota</th>
                            {ATTRS.map((a) => <th key={a} className="text-left font-medium px-3 py-2 whitespace-nowrap">{ATTR_LABELS[a]}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {run.segments.map((s) => (
                            <tr key={s.cluster_no} className="border-b border-gray-50 last:border-0">
                              <td className="px-3 py-2.5">
                                <span className="inline-flex items-center gap-2 font-semibold text-ink">
                                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CLUSTER_COLORS[(s.cluster_no - 1) % CLUSTER_COLORS.length] }} />
                                  {s.cluster_no}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 font-medium">{s.size}</td>
                              {ATTRS.map((a) => <td key={a} className="px-3 py-2.5 whitespace-nowrap">{s.profile.dominant[a] ?? "—"}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {run.segments.map((s) => (
                    <ClusterCard
                      key={s.cluster_no}
                      segment={s}
                      total={run.n_samples}
                      color={CLUSTER_COLORS[(s.cluster_no - 1) % CLUSTER_COLORS.length]}
                      onViewMembers={() => setMembersFor(s.cluster_no)}
                      onSendBlast={() => router.push(`/blast/new?run=${run.id}&cluster=${s.cluster_no}`)}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-surface-card rounded-2xl shadow-card p-10 text-center text-sm text-ink-muted">
                Belum ada hasil clustering. Import data lalu klik <strong>Jalankan</strong>.
              </div>
            )}

            <ProspectsTable refreshKey={refreshKey} onChanged={dataChanged} />

            <p className="text-[11px] text-ink-light leading-relaxed">
              Catatan: K-Means dengan One-Hot Encoding pada data kategorikal menghasilkan kelompok berdasarkan kemiripan kombinasi atribut;
              hasilnya panduan segmentasi, bukan kebenaran mutlak. Asal sekolah yang jarang muncul digabung ke &quot;Lainnya&quot; saat perhitungan
              agar tidak mendominasi.
            </p>
          </div>
        )}
      </div>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={dataChanged}
        existingTotal={total}
        existingCreatedContacts={summary?.created_contacts ?? 0}
      />
      <ResetDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={handleReset}
        total={total}
        createdContacts={summary?.created_contacts ?? 0}
        loading={resetting}
      />
      <MembersModal open={membersFor !== null} onClose={() => setMembersFor(null)} runId={run?.id ?? null} clusterNo={membersFor} />
      <ConfirmDialog
        open={deleteRun}
        onClose={() => setDeleteRun(false)}
        onConfirm={handleDeleteRun}
        title="Hapus hasil cluster"
        message="Hapus hasil clustering ini? Data calon mahasiswa dan kontak tidak ikut terhapus."
        loading={deleting}
      />
    </DashboardLayout>
  );
}
