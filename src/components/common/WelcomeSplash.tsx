import React, { useEffect, useState } from 'react';

interface WelcomeSplashProps {
  onComplete: () => void;
}

export const WelcomeSplash: React.FC<WelcomeSplashProps> = ({ onComplete }) => {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const exitTimer = window.setTimeout(() => {
      setIsExiting(true);
    }, 1850);

    const doneTimer = window.setTimeout(() => {
      onComplete();
    }, 2300);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(doneTimer);
    };
  }, [onComplete]);

  const handleDismiss = () => {
    if (isExiting) return;
    setIsExiting(true);
    window.setTimeout(onComplete, 320);
  };

  return (
    <div
      role="status"
      aria-label="Welcome"
      onClick={handleDismiss}
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-slate-950 text-slate-100 overflow-hidden select-none cursor-pointer transition-all duration-500 ease-out ${
        isExiting ? 'opacity-0 scale-105 pointer-events-none' : 'opacity-100 scale-100'
      }`}
    >
      {/* Subtle architectural dark grid texture */}
      <div
        className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(148,163,184,0.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.35) 1px, transparent 1px)',
          backgroundSize: '36px 36px',
          maskImage: 'radial-gradient(circle at 50% 48%, black 22%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(circle at 50% 48%, black 22%, transparent 75%)',
        }}
      />

      {/* Ambient radial dark-blue & cyan glow orbs */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[360px] h-[360px] sm:w-[460px] sm:h-[460px] rounded-full bg-blue-600/20 blur-[90px] animate-splash-orb pointer-events-none" />
      <div className="absolute top-[42%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[220px] h-[220px] rounded-full bg-cyan-400/15 blur-[65px] animate-splash-orb pointer-events-none" />

      {/* Center Content: Logo, Welcome, Loader */}
      <div className="relative z-10 flex flex-col items-center px-6 text-center max-w-sm w-full">
        {/* Animated Emblem + Pulse Rings */}
        <div className="relative flex items-center justify-center mb-7">
          <span className="absolute w-28 h-28 sm:w-32 sm:h-32 rounded-[28px] border border-sky-400/35 animate-splash-ring pointer-events-none" />
          <span className="absolute w-28 h-28 sm:w-32 sm:h-32 rounded-[28px] border border-blue-500/30 animate-splash-ring-delayed pointer-events-none" />

          <div className="relative p-[2px] rounded-[28px] animate-splash-logo shadow-[0_0_55px_rgba(10,132,255,0.35)]">
            <div
              className="absolute inset-0 rounded-[28px] animate-splash-spin-slow opacity-75"
              style={{
                background:
                  'conic-gradient(from 0deg, transparent 0%, rgba(56,189,248,0.85) 20%, rgba(37,99,235,0.25) 45%, transparent 65%, rgba(16,185,129,0.55) 85%, transparent 100%)',
              }}
            />

            <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-[26px] bg-slate-950 overflow-hidden flex items-center justify-center border border-slate-800/80">
              <svg
                viewBox="0 0 1024 1024"
                className="w-full h-full"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="splashBlueG" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#32D6FF" />
                    <stop offset="45%" stopColor="#0A84FF" />
                    <stop offset="100%" stopColor="#0044E0" />
                  </linearGradient>
                  <linearGradient id="splashBg" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#0F172A" />
                    <stop offset="100%" stopColor="#020617" />
                  </linearGradient>
                  <radialGradient id="splashAmbient" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#0A84FF" stopOpacity="0.28" />
                    <stop offset="65%" stopColor="#0044E0" stopOpacity="0.08" />
                    <stop offset="100%" stopColor="#020617" stopOpacity="0" />
                  </radialGradient>
                </defs>
                <rect x="0" y="0" width="1024" height="1024" fill="url(#splashBg)" />
                <circle cx="512" cy="512" r="420" fill="url(#splashAmbient)" />
                <path
                  d="M 752 327 A 300 300 0 1 0 813 472 L 504 472 L 504 584 L 681 584 A 180 180 0 1 1 658 401 Z"
                  fill="url(#splashBlueG)"
                />
                <path
                  d="M 752 327 A 300 300 0 0 0 258 360"
                  fill="none"
                  stroke="#6BE4FF"
                  strokeWidth="8"
                  strokeLinecap="round"
                  opacity="0.75"
                />
                <path
                  d="M 504 474 L 811 474"
                  fill="none"
                  stroke="#6BE4FF"
                  strokeWidth="6"
                  strokeLinecap="round"
                  opacity="0.6"
                />
              </svg>

              {/* Diagonal glass shimmer sweep */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="h-full w-1/2 bg-gradient-to-r from-transparent via-white/25 to-transparent animate-splash-shimmer" />
              </div>
            </div>
          </div>
        </div>

        {/* Welcome */}
        <h1 className="animate-splash-text-1 text-3xl sm:text-4xl font-bold tracking-tight bg-gradient-to-r from-white via-sky-100 to-blue-300 bg-clip-text text-transparent">
          Welcome
        </h1>

        {/* Sleek Animated Loader */}
        <div className="animate-splash-text-2 mt-6 w-40 sm:w-48">
          <div className="h-[3px] w-full rounded-full bg-slate-800/90 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-sky-400 via-blue-500 to-emerald-400 animate-splash-progress shadow-[0_0_12px_rgba(56,189,248,0.65)]" />
          </div>
        </div>
      </div>
    </div>
  );
};
