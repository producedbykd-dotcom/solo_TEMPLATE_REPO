import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Create one project per uploaded audio file. Client uploads files to storage
 *  under `<user_id>/<project_id>/audio.<ext>` and calls this with the produced
 *  rows. We return back the created projects. */
export const createProjectsBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (data: {
      items: Array<{
        title: string;
        storagePath: string;
        durationSec?: number | null;
        analysisAudioPath?: string | null;
        integratedLufs?: number | null;
        truePeakDbtp?: number | null;
      }>;
    }) => {
      if (!data || !Array.isArray(data.items) || data.items.length === 0) {
        throw new Error("No items provided");
      }
      if (data.items.length > 10) throw new Error("Max 10 tracks per batch");
      for (const it of data.items) {
        if (!it.title || typeof it.title !== "string") throw new Error("Invalid title");
        if (!it.storagePath || typeof it.storagePath !== "string") throw new Error("Invalid path");
      }
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const rows = data.items.map((i) => ({
      user_id: userId,
      title: i.title,
      primary_audio_path: i.storagePath,
      analysis_audio_path: i.analysisAudioPath ?? null,
      duration_sec: i.durationSec ?? null,
      integrated_lufs: i.integratedLufs ?? null,
      true_peak_dbtp: i.truePeakDbtp ?? null,
      kind: "single" as const,
      status: "draft" as const,
    }));
    const { data: inserted, error } = await supabase
      .from("projects")
      .insert(rows as any)
      .select("*");
    if (error) throw new Error(error.message);
    return { projects: inserted };
  });

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { projects: data ?? [] };
  });

/** Catalog view: projects + a denormalized completion summary built from
 *  project_sections so the catalog list can render progress bars without N+1. */
export const listCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data: projects, error } = await supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const ids = (projects ?? []).map((p) => p.id);
    let bySection: Record<string, Set<string>> = {};
    let publishedByProject: Record<string, { url: string; at: string | null; platform: string }> = {};
    if (ids.length) {
      const { data: secs } = await supabase
        .from("project_sections")
        .select("project_id, section, data")
        .in("project_id", ids);
      (secs ?? []).forEach((s: any) => {
        if (!s?.data) return;
        if (!bySection[s.project_id]) bySection[s.project_id] = new Set();
        bySection[s.project_id].add(s.section);
      });
      const { data: jobs } = await supabase
        .from("publish_jobs")
        .select("project_id, platform, platform_url, published_at, status")
        .in("project_id", ids)
        .eq("status", "published")
        .not("platform_url", "is", null)
        .order("published_at", { ascending: true });
      (jobs ?? []).forEach((j: any) => {
        if (!j?.platform_url) return;
        // Keep the earliest published link per project.
        if (!publishedByProject[j.project_id]) {
          publishedByProject[j.project_id] = {
            url: j.platform_url,
            at: j.published_at,
            platform: j.platform,
          };
        }
      });
    }
    const STEPS = ["analysis", "keywords", "metadata", "artwork", "longform", "shorts", "publish"] as const;
    // Sign cover thumbnails (cover_image_path lives in the videos bucket).
    const enriched = await Promise.all((projects ?? []).map(async (p: any) => {
      const filled = bySection[p.id] ?? new Set();
      const published = publishedByProject[p.id] ?? null;
      // Consider "publish" complete when at least one platform_url exists.
      if (published) filled.add("publish");
      const completion = published
        ? 100
        : Math.round((STEPS.filter((s) => filled.has(s)).length / STEPS.length) * 100);
      let coverUrl: string | null = null;
      if (p.cover_image_path) {
        const { data: signed } = await supabase.storage.from("videos").createSignedUrl(p.cover_image_path, 60 * 60);
        coverUrl = signed?.signedUrl ?? null;
      }
      return {
        ...p,
        completion,
        coverUrl,
        // Surface "released" state to the catalog UI without depending on
        // projects.status being flipped by the publish flow.
        is_released: !!published,
        first_published_at: p.first_published_at ?? published?.at ?? null,
        published_url: published?.url ?? null,
        published_platform: published?.platform ?? null,
      };
    }));
    return { projects: enriched };
  });

/** Mark that the post-upload AI auto-chain finished so opening the project
 *  page later does not re-trigger paid YouTube research. */
export const markAutoChainRan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { projectId: string }) => {
    if (!d?.projectId) throw new Error("projectId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase.from("projects") as any)
      .update({ auto_chain_ran_at: new Date().toISOString() })
      .eq("id", data.projectId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getProject = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { id: string }) => {
    if (!d?.id) throw new Error("id required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: project, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!project) throw new Error("Not found");
    const { data: sections } = await supabase
      .from("project_sections")
      .select("*")
      .eq("project_id", data.id);
    return { project, sections: sections ?? [] };
  });

export const updateProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { id: string; patch: Record<string, unknown> }) => {
    if (!d?.id) throw new Error("id required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const allowed = ["title", "status", "scheduled_for", "cover_image_path", "identity_id"];
    const patch: Record<string, unknown> = {};
    for (const k of allowed) if (k in data.patch) patch[k] = data.patch[k];
    const { data: updated, error } = await (supabase
      .from("projects") as any)
      .update(patch)
      .eq("id", data.id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { project: updated };
  });

export const renameProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { id: string; title: string }) => {
    if (!d?.id) throw new Error("id required");
    const t = (d.title ?? "").trim();
    if (!t) throw new Error("Title cannot be empty");
    if (t.length > 140) throw new Error("Title too long");
    return { id: d.id, title: t };
  })
  .handler(async ({ data, context }) => {
    const { data: updated, error } = await (context.supabase.from("projects") as any)
      .update({ title: data.title }).eq("id", data.id).select("*").maybeSingle();
    if (error) throw new Error(error.message);
    return { project: updated };
  });

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { id: string }) => {
    if (!d?.id) throw new Error("id required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("projects").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });