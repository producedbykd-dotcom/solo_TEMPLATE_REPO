import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ShortClip = {
  id: string;
  storagePath: string;
  sizeBytes: number;
  startSec: number;
  durationSec: number;
  showWaveform: boolean;
  thumbnailVariantId?: string | null;
  label?: string | null;
  renderedAt: string;
};

export type ShortsPayload = { clips: ShortClip[] };

/** Append (or replace) a short clip on the project's `shorts` section and
 *  insert a project_assets row of kind `short_video`. */
export const recordShortAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: {
    projectId: string;
    storagePath: string;
    sizeBytes: number;
    startSec: number;
    durationSec: number;
    showWaveform: boolean;
    thumbnailVariantId?: string | null;
    label?: string | null;
  }) => {
    if (!d?.projectId) throw new Error("projectId required");
    if (!d?.storagePath) throw new Error("storagePath required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const clip: ShortClip = {
      id: crypto.randomUUID(),
      storagePath: data.storagePath,
      sizeBytes: data.sizeBytes,
      startSec: data.startSec,
      durationSec: data.durationSec,
      showWaveform: data.showWaveform,
      thumbnailVariantId: data.thumbnailVariantId ?? null,
      label: data.label ?? null,
      renderedAt: new Date().toISOString(),
    };

    const { error: aErr } = await supabase.from("project_assets").insert({
      project_id: data.projectId,
      kind: "short_video" as const,
      storage_path: data.storagePath,
      bucket: "videos",
      meta: clip,
    });
    if (aErr) throw new Error(aErr.message);

    const { data: existing } = await supabase
      .from("project_sections").select("id, data").eq("project_id", data.projectId)
      .eq("section", "shorts").maybeSingle();
    const prevClips: ShortClip[] = (existing?.data as any)?.clips ?? [];
    // Cap at 3 — drop the oldest if user renders a fourth.
    const nextClips = [...prevClips, clip].slice(-3);
    const payload: ShortsPayload = { clips: nextClips };
    if (existing?.id) {
      const { error } = await (supabase.from("project_sections") as any)
        .update({ data: payload, status: "ready", updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("project_sections")
        .insert({ project_id: data.projectId, section: "shorts", status: "ready", data: payload });
      if (error) throw new Error(error.message);
    }
    return { ok: true, clip };
  });

export const deleteShortClip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { projectId: string; clipId: string }) => {
    if (!d?.projectId || !d?.clipId) throw new Error("projectId + clipId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row } = await supabase.from("project_sections")
      .select("id, data").eq("project_id", data.projectId).eq("section", "shorts").maybeSingle();
    if (!row?.id) return { ok: true };
    const prev: ShortClip[] = (row.data as any)?.clips ?? [];
    const target = prev.find((c) => c.id === data.clipId);
    const next = prev.filter((c) => c.id !== data.clipId);
    const { error } = await (supabase.from("project_sections") as any)
      .update({ data: { clips: next }, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) throw new Error(error.message);
    if (target?.storagePath) {
      await supabase.storage.from("videos").remove([target.storagePath]).catch(() => {});
    }
    return { ok: true };
  });