import { useEffect, useState } from "react";
import { Check, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import {
  applyGradientPalette,
  GRADIENT_PALETTE_KEY,
  GRADIENT_PALETTES,
  normalizeGradientPalette,
  type GradientPaletteId,
} from "@/lib/gradient-palette";

export function GradientPalettePicker({ className = "" }: { className?: string }) {
  const [palette, setPalette] = useState<GradientPaletteId>("volt");
  const [userKey, setUserKey] = useState<string>(GRADIENT_PALETTE_KEY);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      const key = data.user?.id ? `${GRADIENT_PALETTE_KEY}:${data.user.id}` : GRADIENT_PALETTE_KEY;
      setUserKey(key);
      const saved = normalizeGradientPalette(
        typeof window !== "undefined" ? localStorage.getItem(key) : null,
      );
      setPalette(saved);
      applyGradientPalette(saved);
    });
    return () => { cancelled = true; };
  }, []);

  function choose(id: GradientPaletteId) {
    setPalette(id);
    applyGradientPalette(id);
    try { localStorage.setItem(userKey, id); } catch { /* ignore */ }
  }

  const active = GRADIENT_PALETTES.find((p) => p.id === palette) ?? GRADIENT_PALETTES[0];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`h-7 w-full justify-start px-2 text-xs ${className}`}
          title="Pick gradient palette"
        >
          <Palette className="mr-1.5 h-3.5 w-3.5" />
          <span className="mr-1.5">Gradient</span>
          <span className="ml-auto h-3.5 w-8 rounded-full border border-border" style={{ background: active.swatch }} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-64 p-3">
        <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Gradient palette</p>
        <div className="mt-3 grid gap-2">
          {GRADIENT_PALETTES.map((option) => {
            const selected = option.id === palette;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => choose(option.id)}
                className={`flex items-center gap-3 rounded-lg border p-2 text-left transition-colors ${
                  selected
                    ? "border-[color:var(--accent)] bg-[color:var(--accent)]/10"
                    : "border-border bg-card/40 hover:border-[color:var(--accent)]/60"
                }`}
              >
                <span className="h-8 w-16 rounded-md shadow-inner" style={{ background: option.swatch }} />
                <span className="flex-1 text-sm font-semibold">{option.name}</span>
                {selected && <Check className="h-4 w-4 text-[color:var(--accent)]" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}