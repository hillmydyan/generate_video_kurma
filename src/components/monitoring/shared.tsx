import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { APP_TZ, parseServerDate } from '@/lib/format';

export type Rentang = 'hari_ini' | '7_hari' | '30_hari' | 'kustom';
export type Sumber = '' | 'studio' | 'pabrik';
export type StatusGroup = 'berhasil' | 'gagal' | 'berjalan' | 'dibatalkan';

export interface MonitoringFilter {
  rentang: Rentang;
  mulai: string;
  sampai: string;
  kantor: string;
  sumber: Sumber;
  q: string;
}

export interface Agg {
  total: number;
  berhasil: number;
  gagal: number;
  berjalan: number;
  dibatalkan: number;
  pct_berhasil: number | null;
  kr_terpakai: number;
  terakhir: string | null;
}

export interface UserRow extends Agg {
  user_id: string;
  nama: string;
  kantor: string;
  role: string;
  aktif: boolean;
}

export interface GenerateItem {
  task_id: string;
  user_id: string;
  user_name: string | null;
  kantor: string | null;
  sumber: 'studio' | 'pabrik';
  batch_id: string | null;
  prompt: string;
  model: string;
  media_type: string;
  status: StatusGroup;
  raw_status: string;
  kr: number;
  durasi_detik: number | null;
  created_at: string | null;
  finished_at: string | null;
  media_url: string | null;
  alasan_gagal: string | null;
}

export const AUTO_REFRESH_MS = 30000;
export const PAGE_SIZE = 20;
export const FAIL_WARN_PCT = 30;

export function filterParams(f: MonitoringFilter): Record<string, string> {
  const p: Record<string, string> = { rentang: f.rentang };
  if (f.rentang === 'kustom') {
    if (f.mulai) p.mulai = f.mulai;
    if (f.sampai) p.sampai = f.sampai;
  }
  if (f.kantor) p.kantor = f.kantor;
  if (f.sumber) p.sumber = f.sumber;
  if (f.q.trim()) p.q = f.q.trim();
  return p;
}

/** Gagal share for the warning colour: gagal / (berhasil + gagal). */
export function failPct(a: Pick<Agg, 'berhasil' | 'gagal'>): number | null {
  const d = a.berhasil + a.gagal;
  return d > 0 ? (100 * a.gagal) / d : null;
}

export function fmtPct(v: number | null | undefined): string {
  return v == null ? '–' : `${v.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
}

export function fmtNum(v: number | null | undefined): string {
  return (v ?? 0).toLocaleString('id-ID');
}

export function fmtWib(s: string | null | undefined, withYear = false): string {
  const d = parseServerDate(s ?? null);
  if (!d) return '–';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: APP_TZ,
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

export function fmtDayShort(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d))
  );
}

export function todayWib(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ }).format(new Date());
}

export const STATUS_LABEL: Record<StatusGroup, string> = {
  berhasil: 'Berhasil',
  gagal: 'Gagal',
  berjalan: 'Berjalan',
  dibatalkan: 'Dibatalkan',
};

const STATUS_CLASS: Record<StatusGroup, string> = {
  berhasil: 'badge-completed',
  gagal: 'badge-failed',
  berjalan: 'badge-generating',
  dibatalkan: 'badge-queued',
};

export const MonStatusBadge: React.FC<{ status: StatusGroup }> = ({ status }) => (
  <span
    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${STATUS_CLASS[status]}`}
  >
    {STATUS_LABEL[status]}
  </span>
);

export const SumberBadge: React.FC<{ sumber: 'studio' | 'pabrik' }> = ({ sumber }) => (
  <span
    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
      sumber === 'pabrik' ? 'bg-[#4f46e5]/20 text-[#9ea0fd]' : 'bg-[#9cb080]/15 text-[#b9ce9b]'
    }`}
  >
    <Icon name={sumber === 'pabrik' ? 'factory' : 'movie'} size={11} />
    {sumber === 'pabrik' ? 'Pabrik' : 'Studio'}
  </span>
);

export const LoadingBlock: React.FC<{ rows?: number; className?: string }> = ({ rows = 4, className = '' }) => (
  <div className={`space-y-2 ${className}`} aria-busy="true">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="h-9 rounded-lg bg-white/[0.04] animate-pulse" />
    ))}
  </div>
);

export const EmptyBlock: React.FC<{ title: string; hint?: string }> = ({ title, hint }) => (
  <div className="py-10 px-4 text-center">
    <div className="w-10 h-10 mx-auto rounded-full bg-white/[0.05] flex items-center justify-center text-[#8f9286]">
      <Icon name="search" size={18} />
    </div>
    <p className="text-sm font-semibold text-white mt-3">{title}</p>
    {hint && <p className="text-xs text-[#8f9286] mt-1">{hint}</p>}
  </div>
);

export const ErrorBlock: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => (
  <div className="py-8 px-4 text-center rounded-xl border border-[#fb7185]/25 bg-[#fb7185]/[0.06]">
    <div className="w-10 h-10 mx-auto rounded-full bg-[#fb7185]/15 flex items-center justify-center text-[#fb7185]">
      <Icon name="error" size={18} />
    </div>
    <p className="text-sm font-semibold text-white mt-3">Gagal memuat data</p>
    <p className="text-xs text-[#9fb0b8] mt-1 break-words">{message}</p>
    <button type="button" onClick={onRetry} className="btn btn-ghost mt-4 text-xs py-1.5 px-3">
      <Icon name="refresh" size={14} />
      Coba lagi
    </button>
  </div>
);

/**
 * Small fetch hook: loading/error/data, manual reload, optional auto-refresh.
 * Background refreshes keep old data on screen (no flashing skeletons).
 */
export function useMonitoringQuery<T>(
  fetcher: () => Promise<T>,
  deps: React.DependencyList,
  opts: { enabled?: boolean; refreshMs?: number } = {}
) {
  const { enabled = true, refreshMs } = opts;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const reqId = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async (background: boolean) => {
    const id = ++reqId.current;
    if (!background) {
      setLoading(true);
      setError(null);
    }
    try {
      const res = await fetcherRef.current();
      if (id === reqId.current) {
        setData(res);
        setError(null);
      }
    } catch (e: any) {
      if (id === reqId.current && !background) setError(e?.message || 'Terjadi kesalahan.');
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setData(null);
    run(false);
    if (!refreshMs) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') run(true);
    }, refreshMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, refreshMs, ...deps]);

  return { data, error, loading, reload: () => run(false), refresh: () => run(true) };
}

export const Pagination: React.FC<{
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
}> = ({ page, totalPages, total, pageSize, onPage }) => {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between gap-3 pt-3 text-xs text-[#8f9286] font-mono">
      <span>
        {fmtNum(from)}–{fmtNum(to)} dari {fmtNum(total)}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="btn btn-ghost py-1 px-2.5 text-xs"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          ‹ Sebelumnya
        </button>
        <span className="px-2 text-white">
          {page}/{totalPages}
        </span>
        <button
          type="button"
          className="btn btn-ghost py-1 px-2.5 text-xs"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Berikutnya ›
        </button>
      </div>
    </div>
  );
};
