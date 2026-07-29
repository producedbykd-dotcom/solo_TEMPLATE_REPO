import { useEffect, useState } from "react";
import { ArrowUp, Loader2, Sparkles } from "lucide-react";

type Props = {
  storageKey: string;                  // localStorage key, scoped per project + section
  label: string;                       // e.g. "Direction for title & description"
  placeholder: string;
  busy?: boolean;
  hasPayload?: boolean;                // kept for API compat (no longer affects label)
  onSubmit: (direction: string) => void;
};

/**
 * Raised, chat-style steering box used across analysis / keywords / metadata / artwork.
 * - Persists the last sent direction per (project, section) so the user always sees it.
 * - Inline gradient send button + ⌘/Ctrl+Enter shortcut.
 */
export function DirectionComposer({ storageKey, label, placeholder, busy, onSubmit }: Props) {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<string>("");

  useEffect(() => {
    try {
      const v = localStorage.getItem(storageKey) || "";
      setSaved(v);
    } catch { /* ignore */ }
  }, [storageKey]);

  function send() {
    const v = value.trim();
    try { localStorage.setItem(storageKey, v); } catch { /* ignore */ }
    setSaved(v);
    onSubmit(v);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--accent)]/40 bg-[color:var(--accent)]/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-foreground">
          <Sparkles className="h-3 w-3 text-[color:var(--accent)]" />
          {label}
        </span>
        {saved && (
          <span className="max-w-[60%] truncate text-[11px] text-muted-foreground" title={saved}>
            Current direction: <span className="text-foreground/80">"{saved}"</span>
          </span>
        )}
      </div>
      <div className="relative rounded-2xl border border-[color:var(--accent)]/40 bg-card p-1 shadow-[0_0_0_1px_rgba(0,0,0,0.4),0_8px_30px_-12px_var(--accent)] focus-within:border-[color:var(--accent)]">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); if (!busy) send(); }
          }}
          rows={3}
          placeholder={placeholder}
          className="w-full resize-none rounded-xl bg-transparent px-4 py-3 pr-16 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
        />
        <button
          type="button"
          onClick={send}
          disabled={busy}
          aria-label="Send"
          title="Send (⌘↵)"
          className="absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-[color:var(--accent)] to-[color:var(--accent-2,#f59e0b)] text-black shadow-md transition-transform hover:scale-105 disabled:opacity-60 disabled:hover:scale-100"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" strokeWidth={2.5} />}
        </button>
      </div>
    </div>
  );
}