import React from 'react';
import { Icon } from '@/components/ui/Icon';
import { fmtCredits, fmtDuration } from '@/lib/format';
import { GenerateItem, MonStatusBadge, SumberBadge, fmtWib } from './shared';

interface Props {
  items: GenerateItem[];
  showUser?: boolean;
  onPlay: (item: GenerateItem) => void;
}

const Actions: React.FC<{ t: GenerateItem; onPlay: (t: GenerateItem) => void }> = ({ t, onPlay }) => {
  if (t.status === 'berhasil' && t.media_url) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="btn btn-ghost py-1 px-2 text-[11px]"
          onClick={(e) => {
            e.stopPropagation();
            onPlay(t);
          }}
        >
          <Icon name="play_arrow" size={13} />
          Putar
        </button>
        <a
          href={t.media_url}
          download={`${t.task_id}.mp4`}
          onClick={(e) => e.stopPropagation()}
          className="btn btn-indigo py-1 px-2 text-[11px]"
        >
          <Icon name="download" size={13} />
          Unduh
        </a>
      </div>
    );
  }
  if (t.status === 'gagal') {
    return (
      <p className="text-[11px] text-[#fb7185] leading-snug break-words max-w-[260px]">
        {t.alasan_gagal || 'Alasan gagal tidak tercatat.'}
      </p>
    );
  }
  return <span className="text-[11px] text-[#8f9286]">–</span>;
};

/** History list shared by the user detail panel and the "Semua Generate" tab. */
export const GenerateList: React.FC<Props> = ({ items, showUser = false, onPlay }) => (
  <>
    <div className="hidden md:block overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] font-mono uppercase tracking-wider text-[#8f9286]">
            <th className="py-2 px-2">Waktu (WIB)</th>
            {showUser && <th className="py-2 px-2">User</th>}
            <th className="py-2 px-2">Sumber</th>
            <th className="py-2 px-2">Prompt</th>
            <th className="py-2 px-2">Model</th>
            <th className="py-2 px-2">Status</th>
            <th className="py-2 px-2 text-right">KR</th>
            <th className="py-2 px-2 text-right">Lama</th>
            <th className="py-2 px-2">Aksi / Alasan</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.05]">
          {items.map((t) => (
            <tr key={t.task_id} className="align-top hover:bg-white/[0.03]">
              <td className="py-2.5 px-2 font-mono text-[#d8e5eb] whitespace-nowrap">{fmtWib(t.created_at)}</td>
              {showUser && (
                <td className="py-2.5 px-2 whitespace-nowrap">
                  <p className="text-white font-semibold">{t.user_name || t.user_id}</p>
                  <p className="text-[10px] text-[#8f9286] font-mono">{t.kantor}</p>
                </td>
              )}
              <td className="py-2.5 px-2">
                <SumberBadge sumber={t.sumber} />
              </td>
              <td className="py-2.5 px-2 text-[#9fb0b8] max-w-[260px]">
                <p className="line-clamp-2 break-words" title={t.prompt}>
                  {t.prompt}
                </p>
              </td>
              <td className="py-2.5 px-2 font-mono text-[#d8e5eb] whitespace-nowrap">{t.model}</td>
              <td className="py-2.5 px-2">
                <MonStatusBadge status={t.status} />
              </td>
              <td className="py-2.5 px-2 text-right font-mono text-[#ffd28a] whitespace-nowrap">
                {t.status === 'berhasil' ? fmtCredits(t.kr) : '–'}
              </td>
              <td className="py-2.5 px-2 text-right font-mono text-[#d8e5eb] whitespace-nowrap">
                {t.durasi_detik != null ? fmtDuration(t.durasi_detik) : '–'}
              </td>
              <td className="py-2.5 px-2">
                <Actions t={t} onPlay={onPlay} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <div className="md:hidden space-y-2">
      {items.map((t) => (
        <div key={t.task_id} className="p-3 rounded-xl bg-[#111d22] border border-white/5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <SumberBadge sumber={t.sumber} />
              <MonStatusBadge status={t.status} />
            </div>
            <span className="text-[10px] font-mono text-[#8f9286]">{fmtWib(t.created_at)}</span>
          </div>
          {showUser && (
            <p className="text-xs text-white font-semibold">
              {t.user_name || t.user_id} <span className="text-[#8f9286] font-mono font-normal">· {t.kantor}</span>
            </p>
          )}
          <p className="text-xs text-[#9fb0b8] line-clamp-2 break-words">{t.prompt}</p>
          <p className="text-[10px] font-mono text-[#8f9286]">
            {t.model} · {t.status === 'berhasil' ? fmtCredits(t.kr) : '– KR'} ·{' '}
            {t.durasi_detik != null ? fmtDuration(t.durasi_detik) : '–'}
          </p>
          <Actions t={t} onPlay={onPlay} />
        </div>
      ))}
    </div>
  </>
);

export const VideoModal: React.FC<{ item: GenerateItem | null; onClose: () => void }> = ({ item, onClose }) => {
  if (!item || !item.media_url) return null;
  return (
    <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-2xl bg-[#0c151a] border border-white/15 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 border-b border-white/10 flex items-center justify-between gap-2">
          <p className="text-xs font-mono text-[#8f9286] truncate">
            {item.user_name || item.user_id} · #{item.task_id}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="p-3 bg-[#041014] flex items-center justify-center min-h-[280px]">
          {item.media_type === 'image' ? (
            <img src={item.media_url} alt="" className="max-h-[70vh] rounded-lg object-contain" />
          ) : (
            <video src={item.media_url} controls autoPlay className="max-h-[70vh] rounded-lg" />
          )}
        </div>
        <div className="p-3 border-t border-white/10 flex justify-end">
          <a href={item.media_url} download={`${item.task_id}.mp4`} className="btn btn-indigo py-1.5 px-4 text-xs">
            <Icon name="download" size={14} />
            Unduh
          </a>
        </div>
      </div>
    </div>
  );
};
