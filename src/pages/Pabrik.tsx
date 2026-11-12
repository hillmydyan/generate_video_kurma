import React, { useState, useEffect } from 'react';
import { Icon } from '@/components/ui/Icon';
import { fmtDuration, fmtCredits } from '@/lib/format';
import { api } from '@/lib/api';

export const Pabrik: React.FC = () => {
  const [batchName, setBatchName] = useState('Kampanye Launching Q4');
  const [mode, setMode] = useState<'multi_prompt' | 'multi_asset' | 'csv'>('multi_prompt');
  const [formula, setFormula] = useState('Close-up shot of {product} on marble podium, {lighting} cinematic illumination');
  const [variations, setVariations] = useState(2);
  const [selectedModelKey, setSelectedModelKey] = useState('veo');
  const [models, setModels] = useState<any[]>([]);
  const [activeBatch, setActiveBatch] = useState<any | null>(null);

  // Variable values
  const [productValues, setProductValues] = useState('Krim Pelembab\nSerum Glowing');
  const [lightingValues, setLightingValues] = useState('Golden Hour\nNeon Cyberpunk');

  useEffect(() => {
    api.models.list().then((res) => {
      const vModels = (res.models || []).filter((m: any) => m.type === 'video');
      setModels(vModels);
      if (vModels.length > 0) setSelectedModelKey(vModels[0].key);
    }).catch(() => {});
  }, []);

  const currentModel = models.find((m) => m.key === selectedModelKey) || models[0];

  // Calculate combinations
  const pList = productValues.split('\n').filter((x) => x.trim().length > 0);
  const lList = lightingValues.split('\n').filter((x) => x.trim().length > 0);
  const totalCombinations = (pList.length || 1) * (lList.length || 1);
  const totalTasks = totalCombinations * variations;
  const costPerVideo = currentModel?.credits || 7;
  const totalCost = totalTasks * costPerVideo;

  const handleStartBatch = () => {
    const dummyBatch = {
      id: `B-${Math.floor(100 + Math.random() * 900)}`,
      name: batchName,
      status: 'SEDANG RENDERING',
      progress: 35,
      completed: Math.floor(totalTasks * 0.35),
      total: totalTasks,
      remainingSec: 180,
      model: currentModel?.label || 'Veo',
    };
    setActiveBatch(dummyBatch);
  };

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
            Sintesis massal puluhan variasi video dari formula prompt dinamis dan matriks aset.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="px-3 py-1.5 rounded-full bg-[#111d22] border border-white/10 text-xs font-mono text-[#9cb080]">
            ● {activeBatch ? '1 BATCH AKTIF' : '0 BATCH AKTIF'}
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
            <span className="kicker text-[10px]">ID: B-NEW</span>
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
              <span>Syntax: Valid (2 variabel terdeteksi)</span>
              <span className="text-[#9cb080]">{totalCombinations} Kombinasi</span>
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
              SALDO CUKUP
            </span>
          </div>

          {/* 6. CTA */}
          <button
            type="button"
            onClick={handleStartBatch}
            className="w-full btn py-3 rounded-xl text-xs font-bold text-white shadow-xl flex items-center justify-center gap-2 bg-gradient-to-r from-[#5d56e9] to-[#9ea0fd] hover:opacity-95 transition"
          >
            <Icon name="play_arrow" size={18} />
            <span>Mulai Batch Pabrik ({totalTasks} Tugas)</span>
          </button>
        </div>

        {/* Right Column: Active Batch & Subtasks (7 cols) */}
        <div className="lg:col-span-7 flex flex-col space-y-6">
          {/* Active Batch Card */}
          {activeBatch ? (
            <div className="glass-panel p-6 rounded-2xl border border-white/10 relative overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-[#5d56e9] to-[#9ea0fd] absolute top-0 left-0 right-0" />
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-white">Batch #{activeBatch.id}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#f59e0b]/20 text-[#f59e0b]">
                      {activeBatch.status}
                    </span>
                  </div>
                  <p className="text-xs text-[#8f9286] mt-0.5">{activeBatch.name}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button className="btn btn-ghost px-3 py-1 text-xs rounded-lg">Jeda</button>
                  <button
                    onClick={() => setActiveBatch(null)}
                    className="btn btn-danger px-3 py-1 text-xs rounded-lg"
                  >
                    Batal
                  </button>
                </div>
              </div>

              {/* 4 KPI Metrics */}
              <div className="grid grid-cols-4 gap-2 py-3 border-y border-white/[0.08]">
                <div>
                  <p className="kicker text-[9px]">PROGRES RENDER</p>
                  <p className="text-base font-bold font-mono text-white mt-0.5">{activeBatch.progress}%</p>
                </div>
                <div>
                  <p className="kicker text-[9px]">VIDEO SELESAI</p>
                  <p className="text-base font-bold font-mono text-[#10b981] mt-0.5">
                    {activeBatch.completed}/{activeBatch.total}
                  </p>
                </div>
                <div>
                  <p className="kicker text-[9px]">ESTIMASI SISA</p>
                  <p className="text-base font-bold font-mono text-[#ffd28a] mt-0.5">
                    ~{fmtDuration(activeBatch.remainingSec)}
                  </p>
                </div>
                <div>
                  <p className="kicker text-[9px]">THROUGHPUT</p>
                  <p className="text-base font-bold font-mono text-white mt-0.5">1.4 v/m</p>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-[#111d22] h-2 rounded-full overflow-hidden mt-4">
                <div
                  className="bg-gradient-to-r from-[#5d56e9] to-[#9ea0fd] h-full transition-all duration-500"
                  style={{ width: `${activeBatch.progress}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="glass-panel p-8 text-center rounded-2xl flex flex-col items-center justify-center text-[#8f9286]">
              <Icon name="factory" size={40} className="opacity-30 mb-2" />
              <p className="text-sm font-semibold text-white">Belum Ada Batch Aktif</p>
              <p className="text-xs mt-1">Isi formulir konfigurasi di sebelah kiri untuk memulai batch.</p>
            </div>
          )}

          {/* Sub-task Queue */}
          <div className="glass-panel p-6 rounded-2xl border border-white/10 flex flex-col space-y-4">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <h3 className="text-sm font-bold text-white">Antrean Sub-Tugas Multi-Skenario</h3>
              <span className="text-xs font-mono text-[#8f9286]">Maks 50 tugas / batch</span>
            </div>

            <div className="space-y-2">
              <div className="p-3 rounded-xl bg-[#111d22] flex items-center justify-between border border-white/5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[#202c31] flex items-center justify-center text-[#10b981]">
                    <Icon name="check_circle" size={18} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white">#01 • Krim Pelembab / Golden Hour</p>
                    <p className="text-[10px] text-[#8f9286] font-mono mt-0.5">Variasi A • 1080×1920 MP4 · Rendered in 48s</p>
                  </div>
                </div>
                <button className="btn btn-ghost px-2.5 py-1 text-xs rounded">Preview</button>
              </div>

              <div className="p-3 rounded-xl bg-[#111d22] flex items-center justify-between border border-white/5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[#202c31] flex items-center justify-center text-[#f59e0b]">
                    <Icon name="sync" size={18} className="animate-fs-spin" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white">#02 • Serum Glowing / Neon Cyberpunk</p>
                    <p className="text-[10px] text-[#ffd28a] font-mono mt-0.5">Variasi A • Rendering… sisa ≈ 34 dtk</p>
                  </div>
                </div>
                <span className="text-xs font-mono text-zinc-400">42%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
