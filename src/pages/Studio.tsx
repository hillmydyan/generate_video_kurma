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
  const [selectedDuration, setSelectedDuration] = useState<number | null>(4);
  const [prompt, setPrompt] = useState('');
  const [referenceImagePath, setReferenceImagePath] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);

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
      const fetched = t.tasks || [];
      setTasks(fetched);
      if (fetched.length > 0) {
        setActiveTask((prev: any) => {
          if (!prev) return fetched[0];
          const updated = fetched.find((item: any) => item.task_id === prev.task_id);
          return updated ? { ...prev, ...updated } : prev;
        });
      }
    } catch {}
  };

  useEffect(() => {
    loadTasksAndQuota();
  }, [user]);

  // Fallback polling every 4s while any task is active (queued / generating / downloading)
  useEffect(() => {
    if (!user) return;
    const hasPending =
      tasks.some((t) => ['queued', 'generating', 'downloading'].includes(t.status)) ||
      (activeTask && ['queued', 'generating', 'downloading'].includes(activeTask.status));

    if (!hasPending) return;

    const timer = setInterval(() => {
      loadTasksAndQuota();
    }, 4000);

    return () => clearInterval(timer);
  }, [tasks, activeTask, user]);

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

  const handleVoiceDictation = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setErrorNote('Browser belum mendukung dikte suara Web Speech API.');
      return;
    }
    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'id-ID';
      recognition.interimResults = false;
      recognition.onstart = () => setIsListening(true);
      recognition.onend = () => setIsListening(false);
      recognition.onerror = () => setIsListening(false);
      recognition.onresult = (event: any) => {
        const transcript = event.results[0]?.[0]?.transcript;
        if (transcript) {
          setPrompt((prev) => (prev.trim() ? `${prev.trim()} ${transcript}` : transcript));
        }
      };
      recognition.start();
    } catch (err: any) {
      setIsListening(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full pb-3">
      {/* Kicker Header */}
      <div className="flex items-center justify-between py-1 border-b border-white/[0.06] mb-2 text-xs font-mono">
        <span className="text-[#9cb080] font-semibold flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#9cb080] animate-pulse" />
          CANVAS LIVE PREVIEW · {user?.division_id?.toUpperCase() || 'KANTOR A'}
        </span>
        <span className="text-[#8f9286]">
          {activeTask ? `ID: #${activeTask.task_id.slice(-6)}` : 'SIAP'}
        </span>
      </div>

      {/* Canvas Card (Compact Responsive Height) */}
      <div className="glass-panel relative rounded-2xl overflow-hidden border border-white/10 bg-[#041014] flex flex-col h-[200px] sm:h-[230px] md:h-[255px] w-full shadow-2xl">
        {/* Top Floating Controls */}
        <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between z-20 pointer-events-none">
          <div className="flex items-center gap-1.5 pointer-events-auto">
            {activeTask && <StatusBadge status={activeTask.status} />}
            <span className="px-2 py-0.5 rounded-full bg-[#152126]/80 backdrop-blur-md border border-white/10 text-[11px] font-mono font-medium text-white">
              {currentModel?.label || 'Veo'}
            </span>
            <span className="px-2 py-0.5 rounded-full bg-[#152126]/80 backdrop-blur-md border border-white/10 text-[11px] font-mono text-[#8f9286]">
              {selectedAspect} · {selectedDuration ? `${selectedDuration}s` : 'IMG'} · 720p
            </span>
          </div>

          <div className="flex items-center gap-1.5 pointer-events-auto">
            <button
              onClick={() => {
                if (activeTask) setPrompt(activeTask.prompt);
              }}
              title="Ulangi Prompt"
              className="w-7 h-7 rounded-full bg-[#152126]/80 backdrop-blur-md border border-white/10 flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/10 transition"
            >
              <Icon name="replay" size={14} />
            </button>
            {activeTask?.result_url && (
              <a
                href={activeTask.result_url}
                download
                title="Unduh Hasil"
                className="w-7 h-7 rounded-full bg-[#152126]/80 backdrop-blur-md border border-white/10 flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/10 transition"
              >
                <Icon name="download" size={14} />
              </a>
            )}
          </div>
        </div>

        {/* Media Preview or State */}
        <div className="flex-1 flex items-center justify-center relative p-3">
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
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="relative w-10 h-10 flex items-center justify-center">
                <div className="w-10 h-10 rounded-full border-2 border-[#f59e0b]/20 border-t-[#f59e0b] animate-spin" />
                <span className="absolute font-mono text-[10px] font-bold text-[#ffd28a]">
                  {activeTask.provider_pct || 1}%
                </span>
              </div>
              <div>
                <p className="text-xs font-semibold text-white">Sedang Memproses...</p>
                <p className="text-[10px] text-[#8f9286] mt-0.5 font-mono">
                  Sisa estimasi ≈ {fmtDuration(activeTask.est_seconds || 180)}
                </p>
              </div>
            </div>
          ) : activeTask?.status === 'queued' ? (
            <div className="flex flex-col items-center gap-1.5 text-center">
              <Icon name="hourglass_empty" size={24} className="text-[#8f9286] animate-pulse" />
              <p className="text-xs font-semibold text-white">Menunggu Antrean Divisi</p>
              <p className="text-[10px] text-[#8f9286] font-mono">Mulai sebentar lagi…</p>
            </div>
          ) : activeTask?.status === 'failed' ? (
            <div className="flex flex-col items-center gap-2 text-center p-4 max-w-md">
              <div className="w-10 h-10 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
                <Icon name="error" size={22} />
              </div>
              <div>
                <p className="text-xs font-semibold text-rose-400">Generasi Gagal</p>
                <p className="text-[11px] text-[#8f9286] mt-1 leading-relaxed">
                  {activeTask.error || 'Server provider tidak merespons atau sedang dalam perbaikan.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPrompt(activeTask.prompt)}
                className="btn btn-ghost px-2.5 py-1 text-[11px] rounded-lg border border-white/10 hover:bg-white/10 flex items-center gap-1.5 text-zinc-300 transition"
              >
                <Icon name="replay" size={13} />
                <span>Salin Prompt Kembali</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5 text-center text-[#8f9286]">
              <Icon name="movie_edit" size={28} className="opacity-40" />
              <p className="text-xs">Belum ada hasil — tulis prompt di bawah</p>
            </div>
          )}
        </div>

        {/* Bottom Banner Inside Canvas */}
        {activeTask && (
          <div className="h-7 px-3 bg-[#09151a]/90 backdrop-blur-md border-t border-white/[0.08] flex items-center justify-between text-[10px] font-mono">
            <span className="text-[#d8e5eb] truncate max-w-md">
              Prompt: {truncate(activeTask.prompt, 55)}
            </span>
            <span className="text-[#ffd28a] font-semibold">
              {activeTask.credit_used ? fmtCredits(activeTask.credit_used) : fmtCredits(activeTask.credit_cost)}
            </span>
          </div>
        )}
      </div>

      {/* Timeline Strip (Compact) */}
      <div className="glass-card mt-2 p-1.5 rounded-xl flex items-center gap-1.5 overflow-x-auto">
        <span className="kicker text-[8px] shrink-0">TIMELINE</span>
        {/* Upload Reference Button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-8 h-8 rounded-lg border border-dashed border-white/20 flex flex-col items-center justify-center text-zinc-400 hover:text-white hover:border-[#9cb080] shrink-0 transition"
          title="Unggah Gambar Referensi"
        >
          <Icon name="add" size={14} />
          <span className="text-[7px] font-mono">Ref</span>
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
            className={`w-8 h-8 rounded-lg overflow-hidden shrink-0 border relative transition ${
              activeTask?.task_id === t.task_id
                ? 'border-[#9cb080] ring-1.5 ring-[#9cb080]/30'
                : 'border-white/10 hover:border-white/30'
            }`}
          >
            {t.result_url ? (
              t.media_type === 'video' ? (
                <video src={t.result_url} className="w-full h-full object-cover" />
              ) : (
                <img src={t.result_url} alt="" className="w-full h-full object-cover" />
              )
            ) : t.status === 'failed' ? (
              <div className="w-full h-full bg-rose-950/40 flex items-center justify-center text-rose-400">
                <Icon name="error" size={14} />
              </div>
            ) : (
              <div className="w-full h-full bg-[#111d22] flex items-center justify-center text-[8px] font-mono text-[#8f9286]">
                {t.status === 'generating' ? `${t.provider_pct || 1}%` : '…'}
              </div>
            )}
            <div className="absolute bottom-0 right-0 px-1 bg-black/70 text-[7px] font-mono text-white">
              {t.options?.duration ? `${t.options.duration}s` : 'IMG'}
            </div>
          </button>
        ))}

        {/* Gallery shortcut */}
        <button
          onClick={() => navigate('/gallery')}
          className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white shrink-0 ml-auto"
          title="Buka Gallery"
        >
          <Icon name="history" size={15} />
        </button>
      </div>

      {/* Alerts */}
      {successNote && (
        <div className="note-info mt-1.5 flex items-center gap-2 text-xs py-1">
          <Icon name="check_circle" size={14} className="text-[#10b981]" />
          <span>{successNote}</span>
        </div>
      )}
      {errorNote && (
        <div className="note-error mt-1.5 flex items-center gap-2 text-xs py-1">
          <Icon name="error" size={14} />
          <span>{errorNote}</span>
        </div>
      )}

      {/* Floating Prompt Dock (ChatGPT & Gemini AI Floating Style) */}
      <div className="relative w-full max-w-[680px] mx-auto mt-2 transition-all duration-300">
        <div className="bg-[#0c1419]/95 backdrop-blur-2xl border border-white/[0.12] rounded-2xl p-2 sm:p-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.8)] focus-within:border-[#9cb080]/60 focus-within:ring-2 focus-within:ring-[#9cb080]/20 transition-all duration-200">
          {/* Top Chips Row */}
          <div className="flex flex-wrap items-center gap-1.5 mb-1 px-1">
            {/* Model Selector Chip */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setModelPopupOpen(!modelPopupOpen)}
                className="btn btn-ghost px-2 py-0.5 text-[11px] font-mono font-semibold rounded-full flex items-center gap-1 border-white/10 bg-[#152126]/80 hover:bg-[#202c31]"
              >
                <Icon name="bolt" size={12} className="text-[#ffd28a]" />
                <span>{currentModel?.label || 'Veo'} · {currentModel?.credits || 7} KR</span>
                <Icon name="arrow_drop_down" size={14} />
              </button>

              {modelPopupOpen && (
                <div
                  className="absolute left-0 bottom-full mb-2 w-64 glass-panel p-2 z-50 shadow-2xl rounded-xl border border-white/15"
                  onMouseLeave={() => setModelPopupOpen(false)}
                >
                  <div className="kicker px-2 py-1 text-[9px]">MODEL DIIZINKAN DIVISI</div>
                  <div className="space-y-1 mt-1 max-h-52 overflow-y-auto">
                    {models.map((m) => (
                      <button
                        key={m.key}
                        onClick={() => {
                          setSelectedModelKey(m.key);
                          if (m.options?.aspect?.length) setSelectedAspect(m.options.aspect[0]);
                          if (m.options?.duration?.length) setSelectedDuration(m.options.duration[0]);
                          setModelPopupOpen(false);
                        }}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between text-[11px] transition ${
                          selectedModelKey === m.key
                            ? 'bg-[#2b373c] text-white border border-[#9cb080]/40'
                            : 'hover:bg-white/5 text-[#d8e5eb]'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Icon name={m.type === 'video' ? 'movie' : 'image'} size={14} />
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
                type="button"
                onClick={() => setRatioDropdownOpen(!ratioDropdownOpen)}
                className="btn btn-ghost px-2 py-0.5 text-[11px] font-mono rounded-full flex items-center gap-1 border-white/10 bg-[#152126]/80 hover:bg-[#202c31]"
              >
                <Icon name="aspect_ratio" size={12} />
                <span>{selectedAspect}</span>
                <Icon name="arrow_drop_down" size={14} />
              </button>
              {ratioDropdownOpen && (
                <div
                  className="absolute left-0 bottom-full mb-2 w-28 glass-panel p-1.5 z-50 rounded-xl border border-white/15"
                  onMouseLeave={() => setRatioDropdownOpen(false)}
                >
                  {(currentModel?.options?.aspect || ['9:16', '16:9', '1:1']).map((asp: string) => (
                    <button
                      key={asp}
                      onClick={() => {
                        setSelectedAspect(asp);
                        setRatioDropdownOpen(false);
                      }}
                      className={`w-full text-left px-2 py-1 rounded text-xs font-mono ${
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
                  type="button"
                  onClick={() => setDurationDropdownOpen(!durationDropdownOpen)}
                  className="btn btn-ghost px-2 py-0.5 text-[11px] font-mono rounded-full flex items-center gap-1 border-white/10 bg-[#152126]/80 hover:bg-[#202c31]"
                >
                  <Icon name="schedule" size={12} />
                  <span>{selectedDuration}s</span>
                  <Icon name="arrow_drop_down" size={14} />
                </button>
                {durationDropdownOpen && (
                  <div
                    className="absolute left-0 bottom-full mb-2 w-28 glass-panel p-1.5 z-50 rounded-xl border border-white/15"
                    onMouseLeave={() => setDurationDropdownOpen(false)}
                  >
                    {(currentModel?.options?.duration || [4, 6, 8]).map((dur: number) => (
                      <button
                        key={dur}
                        onClick={() => {
                          setSelectedDuration(dur);
                          setDurationDropdownOpen(false);
                        }}
                        className={`w-full text-left px-2 py-1 rounded text-xs font-mono ${
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
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#202c31] border border-[#9cb080]/30 text-[10px] text-[#9cb080]">
                <Icon name="image" size={12} />
                <span className="font-mono">Ref</span>
                <button
                  type="button"
                  onClick={() => setReferenceImagePath(null)}
                  className="text-zinc-400 hover:text-white"
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            )}

            {/* Perkaya Prompt (LLM) */}
            <button
              type="button"
              onClick={() => {
                if (prompt.trim()) {
                  setPrompt((prev) => `${prev.trim()}, highly detailed cinematic lighting, 8k octane render, dramatic atmosphere`);
                }
              }}
              className="ml-auto text-[11px] font-semibold text-[#b9ce9b] hover:text-white flex items-center gap-1 transition py-0.5 px-2 rounded-full hover:bg-white/5"
            >
              <Icon name="sparkles" size={12} className="text-amber-300" />
              <span>Perkaya Prompt</span>
            </button>
          </div>

          {/* Borderless Textarea (ChatGPT / Gemini Style) */}
          <div className="relative px-1">
            <textarea
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Deskripsikan scene video yang ingin kamu buat… (e.g. Krim pelembab herbal wajah di atas batu pantai saat sunrise)"
              className="w-full bg-transparent border-0 outline-none text-xs sm:text-[13px] text-[#d8e5eb] placeholder-[#8f9286]/60 resize-none px-1.5 py-0.5 leading-relaxed min-h-[36px] max-h-24 focus:ring-0"
            />
          </div>

          {/* Bottom Action Bar inside the Island */}
          <div className="flex items-center justify-between pt-1 px-1 border-t border-white/[0.06]">
            {/* Left Tools & Validation Status */}
            <div className="flex items-center gap-2">
              {/* Mic Dictation Button */}
              <button
                type="button"
                onClick={handleVoiceDictation}
                title="Dikte Suara (Web Speech API)"
                className={`w-6 h-6 rounded-full flex items-center justify-center transition ${
                  isListening
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 animate-pulse'
                    : 'text-zinc-400 hover:text-white hover:bg-white/10'
                }`}
              >
                <Icon name={isListening ? 'mic' : 'mic_none'} size={14} />
              </button>

              {/* Add Reference Image */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Pasang Gambar Referensi"
                className="w-6 h-6 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 flex items-center justify-center transition"
              >
                <Icon name="attach_file" size={14} />
              </button>

              {/* Realtime Validation Indicator */}
              <div className="text-[10px] font-mono flex items-center gap-1">
                {prompt.trim().length === 0 ? (
                  <span className="text-[#8f9286]/70 hidden sm:inline">Siap mengetik</span>
                ) : prompt.trim().length < 5 ? (
                  <span className="text-[#ffd28a] flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b]" />
                    <span>Min 5 karakter</span>
                  </span>
                ) : (
                  <span className="text-[#10b981] flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
                    <span>Valid</span>
                  </span>
                )}
              </div>
            </div>

            {/* Right Action: Cost Preview & Floating Generate Button */}
            <div className="flex items-center gap-2.5">
              <span className="text-[10px] font-mono text-[#8f9286] hidden sm:inline">
                {currentModel?.credits || 7} KR · ≈ {fmtDuration(currentModel?.est_seconds)}
              </span>

              <button
                type="button"
                onClick={handleGenerate}
                disabled={loading || prompt.trim().length < 5}
                title="Generate (Ctrl + Enter)"
                className="btn btn-indigo h-7.5 px-3 rounded-full text-xs font-bold shadow-md shadow-indigo-600/30 flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed transition transform active:scale-95"
              >
                {loading ? (
                  <Icon name="sync" size={13} className="animate-fs-spin" />
                ) : (
                  <Icon name="arrow_upward" size={13} />
                )}
                <span>Generate</span>
              </button>
            </div>
          </div>
        </div>

        {/* Small Discreet Caption underneath */}
        <div className="text-center mt-1 text-[9px] text-[#8f9286]/60 font-mono">
          Ctrl + Enter untuk generate · Kuota sisa: {quota?.remaining ?? 50}
        </div>
      </div>
    </div>
  );
};
