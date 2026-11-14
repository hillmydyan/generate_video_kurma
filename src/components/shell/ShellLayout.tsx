import React, { useState, useEffect, useRef } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { useNotify } from '@/components/ui/NotificationProvider';
import { useEventsCtx } from '@/lib/useEvents';
import { fmtCredits, initials } from '@/lib/format';
import { api } from '@/lib/api';

export const ShellLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { connState, lastTaskUpdate } = useEventsCtx();
  const { success, error, info, history, clearHistory } = useNotify();
  const [user, setUser] = useState<any>(null);
  const [divisionCredits, setDivisionCredits] = useState<number | null>(null);
  const [refreshingCredits, setRefreshingCredits] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifiedTasksRef = useRef<Record<string, string>>({});

  useEffect(() => {
    const rawUser = localStorage.getItem('snapgen_user');
    if (!rawUser) {
      navigate('/login');
      return;
    }
    try {
      setUser(JSON.parse(rawUser));
    } catch {
      navigate('/login');
    }
  }, [navigate]);

  const fetchCredits = async (refresh: number = 0, manual: boolean = false) => {
    if (!user) return;
    if (refresh === 1) setRefreshingCredits(true);
    try {
      const res = await api.admin.getCredits(refresh);
      if (res.accounts && res.accounts.length > 0) {
        const userDiv = user?.division_id || 'kantor_a';
        const divAccs = res.accounts.filter((a: any) => a.division_id === userDiv);
        const total = divAccs.reduce((sum: number, a: any) => sum + (a.credits || 0), 0);
        setDivisionCredits(total);
        if (manual) {
          info('Saldo Kredit Disinkronkan', `Saldo aktif divisi ${userDiv.toUpperCase()}: ${fmtCredits(total)}`);
        }
      }
    } catch {
      // Silently ignore
    } finally {
      if (refresh === 1) setRefreshingCredits(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchCredits(1);
      const interval = setInterval(() => fetchCredits(0), 15000);
      return () => clearInterval(interval);
    }
  }, [user]);

  // Refresh credits & trigger pop-up notification whenever a task finishes or fails
  useEffect(() => {
    if (user && lastTaskUpdate) {
      fetchCredits(1);
      const tid = lastTaskUpdate.task_id;
      const st = lastTaskUpdate.status;
      if (tid && st && notifiedTasksRef.current[tid] !== st) {
        notifiedTasksRef.current[tid] = st;
        if (st === 'completed') {
          success(
            `Generasi Selesai (#${tid.slice(-6)})`,
            'Video berhasil dirender dan siap ditonton atau diunduh.'
          );
        } else if (st === 'failed') {
          error(
            `Generasi Gagal (#${tid.slice(-6)})`,
            lastTaskUpdate.error || 'Terjadi kendala saat memproses permintaan di provider.'
          );
        }
      }
    }
  }, [lastTaskUpdate]);

  useEffect(() => {
    const onRefresh = () => fetchCredits(1);
    window.addEventListener('snapgen_credits_refresh', onRefresh);
    return () => window.removeEventListener('snapgen_credits_refresh', onRefresh);
  }, [user]);

  const handleLogout = async () => {
    try {
      await api.auth.logout();
    } catch {
      // ignore
    }
    localStorage.removeItem('snapgen_token');
    localStorage.removeItem('snapgen_media_token');
    localStorage.removeItem('snapgen_user');
    navigate('/login');
  };

  if (!user) return null;

  const isAdmin = user.role === 'SUPER_ADMIN' || user.role === 'DIVISION_ADMIN';
  const isStudio = location.pathname === '/studio';

  return (
    <div className={`min-h-screen flex flex-col ${isStudio ? 'bg-[#06090b]' : 'bg-[#09151a]'}`}>
      {/* Navbar 64px */}
      <header className="fixed top-0 left-0 right-0 h-16 bg-[#0b0f17]/90 backdrop-blur-md border-b border-white/[0.08] z-50 px-6 flex items-center justify-between">
        {/* Left: Brand */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#4f46e5] flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
            <Icon name="movie_filter" size={20} />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-lg tracking-tight font-['Plus_Jakarta_Sans'] text-white">
              KurmaFlow
            </span>
          </div>
        </div>

        {/* Center: Navigation Pill */}
        <nav className="flex items-center bg-[#152126] p-1 rounded-full border border-white/[0.06]">
          <NavLink
            to="/studio"
            className={({ isActive }) =>
              `nav-pill ${isActive ? 'nav-pill-active' : ''}`
            }
          >
            Studio
          </NavLink>
          <NavLink
            to="/pabrik"
            className={({ isActive }) =>
              `nav-pill ${isActive ? 'nav-pill-active' : ''}`
            }
          >
            Pabrik
          </NavLink>
          <NavLink
            to="/gallery"
            className={({ isActive }) =>
              `nav-pill ${isActive ? 'nav-pill-active' : ''}`
            }
          >
            Gallery
          </NavLink>
          {isAdmin && (
            <NavLink
              to="/admin"
              end
              className={({ isActive }) =>
                `nav-pill ${isActive ? 'nav-pill-active' : ''}`
              }
            >
              Admin
            </NavLink>
          )}
          {isAdmin && (
            <NavLink
              to="/admin/monitoring"
              className={({ isActive }) =>
                `nav-pill ${isActive ? 'nav-pill-active' : ''}`
              }
            >
              Monitoring
            </NavLink>
          )}
        </nav>

        {/* Right: Status, Credits, Avatar */}
        <div className="flex items-center gap-4">
          {/* SSE Connection Status */}
          <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#111d22] border border-white/[0.06] text-xs font-mono">
            <span
              className={`w-2 h-2 rounded-full ${
                connState === 'online'
                  ? 'bg-[#10b981] animate-pulse'
                  : connState === 'connecting'
                  ? 'bg-[#f59e0b]'
                  : 'bg-[#fb7185]'
              }`}
            />
            <span className="text-zinc-400 capitalize">
              {connState === 'online' ? 'Online' : connState === 'connecting' ? 'Menyambung…' : 'Offline'}
            </span>
          </div>

          {/* Division Credit Chip */}
          <button
            type="button"
            onClick={() => fetchCredits(1, true)}
            title="Klik untuk sinkronisasi saldo kredit terbaru"
            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#111d22] hover:bg-[#1a2a31] border border-[#f59e0b]/30 text-xs font-mono font-semibold text-[#ffd28a] transition cursor-pointer"
          >
            <Icon
              name={refreshingCredits ? 'sync' : 'bolt'}
              size={14}
              className={`text-[#ffd28a] ${refreshingCredits ? 'animate-fs-spin' : ''}`}
            />
            <span>{divisionCredits != null ? fmtCredits(divisionCredits) : '… KR'}</span>
          </button>

          {/* Notification Center Pop-up */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setNotifOpen(!notifOpen);
                setMenuOpen(false);
              }}
              title="Pusat Notifikasi"
              className="relative w-8 h-8 rounded-full bg-[#152126] border border-white/10 flex items-center justify-center text-zinc-300 hover:text-white hover:border-[#9cb080]/50 transition"
            >
              <Icon name="notifications" size={16} />
              {history.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-[#4f46e5] text-[9px] font-mono font-bold text-white flex items-center justify-center">
                  {history.length > 9 ? '9+' : history.length}
                </span>
              )}
            </button>

            {notifOpen && (
              <div
                className="absolute right-0 mt-2 w-80 rounded-2xl bg-[#0c151a]/95 backdrop-blur-2xl border border-white/15 z-50 shadow-[0_20px_50px_rgba(0,0,0,0.85)] overflow-hidden"
                onMouseLeave={() => setNotifOpen(false)}
              >
                <div className="px-4 py-3 border-b border-white/[0.08] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon name="notifications" size={14} className="text-[#9cb080]" />
                    <span className="text-xs font-bold text-white">Notifikasi Sistem</span>
                  </div>
                  {history.length > 0 && (
                    <button
                      type="button"
                      onClick={clearHistory}
                      className="text-[10px] font-mono text-[#8f9286] hover:text-white transition"
                    >
                      Bersihkan
                    </button>
                  )}
                </div>

                <div className="max-h-72 overflow-y-auto divide-y divide-white/[0.06]">
                  {history.length === 0 ? (
                    <div className="py-8 px-4 text-center text-xs text-[#8f9286]">
                      Belum ada notifikasi aktivitas.
                    </div>
                  ) : (
                    history.map((item) => (
                      <div key={item.id} className="p-3 hover:bg-white/[0.03] transition flex items-start gap-2.5">
                        <div
                          className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                            item.type === 'success'
                              ? 'bg-[#10b981]/15 text-[#10b981]'
                              : item.type === 'error'
                              ? 'bg-[#fb7185]/15 text-[#fb7185]'
                              : item.type === 'warning'
                              ? 'bg-[#f59e0b]/15 text-[#ffd28a]'
                              : 'bg-[#4f46e5]/20 text-[#9ea0fd]'
                          }`}
                        >
                          <Icon
                            name={
                              item.type === 'success'
                                ? 'check_circle'
                                : item.type === 'error'
                                ? 'error'
                                : item.type === 'warning'
                                ? 'warning'
                                : 'bolt'
                            }
                            size={13}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-white truncate">{item.title}</p>
                            <span className="text-[9px] font-mono text-[#8f9286] shrink-0">
                              {item.createdAt}
                            </span>
                          </div>
                          {item.message && (
                            <p className="text-[11px] text-[#9fb0b8] mt-0.5 leading-snug break-words">
                              {item.message}
                            </p>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* User Avatar Menu */}
          <div className="relative">
            <button
              onClick={() => {
                setMenuOpen(!menuOpen);
                setNotifOpen(false);
              }}
              className="w-8 h-8 rounded-full bg-[#202c31] border border-white/10 flex items-center justify-center font-bold text-xs text-[#d8e5eb] hover:border-[#9cb080] transition"
            >
              {initials(user.name)}
            </button>

            {menuOpen && (
              <div
                className="absolute right-0 mt-2 w-56 rounded-2xl bg-[#0c151a]/95 backdrop-blur-2xl border border-white/15 py-2 z-50 shadow-[0_20px_50px_rgba(0,0,0,0.85)]"
                onMouseLeave={() => setMenuOpen(false)}
              >
                <div className="px-4 py-2 border-b border-white/[0.08]">
                  <p className="text-sm font-semibold text-white truncate">{user.name}</p>
                  <p className="text-xs text-[#8f9286] font-mono mt-0.5">
                    {user.role} · {user.division_id}
                  </p>
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2 text-sm text-[#fb7185] hover:bg-white/[0.06] flex items-center gap-2 transition"
                >
                  <Icon name="logout" size={16} />
                  <span>Keluar</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Content Container (max-w-1280px, compact for studio) */}
      <main className={`flex-1 mt-16 max-w-[1280px] w-full mx-auto ${isStudio ? 'p-3 sm:p-4' : 'p-6 md:p-8'} flex flex-col`}>
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="h-12 border-t border-white/[0.06] px-8 flex items-center justify-between text-xs text-[#8f9286] font-mono bg-[#0b0f17]/50">
        <div>
          KurmaFlow Studio Engine / v1.6.0
        </div>
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
          <span>Semua sistem aktif (WIB)</span>
        </div>
      </footer>
    </div>
  );
};

