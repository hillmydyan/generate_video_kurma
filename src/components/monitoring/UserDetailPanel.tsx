import React, { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { api } from '@/lib/api';
import { fmtCredits } from '@/lib/format';
import { GenerateList } from './GenerateList';
import {
  Agg,
  EmptyBlock,
  ErrorBlock,
  GenerateItem,
  LoadingBlock,
  MonitoringFilter,
  Pagination,
  UserRow,
  fmtDayShort,
  fmtNum,
  fmtPct,
  filterParams,
  useMonitoringQuery,
  AUTO_REFRESH_MS,
} from './shared';

const DETAIL_PAGE = 50;

interface Harian {
  tanggal: string;
  total: number;
  berhasil: number;
  gagal: number;
}

const DailyChart: React.FC<{ data: Harian[] }> = ({ data }) => {
  const max = Math.max(1, ...data.map((d) => d.berhasil + d.gagal));
  const H = 120;
  const showEvery = data.length > 14 ? Math.ceil(data.length / 7) : 1;
  return (
    <div>
      <div className="flex items-center gap-3 text-[10px] font-mono text-[#8f9286] mb-2">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-[#10b981]" /> Berhasil
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-[#fb7185]" /> Gagal
        </span>
        <span className="ml-auto">maks {fmtNum(max)}/hari</span>
      </div>
      <div className="flex items-end gap-[3px] h-[120px] border-b border-white/10" role="img" aria-label="Grafik generate per hari">
        {data.map((d) => {
          const hOk = (d.berhasil / max) * H;
          const hFail = (d.gagal / max) * H;
          return (
            <div
              key={d.tanggal}
              className="flex-1 min-w-[4px] flex flex-col justify-end group relative"
              title={`${fmtDayShort(d.tanggal)}: ${d.berhasil} berhasil, ${d.gagal} gagal`}
            >
              {d.gagal > 0 && <div className="bg-[#fb7185] rounded-t-sm" style={{ height: hFail }} />}
              {d.berhasil > 0 && (
                <div className={`bg-[#10b981] ${d.gagal > 0 ? '' : 'rounded-t-sm'}`} style={{ height: hOk }} />
              )}
              {d.berhasil + d.gagal === 0 && <div className="bg-white/[0.06] h-[2px]" />}
            </div>
          );
        })}
      </div>
      <div className="flex gap-[3px] mt-1">
        {data.map((d, i) => (
          <span key={d.tanggal} className="flex-1 min-w-[4px] text-[9px] font-mono text-[#8f9286] text-center overflow-visible whitespace-nowrap">
            {i % showEvery === 0 ? fmtDayShort(d.tanggal) : ''}
          </span>
        ))}
      </div>
    </div>
  );
};

interface Props {
  user: UserRow;
  filter: MonitoringFilter;
  kantorNama: (id: string) => string;
  onClose: () => void;
  onPlay: (item: GenerateItem) => void;
}

export const UserDetailPanel: React.FC<Props> = ({ user, filter, kantorNama, onClose, onPlay }) => {
  const [page, setPage] = useState(1);
  const params = filterParams(filter);
  const key = JSON.stringify(params);
  const q = useMonitoringQuery<{
    ringkasan: Agg;
    harian: Harian[];
    riwayat: GenerateItem[];
    riwayat_total: number;
    page: number;
    total_pages: number;
  }>(
    () => api.monitoring.userDetail(user.user_id, { ...params, page: String(page), limit: String(DETAIL_PAGE) }),
    [user.user_id, key, page],
    { refreshMs: AUTO_REFRESH_MS }
  );
  const s = q.data?.ringkasan;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="relative w-full md:max-w-3xl h-full overflow-y-auto bg-[#0c151a] border-l border-white/10 shadow-[0_0_60px_rgba(0,0,0,0.8)]">
        <div className="sticky top-0 z-10 bg-[#0c151a]/95 backdrop-blur border-b border-white/[0.08] px-4 md:px-6 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="kicker">Detail user</span>
            <h2 className="text-lg font-bold text-white font-['Plus_Jakarta_Sans'] truncate">{user.nama}</h2>
            <p className="text-[11px] text-[#8f9286] font-mono">
              {user.user_id} · {kantorNama(user.kantor)} · {user.role}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 shrink-0 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white"
            aria-label="Tutup"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="p-4 md:p-6 space-y-5">
          {q.error && !q.data ? (
            <ErrorBlock message={q.error} onRetry={q.reload} />
          ) : q.loading && !q.data ? (
            <LoadingBlock rows={8} />
          ) : (
            s && (
              <>
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                  {[
                    ['Total', fmtNum(s.total), 'text-white'],
                    ['Berhasil', fmtNum(s.berhasil), 'text-[#10b981]'],
                    ['Gagal', fmtNum(s.gagal), 'text-[#fb7185]'],
                    ['Berjalan', fmtNum(s.berjalan), 'text-[#f59e0b]'],
                    ['% Berhasil', fmtPct(s.pct_berhasil), 'text-white'],
                    ['KR', fmtCredits(s.kr_terpakai), 'text-[#ffd28a]'],
                  ].map(([l, v, c]) => (
                    <div key={l} className="glass-card p-3 rounded-xl">
                      <p className="kicker">{l}</p>
                      <p className={`text-base font-bold font-mono mt-0.5 ${c}`}>{v}</p>
                    </div>
                  ))}
                </div>
                {s.dibatalkan > 0 && (
                  <p className="text-[11px] font-mono text-[#8f9286]">
                    + {fmtNum(s.dibatalkan)} dibatalkan (dihitung terpisah, tidak masuk % berhasil)
                  </p>
                )}

                <div className="glass-panel p-4 rounded-2xl">
                  <h3 className="text-sm font-bold text-white mb-3">Generate per hari</h3>
                  {q.data!.harian.length > 0 ? <DailyChart data={q.data!.harian} /> : <EmptyBlock title="Belum ada data" />}
                </div>

                <div className="glass-panel p-4 rounded-2xl">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-white">Riwayat generate</h3>
                    <span className="text-[11px] font-mono text-[#8f9286]">{fmtNum(q.data!.riwayat_total)} generate</span>
                  </div>
                  {q.data!.riwayat.length === 0 ? (
                    <EmptyBlock title="Belum ada generate" hint="User ini belum generate di periode ini." />
                  ) : (
                    <>
                      <GenerateList items={q.data!.riwayat} onPlay={onPlay} />
                      <Pagination
                        page={q.data!.page}
                        totalPages={q.data!.total_pages}
                        total={q.data!.riwayat_total}
                        pageSize={DETAIL_PAGE}
                        onPage={setPage}
                      />
                    </>
                  )}
                </div>
              </>
            )
          )}
        </div>
      </aside>
    </div>
  );
};
