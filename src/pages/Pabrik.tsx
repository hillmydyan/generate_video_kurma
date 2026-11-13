import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useNotify } from '@/components/ui/NotificationProvider';
import { useEventsCtx } from '@/lib/useEvents';
import { api, API_BASE } from '@/lib/api';

interface PromptCardItem {
  id: string;
  text: string;
}

function makePromptCards(texts: string[]): PromptCardItem[] {
  return texts.map((text, idx) => ({
    id: `p_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
    text,
  }));
}

export const Pabrik: React.FC = () => {
  const { lastTaskUpdate } = useEventsCtx();
  const { success, error, info } = useNotify();

  // Shared user, models, credits
  const [user, setUser] = useState<any>(null);
  const [models, setModels] = useState<any[]>([]);
  const [isModelLocked, setIsModelLocked] = useState<boolean>(false);
  const [selectedModelKey, setSelectedModelKey] = useState<string>('veo');
  const [selectedAspect, setSelectedAspect] = useState<string>('9:16');
  const [selectedDuration, setSelectedDuration] = useState<number>(8);
  const [divisionCredits, setDivisionCredits] = useState<number | null>(null);

  // Foto + Multi Prompt state
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState<string>('');
  const [isDraggingPhoto, setIsDraggingPhoto] = useState<boolean>(false);

  const [promptCards, setPromptCards] = useState<PromptCardItem[]>(() =>
    makePromptCards(['', '', ''])
  );
  // Multi-paragraph paste split offer state
  const [splitOffer, setSplitOffer] = useState<{
    cardIndex: number;
    paragraphs: string[];
  } | null>(null);

  // Active batch & batch history
  const [activeBatch, setActiveBatch] = useState<any | null>(null);
  const [batchHistory, setBatchHistory] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const submitLockRef = useRef<boolean>(false);
  const prevBatchStatusRef = useRef<string | null>(null);
  const [playingTaskIds, setPlayingTaskIds] = useState<Record<string, boolean>>({});
  const [retryingTaskIds, setRetryingTaskIds] = useState<Record<string, boolean>>({});
  const [cancellingTaskIds, setCancellingTaskIds] = useState<Record<string, boolean>>({});
  const [cancellingBatch, setCancellingBatch] = useState<boolean>(false);
  const [downloadingZip, setDownloadingZip] = useState<boolean>(false);

  const photoInputRef = useRef<HTMLInputElement>(null);

  // 1. Load user & models & initial active batch + history
  useEffect(() => {
    const raw = localStorage.getItem('snapgen_user');
    let parsedUser: any = null;
    if (raw) {
      try {
        parsedUser = JSON.parse(raw);
        setUser(parsedUser);
      } catch {}
    }

    api.models
      .list()
      .then((res) => {
        const vModels = (res.models || []).filter((m: any) => m.type === 'video');
        setModels(vModels);
        setIsModelLocked(Boolean(res.video_model_locked) || vModels.length === 1);
        if (vModels.length > 0) {
          const defKey = res.default_video_model || vModels[0].key;
          const found = vModels.find((m: any) => m.key === defKey) || vModels[0];
          setSelectedModelKey(found.key);
          if (found.options?.aspect?.length) {
            setSelectedAspect(found.options.aspect.includes('9:16') ? '9:16' : found.options.aspect[0]);
          }
          if (found.options?.duration?.length) {
            const dList = found.options.duration;
            setSelectedDuration(dList.includes(8) ? 8 : dList[dList.length - 1]);
          }
        }
      })
      .catch(() => {});
  }, []);

  const fetchCredits = useCallback(async ( userObj?: any) => {
    const u = userObj || user;
    if (!u) return;
    try {
      const res = await api.admin.getCredits(0);
      if (res.accounts) {
        const userDiv = u.division_id || 'kantor_a';
        const divAccs = res.accounts.filter((a: any) => a.division_id === userDiv);
        const total = divAccs.reduce((sum: number, a: any) => sum + (a.credits || 0), 0);
        setDivisionCredits(total);
      }
    } catch {}
  }, [user]);

  const loadBatchState = useCallback(async (selectActiveIfNone: boolean = false) => {
    try {
      const [activeRes, historyRes] = await Promise.allSettled([
        api.batches.getActive(),
        api.batches.list(1, 10),
      ]);

      let historyItems: any[] = [];
      if (historyRes.status === 'fulfilled') {
        historyItems = historyRes.value.batches || [];
        setBatchHistory(historyItems);
      }

      if (activeRes.status === 'fulfilled' && activeRes.value?.batch) {
        const runningBatch = activeRes.value.batch;
        setActiveBatch((prev: any) => {
          if (!prev || selectActiveIfNone || prev.id === runningBatch.id) {
            return runningBatch;
          }
          return prev;
        });
      } else if (selectActiveIfNone && historyItems.length > 0) {
        setActiveBatch((prev: any) => prev || historyItems[0]);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (user) {
      fetchCredits(user);
      loadBatchState(true);
    }
  }, [user, fetchCredits, loadBatchState]);

  // 2. Poll active batch every 3 seconds while running
  useEffect(() => {
    if (!activeBatch?.id) return;
    if (activeBatch.status !== 'berjalan') return;

    const timer = setInterval(async () => {
      try {
        const updated = await api.batches.getDetail(activeBatch.id);
        setActiveBatch(updated);
        if (updated.status !== 'berjalan') {
          loadBatchState(false);
          fetchCredits();
          window.dispatchEvent(new Event('snapgen_credits_refresh'));
        }
      } catch {}
    }, 3000);

    return () => clearInterval(timer);
  }, [activeBatch?.id, activeBatch?.status, loadBatchState, fetchCredits]);

  // Refresh when SSE emits task updates for current batch
  useEffect(() => {
    if (!lastTaskUpdate || !activeBatch?.id) return;
    if (lastTaskUpdate.batch_id === activeBatch.id) {
      api.batches
        .getDetail(activeBatch.id)
        .then((updated) => {
          setActiveBatch(updated);
          if (updated.status !== 'berjalan') {
            loadBatchState(false);
            fetchCredits();
            window.dispatchEvent(new Event('snapgen_credits_refresh'));
          }
        })
        .catch(() => {});
    }
  }, [lastTaskUpdate, activeBatch?.id, loadBatchState, fetchCredits]);

  // Clear ONLY prompt cards when an active batch transitions from 'berjalan' to finished
  // Keep photo and settings intact!
  useEffect(() => {
    if (!activeBatch) return;
    const prev = prevBatchStatusRef.current;
    const curr = activeBatch.status;
    if (prev === 'berjalan' && curr && curr !== 'berjalan') {
      setPromptCards((cards) => makePromptCards(cards.map(() => '')));
    }
    prevBatchStatusRef.current = curr;
  }, [activeBatch?.id, activeBatch?.status]);

  // 3. Handle Photo Selection (Click, Drag & Drop, Paste)
  const applyPhotoFile = useCallback(
    (file: File) => {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (file.type && !allowedTypes.includes(file.type)) {
        error('Format Foto Tidak Didukung', 'Gunakan file foto berformat JPG, PNG, atau WEBP.');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        error('Ukuran Foto Terlalu Besar', 'Ukuran foto maksimal 10 MB.');
        return;
      }
      if (photoPreviewUrl) {
        URL.revokeObjectURL(photoPreviewUrl);
      }
      const preview = URL.createObjectURL(file);
      setPhotoFile(file);
      setPhotoPreviewUrl(preview);
      setPhotoName(file.name || 'model-photo.jpg');
    },
    [photoPreviewUrl, error]
  );

  const handleRemovePhoto = () => {
    if (photoPreviewUrl) {
      URL.revokeObjectURL(photoPreviewUrl);
    }
    setPhotoFile(null);
    setPhotoPreviewUrl(null);
    setPhotoName('');
    if (photoInputRef.current) {
      photoInputRef.current.value = '';
    }
  };

  // Global clipboard image paste listener
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            applyPhotoFile(file);
            info('Foto Ditempel', 'Foto model berhasil ditempel dari clipboard.');
            return;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [applyPhotoFile, info]);

  // 4. Prompt Cards Management
  const handlePromptChange = (index: number, value: string) => {
    setPromptCards((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, text: value } : item))
    );
    if (splitOffer && splitOffer.cardIndex === index) {
      setSplitOffer(null);
    }
  };

  const handleAddPromptCard = () => {
    if (promptCards.length >= 10) return;
    setPromptCards((prev) => [
      ...prev,
      { id: `p_${Date.now()}_${prev.length}`, text: '' },
    ]);
  };

  const handleRemovePromptCard = (index: number) => {
    if (promptCards.length <= 1) return;
    setPromptCards((prev) => prev.filter((_, idx) => idx !== index));
    if (splitOffer) setSplitOffer(null);
  };

  const handlePromptPaste = (
    index: number,
    e: React.ClipboardEvent<HTMLTextAreaElement>
  ) => {
    const pasted = e.clipboardData.getData('text/plain') || '';
    // Detect multi-paragraph paste (separated by blank lines or 2+ lines)
    const paragraphs = pasted
      .split(/\r?\n\s*\r?\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (paragraphs.length > 1) {
      const maxCanFit = Math.min(10, paragraphs.length);
      setSplitOffer({
        cardIndex: index,
        paragraphs: paragraphs.slice(0, maxCanFit),
      });
    }
  };

  const applySplitOffer = () => {
    if (!splitOffer) return;
    const { cardIndex, paragraphs } = splitOffer;
    setPromptCards((prev) => {
      const before = prev.slice(0, cardIndex);
      const after = prev.slice(cardIndex + 1).filter((c) => c.text.trim().length > 0);
      const inserted = makePromptCards(paragraphs);
      const combined = [...before, ...inserted, ...after].slice(0, 10);
      return combined.length > 0 ? combined : makePromptCards(['']);
    });
    setSplitOffer(null);
  };

  // 5. Calculations & Validation
  const currentModel =
    models.find((m) => m.key === selectedModelKey) ||
    models[0] || {
      key: 'veo',
      label: 'Veo 3.1 Fast Full HD',
      credits: 20,
      options: { aspect: ['9:16', '16:9'], duration: [4, 6, 8] },
    };

  const nonEmptyPrompts = promptCards
    .map((c) => c.text.trim())
    .filter((t) => t.length > 0);

  const videoCount = nonEmptyPrompts.length;
  const costPerVideo = currentModel?.credits ?? 4;
  const totalKrCost = (videoCount || promptCards.length) * costPerVideo;
  const actualRequiredKr = videoCount * costPerVideo;

  const isPhotoMissing = !photoFile;
  const isAllPromptsEmpty = videoCount === 0;
  const isKrInsufficient =
    divisionCredits !== null && actualRequiredKr > 0 && divisionCredits < actualRequiredKr;

  const isGenerateDisabled =
    submitting || isPhotoMissing || isAllPromptsEmpty || isKrInsufficient;

  const generateDisableReason = submitting
    ? 'Sedang mengirim batch ke server…'
    : isPhotoMissing
    ? 'Unggah foto model terlebih dahulu'
    : isAllPromptsEmpty
    ? 'Tulis minimal 1 prompt video terlebih dahulu'
    : isKrInsufficient
    ? `Saldo KR kurang: butuh ${actualRequiredKr} KR, tersisa ${divisionCredits} KR`
    : `Generate ${videoCount} video sekarang`;

  // 6. Submit Foto + Multi Prompt Batch
  const handleGenerateBatch = async () => {
    if (submitLockRef.current || isGenerateDisabled || !photoFile) return;
    submitLockRef.current = true;
    setSubmitting(true);

    try {
      const fd = new FormData();
      fd.append('foto', photoFile);
      nonEmptyPrompts.forEach((p) => fd.append('prompts[]', p));
      fd.append('rasio', selectedAspect);
      fd.append('durasi', String(selectedDuration));
      fd.append('model', selectedModelKey);

      const createdBatch = await api.batches.create(fd);
      prevBatchStatusRef.current = createdBatch.status || 'berjalan';
      setActiveBatch(createdBatch);
      await loadBatchState(false);
      await fetchCredits();
      window.dispatchEvent(new Event('snapgen_credits_refresh'));
      success(
        `${createdBatch.nama} Dimulai`,
        `${createdBatch.total_tasks} video sedang diproses memakai foto ${photoName}.`
      );
    } catch (err: any) {
      error('Gagal Membuat Batch', err.message || 'Terjadi kesalahan saat memulai batch.');
    } finally {
      setSubmitting(false);
      submitLockRef.current = false;
    }
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleGenerateBatch();
    }
  };

  // 7. Task & Batch Actions (Cancel / Retry / Download ZIP)
  const handleCancelBatch = async () => {
    if (!activeBatch?.id || cancellingBatch) return;
    setCancellingBatch(true);
    try {
      const updated = await api.batches.cancelBatch(activeBatch.id);
      setActiveBatch(updated);
      await loadBatchState(false);
      await fetchCredits();
      window.dispatchEvent(new Event('snapgen_credits_refresh'));
      info('Sisa Tugas Dibatalkan', 'Tugas yang belum selesai telah dibatalkan dan saldo KR dikembalikan.');
    } catch (err: any) {
      error('Gagal Membatalkan Batch', err.message);
    } finally {
      setCancellingBatch(false);
    }
  };

  const handleCancelSingleTask = async (taskId: string) => {
    if (cancellingTaskIds[taskId]) return;
    setCancellingTaskIds((prev) => ({ ...prev, [taskId]: true }));
    try {
      const updated = await api.batches.cancelTask(taskId);
      setActiveBatch(updated);
      await loadBatchState(false);
      await fetchCredits();
      window.dispatchEvent(new Event('snapgen_credits_refresh'));
      info('Tugas Dibatalkan', 'Tugas dibatalkan dan saldo KR telah dikembalikan.');
    } catch (err: any) {
      error('Gagal Membatalkan Tugas', err.message);
    } finally {
      setCancellingTaskIds((prev) => ({ ...prev, [taskId]: false }));
    }
  };

  const handleRetrySingleTask = async (taskId: string) => {
    if (retryingTaskIds[taskId]) return;
    setRetryingTaskIds((prev) => ({ ...prev, [taskId]: true }));
    try {
      const updated = await api.batches.retryTask(taskId);
      prevBatchStatusRef.current = 'berjalan';
      setActiveBatch(updated);
      await loadBatchState(false);
      await fetchCredits();
      window.dispatchEvent(new Event('snapgen_credits_refresh'));
      info('Mencoba Ulang Tugas', 'Tugas yang gagal telah dimasukkan kembali ke antrean.');
    } catch (err: any) {
      error('Gagal Mencoba Ulang', err.message);
    } finally {
      setRetryingTaskIds((prev) => ({ ...prev, [taskId]: false }));
    }
  };

  const handleDownloadBatchZip = async () => {
    if (!activeBatch?.id || downloadingZip) return;
    setDownloadingZip(true);
    try {
      const blob = await api.batches.downloadZip(activeBatch.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (activeBatch.nama || activeBatch.id).replace(/[^a-zA-Z0-9_-]/g, '_');
      a.download = `kurmaflow_${safeName}.zip`;
      a.click();
      window.URL.revokeObjectURL(url);
      success('Unduhan ZIP Dimulai', 'Semua video selesai berhasil dikemas dalam satu ZIP.');
    } catch (err: any) {
      error('Gagal Mengunduh ZIP', err.message);
    } finally {
      setDownloadingZip(false);
    }
  };

  // Compute display batch & progress
  const batchTasks: any[] = activeBatch?.tasks || [];
  const totalBatchTasks = activeBatch?.total_tasks || batchTasks.length || 0;
  const completedBatchTasks =
    activeBatch?.selesai_count ??
    batchTasks.filter((t) => t.status === 'selesai').length;
  const hasUnfinishedBatchTasks = batchTasks.some((t) =>
    ['antre', 'memproses'].includes(t.status)
  );
  const allFinishedAndHasCompleted =
    totalBatchTasks > 0 && !hasUnfinishedBatchTasks && completedBatchTasks > 0;
  const batchProgressPct =
    totalBatchTasks > 0 ? Math.round((completedBatchTasks / totalBatchTasks) * 100) : 0;

  const formatHistorySummary = (b: any): string => {
    const selesai = b.selesai_count ?? 0;
    const gagal = b.gagal_count ?? 0;
    const batal = b.dibatalkan_count ?? 0;
    const total = b.total_tasks ?? 0;
    const kr = b.total_kr ?? 0;

    if (b.status === 'berjalan') {
      return `${total} video · ${kr} KR · sedang berjalan (${selesai}/${total} selesai)`;
    }
    if (gagal > 0) {
      return `${selesai} video · ${kr} KR · ${gagal} gagal, KR tidak terpotong`;
    }
    if (batal > 0 && selesai === 0) {
      return `${total} video · 0 KR · dibatalkan`;
    }
    if (batal > 0) {
      return `${selesai} video · ${kr} KR · ${batal} dibatalkan`;
    }
    return `${selesai || total} video · ${kr} KR · semua selesai`;
  };

  const mediaToken = localStorage.getItem('snapgen_media_token') || localStorage.getItem('snapgen_token') || '';
  const withAuthUrl = (rawUrl?: string | null) => {
    if (!rawUrl) return '';
    const base = rawUrl.startsWith('/') ? `${API_BASE}${rawUrl}` : rawUrl;
    if (!mediaToken) return base;
    return base.includes('?') ? `${base}&token=${encodeURIComponent(mediaToken)}` : `${base}?token=${encodeURIComponent(mediaToken)}`;
  };

  return (
    <div className="flex-1 w-full max-w-[1280px] mx-auto">
      {/* Accessible File Input */}
      <input
        ref={photoInputRef}
        type="file"
        aria-label="Unggah file foto model"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) applyPhotoFile(f);
        }}
      />

      {/* Main Responsive Layout: 2 Columns on >=1024px (lg), 1 Column on <1024px */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-start gap-6">
        {/* ============================================================
            KOLOM KIRI: FORM KONFIGURASI (±390px di desktop)
           ============================================================ */}
        <section
          aria-label="Form Pabrik Video"
          className="w-full lg:w-[390px] shrink-0 rounded-2xl bg-[#0d131f]/95 border border-white/[0.08] p-5 flex flex-col gap-5 shadow-2xl"
        >
          {/* 1. Foto Model */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-slate-300">
                  1. Foto model
                </label>

                {photoFile && photoPreviewUrl ? (
                  <div className="p-3 rounded-xl bg-[#090d16] border border-white/[0.08] flex items-center gap-3.5">
                    <div className="w-14 h-[74px] rounded-lg overflow-hidden bg-[#162032] border border-white/10 shrink-0 relative flex items-center justify-center">
                      <img
                        src={photoPreviewUrl}
                        alt={photoName || 'Foto model'}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-white truncate" title={photoName}>
                        {photoName}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                        Dipakai untuk semua prompt di batch ini
                      </p>
                      <div className="flex items-center gap-2 mt-2.5">
                        <button
                          type="button"
                          onClick={() => photoInputRef.current?.click()}
                          className="px-3 py-1 rounded-md bg-[#131b2e] hover:bg-[#1e293b] border border-white/10 text-[11px] font-semibold text-slate-200 transition cursor-pointer"
                        >
                          Ganti
                        </button>
                        <button
                          type="button"
                          onClick={handleRemovePhoto}
                          className="px-3 py-1 rounded-md bg-[#131b2e] hover:bg-rose-500/20 border border-white/10 hover:border-rose-400/40 text-[11px] font-semibold text-slate-200 hover:text-rose-200 transition cursor-pointer"
                        >
                          Hapus
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => photoInputRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        photoInputRef.current?.click();
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDraggingPhoto(true);
                    }}
                    onDragLeave={() => setIsDraggingPhoto(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDraggingPhoto(false);
                      const f = e.dataTransfer.files?.[0];
                      if (f) applyPhotoFile(f);
                    }}
                    className={`p-4 rounded-xl border border-dashed transition cursor-pointer flex items-center gap-3.5 ${
                      isDraggingPhoto
                        ? 'border-indigo-400 bg-indigo-500/10'
                        : 'border-white/15 bg-[#090d16] hover:bg-[#111827] hover:border-white/30'
                    }`}
                  >
                    <div className="w-14 h-[74px] rounded-lg bg-[#162032] border border-white/10 shrink-0 flex flex-col items-center justify-center text-[10px] text-slate-400 text-center px-1">
                      <Icon name="add_photo_alternate" size={20} className="text-slate-400 mb-1" />
                      <span>Foto model</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white">
                        Unggah foto model (Klik, Seret, atau Paste)
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                        Satu foto referensi dipakai untuk semua prompt · JPG, PNG, WEBP maks. 10 MB
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* 3. Kartu Prompt Bernomor (default 3, maks 10, min 1) */}
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300">
                    2. Prompt
                  </label>
                  <span className="text-[11px] text-slate-400">
                    {promptCards.length} dari maksimal 10
                  </span>
                </div>

                {/* Multi-paragraph split offer banner */}
                {splitOffer && (
                  <div className="p-2.5 rounded-xl bg-indigo-500/15 border border-indigo-400/30 flex items-center justify-between gap-2 text-xs">
                    <span className="text-indigo-200 font-medium">
                      Pisah jadi {splitOffer.paragraphs.length} prompt?
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={applySplitOffer}
                        className="px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-[11px] cursor-pointer"
                      >
                        Pisah jadi {splitOffer.paragraphs.length} prompt
                      </button>
                      <button
                        type="button"
                        onClick={() => setSplitOffer(null)}
                        className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/15 text-slate-300 text-[11px] cursor-pointer"
                      >
                        Biarkan
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-2.5">
                  {promptCards.map((card, idx) => (
                    <div
                      key={card.id}
                      className="rounded-xl bg-[#090d16] border border-white/[0.08] focus-within:border-indigo-500/60 p-3 transition flex flex-col gap-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          PROMPT {idx + 1}
                        </span>
                        {promptCards.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemovePromptCard(idx)}
                            title={`Hapus Prompt ${idx + 1}`}
                            aria-label={`Hapus Prompt ${idx + 1}`}
                            className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                          >
                            <span className="text-sm leading-none">×</span>
                          </button>
                        )}
                      </div>

                      <textarea
                        rows={2}
                        value={card.text}
                        onChange={(e) => handlePromptChange(idx, e.target.value)}
                        onPaste={(e) => handlePromptPaste(idx, e)}
                        onKeyDown={handleTextareaKeyDown}
                        placeholder={
                          idx === 0
                            ? 'Model tersenyum ke kamera sambil mengangkat produk setinggi dada, cahaya lembut dari samping.'
                            : idx === 1
                            ? 'Model berjalan pelan ke arah kamera, lalu berputar memperlihatkan outfit dari samping.'
                            : 'Close-up model menunjuk detail produk, lalu mengangguk puas ke kamera.'
                        }
                        className="w-full bg-transparent border-0 outline-none text-xs text-slate-100 placeholder-slate-500 leading-relaxed resize-y min-h-[44px]"
                      />
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={handleAddPromptCard}
                  disabled={promptCards.length >= 10}
                  className="w-full py-2.5 rounded-xl bg-[#090d16] hover:bg-[#131b2e] border border-white/[0.08] text-xs font-semibold text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                >
                  + Tambah prompt
                </button>
              </div>

              {/* 4. Pengaturan (berlaku untuk semua) */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-slate-300">
                  3. Pengaturan (berlaku untuk semua)
                </label>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Model Badge / Select */}
                  {isModelLocked ? (
                    <div
                      title="Model dikunci oleh pengaturan kantor Anda"
                      className="px-3 py-1.5 rounded-lg bg-[#090d16] border border-white/10 text-xs font-medium text-slate-200 flex items-center gap-1.5 select-none"
                    >
                      <Icon name="lock" size={13} className="text-slate-400" />
                      <span>{currentModel.label}</span>
                    </div>
                  ) : (
                    <div className="relative flex items-center bg-[#090d16] border border-white/10 rounded-lg px-2.5 py-1.5">
                      <Icon name="lock" size={13} className="text-slate-400 mr-1.5 shrink-0" />
                      <select
                        aria-label="Pilih model video"
                        value={selectedModelKey}
                        onChange={(e) => {
                          const key = e.target.value;
                          setSelectedModelKey(key);
                          const m = models.find((item) => item.key === key);
                          if (m?.options?.aspect?.length) {
                            setSelectedAspect(
                              m.options.aspect.includes('9:16') ? '9:16' : m.options.aspect[0]
                            );
                          }
                          if (m?.options?.duration?.length) {
                            const dList = m.options.duration;
                            setSelectedDuration(dList.includes(8) ? 8 : dList[dList.length - 1]);
                          }
                        }}
                        className="bg-transparent border-0 outline-none text-xs font-medium text-slate-200 cursor-pointer pr-1"
                      >
                        {models.map((m) => (
                          <option key={m.key} value={m.key} className="bg-[#0d131f] text-white">
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Rasio */}
                  <div className="bg-[#090d16] border border-white/10 rounded-lg px-2.5 py-1.5 flex items-center">
                    <select
                      aria-label="Pilih rasio video"
                      value={selectedAspect}
                      onChange={(e) => setSelectedAspect(e.target.value)}
                      className="bg-transparent border-0 outline-none text-xs font-medium text-slate-200 cursor-pointer"
                    >
                      {(currentModel?.options?.aspect || ['9:16', '16:9']).map((asp: string) => (
                        <option key={asp} value={asp} className="bg-[#0d131f] text-white">
                          Rasio {asp}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Durasi */}
                  <div className="bg-[#090d16] border border-white/10 rounded-lg px-2.5 py-1.5 flex items-center">
                    <select
                      aria-label="Pilih durasi video"
                      value={selectedDuration}
                      onChange={(e) => setSelectedDuration(Number(e.target.value))}
                      className="bg-transparent border-0 outline-none text-xs font-medium text-slate-200 cursor-pointer"
                    >
                      {(currentModel?.options?.duration || [4, 6, 8]).map((dur: number) => (
                        <option key={dur} value={dur} className="bg-[#0d131f] text-white">
                          Durasi {dur} dtk
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* 5. Ringkasan Biaya & Tombol Generate */}
              <div className="pt-2 border-t border-white/[0.08] flex flex-col gap-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-medium">
                    {videoCount || promptCards.length} video × {costPerVideo} KR
                  </span>
                  <span className="font-mono font-bold text-[#f59e0b]">
                    {totalKrCost} KR
                  </span>
                </div>

                {isKrInsufficient && (
                  <p className="text-[11px] text-rose-400 font-medium">
                    Saldo KR kurang: butuh {actualRequiredKr} KR, tersisa {divisionCredits} KR
                  </p>
                )}

                <button
                  type="button"
                  onClick={handleGenerateBatch}
                  disabled={isGenerateDisabled}
                  title={generateDisableReason}
                  className="w-full py-3 px-4 rounded-xl bg-[#5850ec] hover:bg-[#4f46e5] text-sm font-bold text-white shadow-lg shadow-indigo-600/25 disabled:opacity-45 disabled:cursor-not-allowed transition cursor-pointer flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <>
                      <Icon name="sync" size={16} className="animate-fs-spin" />
                      <span>Mengirim Batch…</span>
                    </>
                  ) : (
                    <span>Generate {videoCount || promptCards.length} Video</span>
                  )}
                </button>

                <p className="text-center text-[11px] text-slate-400">
                  Ctrl + Enter dari kotak prompt mana pun
                </p>
              </div>
        </section>

        {/* ============================================================
            KOLOM KANAN: BATCH AKTIF & RIWAYAT BATCH
           ============================================================ */}
        <section
          aria-label="Hasil Batch dan Riwayat"
          className="flex-1 min-w-0 flex flex-col gap-6"
        >
          {/* 1. Kartu Batch Aktif */}
          <div className="rounded-2xl bg-[#0d131f]/95 border border-white/[0.08] p-5 sm:p-6 shadow-2xl flex flex-col gap-4">
            {activeBatch ? (
              <>
                {/* Header Batch Aktif */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-white font-['Plus_Jakarta_Sans']">
                      {activeBatch.nama}
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {completedBatchTasks} dari {totalBatchTasks} selesai
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCancelBatch}
                      disabled={!hasUnfinishedBatchTasks || cancellingBatch}
                      className="px-3.5 py-1.5 rounded-lg bg-[#131b2e] hover:bg-rose-500/20 border border-white/10 hover:border-rose-400/40 text-xs font-semibold text-slate-200 hover:text-rose-200 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                    >
                      {cancellingBatch ? 'Membatalkan…' : 'Batalkan sisa'}
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadBatchZip}
                      disabled={!allFinishedAndHasCompleted || downloadingZip}
                      className="px-3.5 py-1.5 rounded-lg bg-[#131b2e] hover:bg-[#1e293b] border border-white/10 text-xs font-semibold text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                    >
                      {downloadingZip ? 'Mengemas ZIP…' : 'Unduh semua'}
                    </button>
                  </div>
                </div>

                {/* Progress Bar Emerald */}
                <div className="w-full h-1.5 rounded-full bg-[#162032] overflow-hidden">
                  <div
                    className="h-full bg-[#10b981] transition-all duration-500 rounded-full"
                    style={{ width: `${batchProgressPct}%` }}
                  />
                </div>

                {/* Grid Kartu 9:16 (1–2 kolom di mobile, 3 kolom di desktop) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 pt-1">
                  {batchTasks.map((t: any) => {
                    const isPlaying = Boolean(playingTaskIds[t.id]);
                    const videoSrc = withAuthUrl(t.video_url || t.video_path);

                    return (
                      <div
                        key={t.id}
                        className="rounded-xl bg-[#090d16] border border-white/[0.08] overflow-hidden flex flex-col justify-between"
                      >
                        {/* Top 9:16 Stage */}
                        <div className="relative aspect-[9/16] w-full bg-[#111a2e] flex flex-col items-center justify-center p-4 text-center overflow-hidden">
                          {t.status === 'selesai' && videoSrc ? (
                            isPlaying ? (
                              <video
                                src={videoSrc}
                                controls
                                autoPlay
                                loop
                                playsInline
                                className="absolute inset-0 w-full h-full object-cover bg-black"
                              />
                            ) : (
                              <div
                                onClick={() =>
                                  setPlayingTaskIds((prev) => ({ ...prev, [t.id]: true }))
                                }
                                className="w-full h-full flex flex-col items-center justify-center gap-3 cursor-pointer group"
                              >
                                <video
                                  src={videoSrc}
                                  muted
                                  playsInline
                                  preload="metadata"
                                  className="absolute inset-0 w-full h-full object-cover opacity-55 group-hover:opacity-75 transition"
                                />
                                <div className="relative z-10 w-12 h-12 rounded-full bg-white text-[#090d16] flex items-center justify-center shadow-lg group-hover:scale-105 transition">
                                  <Icon name="play_arrow" size={26} />
                                </div>
                                <span className="relative z-10 text-xs font-medium text-slate-200 drop-shadow">
                                  Pratinjau video {t.urutan}
                                </span>
                              </div>
                            )
                          ) : t.status === 'memproses' ? (
                            <div className="w-full max-w-[180px] flex flex-col items-center gap-2.5">
                              <span className="text-2xl font-bold font-mono text-white">
                                {Math.max(1, t.progress || 15)}%
                              </span>
                              <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                                <div
                                  className="h-full bg-[#6366f1] transition-all duration-500 rounded-full"
                                  style={{ width: `${Math.max(8, t.progress || 15)}%` }}
                                />
                              </div>
                              <span className="text-[11px] text-slate-400">
                                Sekitar {t.remaining_seconds || 40} detik lagi
                              </span>
                            </div>
                          ) : t.status === 'antre' ? (
                            <div className="flex flex-col items-center gap-2 text-slate-400">
                              <Icon name="schedule" size={22} className="text-slate-400" />
                              <span className="text-xs">Menunggu giliran</span>
                            </div>
                          ) : t.status === 'gagal' ? (
                            <div className="flex flex-col items-center gap-2 px-2">
                              <div className="w-10 h-10 rounded-full bg-rose-500/15 border border-rose-400/30 flex items-center justify-center text-rose-400">
                                <Icon name="error" size={20} />
                              </div>
                              <p className="text-xs font-semibold text-rose-300">
                                Pembuatan Gagal
                              </p>
                              <p className="text-[11px] text-slate-300 leading-snug line-clamp-4">
                                {t.error_message || 'Terjadi kendala saat memproses video ini.'}
                              </p>
                              <span className="mt-1 px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px] font-semibold">
                                KR tidak terpotong
                              </span>
                            </div>
                          ) : (
                            /* dibatalkan */
                            <div className="flex flex-col items-center gap-2 text-slate-400 px-2">
                              <Icon name="cancel" size={22} className="text-slate-500" />
                              <span className="text-xs font-medium text-slate-300">
                                Tugas Dibatalkan
                              </span>
                              <span className="text-[10px] text-emerald-300">
                                KR tidak terpotong
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Bottom Metadata & Action */}
                        <div className="p-3 bg-[#090d16] border-t border-white/[0.06] flex flex-col gap-2">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-mono font-semibold text-slate-400 uppercase">
                              PROMPT {t.urutan}
                            </span>
                            {t.status === 'selesai' && (
                              <span className="font-semibold text-[#10b981] flex items-center gap-1">
                                <span>✓</span>
                                <span>Selesai</span>
                              </span>
                            )}
                            {t.status === 'memproses' && (
                              <span className="font-semibold text-[#93c5fd]">
                                Memproses
                              </span>
                            )}
                            {t.status === 'antre' && (
                              <span className="font-semibold text-slate-200">
                                Antre
                              </span>
                            )}
                            {t.status === 'gagal' && (
                              <span className="font-semibold text-rose-400">
                                Gagal
                              </span>
                            )}
                            {t.status === 'dibatalkan' && (
                              <span className="font-semibold text-slate-400">
                                Dibatalkan
                              </span>
                            )}
                          </div>

                          <p
                            className="text-xs text-slate-300 line-clamp-2 min-h-[32px] leading-snug"
                            title={t.prompt}
                          >
                            {t.prompt}
                          </p>

                          {t.status === 'selesai' && videoSrc ? (
                            <a
                              href={videoSrc}
                              download={`prompt_${t.urutan}_${t.id}.mp4`}
                              className="w-full py-2 rounded-lg bg-[#111827] hover:bg-[#1e293b] border border-white/10 text-xs font-semibold text-white text-center transition"
                            >
                              Unduh
                            </a>
                          ) : t.status === 'memproses' || t.status === 'antre' ? (
                            <button
                              type="button"
                              onClick={() => handleCancelSingleTask(t.id)}
                              disabled={Boolean(cancellingTaskIds[t.id])}
                              className="w-full py-2 rounded-lg bg-[#111827] hover:bg-rose-500/20 border border-white/10 hover:border-rose-400/40 text-xs font-semibold text-slate-200 hover:text-rose-200 disabled:opacity-40 transition cursor-pointer"
                            >
                              {cancellingTaskIds[t.id] ? 'Membatalkan…' : 'Batalkan'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleRetrySingleTask(t.id)}
                              disabled={Boolean(retryingTaskIds[t.id])}
                              className="w-full py-2 rounded-lg bg-[#111827] hover:bg-indigo-600/30 border border-white/10 hover:border-indigo-400/50 text-xs font-semibold text-white disabled:opacity-40 transition cursor-pointer"
                            >
                              {retryingTaskIds[t.id] ? 'Mengulang…' : 'Coba lagi'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              /* Empty State when no batch has been started yet */
              <div className="py-14 px-4 text-center flex flex-col items-center justify-center gap-2.5 text-slate-400">
                <div className="w-12 h-12 rounded-2xl bg-[#131b2e] border border-white/10 flex items-center justify-center text-slate-300">
                  <Icon name="movie_filter" size={24} />
                </div>
                <p className="text-sm font-bold text-white">
                  Belum Ada Batch yang Dipilih
                </p>
                <p className="text-xs text-slate-400 max-w-md leading-relaxed">
                  Unggah satu foto model di sebelah kiri, isi daftar prompt gerakan/adegan, lalu tekan tombol Generate untuk memproses seluruh video sekaligus.
                </p>
              </div>
            )}
          </div>

          {/* 2. Kartu Riwayat Batch */}
          <div className="rounded-2xl bg-[#0d131f]/95 border border-white/[0.08] p-5 sm:p-6 shadow-2xl flex flex-col gap-3.5">
            <h3 className="text-sm font-bold text-white font-['Plus_Jakarta_Sans']">
              Riwayat batch
            </h3>

            {batchHistory.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-400">
                Belum ada riwayat batch sebelumnya.
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {batchHistory.map((b: any) => {
                  const isCurrent = activeBatch?.id === b.id;
                  const thumbUrl = withAuthUrl(b.foto_url);

                  return (
                    <div
                      key={b.id}
                      className={`p-3 rounded-xl bg-[#090d16] border transition flex items-center justify-between gap-3 ${
                        isCurrent ? 'border-indigo-500/40' : 'border-white/[0.07]'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-11 rounded-lg overflow-hidden bg-[#162032] border border-white/10 shrink-0 flex items-center justify-center">
                          {thumbUrl ? (
                            <img
                              src={thumbUrl}
                              alt={b.nama}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Icon name="image" size={16} className="text-slate-400" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-white truncate">
                            {b.nama}
                          </p>
                          <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                            {formatHistorySummary(b)}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          prevBatchStatusRef.current = b.status;
                          setActiveBatch(b);
                        }}
                        className="px-3.5 py-1.5 rounded-lg bg-[#131b2e] hover:bg-[#1e293b] border border-white/10 text-xs font-semibold text-slate-200 transition cursor-pointer shrink-0"
                      >
                        Buka
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
