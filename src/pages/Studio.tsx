import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useEventsCtx } from '@/lib/useEvents';
import { fmtDuration, fmtCredits, truncate, fmtTime } from '@/lib/format';
import { api } from '@/lib/api';

export const Studio: React.FC = () => {
  const navigate = useNavigate();
  const { lastTaskUpdate } = useEventsCtx();

  const [models, setModels] = useState<any[]>([]);
  const [selectedModelKey, setSelectedModelKey] = useState<string>('veo');
  const [selectedAspect, setSelectedAspect] = useState<string>('9:16');
  const [selectedDuration, setSelectedDuration] = useState<number | null>(5);
  const [prompt, setPrompt] = useState('');
  const [referenceImagePath, setReferenceImagePath] = useState<string | null>(null);

  const [tasks, setTasks] = useState<any[]>([]);
  const [activeTask, setActiveTask] = useState<any | null>(null);
  const [quota, setQuota] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<any>(null);

  const [modelPopupOpen, setModelPopupOpen] = useState(false);
  const [ratioDropdownOpen, setRatioDropdownOpen] = useState(false);
  const [durationDropdownOpen, setDurationDropdownOpen] = useState(false);
  const [successNote, setSuccessNote] = useState<string | null>(null);
  const [errorNote, setErrorNote] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const raw = localStorage.getItem('snapgen_user');
    if (raw) {
      setUser(JSON.parse(raw));
    }
  }, []);

  // Fetch models & initial tasks
  useEffect(() => {
    api.models.list()
      .then((res) => {
        setModels(res.models || []);
        if (res.models && res.models.length > 0) {
          const defKey = res.default_video_model || res.models[0].key;
          const found = res.models.find((m: any) => m.key === defKey) || res.models[0];
          setSelectedModelKey(found.key);
          if (found.options?.aspect?.length) setSelectedAspect(found.options.aspect[0]);
          if (found.options?.duration?.length) setSelectedDuration(found.options.duration[0]);
        }
      })
      .catch((err) => {
        setErrorNote(err.message);
      });

    // Check reuse from sessionStorage
    const reuse = sessionStorage.getItem('snapgen_reuse');
    if (reuse) {
      try {
        const parsed = JSON.parse(reuse);
        if (parsed.prompt) setPrompt(parsed.prompt);
        if (parsed.model_key) setSelectedModelKey(parsed.model_key);
        if (parsed.options?.aspect) setSelectedAspect(parsed.options.aspect);
        if (parsed.options?.duration) setSelectedDuration(parsed.options.duration);
      } catch {}
      sessionStorage.removeItem('snapgen_reuse');
    }
  }, []);

  const loadTasksAndQuota = async () => {
    if (!user) return;
    try {
      const q = await api.tasks.getQuota(user.id);
      setQuota(q);
      const t = await api.tasks.list({ limit: 24 });
      setTasks(t.tasks || []);
      if (t.tasks && t.tasks.length > 0 && !activeTask) {
        setActiveTask(t.tasks[0]);
      }
    } catch {}
  };

  useEffect(() => {
    loadTasksAndQuota();
  }, [user]);

  // Update on real-time task events
  useEffect(() => {
    if (lastTaskUpdate) {
      setTasks((prev) => {
        const idx = prev.findIndex((t) => t.task_id === lastTaskUpdate.task_id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...lastTaskUpdate };
          return next;
        } else {
          return [lastTaskUpdate, ...prev].slice(0, 24);
        }
      });
      if (activeTask && activeTask.task_id === lastTaskUpdate.task_id) {
        setActiveTask((prev: any) => ({ ...prev, ...lastTaskUpdate }));
      }
    }
  }, [lastTaskUpdate]);

  const currentModel = models.find((m) => m.key === selectedModelKey) || models[0];

  const handleGenerate = async () => {
    if (!prompt.trim() || !user || !currentModel) return;
    setErrorNote(null);
    setLoading(true);

    try {
      const payload = {
        model_key: selectedModelKey,
        media_type: currentModel.type,
        options: {
          aspect: selectedAspect,
          ...(selectedDuration ? { duration: selectedDuration } : {}),
        },
        entries: [
          {
            prompt: prompt.trim(),
            count: 1,
            image_path: referenceImagePath || undefined,
          },
        ],
        image_mode: referenceImagePath ? 'per_entry' : 'none',
      };

      const res = await api.tasks.generate(user.id, payload);
      if (res.tasks && res.tasks.length > 0) {
        const newTask = res.tasks[0];
        setTasks((prev) => [newTask, ...prev].slice(0, 24));
        setActiveTask(newTask);
      }

      setSuccessNote(`Task masuk antrean · estimasi selesai ≈ ${fmtTime(new Date(Date.now() + (res.estimate?.total_sec || 180) * 1000))} WIB`);
      setTimeout(() => setSuccessNote(null), 9000);
      loadTasksAndQuota();
    } catch (err: any) {
      setErrorNote(err.message || 'Gagal memproses pengiriman.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleGenerate();
    }
  };

  const handleUploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await api.tasks.upload(file);
      setReferenceImagePath(res.path);
    } catch (err: any) {
      setErrorNote(err.message);
    }
  };

  return (
    <div className="flex-1 flex flex-col justify-between max-w-5xl mx-auto w-full pb-6">
      {/* Kicker Header */}
      <div className="flex items-center justify-between py-2 border-b border-white/[0.06] mb-4 text-xs font-mono">
        <span className="text-[#9cb080] font-semibold flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#9cb080] animate-pulse" />
          CANVAS LIVE PREVIEW · {user?.division_id?.toUpperCase() || 'KANTOR A'}
        </span>
        <span className="text-[#8f9286]">
          {activeTask ? `ID: #${activeTask.task_id.slice(-6)}` : 'SIAP'}
        </span>
      </div>

      {/* Canvas Card */}
      <div className="glass-panel relative rounded-2xl overflow-hidden border border-white/10 bg-[#041014] flex flex-col aspect-video max-h-[480px] w-full mx-auto shadow-2xl">
        {/* Top Floating Controls */}
        <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-20 pointer-events-none">
          <div className="flex items-center gap-2 pointer-events-auto">
            {activeTask && <StatusBadge status={activeTask.status} />}
            <span className="px-2.5 py-1 rounded-full bg-[#152126]/80 backdrop-blur-md border border-white/10 text-xs font-mono font-medium text-white">
              {currentModel?.label || 'Veo'}
            </span>
            <span className="px-2.5 py-1 rounded-full bg-[#152126]/80 backdrop-blur-md border border-white/10 text-xs font-mono text-[#8f9286]">
              {selectedAspect} · {selectedDuration ? `${selectedDuration}s` : 'IMG'} · 720p
            </span>
          </div>

          <div className="flex items-center gap-2 pointer-events-auto">
            <button
              onClick={() => {
                if (activeTask) setPrompt(activeTask.prompt);
              }}
              title="Ulangi Prompt"
              className="w-8 h-8 rounded-full bg-[#152126]/80 backdrop-blur-md border border-white/10 flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/10 transition"
            >
              <Icon name="replay" size={16} />
            </button>
            {activeTask?.result_url && (
              <a
                href={activeTask.result_url}
                download
                title="Unduh Hasil"
                className="w-8 h-8 rounded-full bg-[#152126]/80 backdrop-blur-md border border-white/10 flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/10 transition"
              >
                <Icon name="download" size={16} />
              </a>
            )}
          </div>
        </div>

        {/* Media Preview or State */}
        <div className="flex-1 flex items-center justify-center relative p-4">
          {activeTask?.status === 'completed' && activeTask.result_url ? (
            activeTask.media_type === 'video' ? (
              <video
                src={activeTask.result_url}
                controls
                autoPlay
                loop
                className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
              />
            ) : (
              <img
                src={activeTask.result_url}
                alt="Generated"
                className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
              />
            )
          ) : activeTask?.status === 'generating' || activeTask?.status === 'downloading' ? (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="relative w-16 h-16 flex items-center justify-center">
                <div className="w-16 h-16 rounded-full border-4 border-[#f59e0b]/20 border-t-[#f59e0b] animate-spin" />
                <span className="absolute font-mono text-xs font-bold text-[#ffd28a]">
                  {activeTask.provider_pct || 1}%
                </span>
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Sedang Memproses...</p>
                <p className="text-xs text-[#8f9286] mt-1 font-mono">
                  Sisa estimasi ≈ {fmtDuration(activeTask.est_seconds || 180)}
                </p>
              </div>
            </div>
          ) : activeTask?.status === 'queued' ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <Icon name="hourglass_empty" size={32} className="text-[#8f9286] animate-pulse" />
              <p className="text-sm font-semibold text-white">Menunggu Antrean Divisi</p>
              <p className="text-xs text-[#8f9286] font-mono">Mulai sebentar lagi…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-center text-[#8f9286]">
              <Icon name="movie_edit" size={40} className="opacity-40" />
              <p className="text-sm">Belum ada hasil — tulis prompt di bawah</p>
            </div>
          )}
        </div>

        {/* Bottom Banner Inside Canvas */}
        {activeTask && (
          <div className="h-10 px-4 bg-[#09151a]/90 backdrop-blur-md border-t border-white/[0.08] flex items-center justify-between text-xs font-mono">
            <span className="text-[#d8e5eb] truncate max-w-md">
              Prompt: {truncate(activeTask.prompt, 55)}
            </span>
            <span className="text-[#ffd28a] font-semibold">
              {activeTask.credit_used ? fmtCredits(activeTask.credit_used) : fmtCredits(activeTask.credit_cost)}
            </span>
          </div>
        )}
      </div>

      {/* Timeline Strip */}
      <div className="glass-card mt-4 p-3 rounded-xl flex items-center gap-3 overflow-x-auto">
        <span className="kicker text-[9px] shrink-0">TIMELINE</span>
        {/* Upload Reference Button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-12 h-12 rounded-lg border border-dashed border-white/20 flex flex-col items-center justify-center text-zinc-400 hover:text-white hover:border-[#9cb080] shrink-0 transition"
          title="Unggah Gambar Referensi"
        >
          <Icon name="add" size={18} />
          <span className="text-[8px] font-mono mt-0.5">Ref</span>
        </button>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleUploadImage}
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
        />

        {/* Task Thumbnails */}
        {tasks.map((t) => (
          <button
            key={t.task_id}
            onClick={() => setActiveTask(t)}
            className={`w-12 h-12 rounded-lg overflow-hidden shrink-0 border relative transition ${
              activeTask?.task_id === t.task_id
                ? 'border-[#9cb080] ring-2 ring-[#9cb080]/30'
                : 'border-white/10 hover:border-white/30'
            }`}
          >
            {t.result_url ? (
              t.media_type === 'video' ? (
                <video src={t.result_url} className="w-full h-full object-cover" />
              ) : (
                <img src={t.result_url} alt="" className="w-full h-full object-cover" />
              )
            ) : (
              <div className="w-full h-full bg-[#111d22] flex items-center justify-center text-[10px] font-mono text-[#8f9286]">
                {t.status === 'generating' ? `${t.provider_pct || 1}%` : '…'}
              </div>
            )}
            <div className="absolute bottom-0 right-0 px-1 bg-black/70 text-[8px] font-mono text-white">
              {t.options?.duration ? `${t.options.duration}s` : 'IMG'}
            </div>
          </button>
        ))}

        {/* Gallery shortcut */}
        <button
          onClick={() => navigate('/gallery')}
          className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white shrink-0 ml-auto"
          title="Buka Gallery"
        >
          <Icon name="history" size={18} />
        </button>
      </div>

      {/* Alerts */}
      {successNote && (
        <div className="note-info mt-4 flex items-center gap-2 text-xs">
          <Icon name="check_circle" size={16} className="text-[#10b981]" />
          <span>{successNote}</span>
        </div>
      )}
      {errorNote && (
        <div className="note-error mt-4 flex items-center gap-2 text-xs">
          <Icon name="error" size={16} />
          <span>{errorNote}</span>
        </div>
      )}

      {/* Prompt Dock (Bottom centered, max-w ±896px) */}
      <div className="glass-panel mt-4 p-4 rounded-2xl relative shadow-2xl">
        {/* Chips Bar */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {/* Model Selector Chip */}
          <div className="relative">
            <button
              onClick={() => setModelPopupOpen(!modelPopupOpen)}
              className="btn btn-ghost px-3 py-1.5 text-xs font-mono font-semibold rounded-full flex items-center gap-1.5 border-white/10 bg-[#111d22]"
            >
              <span>⚡</span>
              <span>{currentModel?.label || 'Veo'} · {currentModel?.credits || 7} KR</span>
              <Icon name="arrow_drop_down" size={16} />
            </button>

            {modelPopupOpen && (
              <div
                className="absolute left-0 bottom-full mb-2 w-72 glass-panel p-2 z-50 shadow-2xl rounded-xl"
                onMouseLeave={() => setModelPopupOpen(false)}
              >
                <div className="kicker px-2 py-1">MODEL DIIZINKAN DIVISI</div>
                <div className="space-y-1 mt-1">
                  {models.map((m) => (
                    <button
                      key={m.key}
                      onClick={() => {
                        setSelectedModelKey(m.key);
                        if (m.options?.aspect?.length) setSelectedAspect(m.options.aspect[0]);
                        if (m.options?.duration?.length) setSelectedDuration(m.options.duration[0]);
                        setModelPopupOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between text-xs transition ${
                        selectedModelKey === m.key
                          ? 'bg-[#2b373c] text-white border border-[#9cb080]/40'
                          : 'hover:bg-white/5 text-[#d8e5eb]'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon name={m.type === 'video' ? 'movie' : 'image'} size={16} />
                        <span className="font-semibold">{m.label}</span>
                      </div>
                      <span className="font-mono text-[#ffd28a]">
                        {m.credits} KR · ≈ {fmtDuration(m.est_seconds)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Aspect Ratio Chip */}
          <div className="relative">
            <button
              onClick={() => setRatioDropdownOpen(!ratioDropdownOpen)}
              className="btn btn-ghost px-3 py-1.5 text-xs font-mono rounded-full flex items-center gap-1.5 border-white/10 bg-[#111d22]"
            >
              <Icon name="aspect_ratio" size={14} />
              <span>{selectedAspect}</span>
              <Icon name="arrow_drop_down" size={16} />
            </button>
            {ratioDropdownOpen && (
              <div
                className="absolute left-0 bottom-full mb-2 w-32 glass-panel p-1.5 z-50 rounded-xl"
                onMouseLeave={() => setRatioDropdownOpen(false)}
              >
                {(currentModel?.options?.aspect || ['9:16', '16:9', '1:1']).map((asp: string) => (
                  <button
                    key={asp}
                    onClick={() => {
                      setSelectedAspect(asp);
                      setRatioDropdownOpen(false);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-mono ${
                      selectedAspect === asp ? 'bg-white/15 text-white' : 'hover:bg-white/5'
                    }`}
                  >
                    {asp}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Duration Chip (Videos only) */}
          {currentModel?.type === 'video' && (
            <div className="relative">
              <button
                onClick={() => setDurationDropdownOpen(!durationDropdownOpen)}
                className="btn btn-ghost px-3 py-1.5 text-xs font-mono rounded-full flex items-center gap-1.5 border-white/10 bg-[#111d22]"
              >
                <Icon name="schedule" size={14} />
                <span>{selectedDuration}s</span>
                <Icon name="arrow_drop_down" size={16} />
              </button>
              {durationDropdownOpen && (
                <div
                  className="absolute left-0 bottom-full mb-2 w-28 glass-panel p-1.5 z-50 rounded-xl"
                  onMouseLeave={() => setDurationDropdownOpen(false)}
                >
                  {(currentModel?.options?.duration || [5, 8, 10]).map((dur: number) => (
                    <button
                      key={dur}
                      onClick={() => {
                        setSelectedDuration(dur);
                        setDurationDropdownOpen(false);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-mono ${
                        selectedDuration === dur ? 'bg-white/15 text-white' : 'hover:bg-white/5'
                      }`}
                    >
                      {dur} Detik
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Reference Asset Chip */}
          {referenceImagePath && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#202c31] border border-[#9cb080]/30 text-xs text-[#9cb080]">
              <Icon name="image" size={14} />
              <span className="font-mono">Ref Terpasang</span>
              <button
                onClick={() => {
                  setReferenceImagePath(null);
                }}
                className="text-zinc-400 hover:text-white"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          )}

          {/* Perkaya Prompt (Optional LLM) */}
          <button
            onClick={() => {
              if (prompt) setPrompt((prev) => `${prev}, highly detailed cinematic 4k lighting, photorealistic octane render`);
            }}
            className="ml-auto text-xs font-semibold text-[#b9ce9b] hover:text-white flex items-center gap-1 transition"
          >
            <span>✦</span>
            <span>Perkaya Prompt</span>
          </button>
        </div>

        {/* Textarea + Generate CTA */}
        <div className="relative">
          <textarea
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Deskripsikan scene video yang ingin kamu buat… (e.g. Krim pelembab herbal wajah di atas batu pantai saat sunrise)"
            className="w-full glass-input text-sm resize-none pb-12"
          />

          <div className="absolute right-3 bottom-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={loading || !prompt.trim()}
              className="btn btn-indigo py-2 px-4 rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 flex items-center gap-1.5"
            >
              {loading ? (
                <Icon name="sync" size={16} className="animate-fs-spin" />
              ) : (
                <span>⚡</span>
              )}
              <span>Generate ↵</span>
            </button>
          </div>
        </div>

        {/* Hint bar */}
        <div className="flex items-center justify-between mt-2 text-[11px] text-[#8f9286] font-mono px-1">
          <span>Tekan Ctrl + Enter untuk sintesis instan</span>
          <span>
            Biaya {currentModel?.credits || 7} KR · estimasi ≈ {fmtDuration(currentModel?.est_seconds)} · kuota sisa {quota?.remaining ?? 50}
          </span>
        </div>
      </div>
    </div>
  );
};
