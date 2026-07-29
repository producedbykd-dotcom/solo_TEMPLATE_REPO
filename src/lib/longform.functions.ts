import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Record a freshly-rendered longform MP4 (already uploaded to the videos
 *  bucket by the client) as both a project_assets row and the canonical
 *  `longform` section on the project. */
export const recordLongformAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: {
    projectId: string;
    storagePath: string;
    sizeBytes: number;
    resolution: "1080p" | "4k";
    showWaveform: boolean;
    animateThumbnail: boolean;
    thumbnailVariantId?: string | null;
  }) => {
    if (!d?.projectId) throw new Error("projectId required");
    if (!d?.storagePath) throw new Error("storagePath required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const meta = {
      sizeBytes: data.sizeBytes,
      resolution: data.resolution,
      showWaveform: data.showWaveform,
      animateThumbnail: data.animateThumbnail,
      thumbnailVariantId: data.thumbnailVariantId ?? null,
      renderedAt: new Date().toISOString(),
    };
    const { error: aErr } = await supabase.from("project_assets").insert({
      project_id: data.projectId,
      kind: "longform_video" as const,
      storage_path: data.storagePath,
      bucket: "videos",
      meta,
    });
    if (aErr) throw new Error(aErr.message);

    const payload = { storagePath: data.storagePath, ...meta };
    const { data: existing } = await supabase
      .from("project_sections").select("id")
      .eq("project_id", data.projectId).eq("section", "longform").maybeSingle();
    if (existing?.id) {
      const { error } = await (supabase.from("project_sections") as any)
        .update({ data: payload, status: "ready", updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("project_sections")
        .insert({ project_id: data.projectId, section: "longform", status: "ready", data: payload });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });