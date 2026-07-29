const cls = "h-7 w-7";

function YouTubeLogo() {
  return (
    <svg viewBox="0 0 24 24" className={cls} aria-hidden>
      <path
        fill="#FF0000"
        d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31.4 31.4 0 0 0 0 12a31.4 31.4 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.4 31.4 0 0 0 24 12a31.4 31.4 0 0 0-.5-5.8Z"
      />
      <path fill="#fff" d="M9.6 15.6 15.8 12 9.6 8.4v7.2Z" />
    </svg>
  );
}

function InstagramLogo() {
  const gid = "ig-grad";
  return (
    <svg viewBox="0 0 24 24" className={cls} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#feda75" />
          <stop offset="25%" stopColor="#fa7e1e" />
          <stop offset="55%" stopColor="#d62976" />
          <stop offset="80%" stopColor="#962fbf" />
          <stop offset="100%" stopColor="#4f5bd5" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="5.5" fill={`url(#${gid})`} />
      <circle cx="12" cy="12" r="4.2" fill="none" stroke="#fff" strokeWidth="1.8" />
      <circle cx="17.4" cy="6.6" r="1.2" fill="#fff" />
    </svg>
  );
}

function TikTokLogo() {
  const d =
    "M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.59a8.16 8.16 0 0 0 4.77 1.52V6.69h-1.84Z";
  return (
    <svg viewBox="0 0 24 24" className={cls} aria-hidden>
      <path d={d} fill="#25F4EE" transform="translate(-1 1)" />
      <path d={d} fill="#FE2C55" transform="translate(1 -1)" />
      <path d={d} fill="#000" />
    </svg>
  );
}

function FacebookLogo() {
  return (
    <svg viewBox="0 0 24 24" className={cls} aria-hidden>
      <rect width="24" height="24" rx="5" fill="#1877F2" />
      <path
        fill="#fff"
        d="M15.3 12.5h-2.3V20h-3.1v-7.5H8.2V10h1.7V8.3c0-2 1.2-3.1 3-3.1.9 0 1.8.2 1.8.2v2h-1c-1 0-1.3.6-1.3 1.3V10h2.2l-.3 2.5Z"
      />
    </svg>
  );
}

function SoundCloudLogo() {
  const gid = "sc-grad";
  return (
    <svg viewBox="0 0 24 24" className={cls} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ff7700" />
          <stop offset="100%" stopColor="#ff3300" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gid})`}
        d="M2 15.2c0-.8.3-1.5.8-2.1v4.2c-.5-.6-.8-1.3-.8-2.1Zm2 2.6V12.6c-.3.2-.6.5-.8.8v3.6c.2.3.5.6.8.8Zm1.5.5V12.1c-.3 0-.5.1-.8.2v6c.3.1.5.2.8.2Zm1.5.1V12c-.3 0-.5 0-.8.1v6.4c.3 0 .5 0 .8 0Zm1.5-.1V12.4c-.3-.1-.5-.2-.8-.3v6.4c.3-.1.5-.2.8-.3Zm1.5-.5V13.4l-.8-.3v4.7c.3-.1.5-.2.8-.3Zm1.5-.6V8.5c-.3 0-.5.1-.8.3v9c.3 0 .5-.1.8-.3Zm10-3.6c0 1.9-1.6 3.5-3.5 3.5h-6.7c-.2 0-.3-.2-.3-.3V7.8c0-.2 0-.3.2-.4 1-.7 2.1-1.1 3.4-1.1 3.1 0 5.6 2.5 5.6 5.6 0 .1 0 .2 0 .3.5-.2 1-.3 1.5-.3 2 0 3.6 1.6 3.6 3.6Z"
      />
    </svg>
  );
}

export function PlatformLogos({ className = "" }: { className?: string }) {
  const items = [
    { Logo: YouTubeLogo, label: "YouTube" },
    { Logo: InstagramLogo, label: "Instagram" },
    { Logo: TikTokLogo, label: "TikTok" },
    { Logo: FacebookLogo, label: "Facebook" },
    { Logo: SoundCloudLogo, label: "SoundCloud" },
  ];
  return (
    <div className={`flex items-center justify-center gap-5 ${className}`}>
      {items.map(({ Logo, label }) => (
        <span
          key={label}
          title={label}
          aria-label={label}
          className="inline-flex transition-transform hover:-translate-y-0.5"
        >
          <Logo />
        </span>
      ))}
    </div>
  );
}