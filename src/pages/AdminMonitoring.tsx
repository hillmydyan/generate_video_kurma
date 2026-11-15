import React, { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { useNotify } from '@/components/ui/NotificationProvider';
import { api } from '@/lib/api';
import { FilterBar } from '@/components/monitoring/FilterBar';
import { SummaryCards } from '@/components/monitoring/SummaryCards';
import { SortKey, UserTable } from '@/components/monitoring/UserTable';
import { GenerateList, VideoModal } from '@/components/monitoring/GenerateList';
import { UserDetailPanel } from '@/components/monitoring/UserDetailPanel';
import {
  AUTO_REFRESH_MS,
  Agg,
  EmptyBlock,
  ErrorBlock,
  GenerateItem,
  LoadingBlock,
  MonitoringFilter,
  PAGE_SIZE,
  Pagination,
  StatusGroup,
  UserRow,
  filterParams,
  fmtWib,
  useMonitoringQuery,
} from '@/components/monitoring/shared';

type Tab = 'users' | 'semua';

const STATUS_TABS: [StatusGroup | '', string][] = [
  ['', 'Semua status'],
  ['berhasil', 'Berhasil'],
  ['gagal', 'Gagal'],
  ['berjalan', 'Berjalan'],
  ['dibatalkan', 'Dibatalkan'],
];

function readUser(): any | null {
  try {
    return JSON.parse(localStorage.getItem('snapgen_user') || 'null');
  } catch {
    return null;
  }
}

export const AdminMonitoring: React.FC = () => {
  const me = readUser();
  const isAdmin = me && (me.role === 'SUPER_ADMIN' || me.role === 'DIVISION_ADMIN');
  const isSuper = me?.role === 'SUPER_ADMIN';
  const { error: notifyError, success } = useNotify();

  const [filter, setFilter] = useState<MonitoringFilter>({
    rentang: 'hari_ini',
    mulai: '',
    sampai: '',
    kantor: isSuper ? '' : me?.division_id || '',
    sumber: '',
    q: '',
  });
  const [tab, setTab] = useState<Tab>('users');
  const [sort, setSort] = useState<SortKey>('total');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [userPage, setUserPage] = useState(1);
  const [genPage, setGenPage] = useState(1);
  const [genStatus, setGenStatus] = useState<StatusGroup | ''>('');
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [playing, setPlaying] = useState<GenerateItem | null>(null);
  const [exporting, setExporting] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const params = filterParams(filter);
  const key = JSON.stringify(params);

  // reset paging when filters change
  useEffect(() => {
    setUserPage(1);
    setGenPage(1);
  }, [key]);

  const ringkasan = useMonitoringQuery<{
    ringkasan: Agg;
    kantor_opsi: { id: string; nama: string }[];
    bisa_semua_kantor: boolean;
    diperbarui: string;
  }>(() => api.monitoring.ringkasan(params), [key], { enabled: !!isAdmin, refreshMs: AUTO_REFRESH_MS });

  const users = useMonitoringQuery<{ items: UserRow[]; total: number; page: number; total_pages: number }>(
    () => api.monitoring.users({ ...params, sort, order, page: String(userPage), limit: String(PAGE_SIZE) }),
    [key, sort, order, userPage],
    { enabled: !!isAdmin && tab === 'users', refreshMs: AUTO_REFRESH_MS }
  );

  const semua = useMonitoringQuery<{ items: GenerateItem[]; total: number; page: number; total_pages: number }>(
    () =>
      api.monitoring.generate({
        ...params,
        ...(genStatus ? { status: genStatus } : {}),
        page: String(genPage),
        limit: String(PAGE_SIZE),
      }),
    [key, genStatus, genPage],
    { enabled: !!isAdmin && tab === 'semua', refreshMs: AUTO_REFRESH_MS }
  );

  useEffect(() => {
    if (ringkasan.data?.diperbarui) setLastUpdated(ringkasan.data.diperbarui);
  }, [ringkasan.data]);

  const kantorOpsi = ringkasan.data?.kantor_opsi ?? [];
  const kantorNama = useCallback(
    (id: string) => kantorOpsi.find((k) => k.id === id)?.nama || id,
    [kantorOpsi]
  );

  if (!isAdmin) return <Navigate to="/studio" replace />;

  const onSort = (k: SortKey) => {
    if (k === sort) setOrder(order === 'desc' ? 'asc' : 'desc');
    else {
      setSort(k);
      setOrder(k === 'nama' || k === 'kantor' ? 'asc' : 'desc');
    }
    setUserPage(1);
  };

  const refreshAll = () => {
    ringkasan.reload();
    if (tab === 'users') users.reload();
    else semua.reload();
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await api.monitoring.usersCsv({ ...params, sort, order });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `monitoring_users_${filter.rentang}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      success('Ekspor CSV', 'File CSV per user berhasil dibuat.');
    } catch (e: any) {
      notifyError('Gagal ekspor CSV', e.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="glass-card p-5 md:p-6 rounded-2xl flex flex-wrap items-center justify-between gap-4 border border-white/10">
        <div>
          <span className="kicker flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#9cb080]" />
            <span>ADMIN / MONITORING GENERATE</span>
          </span>
          <h1 className="text-2xl font-bold font-['Plus_Jakarta_Sans'] text-white mt-1">Monitoring</h1>
          <p className="text-xs text-[#8f9286] mt-0.5">
            Pemakaian generate Studio &amp; Pabrik per user.{' '}
            {isSuper ? 'Semua kantor.' : `Kantor ${me?.division_id}.`}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-mono text-[#8f9286]">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
            Auto-refresh 30 dtk · {lastUpdated ? fmtWib(lastUpdated) : '…'}
          </span>
          <button type="button" className="btn btn-ghost py-1 px-2.5 text-xs" onClick={refreshAll} title="Muat ulang">
            <Icon name="refresh" size={14} />
          </button>
        </div>
      </div>

      <FilterBar
        value={filter}
        onChange={setFilter}
        kantorOpsi={kantorOpsi}
        bisaSemuaKantor={ringkasan.data?.bisa_semua_kantor ?? isSuper}
      />

      {ringkasan.error && !ringkasan.data ? (
        <ErrorBlock message={ringkasan.error} onRetry={ringkasan.reload} />
      ) : (
        <SummaryCards data={ringkasan.data?.ringkasan ?? null} loading={ringkasan.loading} />
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-[#111d22] p-1 rounded-full border border-white/5 text-xs font-medium w-fit">
        {(
          [
            ['users', 'Per User'],
            ['semua', 'Semua Generate'],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`px-4 py-1.5 rounded-full transition ${
              tab === k ? 'bg-[#2b373c] text-white font-semibold' : 'text-[#8f9286] hover:text-white'
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === 'users' ? (
        <UserTable
          data={users.data}
          loading={users.loading}
          error={users.error}
          onRetry={users.reload}
          sort={sort}
          order={order}
          onSort={onSort}
          onPage={setUserPage}
          onSelect={setSelected}
          onExport={exportCsv}
          exporting={exporting}
          kantorNama={kantorNama}
        />
      ) : (
        <div className="glass-panel p-4 md:p-5 rounded-2xl">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3 border-b border-white/[0.08] pb-3">
            <div>
              <h3 className="text-sm font-bold text-white">Semua Generate</h3>
              <p className="text-[11px] text-[#8f9286] font-mono mt-0.5">Riwayat semua user, terbaru di atas</p>
            </div>
            <div className="flex flex-wrap gap-1">
              {STATUS_TABS.map(([k, l]) => (
                <button
                  key={k || 'all'}
                  type="button"
                  onClick={() => {
                    setGenStatus(k);
                    setGenPage(1);
                  }}
                  className={`px-2.5 py-1 rounded-full text-[11px] border transition ${
                    genStatus === k
                      ? 'bg-[#2b373c] border-white/20 text-white font-semibold'
                      : 'border-white/5 text-[#8f9286] hover:text-white'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          {semua.error && !semua.data ? (
            <ErrorBlock message={semua.error} onRetry={semua.reload} />
          ) : semua.loading && !semua.data ? (
            <LoadingBlock rows={6} />
          ) : !semua.data || semua.data.items.length === 0 ? (
            <EmptyBlock title="Belum ada generate" hint="Tidak ada generate untuk filter ini." />
          ) : (
            <>
              <GenerateList items={semua.data.items} showUser onPlay={setPlaying} />
              <Pagination
                page={semua.data.page}
                totalPages={semua.data.total_pages}
                total={semua.data.total}
                pageSize={PAGE_SIZE}
                onPage={setGenPage}
              />
            </>
          )}
        </div>
      )}

      {selected && (
        <UserDetailPanel
          user={selected}
          filter={filter}
          kantorNama={kantorNama}
          onClose={() => setSelected(null)}
          onPlay={setPlaying}
        />
      )}
      <VideoModal item={playing} onClose={() => setPlaying(null)} />
    </div>
  );
};

export default AdminMonitoring;
