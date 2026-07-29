import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ArtworkVariant = { id: string; storagePath: string; createdAt: string };
export type ArtworkPayload = {
  thumbnails: ArtworkVariant[]; // 16:9 YouTube thumbs
  covers: ArtworkVariant[];     // 1:1 album covers (3000x3000)
  selectedThumbnailId?: string;
  selectedCoverId?: string;
  references?: ArtworkVariant[]; // user-uploaded or "use as reference" picks
};

async function generateImage(apiKey: string, prompt: string, refImageDataUrls: string[] = []): Promise<string> {
  // Lovable AI Gateway image gen — returns base64 image.
  // Use gemini-3-pro-image for best realism + reference-image support.
  const content: any[] = [{ type: "text", text: prompt }];
  for (const url of refImageDataUrls.slice(0, 3)) {
    content.push({ type: "image_url", image_url: { url } });
  }
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "google/gemini-3-pro-image",
      messages: [{ role: "user", content }],
      modalities: ["image", "text"],
    }),
  });
  if (!r.ok) throw new Error(`Image gen ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const url: string | undefined = j?.choices?.[0]?.message?.images?.[0]?.image_url?.url
    ?? j?.choices?.[0]?.message?.images?.[0]?.url;
  if (!url) throw new Error("No image returned");
  return url;
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const m = dataUrl.match(/^data:(image\/[a-z0-9+]+);base64,(.+)$/i);
  if (!m) throw new Error("Bad image data url");
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime: m[1] };
}

async function loadArtwork(supabase: any, projectId: string): Promise<ArtworkPayload> {
  const { data: row } = await supabase
    .from("project_sections").select("data").eq("project_id", projectId).eq("section", "artwork").maybeSingle();
  return (row?.data as ArtworkPayload) ?? { thumbnails: [], covers: [], references: [] };
}

/** Genre-aware art direction. Maps the detected genre family to concrete visual codes
 *  (palette, lighting, subject archetypes, era, texture) so first-pass art looks like
 *  a real release in that scene rather than generic AI imagery. */
function genreArtDirection(genre?: string, niche?: string, mood?: string): string {
  const g = `${genre || ""} ${niche || ""}`.toLowerCase();
  const m = (mood || "").toLowerCase();
  const has = (...keys: string[]) => keys.some((k) => g.includes(k));
  if (has("trap", "drill")) return "Visual codes: nocturnal cityscape, sodium-vapor street light, chrome and obsidian, smoke, low-angle hero portrait, grainy 35mm, deep shadows with crushed blacks and a single saturated accent (blood red, neon violet, or toxic green).";
  if (has("hip-hop", "hip hop", "rap")) return "Visual codes: bold portraiture, urban texture, film grain, warm street tungsten mixed with cool shadow, confident posture, mid-90s photo-journalism reference, hand-painted highlight on one element.";
  if (has("r&b", "rnb", "soul", "neo-soul", "neo soul")) return "Visual codes: velvet shadow, candlelit amber and oxblood palette, intimate close-up, soft focus skin texture, vinyl-era warmth, single key light, smoke or silk in frame.";
  if (has("pop")) return "Visual codes: high-key saturated color block, glossy magazine lighting, confident centered subject, glitter or liquid texture, bubblegum-meets-editorial, crisp Y2K-revival energy.";
  if (has("edm", "house", "techno", "trance", "dnb", "drum and bass", "dubstep")) return "Visual codes: cavernous club geometry, volumetric haze, lasers slicing through fog, chrome / liquid / iridescent material, motion-blurred crowd silhouettes, electric blue and magenta dual-tone.";
  if (has("rock", "metal", "punk", "grunge")) return "Visual codes: high-contrast monochrome with one bleed-through color, distressed paper or photocopy texture, kinetic motion, sweat-soaked stage light, raw 35mm flash, brutalist composition.";
  if (has("indie", "alt", "alternative", "shoegaze", "dream")) return "Visual codes: hazy 35mm film, soft sun flare, washed pastels, naturalistic candid framing, slightly off-center subject, melancholic warmth, 1970s photobook reference.";
  if (has("country", "folk", "americana", "bluegrass")) return "Visual codes: golden-hour plains, dust in the air, denim and weathered leather, hand-built wood, warm honeyed light, wide horizon, lived-in authenticity.";
  if (has("latin", "reggaeton", "perreo", "bachata", "salsa")) return "Visual codes: tropical neon and palm shadow, sweat and chrome, gold-tone jewelry catching light, sunset gradient, kinetic dancefloor energy, saturated reds and turquoise.";
  if (has("afrobeat", "afrobeats", "amapiano")) return "Visual codes: rich earth tones, golden afternoon sun, vibrant textile patterns, confident posture, lens-flared celebration, deep terracotta and cobalt accents.";
  if (has("jazz")) return "Visual codes: smoky club, brass and mahogany, single spotlight, Blue Note era photo reference, painterly grain, deep midnight blues and amber.";
  if (has("classical", "orchestral", "score", "soundtrack")) return "Visual codes: cathedral light, marble and gilt, dramatic chiaroscuro, baroque painterly quality, lone figure in vast architecture.";
  if (has("ambient", "lofi", "lo-fi", "chillhop", "chill")) return "Visual codes: rain on window, low warm lamp, analog tape texture, anime-cinematic stillness, muted teals and amber, painterly atmosphere.";
  if (has("gospel", "christian", "worship")) return "Visual codes: godrays through stained glass, hands raised, warm gold and ivory, reverent low angle, choir-loft scale, cinematic faith imagery.";
  if (has("dancehall", "reggae")) return "Visual codes: Caribbean sun, riso-print color blocking, hand-painted signage texture, gold and green and red accents, sweat-shine, low-angle confidence.";
  // Fallback uses mood + niche so we still get a steering line.
  const moodLine = m ? ` Mood-driven palette and lighting: ${m}.` : "";
  const nicheLine = niche ? ` Lean into the visual canon of "${niche}".` : "";
  return `Visual codes: distinctive, scene-appropriate art direction with a singular focal subject, bespoke color story, and texture that reads as a real release — not a stock AI render.${moodLine}${nicheLine}`;
}

function buildPrompt(kind: "thumbnail" | "cover", project: any, analysis: any, steering?: string, brief?: string, identity?: any) {
  const a = analysis || {};
  const artistLine = identity?.artist_name ? ` Artist: ${identity.artist_name}.` : "";
  const base = `Cover art for the song "${project.title}".${artistLine} Genre: ${a.genre || "modern"}. Niche: ${a.niche || ""}. Mood: ${a.mood || ""}. Production notes: ${a.productionNotes || ""}.`;
  const direction = genreArtDirection(a.genre, a.niche, a.mood);
  const originality = `Speak the visual language of the TOP artists in ${a.genre || "this genre"} — match the design aesthetic, palette discipline, typographic taste, photography style and finish of their official album covers — but make this composition unmistakably original. No clichés, no stock imagery, no AI-look gradients, no generic glow, no template feel.`;
  const briefLine = brief ? ` Shared visual brief: ${brief}.` : "";
  const ident = identity?.image_style_prompt ? ` Artist visual identity: ${identity.image_style_prompt}.` : "";
  const userDir = steering ? ` User direction (overrides where it conflicts): ${steering}.` : "";
  const style = `Photorealistic, cinematic lighting, high detail, gallery-quality, premium music release aesthetic.`;
  if (kind === "thumbnail") {
    const titleText = String(project.title || "").toUpperCase();
    const titleDirective = ` RENDER the song title "${titleText}" as bold, click-worthy YouTube thumbnail typography — large, perfectly legible at 320px wide, contemporary display sans-serif with a heavy weight, integrated into the composition (not slapped on), high-contrast against its background, optional subtle stroke or drop-shadow for readability. The title is the only text in the image — no other words, no logos, no watermarks, no captions, no numbers, no taglines.`;
    return `${base} ${direction} ${originality}${ident}${briefLine}${userDir} Compose for a 16:9 YouTube thumbnail: one bold focal subject, dramatic contrast, instantly readable at 320px wide. Reserve a clean zone (top-left or lower-third) for the title text.${titleDirective} ${style}`;
  }
  const coverLock = `Absolutely no text, no logos, no watermarks, no captions, no typography, no letters or numbers anywhere in the image.`;
  return `${base} ${direction} ${originality}${ident}${briefLine}${userDir} Compose for a 1:1 square album cover, distribution-ready (DistroKid 3000x3000): centered iconic composition, gallery-worthy, suitable for vinyl and streaming tile. ${style} ${coverLock}`;
}

async function storagePathToDataUrl(supabase: any, path: string): Promise<string | null> {
  // Download bytes via signed URL, return as data URL the image model can ingest.
  try {
    const { data } = await supabase.storage.from("videos").createSignedUrl(path, 300);
    if (!data?.signedUrl) return null;
    const r = await fetch(data.signedUrl);
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    const mime = r.headers.get("content-type") || "image/png";
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return `data:${mime};base64,${btoa(bin)}`;
  } catch { return null; }
}

async function loadIdentity(supabase: any, projectId: string) {
  const { data: p } = await supabase.from("projects").select("identity_id").eq("id", projectId).maybeSingle();
  if (!p?.identity_id) return null;
  const { data: i } = await supabase.from("identities").select("*").eq("id", p.identity_id).maybeSingle();
  return i ?? null;
}

export const generateArtwork = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { projectId: string; kind: "thumbnail" | "cover"; steering?: string; referenceImagePaths?: string[]; useResearch?: boolean }) => {
    if (!d?.projectId) throw new Error("projectId required");
    if (d.kind !== "thumbnail" && d.kind !== "cover") throw new Error("kind must be thumbnail or cover");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");
    const _action = data.kind === "cover" ? "image_cover" : "image_thumbnail";

    const { data: project } = await supabase
      .from("projects").select("id, title").eq("id", data.projectId).maybeSingle();
    if (!project) throw new Error("Project not found");
    const { data: rows } = await supabase
      .from("project_sections").select("section, data").eq("project_id", data.projectId)
      .in("section", ["analysis", "keywords", "metadata"]);
    const analysis = rows?.find((r) => r.section === "analysis")?.data;
    const kw = rows?.find((r) => r.section === "keywords")?.data as any;
    const meta = rows?.find((r) => r.section === "metadata")?.data as any;
    const identity = await loadIdentity(supabase, data.projectId);

    // Build optional brief from research when useResearch is set.
    let brief: string | undefined;
    const refUrls: string[] = [];
    if (data.useResearch) {
      const topTitles = (kw?.topTitles ?? []).slice(0, 6).join(" / ");
      const topTags = (kw?.topTags ?? []).slice(0, 10).join(", ");
      const tags = (meta?.tags ?? []).slice(0, 10).join(", ");
      const pool = Array.from(new Set([...(kw?.seeds ?? []), ...((kw?.rows ?? []).map((r: any) => r.term))])).slice(0, 30).join(", ");
      brief = `Match the visual codes of these top-performing videos in this niche. Top titles: ${topTitles}. Top tags: ${topTags}. Selected tags: ${tags}. Keyword pool the artist is targeting: ${pool}. Beat them by being more striking and on-genre.`;
      // Pull top thumbnails as references (HTTPS URLs work directly).
      for (const u of (kw?.topThumbnailUrls ?? []).slice(0, 3)) refUrls.push(u);
    }
    // User-uploaded references.
    for (const p of (data.referenceImagePaths ?? []).slice(0, 3)) {
      const url = await storagePathToDataUrl(supabase, p);
      if (url) refUrls.push(url);
    }
    // Identity reference images.
    for (const p of (identity?.reference_image_paths ?? []).slice(0, 2)) {
      const url = await storagePathToDataUrl(supabase, p);
      if (url) refUrls.push(url);
    }

    const prompt = buildPrompt(data.kind, project, analysis, data.steering, brief, identity);
    let dataUrl: string;
    try {
      dataUrl = await generateImage(apiKey, prompt, refUrls);
    } catch (e) {
      throw e;
    }
    const { bytes, mime } = dataUrlToBytes(dataUrl);
    const ext = mime.split("/")[1] || "png";
    const id = crypto.randomUUID();
    const path = `${userId}/${data.projectId}/${data.kind}-${id}.${ext}`;

    const { error: upErr } = await supabase.storage.from("videos").upload(path, bytes, {
      contentType: mime, upsert: true,
    });
    if (upErr) throw new Error(upErr.message);

    const current = await loadArtwork(supabase, data.projectId);
    const variant: ArtworkVariant = { id, storagePath: path, createdAt: new Date().toISOString() };
    const next: ArtworkPayload = {
      ...current,
      thumbnails: data.kind === "thumbnail" ? [variant, ...current.thumbnails].slice(0, 6) : current.thumbnails,
      covers: data.kind === "cover" ? [variant, ...current.covers].slice(0, 6) : current.covers,
      selectedThumbnailId: data.kind === "thumbnail" ? id : current.selectedThumbnailId,
      selectedCoverId: data.kind === "cover" ? id : current.selectedCoverId,
    };
    const { upsertSection } = await import("./sections.server");
    await upsertSection(supabase, data.projectId, "artwork", next);

    // Mirror selected cover onto project.cover_image_path for convenience
    if (data.kind === "cover") {
      await (supabase.from("projects") as any).update({ cover_image_path: path }).eq("id", data.projectId);
    }
    return next;
  });

/** Generate a cohesive thumbnail + cover pair sharing a visual brief.
 *  Uses one AI call to compose the brief, then two image-gen calls in parallel. */
export const generateArtworkPair = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { projectId: string; steering?: string; referenceImagePaths?: string[]; useResearch?: boolean }) => {
    if (!d?.projectId) throw new Error("projectId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const { data: project } = await supabase
      .from("projects").select("id, title").eq("id", data.projectId).maybeSingle();
    if (!project) throw new Error("Project not found");
    const { data: rows } = await supabase
      .from("project_sections").select("section, data").eq("project_id", data.projectId)
      .in("section", ["analysis", "keywords", "metadata"]);
    const analysis = rows?.find((r) => r.section === "analysis")?.data as any;
    const kw = rows?.find((r) => r.section === "keywords")?.data as any;
    const meta = rows?.find((r) => r.section === "metadata")?.data as any;
    const identity = await loadIdentity(supabase, data.projectId);

    // Compose shared brief.
    const briefSys = `You are an award-winning art director for a music release. Write ONE short paragraph (<=70 words) describing a singular, gallery-worthy, photorealistic and cinematic image concept rooted in the genre's visual canon — but with ONE unexpected element that makes it unmistakably this release. Specify subject, palette, lighting, mood, era reference, and composition. The same concept must work as both a 1:1 album cover and a 16:9 YouTube thumbnail. No text, no logos, no typography in the image. No clichés, no stock-AI gradients. Return only the paragraph.`;
    const briefUsr = JSON.stringify({
      title: project.title,
      analysis: analysis ? { genre: analysis.genre, niche: analysis.niche, mood: analysis.mood, key: analysis.key, bpm: analysis.bpm, productionNotes: analysis.productionNotes } : null,
      genreArtDirection: genreArtDirection(analysis?.genre, analysis?.niche, analysis?.mood),
      topTitles: (kw?.topTitles ?? []).slice(0, 6),
      topTags: (kw?.topTags ?? []).slice(0, 10),
      keywordPool: Array.from(new Set([...(kw?.seeds ?? []), ...((kw?.rows ?? []).map((r: any) => r.term))])).slice(0, 12),
      selectedTags: (meta?.tags ?? []).slice(0, 10),
      identityStyle: identity?.image_style_prompt ?? null,
      direction: data.steering ?? null,
      useResearch: !!data.useResearch,
    });
    let brief = "";
    try {
      const br = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "system", content: briefSys },
            { role: "user", content: briefUsr },
          ],
        }),
      });
      if (br.ok) {
        const j = await br.json();
        brief = String(j?.choices?.[0]?.message?.content ?? "").trim();
      }
    } catch (e) { console.error("brief failed", e); }

    // Collect reference images (research thumbnails when requested + uploaded refs + identity refs).
    const refUrls: string[] = [];
    if (data.useResearch) {
      for (const u of (kw?.topThumbnailUrls ?? []).slice(0, 3)) refUrls.push(u);
    }
    for (const p of (data.referenceImagePaths ?? []).slice(0, 3)) {
      const u = await storagePathToDataUrl(supabase, p);
      if (u) refUrls.push(u);
    }
    for (const p of (identity?.reference_image_paths ?? []).slice(0, 2)) {
      const u = await storagePathToDataUrl(supabase, p);
      if (u) refUrls.push(u);
    }

    const thumbPrompt = buildPrompt("thumbnail", project, analysis, data.steering, brief, identity);
    const coverPrompt = buildPrompt("cover", project, analysis, data.steering, brief, identity);

    let thumbDataUrl: string, coverDataUrl: string;
    try {
      [thumbDataUrl, coverDataUrl] = await Promise.all([
        generateImage(apiKey, thumbPrompt, refUrls),
        generateImage(apiKey, coverPrompt, refUrls),
      ]);
    } catch (e) {
      throw e;
    }

    const current = await loadArtwork(supabase, data.projectId);
    const variants: { kind: "thumbnail" | "cover"; v: ArtworkVariant }[] = [];
    for (const [kind, du] of [["thumbnail", thumbDataUrl], ["cover", coverDataUrl]] as const) {
      const { bytes, mime } = dataUrlToBytes(du);
      const ext = mime.split("/")[1] || "png";
      const id = crypto.randomUUID();
      const path = `${userId}/${data.projectId}/${kind}-${id}.${ext}`;
      const { error } = await supabase.storage.from("videos").upload(path, bytes, { contentType: mime, upsert: true });
      if (error) throw new Error(error.message);
      variants.push({ kind, v: { id, storagePath: path, createdAt: new Date().toISOString() } });
    }
    const thumb = variants.find((x) => x.kind === "thumbnail")!.v;
    const cover = variants.find((x) => x.kind === "cover")!.v;
    const next: ArtworkPayload = {
      ...current,
      thumbnails: [thumb, ...current.thumbnails].slice(0, 6),
      covers: [cover, ...current.covers].slice(0, 6),
      selectedThumbnailId: thumb.id,
      selectedCoverId: cover.id,
    };
    const { upsertSection } = await import("./sections.server");
    await upsertSection(supabase, data.projectId, "artwork", next);
    await (supabase.from("projects") as any).update({ cover_image_path: cover.storagePath }).eq("id", data.projectId);
    return next;
  });

/** Upload a user-supplied reference image to videos/{user}/{project}/refs/.
 *  Returns the storage path so the client can include it on the next generation. */
export const addArtworkReference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { projectId: string; storagePath: string }) => {
    if (!d?.projectId || !d?.storagePath) throw new Error("projectId and storagePath required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const current = await loadArtwork(context.supabase, data.projectId);
    const v: ArtworkVariant = { id: crypto.randomUUID(), storagePath: data.storagePath, createdAt: new Date().toISOString() };
    const next: ArtworkPayload = { ...current, references: [v, ...(current.references ?? [])].slice(0, 6) };
    const { upsertSection } = await import("./sections.server");
    await upsertSection(context.supabase, data.projectId, "artwork", next);
    return next;
  });

export const removeArtworkReference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { projectId: string; id: string }) => {
    if (!d?.projectId || !d?.id) throw new Error("projectId and id required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const current = await loadArtwork(context.supabase, data.projectId);
    const next: ArtworkPayload = { ...current, references: (current.references ?? []).filter((r) => r.id !== data.id) };
    const { upsertSection } = await import("./sections.server");
    await upsertSection(context.supabase, data.projectId, "artwork", next);
    return next;
  });

export const selectArtwork = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { projectId: string; kind: "thumbnail" | "cover"; id: string }) => {
    if (!d?.projectId || !d?.id) throw new Error("projectId and id required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const current = await loadArtwork(context.supabase, data.projectId);
    const next: ArtworkPayload = {
      ...current,
      selectedThumbnailId: data.kind === "thumbnail" ? data.id : current.selectedThumbnailId,
      selectedCoverId: data.kind === "cover" ? data.id : current.selectedCoverId,
    };
    const { upsertSection } = await import("./sections.server");
    await upsertSection(context.supabase, data.projectId, "artwork", next);
    if (data.kind === "cover") {
      const sel = current.covers.find((c) => c.id === data.id);
      if (sel) await (context.supabase.from("projects") as any).update({ cover_image_path: sel.storagePath }).eq("id", data.projectId);
    }
    return next;
  });

/** Register a user-uploaded image (already saved to the videos bucket) as a
 *  thumbnail or cover variant, and auto-select it. Lets users skip AI
 *  generation entirely with their own artwork. */
export const useOwnArtwork = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { projectId: string; kind: "thumbnail" | "cover"; storagePath: string }) => {
    if (!d?.projectId || !d?.storagePath) throw new Error("projectId and storagePath required");
    if (d.kind !== "thumbnail" && d.kind !== "cover") throw new Error("kind must be thumbnail or cover");
    return d;
  })
  .handler(async ({ data, context }) => {
    const current = await loadArtwork(context.supabase, data.projectId);
    const v: ArtworkVariant = { id: crypto.randomUUID(), storagePath: data.storagePath, createdAt: new Date().toISOString() };
    const next: ArtworkPayload = {
      ...current,
      thumbnails: data.kind === "thumbnail" ? [v, ...current.thumbnails].slice(0, 6) : current.thumbnails,
      covers: data.kind === "cover" ? [v, ...current.covers].slice(0, 6) : current.covers,
      selectedThumbnailId: data.kind === "thumbnail" ? v.id : current.selectedThumbnailId,
      selectedCoverId: data.kind === "cover" ? v.id : current.selectedCoverId,
    };
    const { upsertSection } = await import("./sections.server");
    await upsertSection(context.supabase, data.projectId, "artwork", next);
    if (data.kind === "cover") {
      await (context.supabase.from("projects") as any).update({ cover_image_path: data.storagePath }).eq("id", data.projectId);
    }
    return next;
  });