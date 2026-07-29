import { Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Standard "Generate from Research" CTA block reused across sections.
 * Keeps the wording, gradient and disabled state consistent so users
 * recognize the same action everywhere.
 */
export function GenerateFromResearchCard({
  eyebrow = "One-click",
  title,
  description,
  buttonLabel = "Generate from Research",
  busy,
  disabled,
  disabledHint,
  onClick,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  buttonLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  disabledHint?: string;
  onClick: () => void;
}) {
  return (
    <div className="rounded-2xl border border-[color:var(--accent)]/40 bg-gradient-to-br from-[color:var(--accent)]/15 via-card/40 to-card/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--accent)]">{eyebrow}</p>
          <h3 className="font-display text-xl">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <Button
          size="lg"
          onClick={onClick}
          disabled={disabled || busy}
          className="shrink-0 bg-gradient-to-r from-[color:var(--accent)] to-[color:var(--accent-2,#f59e0b)] text-white dark:text-black"
        >
          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Wand2 className="mr-1.5 h-4 w-4" />}
          {buttonLabel}
        </Button>
      </div>
      {disabled && disabledHint && (
        <p className="mt-3 text-xs text-muted-foreground">{disabledHint}</p>
      )}
    </div>
  );
}