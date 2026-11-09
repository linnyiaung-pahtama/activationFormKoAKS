import React, { useState, useEffect } from 'react';
import {
  LogIn,
  KeyRound,
  UserCheck,
  Eye,
  EyeOff,
  Sun,
  Moon,
  AlertCircle,
  X,
} from 'lucide-react';
import { authenticateUserDirect } from '../services/UserManager';
import { UserAccount } from '../types';

interface LoginViewProps {
  users: UserAccount[];
  onLoginSuccess: (user: UserAccount) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({
  users,
  onLoginSuccess,
}) => {
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [retryAttempt, setRetryAttempt] = useState<number>(0);
  const [retryNotice, setRetryNotice] = useState<string | null>(null);
  const [isDoorOpening, setIsDoorOpening] = useState<boolean>(false);
  const [authenticatedUser, setAuthenticatedUser] =
    useState<UserAccount | null>(null);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('app_theme');
      if (saved === 'dark' || saved === 'light') return saved;
      if (
        typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches
      ) {
        return 'dark';
      }
    } catch {
      // Safe fallback
    }
    return 'light';
  });

  const isDark = theme === 'dark';

  useEffect(() => {
    try {
      localStorage.setItem('app_theme', theme);
      const root = document.documentElement;
      if (isDark) {
        root.classList.add('dark-theme');
        root.classList.remove('light-theme');
      } else {
        root.classList.add('light-theme');
        root.classList.remove('dark-theme');
      }
    } catch {
      // Safe fallback
    }
  }, [theme, isDark]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDoorOpening || isSubmitting) return;

    setErrorMsg(null);
    setRetryNotice(null);
    setIsSubmitting(true);
    setRetryAttempt(1);

    const trimmedUser = username.trim().toLowerCase();
    const TIMEOUT_MS = 12000;
    const MAX_RETRIES = 2;

    try {
      let authResult: Awaited<ReturnType<typeof authenticateUserDirect>> | null =
        null;

      for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
        setRetryAttempt(attempt);
        if (attempt > 1) {
          setRetryNotice(
            `Fluctuating mobile signal detected. Retrying connection (${attempt}/${MAX_RETRIES + 1})...`
          );
        }

        try {
          let timerId: ReturnType<typeof setTimeout> | undefined;
          const timeoutPromise = new Promise<never>((_, reject) => {
            timerId = setTimeout(() => {
              reject(new Error('Connection timeout'));
            }, TIMEOUT_MS);
          });

          const authPromise = authenticateUserDirect(
            trimmedUser,
            password,
            users
          ).finally(() => {
            if (timerId) clearTimeout(timerId);
          });

          authResult = await Promise.race([authPromise, timeoutPromise]);
          setRetryNotice(null);
          break;
        } catch {
          if (attempt <= MAX_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, 900));
          }
        }
      }

      if (!authResult) {
        authResult = await authenticateUserDirect(trimmedUser, password, users);
      }

      if (authResult.errorType === 'NOT_FOUND' || !authResult.user) {
        if (authResult.errorType === 'INACTIVE') {
          setErrorMsg(
            'This account is currently inactive. Contact the System Administrator.'
          );
          return;
        }
        if (authResult.errorType === 'WRONG_PASSWORD') {
          setErrorMsg('Invalid password for the selected account.');
          return;
        }
        setErrorMsg(
          'Username not found. Please check your username and try again.'
        );
        return;
      }

      const matched = authResult.user;

      setAuthenticatedUser(matched);
      setIsDoorOpening(true);

      setTimeout(() => {
        onLoginSuccess(matched);
      }, 1150);
    } catch {
      setErrorMsg(
        'Connection error or invalid credentials. Please check your network and try again.'
      );
    } finally {
      setIsSubmitting(false);
      setRetryAttempt(0);
      setRetryNotice(null);
    }
  };

  return (
    <div
      className={`relative min-h-screen w-full flex flex-col justify-between transition-colors duration-200 ${
        isDark
          ? 'dark-theme bg-[#0B192C] text-[#E2E8F0]'
          : 'light-theme bg-[#F0F4F8] text-[#0F2C59]'
      }`}
    >
      {/* Top 3-Zone Header */}
      <header
        className={`w-full border-b transition-colors duration-200 ${
          isDark
            ? 'bg-[#06101D] border-[#1E3E62]'
            : 'bg-[#0F2C59] border-[#1E3E62]'
        }`}
      >
        <div className="max-w-7xl w-full mx-auto flex items-center justify-between gap-8 px-4 sm:px-6 py-3.5">
          <span className="text-base sm:text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0">
            Pahtama Group
          </span>

          <div className="hidden md:flex items-center gap-6 text-xs font-medium text-blue-100/80">
            <span className="whitespace-nowrap shrink-0">
              Shaloot Noodle Activation &amp; Sales System
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              id="theme-toggle-header-btn"
              onClick={toggleTheme}
              aria-label={`Switch to ${isDark ? 'Light' : 'Dark'} mode`}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap shrink-0 border ${
                isDark
                  ? 'bg-[#152A47] hover:bg-[#1E3E62] text-amber-200 border-[#2D4D77]'
                  : 'bg-[#1E3E62] hover:bg-[#284f7c] text-white border-blue-400/20'
              }`}
            >
              {isDark ? (
                <>
                  <Sun className="w-3.5 h-3.5 text-amber-300" />
                  <span>Light Mode</span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5 text-blue-200" />
                  <span>Dark Mode</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Centered Login Card */}
      <main className="flex-1 w-full flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-[440px]">
          <div
            className={`w-full rounded-2xl p-6 sm:p-8 border transition-colors duration-200 ${
              isDark
                ? 'bg-[#152A47] border-[#2D4D77]'
                : 'bg-white border-[#CBD5E1] shadow-sm'
            }`}
          >
            <div className="space-y-1.5 mb-6">
              <div
                className={`text-xs font-semibold ${
                  isDark ? 'text-blue-300' : 'text-[#1E3E62]'
                }`}
              >
                Pahtama Group Co., Ltd. · Field Sales &amp; POS Portal
              </div>
              <h1
                className={`text-2xl font-bold tracking-tight ${
                  isDark ? 'text-white' : 'text-[#0F2C59]'
                }`}
              >
                Sign in to your account
              </h1>
              <p
                className={`text-xs leading-relaxed ${
                  isDark ? 'text-[#CBD5E1]' : 'text-[#475569]'
                }`}
              >
                Enter your assigned username and password to access your
                role-scoped activation form, thermal POS invoicing, and national
                branch analytics.
              </p>
            </div>

            {errorMsg && (
              <div
                role="alert"
                className={`mb-5 px-3.5 py-2.5 rounded-lg text-xs font-semibold border flex items-start justify-between gap-2.5 ${
                  isDark
                    ? 'bg-rose-950/80 border-rose-700 text-rose-200'
                    : 'bg-rose-50 border-rose-300 text-rose-900'
                }`}
              >
                <div className="flex items-start gap-2 min-w-0">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
                  <span className="leading-snug">{errorMsg}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setErrorMsg(null)}
                  aria-label="Dismiss error message"
                  className="shrink-0 p-1 rounded hover:bg-rose-200/40 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <form onSubmit={handleFormSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="login-username"
                  className={`block text-xs font-semibold mb-1.5 ${
                    isDark ? 'text-[#F1F5F9]' : 'text-[#0F2C59]'
                  }`}
                >
                  Username
                </label>
                <div className="relative">
                  <UserCheck
                    className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none ${
                      isDark ? 'text-[#60A5FA]' : 'text-[#1E3E62]'
                    }`}
                  />
                  <input
                    id="login-username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="e.g. admin, nsm1, brandmanager1, seller1"
                    required
                    disabled={isDoorOpening || isSubmitting}
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className={`w-full pl-9 pr-3.5 py-2.5 text-sm font-mono rounded-lg border transition-colors outline-none ${
                      isDark
                        ? 'bg-[#0A192F] border-[#385E8E] text-white placeholder-[#8EA4C2] focus:border-[#60A5FA] focus:ring-2 focus:ring-[#60A5FA]/30'
                        : 'bg-white border-[#CBD5E1] text-[#0F172A] placeholder-[#64748B] focus:border-[#0F2C59] focus:ring-2 focus:ring-[#0F2C59]/20'
                    }`}
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className={`block text-xs font-semibold mb-1.5 ${
                    isDark ? 'text-[#F1F5F9]' : 'text-[#0F2C59]'
                  }`}
                >
                  Password
                </label>
                <div className="relative">
                  <KeyRound
                    className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none ${
                      isDark ? 'text-[#60A5FA]' : 'text-[#1E3E62]'
                    }`}
                  />
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    required
                    disabled={isDoorOpening || isSubmitting}
                    autoComplete="current-password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className={`w-full pl-9 pr-10 py-2.5 text-sm font-mono rounded-lg border transition-colors outline-none ${
                      isDark
                        ? 'bg-[#0A192F] border-[#385E8E] text-white placeholder-[#8EA4C2] focus:border-[#60A5FA] focus:ring-2 focus:ring-[#60A5FA]/30'
                        : 'bg-white border-[#CBD5E1] text-[#0F172A] placeholder-[#64748B] focus:border-[#0F2C59] focus:ring-2 focus:ring-[#0F2C59]/20'
                    }`}
                  />
                  <button
                    type="button"
                    id="toggle-password-visibility"
                    onClick={() => setShowPassword((prev) => !prev)}
                    title={showPassword ? 'Hide password' : 'Show password'}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    disabled={isDoorOpening}
                    className={`absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded cursor-pointer transition-colors ${
                      isDark
                        ? 'text-[#94A3B8] hover:text-white'
                        : 'text-slate-500 hover:text-[#0F2C59]'
                    }`}
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="pt-1">
                {isDoorOpening ? (
                  <div className="w-full h-14 rounded-xl overflow-hidden relative flex items-center justify-center border border-blue-400/50 bg-gradient-to-br from-[#0F2C59] via-[#1E3E62] to-[#2563EB]">
                    <div className="relative flex items-center justify-center gap-3 z-10 w-full px-4">
                      <svg
                        viewBox="0 0 100 56"
                        className="h-11 w-20 shrink-0 overflow-visible"
                      >
                        <ellipse
                          cx="50"
                          cy="51"
                          rx="30"
                          ry="3.5"
                          fill="rgba(0,0,0,0.4)"
                        />
                        <rect
                          x="36"
                          y="6"
                          width="28"
                          height="43"
                          rx="2"
                          fill="#0B192C"
                          stroke="#60A5FA"
                          strokeWidth="2"
                        />
                        <rect
                          x="38"
                          y="8"
                          width="24"
                          height="39"
                          fill="#FEF9C3"
                        />
                        <g className="animate-door-swing">
                          <rect
                            x="38"
                            y="8"
                            width="24"
                            height="39"
                            rx="1.5"
                            fill="#1E3E62"
                            stroke="#93C5FD"
                            strokeWidth="1.2"
                          />
                          <circle
                            cx="58"
                            cy="28"
                            r="1.8"
                            fill="#FBBF24"
                            stroke="#D97706"
                            strokeWidth="0.5"
                          />
                        </g>
                        <g className="animate-person-step">
                          <circle cx="34" cy="18" r="3.8" fill="#FFFFFF" />
                          <path
                            d="M34 22 C31 22 29 25 29 30 L31 39 L37 39 L39 30 C39 25 37 22 34 22 Z"
                            fill="#FFFFFF"
                          />
                        </g>
                      </svg>
                      <div className="flex flex-col text-left min-w-0">
                        <span className="text-xs font-bold text-white truncate">
                          Authenticated
                        </span>
                        <span className="text-[11px] text-blue-200 truncate">
                          Opening {authenticatedUser?.fullName || 'Workspace'}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="submit"
                      disabled={isSubmitting || isDoorOpening}
                      className={`w-full min-h-[44px] inline-flex items-center justify-center gap-2 py-2.5 px-4 text-xs font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap ${
                        isDark
                          ? 'bg-[#2563EB] hover:bg-[#1D4ED8] text-white'
                          : 'bg-[#0F2C59] hover:bg-[#1E3E62] text-white'
                      }`}
                    >
                      <LogIn className="w-4 h-4" />
                      <span>
                        {isSubmitting
                          ? retryAttempt > 1
                            ? `Verifying... (Attempt ${retryAttempt}/3)`
                            : 'Verifying...'
                          : 'Sign In'}
                      </span>
                    </button>

                    {isSubmitting && retryNotice && (
                      <div
                        className={`mt-2.5 px-3 py-2 rounded-lg text-[11px] font-medium border ${
                          isDark
                            ? 'bg-amber-950/40 border-amber-800/60 text-amber-200'
                            : 'bg-amber-50 border-amber-300 text-amber-900'
                        }`}
                      >
                        {retryNotice}
                      </div>
                    )}
                  </>
                )}
              </div>
            </form>
          </div>
        </div>
      </main>

      {/* Quiet Footer */}
      <footer
        className={`w-full px-4 sm:px-6 py-4 text-xs text-center border-t ${
          isDark
            ? 'border-[#1E3E62] text-[#94A3B8] bg-[#06101D]/60'
            : 'border-slate-200 text-[#475569] bg-white/70'
        }`}
      >
        Pahtama Group Co., Ltd. · Shaloot Noodle Activation &amp; Sales
        Collection System · Yangon · Mandalay · Naypyitaw · Bago
      </footer>
    </div>
  );
};
