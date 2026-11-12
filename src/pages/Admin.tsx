import React, { useState, useEffect } from 'react';
import { Icon } from '@/components/ui/Icon';
import { fmtCredits, fmtDuration } from '@/lib/format';
import { api } from '@/lib/api';

type AdminTab = 'overview' | 'divisions' | 'health' | 'audit' | 'accounts' | 'users';

export const Admin: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [overview, setOverview] = useState<any>(null);
  const [divisions, setDivisions] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [resetCode, setResetCode] = useState<string>('');
  const [allModels, setAllModels] = useState<any[]>([]);

  // Selected division for detail panel in Alokasi tab
  const [selectedDiv, setSelectedDiv] = useState<any | null>(null);

  // New account form state
  const [newAccId, setNewAccId] = useState('');
  const [newAccLabel, setNewAccLabel] = useState('');
  const [newAccKey, setNewAccKey] = useState('');
  const [newAccDiv, setNewAccDiv] = useState('kantor_a');

  // New user form state
  const [newUsername, setNewUsername] = useState('');
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('DIVISION_MEMBER');
  const [newUserDiv, setNewUserDiv] = useState('kantor_a');

  const fetchAdminData = async () => {
    try {
      const ov = await api.admin.getOverview();
      setOverview(ov);
      const divs = await api.admin.getDivisions();
      setDivisions(divs.divisions || []);
      if (divs.divisions && divs.divisions.length > 0 && !selectedDiv) {
        setSelectedDiv(divs.divisions[0]);
      }
      const accs = await api.admin.getAccounts();
      setAccounts(accs.accounts || []);
      const us = await api.admin.getUsers();
      setUsers(us.users || []);
      const rc = await api.admin.getResetCode();
      setResetCode(rc.code || '');
      const mList = await api.models.list();
      setAllModels(mList.models || []);
    } catch (err) {
      console.error('Failed to load admin data', err);
    }
  };

  useEffect(() => {
    fetchAdminData();
    const interval = setInterval(fetchAdminData, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleSaveDivisionModels = async () => {
    if (!selectedDiv) return;
    try {
      await api.admin.updateDivisionModels(selectedDiv.id, {
        allowed_models: selectedDiv.allowed_models,
        default_video_model: selectedDiv.default_video_model,
        default_image_model: selectedDiv.default_image_model,
      });
      alert('Model divisi berhasil diperbarui!');
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.admin.createAccount({
        id: newAccId,
        label: newAccLabel,
        api_key: newAccKey,
        division_id: newAccDiv,
        slot: 'primary',
      });
      setNewAccId('');
      setNewAccLabel('');
      setNewAccKey('');
      fetchAdminData();
      alert('Akun snapgen berhasil ditambahkan!');
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.admin.createUser({
        username: newUsername,
        name: newName,
        password: newPassword,
        role: newRole,
        division_id: newUserDiv,
      });
      setNewUsername('');
      setNewName('');
      setNewPassword('');
      fetchAdminData();
      alert('User baru berhasil didaftarkan!');
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRotateResetCode = async () => {
    try {
      const res = await api.admin.rotateResetCode();
      setResetCode(res.code);
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="flex-1 flex flex-col space-y-6">
      {/* Header */}
      <div className="glass-card p-6 rounded-2xl flex flex-wrap items-center justify-between gap-4 border border-white/10">
        <div>
          <span className="kicker">● KONSOL SISTEM & DIVISI / ID: snapgen-prod</span>
          <h1 className="text-2xl font-bold font-['Plus_Jakarta_Sans'] text-white mt-1">
            Admin Panel
          </h1>
          <p className="text-xs text-[#8f9286] mt-0.5">
            Manajemen kuota, akun snapgen, pembatasan model divisi, dan observabilitas sistem.
          </p>
        </div>

        {/* Tab Pills */}
        <div className="flex flex-wrap items-center gap-1 bg-[#111d22] p-1 rounded-full border border-white/5 text-xs font-medium">
          {(
            [
              ['overview', 'Overview'],
              ['divisions', 'Alokasi Divisi'],
              ['health', 'Kesehatan Engine'],
              ['audit', 'Audit Log'],
              ['accounts', 'Akun'],
              ['users', 'Users'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-3 py-1.5 rounded-full transition ${
                activeTab === key ? 'bg-[#2b373c] text-white font-semibold' : 'text-[#8f9286] hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* 4 Stats Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="glass-card p-5 rounded-xl">
              <p className="kicker">TOTAL KREDIT CACHED</p>
              <p className="text-2xl font-bold font-mono text-[#ffd28a] mt-1">
                {fmtCredits(overview?.total_credits || 0)}
              </p>
              <p className="text-xs text-[#8f9286] mt-1 font-mono">Semua akun provider</p>
            </div>
            <div className="glass-card p-5 rounded-xl">
              <p className="kicker">STATUS WORKER</p>
              <p className="text-2xl font-bold font-mono text-[#10b981] mt-1">
                {overview?.active_accounts || 0} / {overview?.total_accounts || 0} Aktif
              </p>
              <p className="text-xs text-[#8f9286] mt-1 font-mono">Kantor A & Kantor B</p>
            </div>
            <div className="glass-card p-5 rounded-xl">
              <p className="kicker">DIVISI & USER</p>
              <p className="text-2xl font-bold font-mono text-white mt-1">
                {overview?.divisions_count || 2} Divisi · {overview?.users_count || 0} User
              </p>
              <p className="text-xs text-[#8f9286] mt-1 font-mono">Anggota terdaftar</p>
            </div>
            <div className="glass-card p-5 rounded-xl">
              <p className="kicker">JOB SIMULTAN IN-FLIGHT</p>
              <p className="text-2xl font-bold font-mono text-[#4f46e5] mt-1">
                {overview?.concurrency || 0} Task
              </p>
              <p className="text-xs text-[#8f9286] mt-1 font-mono">Load pipa saat ini</p>
            </div>
          </div>

          {/* Engine Health Metric */}
          <div className="glass-panel p-6 rounded-2xl">
            <div className="flex items-center justify-between mb-4 border-b border-white/[0.08] pb-3">
              <h3 className="text-sm font-bold text-white">Health Metric Engine</h3>
              <span className="text-xs font-mono text-[#10b981]">● All Systems Active</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {overview?.health_metric?.map((hm: any) => (
                <div key={hm.model_key} className="p-4 rounded-xl bg-[#111d22] border border-white/5 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-white uppercase">{hm.label}</p>
                    <p className="text-[11px] text-[#8f9286] font-mono mt-0.5">
                      Median ≈ {fmtDuration(hm.median_sec)} · {hm.outputs_24h} vids/24j
                    </p>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#10b981]/20 text-[#10b981]">
                    {hm.success_rate}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ALOKASI DIVISI (MODEL RESTRICTIONS PRD §3.4) */}
      {activeTab === 'divisions' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 glass-panel p-6 rounded-2xl">
            <h3 className="text-sm font-bold text-white mb-4">Daftar Unit Divisi</h3>
            <div className="space-y-3">
              {divisions.map((d) => (
                <div
                  key={d.id}
                  onClick={() => setSelectedDiv(d)}
                  className={`p-4 rounded-xl border cursor-pointer transition ${
                    selectedDiv?.id === d.id
                      ? 'bg-[#202c31] border-[#9cb080]'
                      : 'bg-[#111d22] border-white/5 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-white">{d.name}</p>
                      <p className="text-xs text-[#8f9286] font-mono mt-0.5">ID: {d.id}</p>
                    </div>
                    <span className="text-xs font-mono text-[#ffd28a]">
                      {d.allowed_models?.length ? `${d.allowed_models.length} Model Diizinkan` : 'Semua Model'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right Panel: Detail Divisi & Model Restriction */}
          {selectedDiv && (
            <div className="lg:col-span-5 glass-panel p-6 rounded-2xl flex flex-col space-y-4">
              <div className="border-b border-white/[0.08] pb-3">
                <h3 className="text-sm font-bold text-white">Pengaturan Divisi: {selectedDiv.name}</h3>
                <p className="text-xs text-[#8f9286] font-mono mt-0.5">ID: {selectedDiv.id}</p>
              </div>

              <div>
                <label className="kicker block mb-2">MODEL YANG DIIZINKAN (PRD §3.4)</label>
                <div className="space-y-2 max-h-56 overflow-y-auto p-1">
                  {allModels.map((m) => {
                    const isChecked = selectedDiv.allowed_models?.includes(m.key);
                    return (
                      <label
                        key={m.key}
                        className="flex items-center gap-2.5 p-2 rounded-lg bg-[#111d22] text-xs cursor-pointer hover:bg-white/5"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            const cur = selectedDiv.allowed_models || [];
                            const next = e.target.checked
                              ? [...cur, m.key]
                              : cur.filter((k: string) => k !== m.key);
                            setSelectedDiv({ ...selectedDiv, allowed_models: next });
                          }}
                          className="accent-[#9cb080]"
                        />
                        <span className="font-semibold text-white">{m.label}</span>
                        <span className="text-[#8f9286] ml-auto font-mono">{m.credits} KR</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={handleSaveDivisionModels}
                className="btn btn-primary py-2 text-xs font-bold rounded-lg mt-2"
              >
                Simpan Pembatasan Model
              </button>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: AKUN & KEY MANAGEMENT */}
      {activeTab === 'accounts' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 space-y-4">
            <h3 className="text-sm font-bold text-white">Akun SnapGen AI Terpasang</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {accounts.map((acc) => (
                <div key={acc.id} className="glass-card p-5 rounded-xl border border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-white">{acc.label}</p>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#10b981]/20 text-[#10b981] capitalize">
                      {acc.status}
                    </span>
                  </div>
                  <p className="text-xs font-mono text-[#8f9286]">Key: {acc.key_masked}</p>
                  <div className="flex items-center justify-between text-xs font-mono pt-2 border-t border-white/5">
                    <span>Divisi: <strong className="text-white">{acc.division_id}</strong></span>
                    <span className="text-[#ffd28a] font-bold">{fmtCredits(acc.credits)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Tambah Akun Form */}
            <form onSubmit={handleCreateAccount} className="glass-panel p-5 rounded-xl space-y-3 mt-6">
              <h4 className="text-xs font-bold text-white kicker">+ TAMBAH AKUN PROVIDER SNAPGEN</h4>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  placeholder="ID Akun (e.g. key_kantor_a)"
                  value={newAccId}
                  onChange={(e) => setNewAccId(e.target.value)}
                  className="glass-input text-xs"
                />
                <input
                  type="text"
                  required
                  placeholder="Label Akun (e.g. Key Primer Kantor A)"
                  value={newAccLabel}
                  onChange={(e) => setNewAccLabel(e.target.value)}
                  className="glass-input text-xs"
                />
              </div>
              <input
                type="password"
                required
                placeholder="SnapGen API Key"
                value={newAccKey}
                onChange={(e) => setNewAccKey(e.target.value)}
                className="w-full glass-input text-xs font-mono"
              />
              <div className="flex items-center justify-between">
                <select
                  value={newAccDiv}
                  onChange={(e) => setNewAccDiv(e.target.value)}
                  className="glass-input text-xs font-mono"
                >
                  <option value="kantor_a">Kantor A</option>
                  <option value="kantor_b">Kantor B</option>
                </select>
                <button type="submit" className="btn btn-indigo py-1.5 px-4 text-xs font-bold rounded-lg">
                  Simpan Akun
                </button>
              </div>
            </form>
          </div>

          {/* Right Column: Kode Reset Password */}
          <div className="lg:col-span-4 glass-panel p-6 rounded-2xl flex flex-col space-y-4">
            <h3 className="text-sm font-bold text-white">Kode Reset Password Harian</h3>
            <p className="text-xs text-[#8f9286]">
              Kode ini diberikan kepada anggota yang lupa password untuk mereset password mereka.
            </p>
            <div className="p-4 rounded-xl bg-[#111d22] border border-white/10 text-center font-mono text-xl font-bold tracking-widest text-[#9cb080]">
              {resetCode || 'MEMUAT...'}
            </div>
            <button
              onClick={handleRotateResetCode}
              className="btn btn-ghost py-2 text-xs font-mono rounded-lg flex items-center justify-center gap-2"
            >
              <Icon name="refresh" size={16} />
              <span>Putar Kode Baru</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB 6: USERS */}
      {activeTab === 'users' && (
        <div className="space-y-6">
          <div className="glass-panel p-6 rounded-2xl">
            <h3 className="text-sm font-bold text-white mb-4">Anggota Terdaftar</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/[0.08] text-[#8f9286] font-mono kicker">
                    <th className="py-2.5 px-3">USERNAME</th>
                    <th className="py-2.5 px-3">NAMA</th>
                    <th className="py-2.5 px-3">ROLE</th>
                    <th className="py-2.5 px-3">DIVISI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-white/[0.02]">
                      <td className="py-3 px-3 font-mono text-[#9cb080] font-semibold">{u.id}</td>
                      <td className="py-3 px-3 font-medium text-white">{u.name}</td>
                      <td className="py-3 px-3 font-mono">{u.role}</td>
                      <td className="py-3 px-3 font-mono uppercase">{u.division_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Form Tambah User */}
          <form onSubmit={handleCreateUser} className="glass-panel p-6 rounded-2xl space-y-4">
            <h4 className="text-xs font-bold kicker">+ DAFTARKAN USER BARU</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                type="text"
                required
                placeholder="Username (e.g. rina_a)"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="glass-input text-xs font-mono"
              />
              <input
                type="text"
                required
                placeholder="Nama Lengkap"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="glass-input text-xs"
              />
              <input
                type="password"
                required
                placeholder="Password (min 6 karakter)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="glass-input text-xs"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="glass-input text-xs font-mono"
                >
                  <option value="DIVISION_MEMBER">DIVISION_MEMBER</option>
                  <option value="DIVISION_ADMIN">DIVISION_ADMIN</option>
                  <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                </select>
                <select
                  value={newUserDiv}
                  onChange={(e) => setNewUserDiv(e.target.value)}
                  className="glass-input text-xs font-mono"
                >
                  <option value="kantor_a">Kantor A</option>
                  <option value="kantor_b">Kantor B</option>
                </select>
              </div>
              <button type="submit" className="btn btn-primary py-2 px-6 text-xs font-bold rounded-lg">
                Daftarkan User
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 3 & 4: Placeholders for Health & Audit */}
      {(activeTab === 'health' || activeTab === 'audit') && (
        <div className="glass-panel p-12 text-center rounded-2xl text-[#8f9286]">
          <Icon name="terminal" size={40} className="opacity-40 mb-2" />
          <p className="text-sm font-semibold text-white">Live Telemetry & Logs</p>
          <p className="text-xs font-mono mt-1">Buffer 2048 records live stream aktif (WIB)</p>
        </div>
      )}
    </div>
  );
};
