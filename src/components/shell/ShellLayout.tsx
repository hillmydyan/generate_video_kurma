import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { useEventsCtx } from '@/lib/useEvents';
import { fmtCredits, initials } from '@/lib/format';
import { api } from '@/lib/api';

export const ShellLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { connState } = useEventsCtx();
  const [user, setUser] = useState<any>(null);
  const [divisionCredits, setDivisionCredits] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

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

  useEffect(() => {
    // Poll credits every 60s
    const fetchCredits = async () => {
      try {
        const res = await api.admin.getCredits(0);
        if (res.accounts && res.accounts.length > 0) {
          const userDiv = user?.division_id || 'kantor_a';
          const divAccs = res.accounts.filter((a: any) => a.division_id === userDiv);
          const total = divAccs.reduce((sum: number, a: any) => sum + (a.credits || 0), 0);
          setDivisionCredits(total);
        }
      } catch {
        // Silently ignore for non-admins or offline
      }
    };

    if (user) {
      fetchCredits();
      const interval = setInterval(fetchCredits, 60000);
      return () => clearInterval(interval);
    }
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
              SnapGen
            </span>
            <span className="text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded bg-white/10 text-[#9cb080] font-mono">
              FLOW
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
              className={({ isActive }) =>
                `nav-pill ${isActive ? 'nav-pill-active' : ''}`
              }
            >
              Admin
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
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#111d22] border border-[#f59e0b]/30 text-xs font-mono font-semibold text-[#ffd28a]">
            <Icon name="bolt" size={14} className="text-[#ffd28a]" />
            <span>{fmtCredits(divisionCredits != null ? divisionCredits : 1250)}</span>
          </div>

          {/* User Avatar Menu */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="w-8 h-8 rounded-full bg-[#202c31] border border-white/10 flex items-center justify-center font-bold text-xs text-[#d8e5eb] hover:border-[#9cb080] transition"
            >
              {initials(user.name)}
            </button>

            {menuOpen && (
              <div
                className="absolute right-0 mt-2 w-56 glass-panel py-2 z-50 shadow-2xl"
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

      {/* Content Container (max-w-1280px, padding 32px) */}
      <main className="flex-1 mt-16 max-w-[1280px] w-full mx-auto p-6 md:p-8 flex flex-col">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="h-12 border-t border-white/[0.06] px-8 flex items-center justify-between text-xs text-[#8f9286] font-mono bg-[#0b0f17]/50">
        <div>
          SnapGen FLOW Studio Engine / v1.6.0
        </div>
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
          <span>Semua sistem aktif (WIB)</span>
        </div>
      </footer>
    </div>
  );
};

