import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useEventsCtx } from '@/lib/useEvents';
import { fmtCredits } from '@/lib/format';
import { api } from '@/lib/api';

export const Gallery: React.FC = () => {
  const navigate = useNavigate();
  const { lastTaskUpdate } = useEventsCtx();

  const [tasks, setTasks] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Preview Modal
  const [previewTask, setPreviewTask] = useState<any | null>(null);

  const user = JSON.parse(localStorage.getItem('snapgen_user') || '{}');

  const fetchGalleryData = async (silent: boolean = false) => {
    if (!user.id) return;
    if (!silent) setLoading(true);
    try {
      const params: Record<string, any> = { page, limit: 24 };
      if (filterType === 'video_9_16') {
        params.media_type = 'video';
        params.aspect = '9:16';
      } else if (filterType === 'video_16_9') {
        params.media_type = 'video';
        params.aspect = '16:9';
      } else if (filterType === 'image') {
        params.media_type = 'image';
      }
      if (filterStatus !== 'all') {
        params.status = filterStatus;
      }
      if (searchQuery.trim()) {
        params.q = searchQuery.trim();
      }

      const [statsResult, tasksResult] = await Promise.allSettled([
        api.tasks.getStats(user.id),
        api.tasks.list(params),
      ]);

      if (statsResult.status === 'fulfilled') {
        setStats(statsResult.value);
      }
      if (tasksResult.status === 'fulfilled') {
        const tasksRes = tasksResult.value;
        setTasks(tasksRes.tasks || []);
        setTotalPages(tasksRes.total_pages || 1);
        setTotalCount(tasksRes.total || 0);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGalleryData();
  }, [page, filterType, filterStatus]);

  // Auto-poll every 4s while any task is queued, generating, or downloading
  useEffect(() => {
    const hasPending = tasks.some((t) =>
      ['queued', 'generating', 'downloading'].includes(t.status)
    );
    if (!hasPending) return;
    const timer = setInterval(() => fetchGalleryData(true), 4000);
    return () => clearInterval(timer);
  }, [tasks, page, filterType, filterStatus]);

  useEffect(() => {
    if (lastTaskUpdate) {
      setTasks((prev) => {
        const idx = prev.findIndex((t) => t.task_id === lastTaskUpdate.task_id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...lastTaskUpdate };
          return next;
        }
        return [lastTaskUpdate, ...prev];
      });
    }
  }, [lastTaskUpdate]);

  const toggleSelect = (taskId: string) => {
    setSelectedIds((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    );
  };

  const handleDownloadZip = async () => {
    if (!user.id || selectedIds.length === 0) return;
    try {
      const blob = await api.tasks.downloadZip(user.id, selectedIds);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `snapgen_assets_${selectedIds.length}.zip`;
      a.click();
    } catch (err: any) {
      alert(err.message || 'Gagal mengunduh ZIP');
    }
  };

  const handleReuse = (task: any) => {
    sessionStorage.setItem(
      'snapgen_reuse',
      JSON.stringify({
        prompt: task.prompt,
        model_key: task.model_key,
        options: task.options,
      })
    );
    navigate('/studio');
  };

  const handleDelete = async (taskId: string) => {
    if (!window.confirm('Hapus aset ini dari galeri?')) return;
    try {
      await api.tasks.delete(taskId);
      setTasks((prev) => prev.filter((t) => t.task_id !== taskId));
      setSelectedIds((prev) => prev.filter((id) => id !== taskId));
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="flex-1 flex flex-col space-y-6">
      {/* Statistics Strip (4 cells) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-card p-4 rounded-xl flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#202c31] flex items-center justify-center text-[#9cb080]">
            <Icon name="movie" size={20} />
          </div>
          <div>
            <p className="kicker">TOTAL GENERASI</p>
            <p className="text-xl font-bold font-mono text-white mt-0.5">
              {stats?.total_generations?.toLocaleString('id-ID') || 0}
            </p>
          </div>
        </div>

        <div className="glass-card p-4 rounded-xl flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#202c31] flex items-center justify-center text-[#10b981]">
            <Icon name="today" size={20} />
          </div>
          <div>
            <p className="kicker">OUTPUT HARI INI</p>
            <p className="text-xl font-bold font-mono text-white mt-0.5">
              +{stats?.output_today || 0}
            </p>
          </div>
        </div>

        <div className="glass-card p-4 rounded-xl flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#202c31] flex items-center justify-center text-[#f59e0b]">
            <Icon name="pending_actions" size={20} />
          </div>
          <div>
            <p className="kicker">ANTREAN PIPELINE</p>
            <p className="text-xl font-bold font-mono text-white mt-0.5">
              {stats?.inflight_pipeline || 0} aktif
            </p>
          </div>
        </div>

        <div className="glass-card p-4 rounded-xl flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#202c31] flex items-center justify-center text-[#9ea0fd]">
            <Icon name="verified" size={20} />
          </div>
          <div>
            <p className="kicker">SUCCESS RATE</p>
            <p className="text-xl font-bold font-mono text-white mt-0.5">
              {stats?.success_rate || 100}%
            </p>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 glass-card p-3 rounded-xl">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="glass-input flex items-center gap-2.5 px-3 py-1.5 w-full">
            <Icon name="search" size={15} className="text-zinc-400 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchGalleryData()}
              placeholder="Cari prompt, ID aset, atau model…"
              className="w-full bg-transparent border-0 outline-none text-xs font-mono text-white placeholder-[#8f9286]/70 focus:ring-0"
            />
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1 bg-[#111d22] p-1 rounded-full border border-white/5 text-xs">
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1 rounded-full transition ${
              filterType === 'all' ? 'bg-[#2b373c] text-white font-semibold' : 'text-[#8f9286]'
            }`}
          >
            Semua
          </button>
          <button
            onClick={() => setFilterType('video_9_16')}
            className={`px-3 py-1 rounded-full transition ${
              filterType === 'video_9_16' ? 'bg-[#2b373c] text-white font-semibold' : 'text-[#8f9286]'
            }`}
          >
            Video 9:16
          </button>
          <button
            onClick={() => setFilterType('video_16_9')}
            className={`px-3 py-1 rounded-full transition ${
              filterType === 'video_16_9' ? 'bg-[#2b373c] text-white font-semibold' : 'text-[#8f9286]'
            }`}
          >
            Video 16:9
          </button>
          <button
            onClick={() => setFilterType('image')}
            className={`px-3 py-1 rounded-full transition ${
              filterType === 'image' ? 'bg-[#2b373c] text-white font-semibold' : 'text-[#8f9286]'
            }`}
          >
            Gambar
          </button>
        </div>

        {/* Status Select & Download ZIP Button */}
        <div className="flex items-center gap-2">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="glass-input text-xs py-1.5 px-3 rounded-lg font-mono"
          >
            <option value="all">Status: Semua</option>
            <option value="completed">Selesai</option>
            <option value="generating">Berjalan</option>
            <option value="failed">Gagal</option>
          </select>

          {selectedIds.length > 0 && (
            <button
              onClick={handleDownloadZip}
              className="btn btn-indigo py-1.5 px-3 text-xs rounded-lg flex items-center gap-1.5 shadow"
            >
              <Icon name="download" size={14} />
              <span>Unduh Terpilih ({selectedIds.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* Grid: 6 columns at 1280px */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="glass-card aspect-[9/16] rounded-xl animate-pulse bg-white/5" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <div className="glass-panel p-16 text-center rounded-2xl flex flex-col items-center justify-center text-[#8f9286]">
          <Icon name="photo_library" size={48} className="opacity-30 mb-3" />
          <p className="text-base font-semibold text-white">Belum Ada Hasil</p>
          <p className="text-xs mt-1">Generate video atau gambar pertama kamu di Studio.</p>
          <button
            onClick={() => navigate('/studio')}
            className="btn btn-primary py-2 px-4 rounded-lg mt-4 text-xs font-semibold"
          >
            Buka Studio
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {tasks.map((t) => {
            const isLandscape = t.options?.aspect === '16:9';
            const isSelected = selectedIds.includes(t.task_id);

            return (
              <div
                key={t.task_id}
                className={`glass-panel group relative rounded-xl overflow-hidden border transition flex flex-col justify-between ${
                  isLandscape ? 'col-span-2 aspect-video' : 'aspect-[9/16]'
                } ${
                  isSelected ? 'border-[#9cb080] ring-2 ring-[#9cb080]/30' : 'border-white/10 hover:border-white/30'
                }`}
              >
                {/* Media Preview / State */}
                <div className="absolute inset-0 z-0 bg-[#041014] flex items-center justify-center">
                  {t.result_url ? (
                    t.media_type === 'video' ? (
                      <video
                        src={t.result_url}
                        muted
                        loop
                        onMouseEnter={(e) => e.currentTarget.play()}
                        onMouseLeave={(e) => {
                          e.currentTarget.pause();
                          e.currentTarget.currentTime = 0;
                        }}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <img src={t.result_url} alt="" className="w-full h-full object-cover" />
                    )
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-center p-3">
                      <StatusBadge status={t.status} />
                      {t.status === 'generating' && (
                        <p className="text-xs font-mono text-[#ffd28a]">{t.provider_pct || 1}%</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Top Overlay: Checkbox & Badges */}
                <div className="relative z-10 p-2.5 flex items-start justify-between bg-gradient-to-b from-black/80 via-black/30 to-transparent">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 rounded bg-black/60 text-[9px] font-mono text-white backdrop-blur">
                      {t.options?.aspect || '9:16'}
                    </span>
                    {t.options?.duration && (
                      <span className="px-1.5 py-0.5 rounded bg-black/60 text-[9px] font-mono text-white backdrop-blur">
                        {t.options.duration}s
                      </span>
                    )}
                  </div>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(t.task_id)}
                    className="w-4 h-4 rounded border-white/30 bg-black/50 accent-[#9cb080] cursor-pointer"
                  />
                </div>

                {/* Bottom Overlay: Title, Model, Hover Actions */}
                <div className="relative z-10 p-2.5 bg-gradient-to-t from-black/95 via-black/80 to-transparent flex flex-col gap-1.5">
                  <p className="text-xs font-medium text-white truncate" title={t.prompt}>
                    {t.prompt}
                  </p>
                  <div className="flex items-center justify-between text-[10px] font-mono text-[#8f9286]">
                    <span className="text-[#9cb080] uppercase">{t.model_key}</span>
                    <span className="text-[#ffd28a]">{fmtCredits(t.credit_used || t.credit_cost)}</span>
                  </div>

                  {/* Hover Buttons */}
                  <div className="pt-1 border-t border-white/10 hidden group-hover:flex items-center justify-between text-xs">
                    <button
                      onClick={() => setPreviewTask(t)}
                      className="text-zinc-300 hover:text-white flex items-center gap-0.5"
                    >
                      <Icon name="visibility" size={14} />
                      <span className="text-[10px]">Preview</span>
                    </button>
                    <button
                      onClick={() => handleReuse(t)}
                      className="text-[#9cb080] hover:text-white flex items-center gap-0.5"
                    >
                      <Icon name="replay" size={14} />
                      <span className="text-[10px]">Reuse</span>
                    </button>
                    <button
                      onClick={() => handleDelete(t.task_id)}
                      className="text-[#fb7185] hover:text-red-400"
                    >
                      <Icon name="delete" size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bottom Bar: Retention info & Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-4 py-4 text-xs font-mono text-[#8f9286] border-t border-white/[0.06]">
        <div>
          Menampilkan {tasks.length} dari {totalCount} kreasi • Hasil dihapus otomatis setelah 3 hari
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="btn btn-ghost px-2.5 py-1 text-xs rounded disabled:opacity-30"
          >
            ← Sebelumnya
          </button>
          <span>Halaman {page} dari {totalPages}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="btn btn-ghost px-2.5 py-1 text-xs rounded disabled:opacity-30"
          >
            Berikutnya →
          </button>
        </div>
      </div>

      {/* Preview Modal */}
      {previewTask && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl flex flex-col border border-white/15">
            {/* Modal Header */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <p className="text-xs font-mono text-[#9cb080] uppercase">{previewTask.model_key}</p>
                <p className="text-sm font-semibold text-white truncate max-w-md mt-0.5">{previewTask.prompt}</p>
              </div>
              <button
                onClick={() => setPreviewTask(null)}
                className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 flex items-center justify-center bg-[#041014] min-h-[360px]">
              {previewTask.result_url ? (
                previewTask.media_type === 'video' ? (
                  <video src={previewTask.result_url} controls autoPlay className="max-h-[480px] rounded-lg" />
                ) : (
                  <img src={previewTask.result_url} alt="" className="max-h-[480px] rounded-lg object-contain" />
                )
              ) : (
                <StatusBadge status={previewTask.status} />
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-white/10 flex items-center justify-between text-xs font-mono">
              <span className="text-[#8f9286]">ID: #{previewTask.task_id}</span>
              {previewTask.result_url && (
                <a
                  href={previewTask.result_url}
                  download
                  className="btn btn-indigo py-1.5 px-4 rounded-lg flex items-center gap-1.5"
                >
                  <Icon name="download" size={16} />
                  <span>Unduh File</span>
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
