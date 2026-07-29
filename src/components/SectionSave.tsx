import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";

export type SectionSaveHandler = () => Promise<unknown> | unknown;

type Ctx = {
  register: (h: SectionSaveHandler | null) => void;
  run: () => Promise<void>;
};

const SectionSaveCtx = createContext<Ctx | null>(null);

/**
 * Wrap a region (e.g. the wizard step body) and call `run()` from the
 * surrounding "Approve & continue" button. Any child section that mounts
 * a save mutation calls {@link useRegisterSectionSave} so the wizard can
 * flush pending edits before advancing.
 */
export function SectionSaveProvider({ children }: { children: (run: () => Promise<void>) => ReactNode }) {
  const handlerRef = useRef<SectionSaveHandler | null>(null);
  const value = useMemo<Ctx>(() => ({
    register: (h) => { handlerRef.current = h; },
    run: async () => {
      const h = handlerRef.current;
      if (!h) return;
      try { await h(); } catch { /* surfaced by the section's own toast */ }
    },
  }), []);
  return (
    <SectionSaveCtx.Provider value={value}>
      {children(value.run)}
    </SectionSaveCtx.Provider>
  );
}

export function useRegisterSectionSave(handler: SectionSaveHandler | null) {
  const ctx = useContext(SectionSaveCtx);
  useEffect(() => {
    if (!ctx) return;
    ctx.register(handler);
    return () => ctx.register(null);
  }, [ctx, handler]);
}