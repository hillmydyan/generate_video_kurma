import React, { useState, useEffect } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useNotify } from '@/components/ui/NotificationProvider';
import { fmtDuration, fmtCredits, truncate } from '@/lib/format';
import { api } from '@/lib/api';

export const Pabrik: React.FC = () => {
  const { success, error, warning } = useNotify();
  const [batchName, setBatchName] = useState('Kampanye Launching Q4');
  const [mode, setMode] = useState<'multi_prompt' | 'multi_asset' | 'csv'>('multi_prompt');
  const [formula, setFormula] = useState('Close-up shot of {product} on marble podium, {lighting} cinematic illumination');
  const [variations, setVariations] = useState(1);
  const [selectedModelKey, setSelectedModelKey] = useState('veo');
  const [models, setModels] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null);

  // Variable values
  const [productValues, setProductValues] = useState('Krim Pelembab\nSerum Glowing');
  const [lightingValues, setLightingValues] = useState('Golden Hour\nNeon Cyberpunk');

  // Real tasks & batch state
  const [tasks, setTasks] = useState<any[]>([]);
  const [batchTaskIds, setBatchTaskIds] = useState<string[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [previewTask, setPreviewTask] = useState<any | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem('snapgen_user');
    if (raw) {
      try {
        setUser(JSON.parse(raw));
      } catch {}
    }

    api.models.list().then((res) => {
      const vModels = (res.models || []).filter((m: any) => m.type === 'video');
      setModels(vModels);
      if (vModels.length > 0) setSelectedModelKey(vModels[0].key);
    }).catch(() => {});
  }, []);

  const loadTasks = async () => {
    try {
      const res = await api.tasks.list({ limit: 50 });
      setTasks(res.tasks || []);
    } catch {}
  };

  useEffect(() => {
    loadTasks();
  }, []);

  // Auto-poll every 4s while any task is queued, generating, or downloading
  useEffect(() => {
    const hasPending = tasks.some((t) =>
      ['queued', 'generating', 'downloading'].includes(t.status)
    );
    if (!hasPending) return;
    const timer = setInterval(loadTasks, 4000);
    return () => clearInterval(timer);
  }, [tasks]);

  const currentModel = models.find((m) => m.key === selectedModelKey) || models[0];

  // Calculate combinations
  const pList = productValues.split('\n').map((x) => x.trim()).filter((x) => x.length > 0);
  const lList = lightingValues.split('\n').map((x) => x.trim()).filter((x) => x.length > 0);
  const totalCombinations = (pList.length || 1) * (lList.length || 1);
  const totalTasks = totalCombinations * variations;
  const costPerVideo = currentModel?.credits ?? 4;
  const totalCost = totalTasks * costPerVideo;

  const handleStartBatch = async () => {
    if (!user) return;

    // Build expanded prompt entries
    const entries: { prompt: string; count: number }[] = [];
    const products = pList.length > 0 ? pList : ['Produk'];
    const lightings = lList.length > 0 ? lList : ['Cinematic'];

    for (const prod of products) {
      for (const light of lightings) {
        const expanded = formula
          .replace(/\{product\}/gi, prod)
          .replace(/\{lighting\}/gi, light)
          .trim();
        if (expanded.length >= 5) {
          entries.push({ prompt: expanded, count: variations });
        }
      }
    }

    if (entries.length === 0) {
      warning('Formula Tidak Valid', 'Formula prompt minimal harus memiliki 5 karakter.');
      return;
    }

    setSubmitting(true);
    try {
      const defaultAspect = currentModel?.options?.aspect?.[0] || '9:16';
      const defaultDuration = currentModel?.options?.duration?.[0] || 4;

      const payload = {
        model_key: selectedModelKey,
        media_type: currentModel?.type || 'video',
        options: {
          aspect: defaultAspect,
          ...(defaultDuration ? { duration: defaultDuration } : {}),
        },
        entries,
        image_mode: 'none',
      };

      const res = await api.tasks.generate(user.id, payload);
      const created = res.tasks || [];
      const newBatchId = `B-${Math.floor(100 + Math.random() * 900)}`;
      setBatchId(newBatchId);
      setBatchTaskIds(created.map((t: any) => t.task_id));
      success(
        `Batch #${newBatchId} Dimulai`,
        `${created.length} sub-tugas berhasil dikirim ke antrean worker divisi.`
      );
      await loadTasks();
      setTimeout(() => window.dispatchEvent(new Event('snapgen_credits_refresh')), 2500);
    } catch (err: any) {
      error('Gagal Memulai Batch', err.message || 'Gagal memulai batch pabrik.');
    } finally {
      setSubmitting(false);
    }
  };

  // Compute active batch stats from real tasks
  const trackedTasks = batchTaskIds.length > 0
    ? tasks.filter((t) => batchTaskIds.includes(t.task_id))
    : tasks.filter((t) => ['queued', 'generating', 'downloading'].includes(t.status));

  const isBatchRunning = trackedTasks.some((t) =>
    ['queued', 'generating', 'downloading'].includes(t.status)
  );
  const completedCount = trackedTasks.filter((t) => t.status === 'completed').length;
  const totalTracked = trackedTasks.length;
  const progressPct = totalTracked > 0 ? Math.round((completedCount / totalTracked) * 100) : 0;
  const pendingCount = trackedTasks.filter((t) =>
    ['queued', 'generating', 'downloading'].includes(t.status)
  ).length;
  const remainingSec = pendingCount * (currentModel?.est_seconds || 180);

  return (
    <div className="flex-1 flex flex-col space-y-6">
      {/* Header Card */}
      <div className="glass-card p-6 rounded-2xl flex flex-wrap items-center justify-between gap-4 border border-white/10">
        <div>
          <span className="kicker">BATCH PIPELINE ENGINE</span>
          <h1 className="text-2xl font-bold font-['Plus_Jakarta_Sans'] text-white mt-1">
            Pabrik Video
          </h1>
          <p className="text-xs text-[#8f9286] mt-0.5">
            Sintesis massal variasi video dari formula prompt dinamis (&#123;product&#125; × &#123;lighting&#125;) langsung ke antrean akun divisi.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="px-3 py-1.5 rounded-full bg-[#111d22] border border-white/10 text-xs font-mono text-[#9cb080] flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${isBatchRunning ? 'bg-[#f59e0b] animate-pulse' : 'bg-[#9cb080]'}`} />
            <span>{isBatchRunning ? `${pendingCount} TUGAS DIPROSES` : 'SIAP'}</span>
          </span>
          <span className="px-3 py-1.5 rounded-full bg-[#111d22] border border-white/10 text-xs font-mono text-white">
            Slot paralel: 2
          </span>
        </div>
      </div>

      {/* Two Columns Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Form Config (5 cols) */}
        <div className="lg:col-span-5 glass-panel p-6 rounded-2xl flex flex-col space-y-5">
          <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
            <h2 className="text-sm font-bold text-white">Konfigurasi Parameter Batch</h2>
            <span className="kicker text-[10px]">{batchId ? `ID: ${batchId}` : 'SIAP'}</span>
          </div>

          {/* 1. Nama Batch */}
          <div>
            <label className="kicker block mb-1">NAMA BATCH KAMPANYE</label>
            <input
              type="text"
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
              className="w-full glass-input text-xs font-medium"
            />
          </div>

          {/* 2. Mode Matriks */}
          <div>
            <label className="kicker block mb-1">MODE MATRIKS GENERASI</label>
            <div className="grid grid-cols-3 gap-1 bg-[#111d22] p-1 rounded-xl border border-white/5 text-xs">
              <button
                type="button"
                onClick={() => setMode('multi_prompt')}
                className={`py-1.5 rounded-lg transition ${
                  mode === 'multi_prompt' ? 'bg-[#2b373c] text-white font-semibold' : 'text-[#8f9286]'
                }`}
              >
                Multi-Prompt
              </button>
              <button
                type="button"
                onClick={() => setMode('multi_asset')}
                className={`py-1.5 rounded-lg transition ${
                  mode === 'multi_asset' ? 'bg-[#2b373c] text-white font-semibold' : 'text-[#8f9286]'
                }`}
              >
                Multi-Aset
              </button>
              <button
                type="button"
                onClick={() => setMode('csv')}
                className={`py-1.5 rounded-lg transition ${
                  mode === 'csv' ? 'bg-[#2b373c] text-white font-semibold' : 'text-[#8f9286]'
                }`}
              >
                Matriks CSV
              </button>
            </div>
          </div>

          {/* 3. Model & Parameter */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="kicker block mb-1">MODEL VIDEO</label>
              <select
                value={selectedModelKey}
                onChange={(e) => setSelectedModelKey(e.target.value)}
                className="w-full glass-input text-xs font-mono"
              >
                {models.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label} ({m.credits} KR)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="kicker block mb-1">VARIASI / PROMPT</label>
              <select
                value={variations}
                onChange={(e) => setVariations(Number(e.target.value))}
                className="w-full glass-input text-xs font-mono"
              >
                <option value={1}>1 Variasi</option>
                <option value={2}>2 Variasi</option>
                <option value={3}>3 Variasi</option>
                <option value={4}>4 Variasi</option>
              </select>
            </div>
          </div>

          {/* 4. Formula Prompt Dinamis */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="kicker">FORMULA PROMPT DINAMIS</label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setFormula((f) => f + ' {product}')}
                  className="px-2 py-0.5 rounded bg-indigo-500/20 text-[#9ea0fd] text-[10px] font-mono hover:bg-indigo-500/30"
                >
                  + &#123;product&#125;
                </button>
                <button
                  type="button"
                  onClick={() => setFormula((f) => f + ' {lighting}')}
                  className="px-2 py-0.5 rounded bg-indigo-500/20 text-[#9ea0fd] text-[10px] font-mono hover:bg-indigo-500/30"
                >
                  + &#123;lighting&#125;
                </button>
              </div>
            </div>
            <textarea
              rows={3}
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              className="w-full glass-input text-xs leading-relaxed resize-none"
            />
            <div className="flex items-center justify-between text-[11px] font-mono text-[#8f9286] mt-1">
              <span>Variabel: &#123;product&#125; × &#123;lighting&#125;</span>
              <span className="text-[#9cb080]">{totalCombinations} Kombinasi Prompt</span>
            </div>
          </div>

          {/* Variabel Values Editor */}
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/[0.06]">
            <div>
              <label className="kicker block mb-1">&#123;product&#125; (1 per baris)</label>
              <textarea
                rows={2}
                value={productValues}
                onChange={(e) => setProductValues(e.target.value)}
                className="w-full glass-input text-xs font-mono resize-none"
              />
            </div>
            <div>
              <label className="kicker block mb-1">&#123;lighting&#125; (1 per baris)</label>
              <textarea
                rows={2}
                value={lightingValues}
                onChange={(e) => setLightingValues(e.target.value)}
                className="w-full glass-input text-xs font-mono resize-none"
              />
            </div>
          </div>

          {/* 5. Estimasi Biaya */}
          <div className="p-3.5 rounded-xl bg-[#111d22] border border-white/5 flex items-center justify-between">
            <div>
              <p className="kicker">ESTIMASI BIAYA</p>
              <p className="text-sm font-bold font-mono text-white mt-0.5">
                {totalTasks} Video × {costPerVideo} KR = {fmtCredits(totalCost)}
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-[#10b981]/15 text-[#10b981] text-[10px] font-mono font-bold">
              SIAP EKSEKUSI
            </span>
          </div>

          {/* 6. CTA */}
          <button
            type="button"
            onClick={handleStartBatch}
            disabled={submitting}
            className="w-full btn py-3 rounded-xl text-xs font-bold text-white shadow-xl flex items-center justify-center gap-2 bg-gradient-to-r from-[#5d56e9] to-[#9ea0fd] hover:opacity-95 disabled:opacity-50 transition"
          >
            {submitting ? (
              <Icon name="sync" size={18} className="animate-fs-spin" />
            ) : (
              <Icon name="play_arrow" size={18} />
            )}
            <span>{submitting ? 'Mengirim Batch...' : `Mulai Batch Pabrik (${totalTasks} Tugas)`}</span>
          </button>
        </div>

        {/* Right Column: Active Batch & Real Subtasks (7 cols) */}
        <div className="lg:col-span-7 flex flex-col space-y-6">
          {/* Active Batch Card */}
          {totalTracked > 0 ? (
            <div className="glass-panel p-6 rounded-2xl border border-white/10 relative overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-[#5d56e9] to-[#9ea0fd] absolute top-0 left-0 right-0" />
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-white">
                      {batchId ? `Batch #${batchId}` : 'Antrean Aktif'}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                        isBatchRunning
                          ? 'bg-[#f59e0b]/20 text-[#f59e0b]'
                          : 'bg-[#10b981]/20 text-[#10b981]'
                      }`}
                    >
                      {isBatchRunning ? 'SEDANG RENDERING' : 'SELESAI'}
                    </span>
                  </div>
                  <p className="text-xs text-[#8f9286] mt-0.5">{batchName}</p>
                </div>
                {batchTaskIds.length > 0 && (
                  <button
                    onClick={() => {
                      setBatchTaskIds([]);
                      setBatchId(null);
                    }}
                    className="btn btn-ghost px-3 py-1 text-xs rounded-lg"
                  >
                    Bersihkan Tampilan
                  </button>
                )}
              </div>

              {/* 4 KPI Metrics */}
              <div className="grid grid-cols-4 gap-2 py-3 border-y border-white/[0.08]">
                <div>
                  <p className="kicker text-[9px]">PROGRES RENDER</p>
                  <p className="text-base font-bold font-mono text-white mt-0.5">{progressPct}%</p>
                </div>
                <div>
                  <p className="kicker text-[9px]">VIDEO SELESAI</p>
                  <p className="text-base font-bold font-mono text-[#10b981] mt-0.5">
                    {completedCount}/{totalTracked}
                  </p>
                </div>
                <div>
                  <p className="kicker text-[9px]">ESTIMASI SISA</p>
                  <p className="text-base font-bold font-mono text-[#ffd28a] mt-0.5">
                    {isBatchRunning ? `~${fmtDuration(remainingSec)}` : '0s'}
                  </p>
                </div>
                <div>
                  <p className="kicker text-[9px]">MODEL AKTIF</p>
                  <p className="text-base font-bold font-mono text-white mt-0.5">
                    {currentModel?.label || 'Veo'}
                  </p>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-[#111d22] h-2 rounded-full overflow-hidden mt-4">
                <div
                  className="bg-gradient-to-r from-[#5d56e9] to-[#9ea0fd] h-full transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="glass-panel p-8 text-center rounded-2xl flex flex-col items-center justify-center text-[#8f9286]">
              <Icon name="factory" size={40} className="opacity-30 mb-2" />
              <p className="text-sm font-semibold text-white">Belum Ada Batch Aktif</p>
              <p className="text-xs mt-1">
                Atur variabel di sebelah kiri lalu klik "Mulai Batch Pabrik" untuk menjalankan antrean massal.
              </p>
            </div>
          )}

          {/* Real Sub-task Queue */}
          <div className="glass-panel p-6 rounded-2xl border border-white/10 flex flex-col space-y-4">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div>
                <h3 className="text-sm font-bold text-white">Daftar Tugas & Riwayat Antrean</h3>
                <p className="text-[11px] text-[#8f9286]">
                  Menampilkan tugas nyata yang sedang diproses maupun yang telah selesai
                </p>
              </div>
              <span className="text-xs font-mono text-[#8f9286]">{tasks.length} tugas</span>
            </div>

            {tasks.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#8f9286]">
                Belum ada tugas yang dijalankan.
              </div>
            ) : (
              <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                {tasks.slice(0, 20).map((t, index) => (
                  <div
                    key={t.task_id}
                    className="p-3 rounded-xl bg-[#111d22] flex items-center justify-between border border-white/5 hover:border-white/15 transition"
                  >
                    <div className="flex items-center gap-3 min-w-0 pr-3">
                      <div
                        className={`w-9 h-9 rounded-lg bg-[#202c31] flex items-center justify-center shrink-0 ${
                          t.status === 'completed'
                            ? 'text-[#10b981]'
                            : t.status === 'failed'
                            ? 'text-[#fb7185]'
                            : 'text-[#f59e0b]'
                        }`}
                      >
                        <Icon
                          name={
                            t.status === 'completed'
                              ? 'check_circle'
                              : t.status === 'failed'
                              ? 'error'
                              : 'sync'
                          }
                          size={18}
                          className={
                            ['queued', 'generating', 'downloading'].includes(t.status)
                              ? 'animate-fs-spin'
                              : ''
                          }
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white truncate">
                          #{String(index + 1).padStart(2, '0')} • {truncate(t.prompt, 65)}
                        </p>
                        <p className="text-[10px] text-[#8f9286] font-mono mt-0.5">
                          {(t.model_key || 'veo').toUpperCase()} • {t.options?.aspect || '9:16'} •{' '}
                          {t.status === 'completed'
                            ? `Selesai (${t.credit_used || t.credit_cost || 7} KR)`
                            : t.status === 'failed'
                            ? `Gagal: ${truncate(t.error || 'Error', 40)}`
                            : t.status === 'downloading'
                            ? 'Mengunduh video...'
                            : t.status === 'generating'
                            ? `Rendering… (${t.provider_pct || 1}%)`
                            : 'Menunggu antrean…'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {t.status === 'completed' && t.result_url ? (
                        <button
                          type="button"
                          onClick={() => setPreviewTask(t)}
                          className="btn btn-ghost px-2.5 py-1 text-xs rounded-lg border border-white/10 hover:bg-white/10"
                        >
                          Preview
                        </button>
                      ) : ['queued', 'generating', 'downloading'].includes(t.status) ? (
                        <span className="text-xs font-mono text-[#ffd28a]">
                          {t.status === 'downloading' ? '100%' : `${t.provider_pct || 1}%`}
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono text-[#fb7185]">Gagal</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      {previewTask && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setPreviewTask(null)}
        >
          <div
            className="glass-panel max-w-2xl w-full rounded-2xl p-4 border border-white/15 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <div className="min-w-0 pr-4">
                <p className="text-xs font-mono text-[#9cb080]">ID: #{previewTask.task_id.slice(-6)}</p>
                <p className="text-xs text-white truncate mt-0.5">{previewTask.prompt}</p>
              </div>
              <button
                onClick={() => setPreviewTask(null)}
                className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <div className="bg-[#041014] rounded-xl overflow-hidden flex items-center justify-center max-h-[420px]">
              {previewTask.media_type === 'video' ? (
                <video
                  src={previewTask.result_url}
                  controls
                  autoPlay
                  loop
                  className="max-h-[400px] w-auto object-contain"
                />
              ) : (
                <img
                  src={previewTask.result_url}
                  alt="Preview"
                  className="max-h-[400px] w-auto object-contain"
                />
              )}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <a
                href={previewTask.result_url}
                download
                className="btn btn-indigo px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
              >
                <Icon name="download" size={14} />
                <span>Unduh File</span>
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
