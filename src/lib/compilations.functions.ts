import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Merge the central keyword pools of N member tracks into one ordered list.
 *  Dedupe (case-insensitive), preserve frequency order so the keywords that
 *  appeared on the most tracks float to the top, cap at `max` items. */
function mergeKeywordSeeds(perTrackSeeds: string[][], max = 30): string[] {
  const counts = new Map<string, { freq: number; canonical: string; firstSeen: number }>();
  let order = 0;
  for (const seeds of perTrackSeeds) {
    for (const raw of seeds) {
      const term = (raw || "").trim();
      if (!term) continue;
      const k = term.toLowerCase();
      const existing = counts.get(k);
      if (existing) existing.freq += 1;
      else counts.set(k, { freq: 1, canonical: term, firstSeen: order++ });
    }
  }
  return Array.from(counts.values())
    .sort((a, b) => (b.freq - a.freq) || (a.firstSeen - b.firstSeen))
    .slice(0, max)
    .map((v) => v.canonical);
}

function addTerms(target: string[], values: unknown) {
  if (!Array.isArray(values)) return;
  for (const value of values) {
    const term = String(value ?? "").replace(/^#/, "").replace(/\s+/g, " ").trim();
    if (term) target.push(term);
  }
}

async function buildCompilationKeywordPayload(
  supabase: any,
  orderedTrackIds: string[],
) {
  const { data: secRows, error } = await supabase
    .from("project_sections")
    .select("project_id,section,data")
    .in("section", ["keywords", "analysis", "metadata"])
    .in("project_id", orderedTrackIds);
  if (error) throw new Error(error.message);

  const perTrackSeeds: string[][] = [];
  for (const tid of orderedTrackIds) {
    const kw = (secRows ?? []).find((s: any) => s.project_id === tid && s.section === "keywords")?.data as any;
    const an = (secRows ?? []).find((s: any) => s.project_id === tid && s.section === "analysis")?.data as any;
    const md = (secRows ?? []).find((s: any) => s.project_id === tid && s.section === "metadata")?.data as any;
    const terms: string[] = [];

    addTerms(terms, kw?.seeds);
    if (Array.isArray(kw?.rows)) addTerms(terms, kw.rows.map((r: any) => r?.term));
    addTerms(terms, kw?.topTags);
    addTerms(terms, md?.tags);
    addTerms(terms, md?.hashtags);

    if (an) {
      addTerms(terms, [an.niche, an.genre, an.mood, an.bpm ? `${an.niche || an.genre || "music"} ${an.bpm} bpm` : null]);
    }
    perTrackSeeds.push(terms);
  }

  const combinedCandidates = mergeKeywordSeeds(perTrackSeeds, 100);
  return {
    seeds: combinedCandidates.slice(0, 30),
    combinedCandidates,
    rows: [],
    generatedAt: new Date().toISOString(),
  };
}

/** Save a release compilation — a user-defined ordering of existing project
 *  tracks that we'll stitch into a single longform video. Also creates a
 *  backing "compilation" project so the user runs the same wizard
 *  (keywords → artwork → metadata → render → shorts → publish) as singles. */
export const upsertCompilation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { id?: string; title: string; orderedTrackIds: string[]; coverImagePath?: string | null }) => {
    const title = (d?.title ?? "").trim();
    if (!title) throw new Error("Title is required");
    if (!Array.isArray(d.orderedTrackIds) || d.orderedTrackIds.length < 2) {
      throw new Error("Pick at least 2 tracks to combine");
    }
    if (d.orderedTrackIds.length > 12) throw new Error("Max 12 tracks per compilation");
    return { id: d.id, title, orderedTrackIds: d.orderedTrackIds, coverImagePath: d.coverImagePath ?? null };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Sum of member track durations — useful for the render UI.
    const { data: memberTracks } = await supabase
      .from("projects")
      .select("id,duration_sec")
      .in("id", data.orderedTrackIds);
    const totalDuration = (memberTracks ?? []).reduce(
      (acc: number, p: any) => acc + (Number(p.duration_sec) || 0), 0,
    );

    if (data.id) {
      const { data: row, error } = await (supabase.from("release_compilations") as any)
        .update({
          title: data.title,
          ordered_track_ids: data.orderedTrackIds,
          cover_image_path: data.coverImagePath,
          duration_sec: totalDuration || null,
        })
        .eq("id", data.id)
        .eq("user_id", userId)
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);

      // Keep the linked wizard project's title in sync (if any).
      if (row?.project_id) {
        await (supabase.from("projects") as any)
          .update({ title: data.title, duration_sec: totalDuration || null })
          .eq("id", row.project_id);
        const { upsertSection } = await import("./sections.server");
        const keywordPayload = await buildCompilationKeywordPayload(supabase, data.orderedTrackIds);
        await upsertSection(supabase, row.project_id, "keywords", keywordPayload);
      }
      return { compilation: row };
    }

    // --- Create path: compilation + backing project + pre-seeded keyword pool.

    const { data: row, error } = await (supabase.from("release_compilations") as any)
      .insert({
        user_id: userId,
        title: data.title,
        ordered_track_ids: data.orderedTrackIds,
        cover_image_path: data.coverImagePath,
        duration_sec: totalDuration || null,
      })
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);

    // Create the wizard project bound to this compilation.
    const { data: proj, error: pErr } = await (supabase.from("projects") as any)
      .insert({
        user_id: userId,
        title: data.title,
        kind: "compilation_video",
        compilation_id: row.id,
        duration_sec: totalDuration || null,
        status: "draft",
      })
      .select("*")
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);

    // Back-link the project on the compilation row.
    await (supabase.from("release_compilations") as any)
      .update({ project_id: proj.id })
      .eq("id", row.id);

    // Pre-seed the central keyword pool by merging each member track's keywords,
    // researched terms and saved metadata tags. Capped at 30 for compilation curation.
    const { upsertSection } = await import("./sections.server");
    const keywordPayload = await buildCompilationKeywordPayload(supabase, data.orderedTrackIds);
    await upsertSection(supabase, proj.id, "keywords", keywordPayload);

    return { compilation: { ...row, project_id: proj.id }, projectId: proj.id };
  });

export const ensureCompilationKeywords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { projectId: string }) => {
    if (!d?.projectId) throw new Error("projectId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: project, error: pErr } = await supabase
      .from("projects")
      .select("id,kind,compilation_id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!project || (project.kind !== "compilation_video" && project.kind !== "compilation_playlist")) {
      throw new Error("Project is not a compilation");
    }
    if (!project.compilation_id) throw new Error("Compilation link missing");

    const { data: compilation, error: cErr } = await (supabase.from("release_compilations") as any)
      .select("ordered_track_ids")
      .eq("id", project.compilation_id)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    const orderedTrackIds = (compilation?.ordered_track_ids ?? []) as string[];
    if (orderedTrackIds.length < 2) throw new Error("Compilation tracks missing");

    const { upsertSection } = await import("./sections.server");
    const keywordPayload = await buildCompilationKeywordPayload(supabase, orderedTrackIds);
    await upsertSection(supabase, data.projectId, "keywords", keywordPayload);
    return keywordPayload;
  });

export const listCompilations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("release_compilations")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { compilations: data ?? [] };
  });

export const deleteCompilation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { id: string }) => {
    if (!d?.id) throw new Error("id required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("release_compilations").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });