import React, { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { MonitoringFilter, Rentang, Sumber, todayWib } from './shared';

const RENTANG: [Rentang, string][] = [
  ['hari_ini', 'Hari ini'],
  ['7_hari', '7 hari'],
  ['30_hari', '30 hari'],
  ['kustom', 'Kustom'],
];

const SUMBER: [Sumber, string][] = [
  ['', 'Semua'],
  ['studio', 'Studio'],
  ['pabrik', 'Pabrik'],
];

interface Props {
  value: MonitoringFilter;
  onChange: (f: MonitoringFilter) => void;
  kantorOpsi: { id: string; nama: string }[];
  bisaSemuaKantor: boolean;
}

export const FilterBar: React.FC<Props> = ({ value, onChange, kantorOpsi, bisaSemuaKantor }) => {
  const [q, setQ] = useState(value.q);

  // debounce search box
  useEffect(() => {
    if (q === value.q) return;
    const t = setTimeout(() => onChange({ ...value, q }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const set = (patch: Partial<MonitoringFilter>) => onChange({ ...value, ...patch });
  const today = todayWib();

  return (
    <div className="glass-card p-4 rounded-2xl flex flex-col lg:flex-row lg:items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="kicker">Periode (WIB)</span>
        <div className="flex flex-wrap items-center gap-1 bg-[#111d22] p-1 rounded-full border border-white/5 text-xs font-medium w-fit">
          {RENTANG.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() =>
                set(
                  key === 'kustom'
                    ? { rentang: key, mulai: value.mulai || today, sampai: value.sampai || today }
                    : { rentang: key }
                )
              }
              className={`px-3 py-1.5 rounded-full transition ${
                value.rentang === key ? 'bg-[#2b373c] text-white font-semibold' : 'text-[#8f9286] hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {value.rentang === 'kustom' && (
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1.5">
            <span className="kicker">Dari</span>
            <input
              type="date"
              className="glass-input text-xs py-1.5"
              value={value.mulai}
              max={value.sampai || today}
              onChange={(e) => set({ mulai: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="kicker">Sampai</span>
            <input
              type="date"
              className="glass-input text-xs py-1.5"
              value={value.sampai}
              min={value.mulai}
              max={today}
              onChange={(e) => set({ sampai: e.target.value })}
            />
          </label>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 lg:flex lg:items-end">
        <label className="flex flex-col gap-1.5">
          <span className="kicker">Kantor</span>
          <select
            className="glass-input text-xs py-1.5 pr-8"
            value={value.kantor}
            disabled={!bisaSemuaKantor}
            onChange={(e) => set({ kantor: e.target.value })}
          >
            {bisaSemuaKantor && <option value="">Semua kantor</option>}
            {kantorOpsi.map((k) => (
              <option key={k.id} value={k.id}>
                {k.nama}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="kicker">Sumber</span>
          <select
            className="glass-input text-xs py-1.5 pr-8"
            value={value.sumber}
            onChange={(e) => set({ sumber: e.target.value as Sumber })}
          >
            {SUMBER.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1.5 lg:ml-auto lg:w-60">
        <span className="kicker">Cari user</span>
        <div className="relative">
          <Icon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8f9286]" />
          <input
            type="search"
            className="glass-input text-xs py-1.5 pl-8 w-full"
            placeholder="Nama user…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </label>
    </div>
  );
};
