import { useEffect, useState } from "react";

/**
 * Indeterminate-but-helpful progress bar for image generations.
 * The Gemini image endpoint isn't streamed, so we asymptotically ramp toward
 * ~95% over ~`etaSec` seconds (image gens typically land in 30–60s). When the
 * call resolves and `active` flips to false the bar snaps to 100%, then hides.
 */
export function ImageGenProgress({
  active,
  label = "Generating image",
  etaSec = 45,
}: {
  active: boolean;
  label?: string;
  etaSec?: number;
}) {
  const [pct, setPct] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (active) {
      setVisible(true);
      setPct(0);
      setElapsed(0);
      const start = Date.now();
      const id = setInterval(() => {
        const t = (Date.now() - start) / 1000;
        setElapsed(t);
        // 1 - exp(-t/τ) — fast climb, slow asymptote, capped at 95.
        const target = 95 * (1 - Math.exp(-t / (etaSec * 0.6)));
        setPct((p) => Math.max(p, Math.min(95, target)));
      }, 250);
      return () => clearInterval(id);
    }
    // Resolved (success or error): snap to 100, then fade.
    setPct(100);
    const t = setTimeout(() => setVisible(false), 600);
    return () => clearTimeout(t);
  }, [active, etaSec]);

  if (!visible) return null;
  return (
    <div className="rounded-xl border border-[color:var(--accent)]/40 bg-card/60 p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-foreground/80">{label}…</span>
        <span className="font-mono text-muted-foreground">
          {Math.round(pct)}% · {elapsed.toFixed(0)}s
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary/40">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[color:var(--accent)] to-[color:var(--accent-2,#f59e0b)] transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}