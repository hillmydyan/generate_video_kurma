import React from 'react';
import { fmtCredits } from '@/lib/format';
import { Agg, FAIL_WARN_PCT, failPct, fmtNum, fmtPct } from './shared';

export const SummaryCards: React.FC<{ data: Agg | null; loading: boolean }> = ({ data, loading }) => {
  const fp = data ? failPct(data) : null;
  const cards = [
    {
      label: 'Total generate',
      value: fmtNum(data?.total),
      sub: data?.dibatalkan ? `${fmtNum(data.dibatalkan)} dibatalkan (terpisah)` : '1 video = 1 generate',
      color: 'text-white',
    },
    {
      label: 'Berhasil',
      value: fmtNum(data?.berhasil),
      sub: `${fmtPct(data?.pct_berhasil)} berhasil`,
      color: 'text-[#10b981]',
    },
    {
      label: 'Gagal',
      value: fmtNum(data?.gagal),
      sub: fp == null ? 'Belum ada yang selesai' : `${fmtPct(Math.round(fp * 10) / 10)} dari selesai`,
      color: fp != null && fp > FAIL_WARN_PCT ? 'text-[#fb7185]' : 'text-[#fda4af]',
    },
    {
      label: 'Sedang berjalan',
      value: fmtNum(data?.berjalan),
      sub: 'Antre + diproses',
      color: 'text-[#f59e0b]',
    },
    {
      label: 'KR terpakai',
      value: fmtCredits(data?.kr_terpakai ?? 0),
      sub: 'Dari generate berhasil',
      color: 'text-[#ffd28a]',
    },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
      {cards.map((c, i) => (
        <div key={c.label} className={`glass-card p-4 rounded-xl ${i === 0 ? 'col-span-2 md:col-span-1' : ''}`}>
          <p className="kicker">{c.label}</p>
          {loading && !data ? (
            <div className="h-7 w-20 mt-2 rounded bg-white/[0.06] animate-pulse" />
          ) : (
            <p className={`text-2xl font-bold font-mono mt-1 ${c.color}`}>{c.value}</p>
          )}
          <p className="text-[11px] text-[#8f9286] mt-1 font-mono truncate">{c.sub}</p>
        </div>
      ))}
    </div>
  );
};
