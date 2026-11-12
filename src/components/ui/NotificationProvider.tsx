import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { Icon } from '@/components/ui/Icon';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  createdAt: string;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface PromptOptions {
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface NotificationContextValue {
  notify: (opts: {
    type?: ToastType;
    title: string;
    message?: string;
    duration?: number;
  }) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
  history: ToastItem[];
  clearHistory: () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export const useNotify = (): NotificationContextValue => {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error('useNotify must be used within NotificationProvider');
  }
  return ctx;
};

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [history, setHistory] = useState<ToastItem[]>([]);

  // Confirm modal state
  const [confirmState, setConfirmState] = useState<{
    opts: ConfirmOptions;
    resolve: (val: boolean) => void;
  } | null>(null);

  // Prompt modal state
  const [promptState, setPromptState] = useState<{
    opts: PromptOptions;
    resolve: (val: string | null) => void;
  } | null>(null);
  const [promptValue, setPromptValue] = useState('');

  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const dismissToast = useCallback((id: string) => {
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    ({
      type = 'info',
      title,
      message,
      duration = 4500,
    }: {
      type?: ToastType;
      title: string;
      message?: string;
      duration?: number;
    }) => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const nowTime = new Date().toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const item: ToastItem = {
        id,
        type,
        title,
        message,
        duration,
        createdAt: nowTime,
      };

      setToasts((prev) => [item, ...prev].slice(0, 4));
      setHistory((prev) => [item, ...prev].slice(0, 25));

      if (duration > 0) {
        timersRef.current[id] = setTimeout(() => {
          dismissToast(id);
        }, duration);
      }
    },
    [dismissToast]
  );

  const success = useCallback(
    (title: string, message?: string) => notify({ type: 'success', title, message }),
    [notify]
  );
  const error = useCallback(
    (title: string, message?: string) => notify({ type: 'error', title, message, duration: 6000 }),
    [notify]
  );
  const info = useCallback(
    (title: string, message?: string) => notify({ type: 'info', title, message }),
    [notify]
  );
  const warning = useCallback(
    (title: string, message?: string) => notify({ type: 'warning', title, message, duration: 5000 }),
    [notify]
  );

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({ opts, resolve });
    });
  }, []);

  const prompt = useCallback((opts: PromptOptions): Promise<string | null> => {
    setPromptValue(opts.defaultValue || '');
    return new Promise((resolve) => {
      setPromptState({ opts, resolve });
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  const getTypeStyle = (type: ToastType) => {
    switch (type) {
      case 'success':
        return {
          icon: 'check_circle',
          accent: 'border-[#10b981]/40',
          iconBg: 'bg-[#10b981]/15 text-[#10b981]',
          bar: 'bg-[#10b981]',
          badge: 'BERHASIL',
          badgeColor: 'text-[#10b981]',
        };
      case 'error':
        return {
          icon: 'error',
          accent: 'border-[#fb7185]/40',
          iconBg: 'bg-[#fb7185]/15 text-[#fb7185]',
          bar: 'bg-[#fb7185]',
          badge: 'ERROR',
          badgeColor: 'text-[#fb7185]',
        };
      case 'warning':
        return {
          icon: 'warning',
          accent: 'border-[#f59e0b]/40',
          iconBg: 'bg-[#f59e0b]/15 text-[#ffd28a]',
          bar: 'bg-[#f59e0b]',
          badge: 'PERHATIAN',
          badgeColor: 'text-[#ffd28a]',
        };
      default:
        return {
          icon: 'bolt',
          accent: 'border-[#9ea0fd]/40',
          iconBg: 'bg-[#4f46e5]/20 text-[#9ea0fd]',
          bar: 'bg-[#5d56e9]',
          badge: 'INFO SISTEM',
          badgeColor: 'text-[#9ea0fd]',
        };
    }
  };

  return (
    <NotificationContext.Provider
      value={{
        notify,
        success,
        error,
        info,
        warning,
        confirm,
        prompt,
        history,
        clearHistory,
      }}
    >
      {children}

      {/* Floating Pop-Up Toast Stack (Top-Right below Navbar) */}
      <div className="fixed top-20 right-4 sm:right-6 z-[100] flex flex-col gap-2.5 w-full max-w-[360px] pointer-events-none">
        {toasts.map((t) => {
          const st = getTypeStyle(t.type);
          return (
            <div
              key={t.id}
              className={`pointer-events-auto relative overflow-hidden rounded-2xl bg-[#0b1419]/95 backdrop-blur-2xl border ${st.accent} shadow-[0_14px_44px_rgba(0,0,0,0.85)] p-3.5 transition-all duration-300`}
            >
              {/* Top subtle accent line */}
              <div className={`absolute top-0 left-0 right-0 h-[2px] ${st.bar} opacity-80`} />

              <div className="flex items-start gap-3">
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${st.iconBg}`}
                >
                  <Icon name={st.icon} size={17} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[9px] font-mono font-bold tracking-wider ${st.badgeColor}`}>
                      {st.badge} · {t.createdAt}
                    </span>
                  </div>
                  <p className="text-xs font-bold text-white mt-0.5 leading-snug">{t.title}</p>
                  {t.message && (
                    <p className="text-[11px] text-[#9fb0b8] mt-1 leading-relaxed break-words">
                      {t.message}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => dismissToast(t.id)}
                  className="w-6 h-6 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white shrink-0 transition"
                  title="Tutup"
                >
                  <Icon name="close" size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Custom Glassmorphic Confirm Modal Pop-up */}
      {confirmState && (
        <div
          className="fixed inset-0 z-[110] bg-black/75 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => {
            confirmState.resolve(false);
            setConfirmState(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-[#0c151a] border border-white/15 shadow-[0_20px_60px_rgba(0,0,0,0.9)] p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3.5">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  confirmState.opts.danger
                    ? 'bg-[#fb7185]/15 text-[#fb7185] border border-[#fb7185]/30'
                    : 'bg-[#f59e0b]/15 text-[#ffd28a] border border-[#f59e0b]/30'
                }`}
              >
                <Icon name={confirmState.opts.danger ? 'delete' : 'warning'} size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <span className="kicker text-[9px]">KONFIRMASI TINDAKAN</span>
                <h3 className="text-sm font-bold text-white mt-0.5">{confirmState.opts.title}</h3>
                <p className="text-xs text-[#9fb0b8] mt-1.5 leading-relaxed">
                  {confirmState.opts.message}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-white/[0.08]">
              <button
                type="button"
                onClick={() => {
                  confirmState.resolve(false);
                  setConfirmState(null);
                }}
                className="btn btn-ghost px-4 py-1.5 rounded-xl text-xs font-semibold"
              >
                {confirmState.opts.cancelLabel || 'Batal'}
              </button>
              <button
                type="button"
                onClick={() => {
                  confirmState.resolve(true);
                  setConfirmState(null);
                }}
                className={`px-4 py-1.5 rounded-xl text-xs font-bold text-white transition flex items-center gap-1.5 ${
                  confirmState.opts.danger
                    ? 'bg-rose-600 hover:bg-rose-500 shadow-lg shadow-rose-600/25'
                    : 'btn-indigo'
                }`}
              >
                <Icon name={confirmState.opts.danger ? 'delete' : 'check_circle'} size={14} />
                <span>{confirmState.opts.confirmLabel || 'Ya, Lanjutkan'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Glassmorphic Input Prompt Modal Pop-up */}
      {promptState && (
        <div
          className="fixed inset-0 z-[110] bg-black/75 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => {
            promptState.resolve(null);
            setPromptState(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              promptState.resolve(promptValue.trim() || null);
              setPromptState(null);
            }}
            className="w-full max-w-md rounded-2xl bg-[#0c151a] border border-white/15 shadow-[0_20px_60px_rgba(0,0,0,0.9)] p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-[#4f46e5]/20 text-[#9ea0fd] border border-[#9ea0fd]/30 flex items-center justify-center shrink-0">
                <Icon name="key" size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <span className="kicker text-[9px]">INPUT PARAMETER</span>
                <h3 className="text-sm font-bold text-white mt-0.5">{promptState.opts.title}</h3>
                {promptState.opts.message && (
                  <p className="text-xs text-[#9fb0b8] mt-1 leading-relaxed">
                    {promptState.opts.message}
                  </p>
                )}
              </div>
            </div>

            <div>
              <input
                type="text"
                autoFocus
                required
                value={promptValue}
                onChange={(e) => setPromptValue(e.target.value)}
                placeholder={promptState.opts.placeholder || 'Masukkan nilai...'}
                className="w-full glass-input text-xs font-mono py-2.5 px-3 rounded-xl"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-white/[0.08]">
              <button
                type="button"
                onClick={() => {
                  promptState.resolve(null);
                  setPromptState(null);
                }}
                className="btn btn-ghost px-4 py-1.5 rounded-xl text-xs font-semibold"
              >
                {promptState.opts.cancelLabel || 'Batal'}
              </button>
              <button
                type="submit"
                className="btn btn-indigo px-4 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5"
              >
                <Icon name="check_circle" size={14} />
                <span>{promptState.opts.confirmLabel || 'Simpan'}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </NotificationContext.Provider>
  );
};
