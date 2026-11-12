import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { api } from '@/lib/api';

type LoginMode = 'login' | 'reset' | 'bootstrap';

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<LoginMode>('login');
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check if system is uninitialized (bootstrap open)
    api.auth.bootstrap()
      .then((res) => {
        if (res.open) {
          setMode('bootstrap');
        }
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'bootstrap') {
        const res = await api.auth.register({ username, name, password });
        localStorage.setItem('snapgen_token', res.token);
        localStorage.setItem('snapgen_media_token', res.media_token);
        localStorage.setItem('snapgen_user', JSON.stringify(res.user));
        navigate('/studio');
      } else if (mode === 'login') {
        const res = await api.auth.login({ username, password });
        localStorage.setItem('snapgen_token', res.token);
        localStorage.setItem('snapgen_media_token', res.media_token);
        localStorage.setItem('snapgen_user', JSON.stringify(res.user));
        navigate('/studio');
      } else if (mode === 'reset') {
        const res = await api.auth.resetPassword({
          username,
          reset_code: resetCode,
          new_password: password,
        });
        localStorage.setItem('snapgen_token', res.token);
        localStorage.setItem('snapgen_media_token', res.media_token);
        navigate('/studio');
      }
    } catch (err: any) {
      setError(err.message || 'Terjadi kesalahan sistem.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#06090b] flex flex-col items-center justify-center p-6 selection:bg-[#9cb080]/30 selection:text-white">
      {/* Brand Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-[#4f46e5] flex items-center justify-center text-white shadow-lg shadow-indigo-500/25">
          <Icon name="movie_filter" size={24} />
        </div>
        <div className="flex items-center gap-2">
          <span className="font-extrabold text-2xl tracking-tight font-['Plus_Jakarta_Sans'] text-white">
            SnapGen
          </span>
          <span className="text-xs uppercase font-bold tracking-widest px-2.5 py-1 rounded bg-white/10 text-[#9cb080] font-mono">
            FLOW
          </span>
        </div>
      </div>

      {/* Login Card */}
      <div className="w-full max-w-[388px] glass-panel p-8">
        <div className="kicker mb-1 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#9cb080]" />
          <span>AKSES STUDIO</span>
        </div>
        <h1 className="text-xl font-bold font-['Plus_Jakarta_Sans'] text-white mb-6">
          {mode === 'login' && 'Masuk'}
          {mode === 'reset' && 'Setel Ulang Password'}
          {mode === 'bootstrap' && 'Buat Akun Admin Pertama'}
        </h1>

        {error && (
          <div className="note-error mb-5 text-xs flex items-center gap-2">
            <Icon name="error" size={16} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="kicker block mb-1.5">USERNAME</label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="nama.pengguna"
              className="w-full glass-input text-sm font-mono"
            />
          </div>

          {mode === 'bootstrap' && (
            <div>
              <label className="kicker block mb-1.5">NAMA TAMPILAN</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Rian W."
                className="w-full glass-input text-sm"
              />
            </div>
          )}

          {mode === 'reset' && (
            <div>
              <label className="kicker block mb-1.5">KODE RESET (DARI ADMIN)</label>
              <input
                type="text"
                required
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value.toUpperCase())}
                placeholder="XXXX-XXXX"
                className="w-full glass-input text-sm font-mono tracking-widest"
              />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="kicker block">
                {mode === 'reset' ? 'PASSWORD BARU' : 'PASSWORD'}
              </label>
              {mode === 'login' && (
                <button
                  type="button"
                  onClick={() => setMode('reset')}
                  className="text-xs text-[#8f9286] hover:text-[#9cb080] transition"
                >
                  Lupa password?
                </button>
              )}
            </div>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full glass-input text-sm pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
              >
                <Icon name={showPassword ? 'visibility_off' : 'visibility'} size={18} />
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full btn btn-indigo py-2.5 mt-2 text-sm font-semibold rounded-lg shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2"
          >
            {loading ? (
              <Icon name="sync" size={18} className="animate-fs-spin" />
            ) : (
              <Icon name="bolt" size={18} />
            )}
            <span>
              {mode === 'login' && 'Masuk'}
              {mode === 'reset' && 'Setel & Masuk'}
              {mode === 'bootstrap' && 'Buat Akun & Masuk'}
            </span>
          </button>
        </form>

        {mode === 'reset' && (
          <div className="mt-5 text-center">
            <button
              onClick={() => setMode('login')}
              className="text-xs text-[#8f9286] hover:text-white flex items-center justify-center gap-1 mx-auto transition"
            >
              <Icon name="arrow_back" size={14} />
              <span>Kembali ke masuk</span>
            </button>
          </div>
        )}
      </div>

      {/* Footer Version info */}
      <div className="mt-8 text-xs text-[#4a5a62] font-mono">
        SnapGen FLOW Studio Engine / v1.6.0
      </div>
    </div>
  );
};
