import React from 'react';
import { Icon } from '@/components/ui/Icon';
import { fmtCredits } from '@/lib/format';
import {
  EmptyBlock,
  ErrorBlock,
  FAIL_WARN_PCT,
  LoadingBlock,
  PAGE_SIZE,
  Pagination,
  UserRow,
  failPct,
  fmtNum,
  fmtPct,
  fmtWib,
} from './shared';

export type SortKey = 'nama' | 'kantor' | 'total' | 'berhasil' | 'gagal' | 'berjalan' | 'pct' | 'kr' | 'terakhir';

const COLS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'nama', label: 'Nama' },
  { key: 'kantor', label: 'Kantor' },
  { key: 'total', label: 'Total', align: 'right' },
  { key: 'berhasil', label: 'Berhasil', align: 'right' },
  { key: 'gagal', label: 'Gagal', align: 'right' },
  { key: 'berjalan', label: 'Berjalan', align: 'right' },
  { key: 'pct', label: '% Berhasil', align: 'right' },
  { key: 'kr', label: 'KR terpakai', align: 'right' },
  { key: 'terakhir', label: 'Generate terakhir' },
];

interface Props {
  data: { items: UserRow[]; total: number; page: number; total_pages: number } | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  sort: SortKey;
  order: 'asc' | 'desc';
  onSort: (k: SortKey) => void;
  onPage: (p: number) => void;
  onSelect: (u: UserRow) => void;
  onExport: () => void;
  exporting: boolean;
  kantorNama: (id: string) => string;
}

const isWarn = (u: UserRow) => {
  const fp = failPct(u);
  return fp != null && fp > FAIL_WARN_PCT;
};

export const UserTable: React.FC<Props> = ({
  data,
  loading,
  error,
  onRetry,
  sort,
  order,
  onSort,
  onPage,
  onSelect,
  onExport,
  exporting,
  kantorNama,
}) => {
  const items = data?.items ?? [];
  return (
    <div className="glass-panel p-4 md:p-5 rounded-2xl">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 border-b border-white/[0.08] pb-3">
        <div>
          <h3 className="text-sm font-bold text-white">Per User</h3>
          <p className="text-[11px] text-[#8f9286] font-mono mt-0.5">
            Klik baris untuk detail · gagal &gt; {FAIL_WARN_PCT}% ditandai merah
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="glass-input text-xs py-1.5 md:hidden"
            value={`${sort}:${order}`}
            onChange={(e) => {
              const [k] = e.target.value.split(':');
              onSort(k as SortKey);
            }}
          >
            {COLS.map((c) => (
              <option key={c.key} value={`${c.key}:${sort === c.key ? order : 'desc'}`}>
                Urut: {c.label}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-ghost text-xs py-1.5 px-3" onClick={onExport} disabled={exporting}>
            <Icon name={exporting ? 'sync' : 'download'} size={14} className={exporting ? 'animate-fs-spin' : ''} />
            Ekspor CSV
          </button>
        </div>
      </div>

      {error && !data ? (
        <ErrorBlock message={error} onRetry={onRetry} />
      ) : loading && !data ? (
        <LoadingBlock rows={6} />
      ) : items.length === 0 ? (
        <EmptyBlock title="Tidak ada user" hint="Coba ubah filter kantor atau kata pencarian." />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[#8f9286] text-left">
                  {COLS.map((c) => (
                    <th
                      key={c.key}
                      className={`py-2 px-2 font-mono font-semibold uppercase tracking-wider text-[10px] whitespace-nowrap select-none cursor-pointer hover:text-white ${
                        c.align === 'right' ? 'text-right' : ''
                      }`}
                      onClick={() => onSort(c.key)}
                    >
                      {c.label}
                      {sort === c.key && <span className="ml-1 text-[#9cb080]">{order === 'desc' ? '↓' : '↑'}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {items.map((u) => {
                  const warn = isWarn(u);
                  return (
                    <tr
                      key={u.user_id}
                      onClick={() => onSelect(u)}
                      className={`cursor-pointer transition hover:bg-white/[0.04] ${warn ? 'bg-[#fb7185]/[0.05]' : ''}`}
                    >
                      <td className="py-2.5 px-2">
                        <p className="font-semibold text-white">{u.nama}</p>
                        <p className="text-[10px] text-[#8f9286] font-mono">{u.user_id}</p>
                      </td>
                      <td className="py-2.5 px-2 text-[#d8e5eb] whitespace-nowrap">{kantorNama(u.kantor)}</td>
                      <td className="py-2.5 px-2 text-right font-mono font-bold text-white">{fmtNum(u.total)}</td>
                      <td className="py-2.5 px-2 text-right font-mono text-[#10b981]">{fmtNum(u.berhasil)}</td>
                      <td className={`py-2.5 px-2 text-right font-mono ${warn ? 'text-[#fb7185] font-bold' : 'text-[#d8e5eb]'}`}>
                        {warn && <Icon name="warning" size={12} className="inline mr-1 -mt-0.5" />}
                        {fmtNum(u.gagal)}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-[#f59e0b]">{fmtNum(u.berjalan)}</td>
                      <td className={`py-2.5 px-2 text-right font-mono ${warn ? 'text-[#fb7185]' : 'text-[#d8e5eb]'}`}>
                        {fmtPct(u.pct_berhasil)}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-[#ffd28a] whitespace-nowrap">
                        {fmtCredits(u.kr_terpakai)}
                      </td>
                      <td className="py-2.5 px-2 font-mono text-[#8f9286] whitespace-nowrap">{fmtWib(u.terakhir)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {items.map((u) => {
              const warn = isWarn(u);
              return (
                <button
                  key={u.user_id}
                  type="button"
                  onClick={() => onSelect(u)}
                  className={`w-full text-left p-3 rounded-xl border transition ${
                    warn ? 'bg-[#fb7185]/[0.06] border-[#fb7185]/30' : 'bg-[#111d22] border-white/5'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{u.nama}</p>
                      <p className="text-[10px] text-[#8f9286] font-mono">
                        {kantorNama(u.kantor)} · {fmtWib(u.terakhir)}
                      </p>
                    </div>
                    <span className="text-lg font-bold font-mono text-white">{fmtNum(u.total)}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-1 mt-2 text-[11px] font-mono">
                    <span className="text-[#10b981]">✓ {fmtNum(u.berhasil)}</span>
                    <span className={warn ? 'text-[#fb7185] font-bold' : 'text-[#d8e5eb]'}>✗ {fmtNum(u.gagal)}</span>
                    <span className="text-[#f59e0b]">⟳ {fmtNum(u.berjalan)}</span>
                    <span className="text-right text-[#ffd28a]">{fmtCredits(u.kr_terpakai)}</span>
                  </div>
                  <p className={`text-[10px] font-mono mt-1 ${warn ? 'text-[#fb7185]' : 'text-[#8f9286]'}`}>
                    {fmtPct(u.pct_berhasil)} berhasil
                  </p>
                </button>
              );
            })}
          </div>

          <Pagination
            page={data!.page}
            totalPages={data!.total_pages}
            total={data!.total}
            pageSize={PAGE_SIZE}
            onPage={onPage}
          />
        </>
      )}
    </div>
  );
};
