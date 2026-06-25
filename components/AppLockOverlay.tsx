import React, { useEffect, useMemo, useState } from 'react';
import { Delete, Fingerprint, Lock, ShieldAlert } from 'lucide-react';

interface AppLockOverlayProps {
  password: string;
  error: string | null;
  idleLockMinutes: number;
  isPasswordSubmitting: boolean;
  isPasskeySubmitting: boolean;
  canUsePasskey: boolean;
  hasRegisteredPasskey: boolean;
  onPasswordChange: (value: string) => void;
  onPasswordSubmit: () => void;
  onPasskeySubmit: () => void;
}

const AppLockOverlay: React.FC<AppLockOverlayProps> = ({
  password,
  error,
  idleLockMinutes,
  isPasswordSubmitting,
  isPasskeySubmitting,
  canUsePasskey,
  hasRegisteredPasskey,
  onPasswordChange,
  onPasswordSubmit,
  onPasskeySubmit
}) => {
  const [isMobileLayout, setIsMobileLayout] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const mediaQuery = window.matchMedia('(max-width: 640px), (pointer: coarse)');
    const updateLayout = () => setIsMobileLayout(mediaQuery.matches);

    updateLayout();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateLayout);
      return () => mediaQuery.removeEventListener('change', updateLayout);
    }

    mediaQuery.addListener(updateLayout);
    return () => mediaQuery.removeListener(updateLayout);
  }, []);

  useEffect(() => {
    if (!isMobileLayout) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isPasswordSubmitting || isPasskeySubmitting) return;

      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        onPasswordChange(password + event.key);
        return;
      }

      if (event.key === 'Backspace') {
        event.preventDefault();
        onPasswordChange(password.slice(0, -1));
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        onPasswordChange('');
        return;
      }

      if (event.key === 'Enter' && password.length > 0) {
        event.preventDefault();
        onPasswordSubmit();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileLayout, isPasskeySubmitting, isPasswordSubmitting, onPasswordChange, onPasswordSubmit, password]);

  const keypadRows = useMemo(() => [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']], []);

  const appendDigit = (digit: string) => {
    if (isPasswordSubmitting || isPasskeySubmitting) return;
    onPasswordChange(password + digit);
  };

  const removeDigit = () => {
    if (isPasswordSubmitting || isPasskeySubmitting || password.length === 0) return;
    onPasswordChange(password.slice(0, -1));
  };

  const clearPassword = () => {
    if (isPasswordSubmitting || isPasskeySubmitting || password.length === 0) return;
    onPasswordChange('');
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4">
      <div className="w-full max-w-md rounded-[2rem] border border-white/10 bg-slate-900/95 p-6 shadow-2xl shadow-slate-950/50 sm:p-8">
        <div className="mb-6 flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-300">
            <Lock className="h-7 w-7" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white">KidsLedger 已鎖定</h2>
            {!isMobileLayout && (
              <p className="mt-1 text-sm font-semibold text-slate-300">
                閒置超過 {idleLockMinutes} 分鐘，請輸入解鎖密碼繼續使用
              </p>
            )}
          </div>
        </div>

        {isMobileLayout ? (
          <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
            <p className="text-center text-sm font-semibold text-slate-300">請輸入數字密碼，或直接使用 Passkey 解鎖</p>
            <div className="mt-5 flex min-h-9 flex-wrap items-center justify-center gap-3">
              {password.length === 0 ? (
                <span className="text-sm font-medium text-slate-500">尚未輸入密碼</span>
              ) : (
                Array.from({ length: password.length }).map((_, index) => (
                  <span key={index} className="h-4 w-4 rounded-full border border-white/40 bg-white" />
                ))
              )}
            </div>
            <div className="mt-6 space-y-3">
              {keypadRows.map((row, rowIndex) => (
                <div key={rowIndex} className="grid grid-cols-3 gap-3">
                  {row.map((digit) => (
                    <button
                      key={digit}
                      type="button"
                      onClick={() => appendDigit(digit)}
                      disabled={isPasswordSubmitting || isPasskeySubmitting}
                      className="flex h-16 items-center justify-center rounded-3xl border border-white/10 bg-white/10 text-3xl font-light text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {digit}
                    </button>
                  ))}
                </div>
              ))}
              <div className="grid grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={clearPassword}
                  disabled={isPasswordSubmitting || isPasskeySubmitting || password.length === 0}
                  className="flex h-16 items-center justify-center rounded-3xl border border-white/10 bg-white/5 px-3 text-sm font-black text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  清除
                </button>
                <button
                  type="button"
                  onClick={() => appendDigit('0')}
                  disabled={isPasswordSubmitting || isPasskeySubmitting}
                  className="flex h-16 items-center justify-center rounded-3xl border border-white/10 bg-white/10 text-3xl font-light text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={removeDigit}
                  disabled={isPasswordSubmitting || isPasskeySubmitting || password.length === 0}
                  className="flex h-16 items-center justify-center rounded-3xl border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="刪除一個數字"
                >
                  <Delete className="h-6 w-6" />
                </button>
              </div>
            </div>
            {error ? (
              <div className="mt-4 flex items-start gap-2 rounded-2xl bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-200">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
            <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">
              解鎖密碼
            </label>
            <input
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && onPasswordSubmit()}
              placeholder="請輸入密碼"
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-4 text-base font-bold text-white placeholder:text-slate-500 focus:border-blue-400 focus:outline-none"
              autoFocus
            />
            {error ? (
              <div className="mt-3 flex items-start gap-2 rounded-2xl bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-200">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : (
              <p className="mt-3 text-sm font-medium text-slate-400">
                第一次成功解鎖後，這台裝置會被記住；你也可以稍後到設定中改回需要解鎖。密碼只會送到 Cloudflare Function 驗證，不會保存在瀏覽器。
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={onPasswordSubmit}
          disabled={isPasswordSubmitting || isPasskeySubmitting || password.length === 0}
          className="mt-6 flex w-full items-center justify-center rounded-2xl bg-blue-500 px-4 py-4 text-base font-black text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:bg-blue-500/60"
        >
          {isPasswordSubmitting ? '驗證中...' : '送出'}
        </button>

        {hasRegisteredPasskey && (
          <button
            type="button"
            onClick={onPasskeySubmit}
            disabled={!canUsePasskey || isPasswordSubmitting || isPasskeySubmitting}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-base font-black text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Fingerprint className="h-5 w-5" />
            {isPasskeySubmitting ? '驗證 Passkey 中...' : '使用 Passkey 解鎖'}
          </button>
        )}
      </div>
    </div>
  );
};

export default AppLockOverlay;
