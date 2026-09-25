"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Play, Trash2, Info, RotateCcw, Download } from "lucide-react";
import { api } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import DashboardLayout from "@/components/DashboardLayout";
import ConfirmDialog from "@/components/ConfirmDialog";
import PageHeader from "@/components/ui/PageHeader";
import ProgressBarList from "@/components/ui/ProgressBarList";
import { SkeletonCard, SkeletonTable } from "@/components/ui/Skeleton";
import ImportModal from "@/components/segmentation/ImportModal";
import ResetDialog from "@/components/segmentation/ResetDialog";
import DataSummary from "@/components/segmentation/DataSummary";
import PreprocessingSummary from "@/components/segmentation/PreprocessingSummary";
import KEvaluation from "@/components/segmentation/KEvaluation";
import ClusterResult, { colorOf } from "@/components/segmentation/ClusterResult";
import ClusterCard from "@/components/segmentation/ClusterCard";
import MembersModal from "@/components/segmentation/MembersModal";
import ProspectsTable from "@/components/segmentation/ProspectsTable";
import {
  ATTRS,
  ATTR_LABELS,
  type ProspectSummary,
  type RunDetail,
  type RunDetailMember,
  type RunSummary,
  type SuggestResult,
} from "@/lib/segmentation";

const SectionTitle = ({ n, title, hint }: { n: number; title: string; hint?: string }) => (
  <div className="flex items-center gap-2.5 mb-3">
    <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary-100 text-primary-700 text-xs font-bold">{n}</span>
    <div>
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </div>
  </div>
);

export default function SegmentationPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<ProspectSummary | null>(null);
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
  const [exportingAll, setExportingAll] = useState(false);

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
        api.get<ProspectSummary>("/api/segmentation/prospects/summary"),
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

  async function handleEvaluate() {
    setSuggesting(true);
    setError(null);
    try {
      const res = await api.get<SuggestResult>("/api/segmentation/suggest-k", { params: { max: 6 } });
      setSuggest(res);
      if (res.recommendation) setK(res.recommendation.k);
    } catch (err: any) {
      setError(err?.body?.error || "Gagal mengevaluasi K");
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

  async function exportAllMembers() {
    if (!run) return;
    setExportingAll(true);
    try {
      const res = await api.get<{ members: RunDetailMember[] }>(`/api/segmentation/runs/${run.id}/details`, { params: { limit: 5000 } });
      downloadCsv(`anggota-semua-cluster-run-${run.id}.csv`, [
        ["Nama", "Nomor_WhatsApp", "Minat_Program_Studi", "Asal_Sekolah", "Jurusan_Sekolah", "Domisili", "Cluster"],
        ...res.members.map((m) => [m.name, m.phone_number, m.program_studi, m.asal_sekolah, m.jurusan_sekolah, m.domisili, m.cluster_no]),
      ]);
    } catch (err: any) {
      setError(err?.body?.error || "Gagal mengunduh");
    } finally {
      setExportingAll(false);
    }
  }

  const total = summary?.total ?? 0;
  const complete = summary?.clustering.complete ?? 0;
  const canRun = complete >= 2 && !running;

  return (
    <DashboardLayout>
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <PageHeader
          title="Segmentation"
          subtitle="Segmentasi calon mahasiswa dengan K-Means (One-Hot Encoding), lalu kirim blast ke cluster pilihan"
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
                <Upload size={16} /> Import Data
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

        {loading || !summary ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4"><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
            <SkeletonTable rows={5} />
          </div>
        ) : (
          <div className="space-y-10">
            {/* 1. Data Summary */}
            <div>
              <SectionTitle n={1} title="Data Summary" hint="Ringkasan dataset dan hasil validasi" />
              <DataSummary summary={summary} />
              {total > 0 && (
                <div className="bg-surface-card rounded-2xl shadow-card p-5 mt-4">
                  <p className="text-sm font-semibold text-ink mb-4">Komposisi Data</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                    {ATTRS.map((attr) => (
                      <div key={attr}>
                        <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">{ATTR_LABELS[attr]}</p>
                        <ProgressBarList items={summary.distribution[attr].slice(0, 5).map((d) => ({ label: d.value, value: d.count, max: total }))} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 2. Preprocessing Summary */}
            <div>
              <SectionTitle n={2} title="Preprocessing" hint="Cleaning, standardisasi format, dan pembakuan kategori sebelum One-Hot Encoding" />
              <PreprocessingSummary summary={summary} />
            </div>

            {/* 3. Evaluasi K + Elbow */}
            <div>
              <SectionTitle n={3} title="Evaluasi K" hint="SSE, Silhouette, Davies-Bouldin, dan grafik Elbow" />
              <KEvaluation
                result={suggest}
                loading={suggesting}
                disabled={complete < 3}
                disabledHint={complete < 3 ? "Butuh minimal 3 data calon mahasiswa. Import data terlebih dahulu." : undefined}
                selectedK={k}
                onEvaluate={handleEvaluate}
                onPickK={setK}
              />
            </div>

            {/* 4. Jalankan clustering */}
            <div>
              <SectionTitle n={4} title="Jalankan Clustering" hint="K-Means pada 4 variabel: minat program studi, asal sekolah, jurusan sekolah, domisili" />
              <div className="bg-surface-card rounded-2xl shadow-card p-5">
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
                  <button onClick={handleRun} disabled={!canRun}
                    className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-primary-500 rounded-xl hover:bg-primary-600 disabled:opacity-40 transition-all shadow-sm">
                    <Play size={15} /> {running ? "Memproses…" : "Jalankan K-Means"}
                  </button>
                </div>
                {complete < 2 ? (
                  <p className="flex items-center gap-1.5 text-xs text-ink-muted mt-3"><Info size={13} /> Import data calon mahasiswa dulu.</p>
                ) : (
                  <p className="text-xs text-ink-muted mt-3">
                    {complete} data diproses dengan {summary.clustering.feature_count} fitur One-Hot
                    {summary.clustering.imputed > 0 && <> · {summary.clustering.imputed} baris missing value diimputasi</>}.
                    Hasil disimpan ke database dan dapat dipilih sebagai target campaign.
                  </p>
                )}
              </div>
            </div>

            {/* 5. Hasil + Detail */}
            {run ? (
              <div className="space-y-8">
                <div>
                  <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                    <SectionTitle n={5} title="Hasil Segmentasi" hint={`${run.name || `Run #${run.id}`} · ${new Date(run.created_at).toLocaleString()}`} />
                    <div className="flex items-center gap-2 -mt-3">
                      <select value={run.id} onChange={(e) => loadRun(Number(e.target.value))}
                        className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white max-w-[260px] focus:outline-none focus:ring-2 focus:ring-primary-500">
                        {runs.map((r) => <option key={r.id} value={r.id}>{r.name || `Run #${r.id}`} (K={r.k})</option>)}
                      </select>
                      <button onClick={exportAllMembers} disabled={exportingAll}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-ink-muted bg-surface-card rounded-xl border border-gray-200 hover:bg-gray-50 disabled:opacity-50">
                        <Download size={13} /> {exportingAll ? "Menyiapkan…" : "Anggota (CSV)"}
                      </button>
                      <button onClick={() => setDeleteRun(true)} title="Hapus hasil ini" className="p-2 text-ink-light hover:text-red-500 rounded-xl hover:bg-red-50 transition-all">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <ClusterResult run={run} />
                </div>

                <div>
                  <SectionTitle n={6} title="Detail Cluster" hint="Distribusi keempat variabel pada setiap cluster (kategori, jumlah, persentase)" />
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {run.segments.map((s) => (
                      <ClusterCard
                        key={s.cluster_no}
                        segment={s}
                        total={run.n_samples}
                        color={colorOf(s.cluster_no)}
                        onViewMembers={() => setMembersFor(s.cluster_no)}
                        onSendBlast={() => router.push(`/blast/new?run=${run.id}&cluster=${s.cluster_no}`)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-surface-card rounded-2xl shadow-card p-10 text-center text-sm text-ink-muted">
                Belum ada hasil clustering. Import data, evaluasi K, lalu klik <strong>Jalankan K-Means</strong>.
              </div>
            )}

            <div>
              <SectionTitle n={run ? 7 : 5} title="Data Calon Mahasiswa" hint="Daftar data yang tersimpan" />
              <ProspectsTable refreshKey={refreshKey} onChanged={dataChanged} />
            </div>

            <p className="text-[11px] text-ink-light leading-relaxed">
              Catatan metodologi: K-Means dengan One-Hot Encoding pada data kategorikal mengelompokkan berdasarkan kemiripan kombinasi atribut; hasilnya
              panduan segmentasi, bukan kebenaran mutlak. Kategori yang sangat jarang muncul digabung ke &quot;Lainnya&quot; hanya saat perhitungan.
              Nama dan nomor WhatsApp hanya identitas dan tidak dipakai sebagai fitur.
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
