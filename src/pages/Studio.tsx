import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { useNotify } from '@/components/ui/NotificationProvider';
import { useEventsCtx } from '@/lib/useEvents';
import { fmtDuration, fmtTime } from '@/lib/format';
import { api } from '@/lib/api';

function humanizeError(raw?: string): string {
  if (!raw) {
    return 'Permintaan pembuatan video belum dapat diselesaikan oleh server penyedia. Silakan coba kembali.';
  }
  const lower = raw.toLowerCase();
  if (lower.includes('timeout') || lower.includes('aborted')) {
    return 'Waktu koneksi ke server habis. Silakan periksa jaringan lalu coba lagi.';
  }
  if (lower.includes('maintenance') || lower.includes('503')) {
    return 'Server penyedia video sedang dalam pemeliharaan sementara. Silakan coba beberapa saat lagi.';
  }
  if (lower.includes('quota') || lower.includes('kuota')) {
    return 'Kuota pembuatan video Anda sudah mencapai batas.';
  }
  if (lower.includes('credit') || lower.includes('kredit') || lower.includes('balance')) {
    return 'Saldo kredit kantor tidak mencukupi untuk menjalankan model ini.';
  }
  if (lower.includes('db_writer') || lower.includes('statementerror') || lower.includes('traceback')) {
    return 'Terjadi gangguan sinkronisasi internal saat menyimpan hasil video. Silakan coba lagi.';
  }
  return raw;
}

function formatOfficeName(divisionId?: string): string {
  if (!divisionId) return 'Kantor A';
  return divisionId
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export const Studio: React.FC = () => {
  const [searchParams] = useSearchParams();
  const demoState = searchParams.get('demo_state'); // 'empty' | 'processing' | 'completed' | 'failed' | null

  const { connState, lastTaskUpdate } = useEventsCtx();
  const { success, error, info, warning } = useNotify();

  const [models, setModels] = useState<any[]>([]);
  const [selectedModelKey, setSelectedModelKey] = useState<string>('veo');
  const [selectedAspect, setSelectedAspect] = useState<string>('9:16');
  const [selectedDuration, setSelectedDuration] = useState<number | null>(4);
  const [selectedResolution, setSelectedResolution] = useState<string>('1080p');
  const [prompt, setPrompt] = useState('');
  const [referenceImagePath, setReferenceImagePath] = useState<string | null>(null);
  const [referenceImageName, setReferenceImageName] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);

  const [tasks, setTasks] = useState<any[]>([]);
  const [activeTask, setActiveTask] = useState<any | null>(null);
  const [quota, setQuota] = useState<any>(null);
  const [divisionCredits, setDivisionCredits] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<any>(null);

  const [modelPopupOpen, setModelPopupOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync user from localStorage
  useEffect(() => {
    const raw = localStorage.getItem('snapgen_user');
    if (raw) {
      try {
        setUser(JSON.parse(raw));
      } catch {}
    }
  }, []);

  // Harmonize navbar connection label ("Terhubung" / "Menyambung…" / "Terputus") & credit skeleton
  // without modifying files outside Studio.tsx
  useEffect(() => {
    const header = document.querySelector('header');
    if (!header) return;
    const spans = header.querySelectorAll('span');
    spans.forEach((sp) => {
      const txt = sp.textContent?.trim();
      if (txt === 'Online' || txt === 'Terhubung' || txt === 'Offline' || txt === 'Terputus' || txt === 'Menyambung…') {
        sp.textContent =
          connState === 'online'
            ? 'Terhubung'
            : connState === 'connecting'
            ? 'Menyambung…'
            : 'Terputus';
      }
      if (txt === '… KR') {
        sp.innerHTML =
          '<span class="inline-block w-14 h-3.5 rounded bg-white/15 animate-pulse align-middle" aria-label="Memuat saldo kredit"></span>';
      }
    });
  }, [connState, divisionCredits]);

  // Auto-grow textarea (minimum 5 rows)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(128, el.scrollHeight)}px`;
  }, [prompt]);

  // Fetch models & check reuse
  useEffect(() => {
    api.models
      .list()
      .then((res) => {
        const list = res.models || [];
        setModels(list);
        if (list.length > 0) {
          const defKey = res.default_video_model || list[0].key;
          const found = list.find((m: any) => m.key === defKey) || list[0];
          setSelectedModelKey(found.key);
          if (found.options?.aspect?.length) setSelectedAspect(found.options.aspect[0]);
          if (found.options?.duration?.length) setSelectedDuration(found.options.duration[0]);
          setSelectedResolution(found.provider_params?.resolution || '1080p');
        }
      })
      .catch((err) => {
        error('Gagal Memuat Model', err.message);
      });

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
      const [qRes, tRes, cRes] = await Promise.allSettled([
        api.tasks.getQuota(user.id),
        api.tasks.list({ limit: 24 }),
        api.admin.getCredits(0),
      ]);

      if (qRes.status === 'fulfilled') {
        setQuota(qRes.value);
      }
      if (cRes.status === 'fulfilled' && cRes.value?.accounts) {
        const userDiv = user?.division_id || 'kantor_a';
        const divAccs = cRes.value.accounts.filter((a: any) => a.division_id === userDiv);
        const total = divAccs.reduce((sum: number, a: any) => sum + (a.credits || 0), 0);
        setDivisionCredits(total);
      }
      if (tRes.status === 'fulfilled') {
        const fetched = tRes.value.tasks || [];
        setTasks(fetched);
        if (fetched.length > 0) {
          setActiveTask((prev: any) => {
            if (!prev) return fetched[0];
            const updated = fetched.find((item: any) => item.task_id === prev.task_id);
            return updated ? { ...prev, ...updated } : prev;
          });
        }
      }
    } catch {}
  };

  useEffect(() => {
    loadTasksAndQuota();
  }, [user]);

  // Fallback polling every 4s while any task is active
  useEffect(() => {
    if (!user || demoState) return;
    const hasPending =
      tasks.some((t) => ['queued', 'generating', 'downloading'].includes(t.status)) ||
      (activeTask && ['queued', 'generating', 'downloading'].includes(activeTask.status));

    if (!hasPending) return;

    const timer = setInterval(() => {
      loadTasksAndQuota();
    }, 4000);

    return () => clearInterval(timer);
  }, [tasks, activeTask, user, demoState]);

  // Update on real-time SSE task events
  useEffect(() => {
    if (lastTaskUpdate && !demoState) {
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
  }, [lastTaskUpdate, demoState]);

  const currentModel = models.find((m) => m.key === selectedModelKey) || models[0];
  const isModelLocked = models.length === 1;
  const costCredits = currentModel?.credits ?? 4;
  const remainingQuota = quota?.remaining ?? 35;

  // Resolve effective task & history for display (supports ?demo_state= for visual verification)
  const effectiveTask = React.useMemo(() => {
    if (demoState === 'empty') return null;
    if (demoState === 'processing') {
      return {
        task_id: 'task_demo_proc01',
        status: 'generating',
        prompt:
          prompt ||
          'Close-up botol serum kaca emerald di atas batu sungai berlumut, cahaya matahari pagi menembus kabut hutan tropis',
        model_key: selectedModelKey,
        media_type: 'video',
        provider_pct: 48,
        est_seconds: 120,
        options: { aspect: selectedAspect, duration: selectedDuration || 4 },
      };
    }
    if (demoState === 'completed') {
      const realCompleted = tasks.find((t) => t.status === 'completed' && t.result_url);
      return (
        realCompleted || {
          task_id: 'task_demo_done01',
          status: 'completed',
          prompt:
            'Krim pelembab herbal wajah di atas batu pantai saat matahari terbit dengan pencahayaan sinematik',
          model_key: selectedModelKey,
          media_type: 'video',
          result_url: '/videos/task_7beebbf3171b.mp4',
          options: { aspect: selectedAspect, duration: selectedDuration || 4 },
        }
      );
    }
    if (demoState === 'failed') {
      return {
        task_id: 'task_demo_fail01',
        status: 'failed',
        prompt:
          prompt ||
          'Parfum mewah di atas meja marmer hitam dengan pantulan cahaya emas dramatis',
        model_key: selectedModelKey,
        media_type: 'video',
        error: 'Waktu tunggu ke server penyedia habis karena antrean sedang padat.',
        options: { aspect: selectedAspect, duration: selectedDuration || 4 },
      };
    }
    return activeTask;
  }, [demoState, activeTask, tasks, prompt, selectedModelKey, selectedAspect, selectedDuration]);

  const sessionHistory = React.useMemo(() => {
    if (demoState === 'empty') return [];
    return tasks;
  }, [demoState, tasks]);

  const isProcessing =
    loading ||
    Boolean(
      effectiveTask &&
        ['queued', 'generating', 'downloading'].includes(effectiveTask.status)
    );

  // Determine Generate button disabled state & tooltip reason
  const isPromptEmpty = prompt.trim().length === 0;
  const isPromptTooShort = prompt.trim().length > 0 && prompt.trim().length < 5;
  const isQuotaDepleted = remainingQuota <= 0;
  const isCreditsInsufficient =
    divisionCredits !== null && costCredits > 0 && divisionCredits < costCredits;

  const isGenerateDisabled =
    isProcessing ||
    isPromptEmpty ||
    isPromptTooShort ||
    isQuotaDepleted ||
    isCreditsInsufficient;

  const generateTooltip = isProcessing
    ? 'Sedang memproses video saat ini'
    : isPromptEmpty
    ? 'Tulis deskripsi prompt terlebih dahulu sebelum membuat video'
    : isPromptTooShort
    ? 'Prompt minimal terdiri dari 5 karakter'
    : isQuotaDepleted
    ? 'Sisa kuota pembuatan video Anda sudah habis'
    : isCreditsInsufficient
    ? `Saldo kredit tidak mencukupi (butuh ${costCredits} KR)`
    : 'Buat video sekarang (Ctrl + Enter)';

  const handleGenerate = async () => {
    if (isGenerateDisabled || !user || !currentModel) return;
    setLoading(true);

    try {
      const payload = {
        model_key: selectedModelKey,
        media_type: currentModel.type,
        options: {
          aspect: selectedAspect,
          resolution: selectedResolution,
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

      const estFinish = fmtTime(new Date(Date.now() + (res.estimate?.total_sec || 120) * 1000));
      success(
        'Tugas Masuk Antrean Render',
        `${currentModel.label} · Estimasi selesai sekitar pukul ${estFinish} WIB`
      );
      loadTasksAndQuota();
      setTimeout(() => window.dispatchEvent(new Event('snapgen_credits_refresh')), 2500);
    } catch (err: any) {
      error('Gagal Mengirim Tugas', humanizeError(err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleCancelTask = async () => {
    if (!effectiveTask) return;
    if (demoState) {
      info(' Tugas Dibatalkan', 'Pembuatan video telah dihentikan.');
      return;
    }
    try {
      await api.tasks.delete(effectiveTask.task_id);
      setTasks((prev) => prev.filter((t) => t.task_id !== effectiveTask.task_id));
      const remaining = tasks.filter((t) => t.task_id !== effectiveTask.task_id);
      setActiveTask(remaining[0] || null);
      info('Tugas Dibatalkan', 'Pembuatan video dibatalkan dan kuota dikembalikan.');
      loadTasksAndQuota();
    } catch (err: any) {
      setActiveTask(null);
      info('Dibatalkan dari Pratinjau', 'Status pratinjau telah direset.');
    }
  };

  const handleRetryTask = () => {
    if (!effectiveTask) return;
    if (effectiveTask.prompt) {
      setPrompt(effectiveTask.prompt);
    }
    textareaRef.current?.focus();
    info('Siap Mencoba Lagi', 'Prompt telah dimuat kembali ke kolom kontrol.');
  };

  const handleUseAsReference = () => {
    if (!effectiveTask?.result_url) return;
    setReferenceImagePath(effectiveTask.result_url);
    setReferenceImageName(`Hasil #${effectiveTask.task_id.slice(-6)}`);
    info('Dipasang Sebagai Referensi', 'Hasil ini telah ditambahkan ke slot referensi.');
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
      setReferenceImageName(res.filename || file.name);
      info('Gambar Referensi Terpasang', `File ${res.filename || file.name} siap digunakan.`);
    } catch (err: any) {
      error('Gagal Mengunggah Gambar', humanizeError(err.message));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleVoiceDictation = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      warning('Dikte Suara Tidak Didukung', 'Browser Anda belum mendukung Web Speech API.');
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
    } catch {
      setIsListening(false);
    }
  };

  // Status text for the single header line above the preview frame
  const statusLabel = !effectiveTask
    ? 'Menunggu prompt'
    : effectiveTask.status === 'completed'
    ? 'Selesai dibuat'
    : effectiveTask.status === 'failed'
    ? 'Gagal membuat video'
    : effectiveTask.status === 'queued'
    ? 'Dalam antrean kantor…'
    : `Sedang membuat video (${effectiveTask.provider_pct || 15}%)…`;

  const statusDotColor = !effectiveTask
    ? 'bg-slate-400'
    : effectiveTask.status === 'completed'
    ? 'bg-[#10b981]'
    : effectiveTask.status === 'failed'
    ? 'bg-[#fb7185]'
    : 'bg-[#f59e0b] animate-pulse';

  const previewAspect = effectiveTask?.options?.aspect || selectedAspect || '9:16';

  const referencePreviewUrl = referenceImagePath
    ? referenceImagePath.startsWith('http') || referenceImagePath.startsWith('/')
      ? referenceImagePath
      : `/${referenceImagePath}`
    : null;

  return (
    <div className="flex-1 w-full max-w-[1280px] mx-auto">
      {/* Hidden File Input for Reference Upload */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleUploadImage}
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        aria-label="Unggah file gambar referensi"
      />

      {/* Main 2-Column Layout on Desktop (>=1024px), 1-Column on Mobile/Tablet (<1024px) */}
      {/* DOM Order: Control Panel first for keyboard Tab order (prompt -> referensi -> pengaturan -> Generate),
          flex-col-reverse on <1024px puts Preview visually on top and Control Panel below */}
      <div className="flex flex-col-reverse lg:flex-row items-stretch lg:items-start gap-6 pb-4">
        {/* ============================================================
            KOLOM KIRI: PANEL KONTROL (±420px tetap di desktop)
           ============================================================ */}
        <section
          aria-label="Panel Kontrol Pembuatan Video"
          className="w-full lg:w-[420px] shrink-0 rounded-[12px] bg-[#0c151a] border border-white/15 p-4 flex flex-col gap-4 shadow-xl"
        >
          {/* a. Textarea Prompt (min 5 baris, auto-grow, penghitung karakter, toolbar bawah) */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="studio-prompt-input"
                className="font-mono uppercase text-[11px] font-semibold tracking-wider text-[#cbd5e1]"
              >
                PROMPT VIDEO
              </label>
              <span
                className="text-xs text-[#cbd5e1]"
                aria-live="polite"
              >
                {prompt.length} karakter
              </span>
            </div>

            <div className="rounded-[8px] bg-[#070d10] border border-white/15 focus-within:border-[#9cb080] focus-within:ring-2 focus-within:ring-[#9cb080]/40 transition flex flex-col">
              <textarea
                id="studio-prompt-input"
                ref={textareaRef}
                rows={5}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Tulis adegan video yang ingin dibuat secara detail. Contoh: Botol serum kaca di atas batu sungai berlumut dengan sinar matahari pagi menembus kabut..."
                className="w-full bg-transparent border-0 outline-none p-3 text-sm text-[#f1f5f9] placeholder-[#94a3b8] leading-relaxed resize-none min-h-[128px]"
              />

              {/* Toolbar bawah textarea: Perkaya Prompt, Mic, Lampiran */}
              <div className="flex items-center justify-between gap-2 px-2.5 py-2 border-t border-white/10 bg-[#0a1216] rounded-b-[8px]">
                <button
                  type="button"
                  onClick={() => {
                    if (prompt.trim()) {
                      setPrompt(
                        (prev) =>
                          `${prev.trim()}, pencahayaan sinematik detail tinggi, kualitas kamera profesional, komposisi visual tajam`
                      );
                    } else {
                      warning(
                        'Prompt Masih Kosong',
                        'Tulis ide singkat terlebih dahulu sebelum memperkaya prompt.'
                      );
                    }
                  }}
                  title="Perkaya deskripsi prompt dengan detail visual sinematik"
                  aria-label="Perkaya Prompt"
                  className="px-2.5 py-1.5 rounded-[8px] border border-white/15 bg-white/[0.03] hover:bg-white/10 text-xs font-medium text-[#e2e8f0] flex items-center gap-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9cb080]"
                >
                  <Icon name="sparkles" size={14} className="text-[#ffd28a]" />
                  <span>Perkaya Prompt</span>
                </button>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleVoiceDictation}
                    title={isListening ? 'Menghentikan dikte suara' : 'Dikte suara (Bahasa Indonesia)'}
                    aria-label="Dikte suara"
                    className={`w-8 h-8 rounded-[8px] border flex items-center justify-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9cb080] ${
                      isListening
                        ? 'bg-rose-500/20 border-rose-400 text-rose-300 animate-pulse'
                        : 'border-white/15 bg-white/[0.03] hover:bg-white/10 text-[#cbd5e1] hover:text-white'
                    }`}
                  >
                    <Icon name={isListening ? 'mic' : 'mic_none'} size={15} />
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    title="Lampirkan gambar referensi"
                    aria-label="Lampirkan gambar referensi"
                    className="w-8 h-8 rounded-[8px] border border-white/15 bg-white/[0.03] hover:bg-white/10 text-[#cbd5e1] hover:text-white flex items-center justify-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9cb080]"
                  >
                    <Icon name="attach_file" size={15} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* b. Area Referensi */}
          <div className="flex flex-col gap-2">
            <span className="font-mono uppercase text-[11px] font-semibold tracking-wider text-[#cbd5e1]">
              REFERENSI GAMBAR
            </span>

            {referenceImagePath ? (
              <div className="p-2.5 rounded-[8px] bg-[#070d10] border border-white/15 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-12 h-12 rounded-[8px] overflow-hidden bg-[#111d22] border border-white/10 shrink-0 flex items-center justify-center">
                    {referencePreviewUrl ? (
                      <img
                        src={referencePreviewUrl}
                        alt="Thumbnail referensi"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Icon name="image" size={18} className="text-[#9cb080]" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#f1f5f9] truncate">
                      {referenceImageName || 'Gambar referensi aktif'}
                    </p>
                    <p className="text-xs text-[#94a3b8] mt-0.5">
                      Digunakan sebagai acuan visual awal
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setReferenceImagePath(null);
                    setReferenceImageName(null);
                  }}
                  title="Hapus gambar referensi"
                  aria-label="Hapus gambar referensi"
                  className="px-2.5 py-1.5 rounded-[8px] border border-white/15 bg-white/[0.03] hover:bg-rose-500/20 hover:border-rose-400/40 text-xs font-medium text-[#e2e8f0] hover:text-rose-200 flex items-center gap-1.5 shrink-0 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9cb080]"
                >
                  <Icon name="delete" size={14} />
                  <span>Hapus</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Unggah gambar referensi (PNG, JPG, atau WEBP)"
                aria-label="Tambah referensi gambar"
                className="w-full p-3 rounded-[8px] border border-dashed border-white/20 bg-[#070d10]/70 hover:bg-white/[0.04] hover:border-[#9cb080] flex items-center justify-between gap-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9cb080]"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-[8px] bg-white/[0.05] border border-white/10 flex items-center justify-center text-[#cbd5e1]">
                    <Icon name="add" size={16} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[#f1f5f9]">Tambah referensi</p>
                    <p className="text-xs text-[#94a3b8]">Opsional · PNG, JPG, WEBP maks. 10 MB</p>
                  </div>
                </div>
                <span className="text-xs font-medium text-[#cbd5e1] px-2.5 py-1 rounded-[8px] border border-white/15 bg-white/[0.03]">
                  Pilih File
                </span>
              </button>
            )}
          </div>

          {/* c. Pengaturan dalam satu baris: Model, Rasio, Durasi, Resolusi */}
          <div className="flex flex-col gap-2">
            <span className="font-mono uppercase text-[11px] font-semibold tracking-wider text-[#cbd5e1]">
              PENGATURAN OUTPUT
            </span>

            <div className="grid grid-cols-4 gap-2">
              {/* 1. Model */}
              <div className="relative col-span-1">
                <label className="block font-mono uppercase text-[10px] text-[#94a3b8] mb-1">
                  MODEL
                </label>
                {isModelLocked ? (
                  <div
                    title="Model dikunci sesuai kebijakan kantor Anda"
                    aria-label={`Model terkunci: ${currentModel?.label || 'Veo 3.1'}`}
                    className="h-9 px-2 rounded-[8px] bg-[#070d10] border border-white/15 flex items-center gap-1.5 text-xs font-medium text-[#cbd5e1] select-none"
                  >
                    <svg
                      width={13}
                      height={13}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-[#94a3b8] shrink-0"
                    >
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    <span className="truncate">{currentModel?.label || 'Veo 3.1'}</span>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setModelPopupOpen(!modelPopupOpen)}
                      title={`Model terpilih: ${currentModel?.label || 'Veo 3.1 Fast Full HD'}`}
                      aria-label="Pilih model video"
                      aria-expanded={modelPopupOpen}
                      className="w-full h-9 px-2 rounded-[8px] bg-[#070d10] hover:bg-white/[0.06] border border-white/15 flex items-center justify-between gap-1 text-xs font-medium text-[#f1f5f9] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9cb080]"
                    >
                      <span className="truncate">
                        {currentModel?.label?.replace('Full HD', 'FHD') || 'Veo 3.1'}
                      </span>
                      <Icon name="arrow_drop_down" size={14} className="text-[#cbd5e1] shrink-0" />
                    </button>

                    {modelPopupOpen && (
                      <div
                        role="listbox"
                        aria-label="Daftar pilihan model"
                        onMouseLeave={() => setModelPopupOpen(false)}
                        className="absolute left-0 bottom-full mb-2 w-64 rounded-[12px] bg-[#0c151a] border border-white/20 p-2 z-50 shadow-2xl space-y-1"
                      >
                        <div className="px-2 py-1 font-mono uppercase text-[10px] text-[#94a3b8] border-b border-white/10">
                          PILIH MODEL
                        </div>
                        <div className="max-h-52 overflow-y-auto space-y-1 pt-1">
                          {models.map((m) => (
                            <button
                              key={m.key}
                              type="button"
                              role="option"
                              aria-selected={selectedModelKey === m.key}
                              onClick={() => {
                                setSelectedModelKey(m.key);
                                if (m.options?.aspect?.length) setSelectedAspect(m.options.aspect[0]);
                                if (m.options?.duration?.length) setSelectedDuration(m.options.duration[0]);
                                setSelectedResolution(m.provider_params?.resolution || '1080p');
                                setModelPopupOpen(false);
                              }}
                              className={`w-full text-left px-2.5 py-2 rounded-[8px] text-xs font-medium flex items-center justify-between transition ${
                                selectedModelKey === m.key
                                  ? 'bg-[#202c31] text-white border border-[#9cb080]/50'
                                  : 'text-[#e2e8f0] hover:bg-white/[0.06]'
                              }`}
                            >
                              <span className="truncate">{m.label}</span>
                              {selectedModelKey === m.key && (
                                <Icon name="check_circle" size={14} className="text-[#9cb080] shrink-0" />
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* 2. Rasio */}
              <div className="col-span-1">
                <label
                  htmlFor="studio-aspect-select"
                  className="block font-mono uppercase text-[10px] text-[#94a3b8] mb-1"
                >
                  RASIO
                </label>
                <select
                  id="studio-aspect-select"
                  value={selectedAspect}
                  onChange={(e) => setSelectedAspect(e.target.value)}
                  title="Pilih rasio aspek video"
                  aria-label="Pilih rasio aspek video"
                  className="w-full h-9 px-2 rounded-[8px] bg-[#070d10] hover:bg-white/[0.06] border border-white/15 text-xs font-medium text-[#f1f5f9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9cb080]"
                >
                  {(currentModel?.options?.aspect || ['9:16', '16:9']).map((asp: string) => (
                    <option key={asp} value={asp} className="bg-[#0c151a] text-white">
                      {asp}
                    </option>
                  ))}
                </select>
              </div>

              {/* 3. Durasi */}
              <div className="col-span-1">
                <label
                  htmlFor="studio-duration-select"
                  className="block font-mono uppercase text-[10px] text-[#94a3b8] mb-1"
                >
                  DURASI
                </label>
                {currentModel?.type === 'video' ? (
                  <select
                    id="studio-duration-select"
                    value={selectedDuration || 4}
                    onChange={(e) => setSelectedDuration(Number(e.target.value))}
                    title="Pilih durasi video"
                    aria-label="Pilih durasi video"
                    className="w-full h-9 px-2 rounded-[8px] bg-[#070d10] hover:bg-white/[0.06] border border-white/15 text-xs font-medium text-[#f1f5f9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9cb080]"
                  >
                    {(currentModel?.options?.duration || [4, 6, 8]).map((dur: number) => (
                      <option key={dur} value={dur} className="bg-[#0c151a] text-white">
                        {dur} dtk
                      </option>
                    ))}
                  </select>
                ) : (
                  <div
                    title="Durasi tidak berlaku untuk gambar statis"
                    className="h-9 px-2 rounded-[8px] bg-[#070d10] border border-white/10 flex items-center text-xs text-[#94a3b8]"
                  >
                    Statis
                  </div>
                )}
              </div>

              {/* 4. Resolusi */}
              <div className="col-span-1">
                <label
                  htmlFor="studio-resolution-select"
                  className="block font-mono uppercase text-[10px] text-[#94a3b8] mb-1"
                >
                  RESOLUSI
                </label>
                <select
                  id="studio-resolution-select"
                  value={selectedResolution}
                  onChange={(e) => setSelectedResolution(e.target.value)}
                  title="Pilih resolusi output"
                  aria-label="Pilih resolusi output"
                  className="w-full h-9 px-2 rounded-[8px] bg-[#070d10] hover:bg-white/[0.06] border border-white/15 text-xs font-medium text-[#f1f5f9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9cb080]"
                >
                  <option value="1080p" className="bg-[#0c151a] text-white">
                    1080p
                  </option>
                  <option value="720p" className="bg-[#0c151a] text-white">
                    720p
                  </option>
                </select>
              </div>
            </div>
          </div>

          {/* d. Ringkasan biaya SATU kali saja */}
          <div className="px-3 py-2.5 rounded-[8px] bg-[#070d10] border border-white/10 flex items-center justify-between">
            <span className="text-xs font-medium text-[#e2e8f0]">
              Biaya: <strong className="text-[#ffd28a]">{costCredits} KR</strong> · Sisa kuota hari ini:{' '}
              <strong className="text-white">{remainingQuota}/{quota?.limit ?? 35}</strong>
            </span>
            {isPromptTooShort && (
              <span className="text-xs text-[#ffd28a]">Min. 5 karakter</span>
            )}
          </div>

          {/* e. Tombol Generate lebar penuh (sticky di bawah layar pada mobile/tablet <1024px) */}
          <div className="sticky bottom-0 lg:static z-30 pt-2 lg:pt-0 bg-[#0c151a] pb-1 lg:pb-0">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerateDisabled}
              title={generateTooltip}
              aria-label={isProcessing ? 'Sedang membuat video' : 'Generate video'}
              className="w-full h-11 px-4 rounded-[8px] bg-[#4f46e5] hover:bg-[#4338ca] text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2 disabled:opacity-45 disabled:cursor-not-allowed transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9cb080]"
            >
              {isProcessing ? (
                <>
                  <Icon name="sync" size={16} className="animate-fs-spin" />
                  <span>Sedang membuat…</span>
                </>
              ) : (
                <>
                  <Icon name="bolt" size={16} />
                  <span>Generate</span>
                </>
              )}
            </button>
            <p className="text-center text-xs text-[#94a3b8] mt-2">
              Pintasan keyboard: <span className="text-[#cbd5e1] font-medium">Ctrl+Enter</span>
            </p>
          </div>
        </section>

        {/* ============================================================
            KOLOM KANAN: PREVIEW & RIWAYAT SESI INI
           ============================================================ */}
        <section
          aria-label="Area Pratinjau Hasil"
          className="flex-1 min-w-0 w-full flex flex-col items-center gap-4"
        >
          {/* b. Satu baris info kecil di atas frame: nama kantor + status */}
          <div className="w-full max-w-[440px] flex items-center justify-between px-1 text-xs">
            <span className="font-mono uppercase text-[11px] font-semibold tracking-wider text-[#cbd5e1]">
              {formatOfficeName(user?.division_id)}
            </span>
            <span className="flex items-center gap-2 text-[#e2e8f0] font-medium">
              <span className={`w-2 h-2 rounded-full ${statusDotColor}`} />
              <span>{statusLabel}</span>
            </span>
          </div>

          {/* a. Frame Preview mengikuti rasio yang dipilih (9:16 tegak di tengah, tanpa scroll) */}
          <div
            className={`relative rounded-[12px] overflow-hidden bg-[#050c10] border border-white/15 shadow-2xl flex flex-col items-center justify-center ${
              previewAspect === '16:9'
                ? 'w-full max-w-[680px] aspect-video'
                : previewAspect === '1:1'
                ? 'w-full max-w-[420px] aspect-square'
                : 'w-[260px] sm:w-[290px] lg:w-[300px] aspect-[9/16] max-h-[calc(100vh-220px)]'
            }`}
          >
            {/* STATE 3: BERHASIL */}
            {effectiveTask?.status === 'completed' && effectiveTask.result_url ? (
              effectiveTask.media_type === 'video' ? (
                <video
                  key={effectiveTask.result_url}
                  src={effectiveTask.result_url}
                  controls
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="w-full h-full object-cover"
                />
              ) : (
                <img
                  src={effectiveTask.result_url}
                  alt={effectiveTask.prompt || 'Hasil generasi'}
                  className="w-full h-full object-cover"
                />
              )
            ) : /* STATE 2: MEMPROSES */ effectiveTask &&
              ['queued', 'generating', 'downloading'].includes(effectiveTask.status) ? (
              <div className="w-full h-full p-6 flex flex-col items-center justify-center text-center relative">
                {/* Skeleton Background Pulse */}
                <div className="absolute inset-3 rounded-[8px] bg-gradient-to-b from-white/[0.04] via-white/[0.08] to-white/[0.03] animate-pulse pointer-events-none" />

                <div className="relative z-10 flex flex-col items-center gap-4 max-w-[230px]">
                  <div className="w-12 h-12 rounded-full bg-[#111d22] border border-[#f59e0b]/40 flex items-center justify-center text-[#ffd28a]">
                    <Icon name="sync" size={22} className="animate-fs-spin" />
                  </div>

                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-white">
                      {effectiveTask.status === 'queued'
                        ? 'Menunggu Giliran Antrean…'
                        : effectiveTask.status === 'downloading'
                        ? 'Menyimpan Video (99%)…'
                        : `Membuat Video (${effectiveTask.provider_pct || 15}%)`}
                    </p>
                    <p className="text-xs text-[#cbd5e1]">
                      Estimasi waktu: ±{fmtDuration(effectiveTask.est_seconds || 120)}
                    </p>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-[#f59e0b] transition-all duration-500"
                      style={{
                        width: `${
                          effectiveTask.status === 'downloading'
                            ? 98
                            : Math.max(12, effectiveTask.provider_pct || 15)
                        }%`,
                      }}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleCancelTask}
                    title="Batalkan pembuatan video ini"
                    aria-label="Batalkan pembuatan video"
                    className="mt-2 px-4 py-2 rounded-[8px] border border-white/20 bg-[#0c151a]/90 hover:bg-rose-500/20 hover:border-rose-400/40 text-xs font-medium text-[#f1f5f9] flex items-center gap-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9cb080]"
                  >
                    <Icon name="close" size={14} />
                    <span>Batal</span>
                  </button>
                </div>
              </div>
            ) : /* STATE 4: GAGAL */ effectiveTask?.status === 'failed' ? (
              <div className="w-full h-full p-6 flex flex-col items-center justify-center text-center gap-4">
                <div className="w-12 h-12 rounded-full bg-rose-500/15 border border-rose-400/30 flex items-center justify-center text-rose-300">
                  <Icon name="error" size={24} />
                </div>

                <div className="space-y-2 max-w-[240px]">
                  <p className="text-sm font-bold text-white">Pembuatan Video Gagal</p>
                  <p className="text-xs text-[#e2e8f0] leading-relaxed">
                    {humanizeError(effectiveTask.error)}
                  </p>
                  <p className="text-xs text-[#9cb080] font-medium pt-1">
                    Saldo KR dan kuota Anda tidak terpotong.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleRetryTask}
                  title="Muat ulang prompt dan coba buat kembali"
                  aria-label="Coba lagi membuat video"
                  className="px-4 py-2 rounded-[8px] border border-white/20 bg-white/[0.06] hover:bg-white/15 text-xs font-semibold text-white flex items-center gap-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9cb080]"
                >
                  <Icon name="replay" size={14} />
                  <span>Coba lagi</span>
                </button>
              </div>
            ) : (
              /* STATE 1: KOSONG */
              <div className="w-full h-full p-6 flex flex-col items-center justify-center text-center gap-3">
                <div className="w-12 h-12 rounded-[12px] bg-white/[0.04] border border-white/10 flex items-center justify-center text-[#9cb080]">
                  <Icon name="movie_edit" size={24} />
                </div>
                <p className="text-xs text-[#cbd5e1] leading-relaxed max-w-[210px]">
                  Belum ada hasil. Tulis prompt lalu klik Generate.
                </p>
              </div>
            )}
          </div>

          {/* d. Saat ada hasil: tombol Unduh, Generate ulang, dan Pakai sebagai referensi */}
          {effectiveTask?.status === 'completed' && effectiveTask.result_url && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <a
                href={effectiveTask.result_url}
                download
                title="Unduh file video hasil"
                aria-label="Unduh hasil"
                className="px-3 py-2 rounded-[8px] border border-white/15 bg-[#0c151a] hover:bg-white/10 text-xs font-medium text-[#f1f5f9] flex items-center gap-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9cb080]"
              >
                <Icon name="download" size={15} />
                <span>Unduh</span>
              </a>

              <button
                type="button"
                onClick={() => {
                  if (effectiveTask.prompt) setPrompt(effectiveTask.prompt);
                  textareaRef.current?.focus();
                }}
                title="Gunakan kembali prompt ini untuk membuat variasi baru"
                aria-label="Generate ulang dengan prompt ini"
                className="px-3 py-2 rounded-[8px] border border-white/15 bg-[#0c151a] hover:bg-white/10 text-xs font-medium text-[#f1f5f9] flex items-center gap-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9cb080]"
              >
                <Icon name="replay" size={15} />
                <span>Generate ulang</span>
              </button>

              <button
                type="button"
                onClick={handleUseAsReference}
                title="Gunakan hasil ini sebagai referensi visual pada panel kontrol"
                aria-label="Pakai sebagai referensi"
                className="px-3 py-2 rounded-[8px] border border-white/15 bg-[#0c151a] hover:bg-white/10 text-xs font-medium text-[#f1f5f9] flex items-center gap-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9cb080]"
              >
                <Icon name="image" size={15} />
                <span>Pakai sebagai referensi</span>
              </button>
            </div>
          )}

          {/* c. Strip "Riwayat sesi ini" (disembunyikan kalau kosong) */}
          {sessionHistory.length > 0 && (
            <div className="w-full max-w-[520px] rounded-[12px] bg-[#0c151a] border border-white/15 p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-mono uppercase text-[10px] font-semibold tracking-wider text-[#cbd5e1]">
                  RIWAYAT SESI INI
                </span>
                <span className="text-xs text-[#94a3b8]">{sessionHistory.length} hasil</span>
              </div>

              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {sessionHistory.map((t, idx) => {
                  const isSelected = effectiveTask?.task_id === t.task_id;
                  return (
                    <button
                      key={t.task_id}
                      type="button"
                      onClick={() => setActiveTask(t)}
                      title={`Tampilkan hasil #${idx + 1}: ${t.prompt || ''}`}
                      aria-label={`Pilih riwayat hasil ${idx + 1}`}
                      className={`relative w-12 h-16 rounded-[8px] overflow-hidden shrink-0 border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9cb080] ${
                        isSelected
                          ? 'border-[#9cb080] ring-2 ring-[#9cb080]/40'
                          : 'border-white/15 hover:border-white/40 opacity-80 hover:opacity-100'
                      }`}
                    >
                      {t.result_url ? (
                        t.media_type === 'video' ? (
                          <video
                            src={t.result_url}
                            muted
                            playsInline
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <img
                            src={t.result_url}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        )
                      ) : t.status === 'failed' ? (
                        <div className="w-full h-full bg-rose-950/60 flex items-center justify-center text-rose-300">
                          <Icon name="error" size={16} />
                        </div>
                      ) : (
                        <div className="w-full h-full bg-[#111d22] flex items-center justify-center text-[10px] font-medium text-[#ffd28a]">
                          {t.provider_pct ? `${t.provider_pct}%` : '…'}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
