import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type MetadataPayload = {
  titles: string[];          // 5 candidates
  selectedTitle: string;
  description: string;
  tags: string[];            // up to 20
  hashtags: string[];        // 3-5 leading #
};

function extractJson<T = unknown>(text: string): T | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]) as T; } catch { return null; }
}

export const generateMetadata = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { projectId: string; steering?: string }) => {
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
    const { data: sections } = await supabase
      .from("project_sections").select("section, data").eq("project_id", data.projectId);
    const analysis = sections?.find((s) => s.section === "analysis")?.data as any;
    const keywords = sections?.find((s) => s.section === "keywords")?.data as any;

    // Use the user's curated keyword pool (seeds) as the source of truth, then
    // fold in the highest-opportunity researched terms. This way every edit the
    // user made in the Keywords step — adds, removes, "Discover" picks — flows
    // through to titles, descriptions and tags.
    const seedTerms: string[] = Array.isArray(keywords?.seeds) ? keywords.seeds : [];
    const researchedTerms: string[] = Array.isArray(keywords?.rows)
      ? keywords.rows.filter((r: any) => !r.failed).slice(0, 8).map((r: any) => r.term)
      : [];
    const topKeywords: string[] = Array.from(
      new Set([...seedTerms, ...researchedTerms].map((s) => s.trim()).filter(Boolean)),
    ).slice(0, 30);
    const topDescriptionSamples: string[] = Array.isArray(keywords?.topDescriptionSamples)
      ? keywords.topDescriptionSamples.slice(0, 3)
      : [];

    const system = `You are a YouTube SEO strategist for independent musicians. Return STRICT JSON only — no prose, no code fence — matching:
{"titles":string[5],"selectedTitle":string,"description":string,"tags":string[15..20],"hashtags":string[3..5]}
Rules:
- Titles: under 70 chars, click-worthy, include genre/niche, no clickbait lies.
- selectedTitle: pick the strongest of the 5.
- description: 350-700 chars. Keep it SIMPLE and human. Focus ONLY on the mood and listening experience — how the track feels, when to play it, who it's for. DO NOT reveal or reference musical analysis details (no BPM, no key, no LUFS, no production breakdowns, no "the track uses…"). Do NOT sound like an AI or a review. Include a link placeholder block with "Stream everywhere: [link]" and "Follow: [link]", and a short "Like 👍 and Subscribe 🔔 for more" line. End with the hashtags on the final line.
- If referenceDescriptions are provided, mirror the STRUCTURE of top-ranking videos in this niche (section order, link-block style, emoji density, line breaks, hashtag placement) so the description fits the niche — but write ORIGINAL copy. Never copy phrases verbatim from them, and never surface any analysis details even if the references do.
- tags: lowercase, no #, niche-first, max 500 chars total.
- hashtags: 3-5, start with #, no spaces.`;

    // Only pass mood/genre/niche cues — never full analysis — so descriptions
    // stay experience-focused and can't be reverse-engineered into a prompt.
    const moodCtx = analysis
      ? {
          mood: (analysis as any).mood ?? null,
          genre: (analysis as any).genre ?? null,
          niche: (analysis as any).niche ?? null,
        }
      : null;
    const ctx = {
      title: project.title,
      mood: moodCtx,
      topKeywords,
      referenceDescriptions: topDescriptionSamples.map((s: string) => String(s).slice(0, 600)),
      steering: data.steering ?? null,
    };

    async function callOnce(): Promise<MetadataPayload> {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 45_000);
      try {
        const gw = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          signal: ctrl.signal,
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            max_tokens: 4096,
            messages: [
              { role: "system", content: system },
              { role: "user", content: `Context:\n${JSON.stringify(ctx)}\nReturn the JSON now.` },
            ],
          }),
        });
        if (!gw.ok) {
          const body = (await gw.text()).slice(0, 200);
          const err: any = new Error(`AI gateway ${gw.status}: ${body}`);
          err.status = gw.status;
          throw err;
        }
        const payload = await gw.json();
        const text: string = payload?.choices?.[0]?.message?.content ?? "";
        const parsed = extractJson<MetadataPayload>(text);
        if (!parsed) throw new Error("Could not parse metadata response");
        return parsed;
      } finally {
        clearTimeout(t);
      }
    }

    let parsed: MetadataPayload;
    try {
      parsed = await callOnce();
    } catch (e: any) {
      const retryable = e?.name === "AbortError" || e?.status === 524 || (e?.status >= 500 && e?.status < 600);
      if (!retryable) throw e;
      try {
        parsed = await callOnce();
      } catch (e2: any) {
        if (e2?.name === "AbortError" || e2?.status === 524) {
          throw new Error("Metadata generation timed out — try again.");
        }
        throw e2;
      }
    }

    const { upsertSection } = await import("./sections.server");

    // Append the artist's storefront link so every release drives traffic to
    // where fans can actually buy the track.
    try {
      const { data: store } = await supabase
        .from("stores").select("handle, published").eq("user_id", userId).maybeSingle();
      const handle = (store as any)?.handle;
      if (handle && (store as any)?.published) {
        const { getPublicOrigin } = await import("@/lib/public-origin");
        const link = `${getPublicOrigin()}/store/${handle}`;
        if (!parsed.description.includes(link)) {
          parsed.description = `${parsed.description.trim()}\n\n🎧 Buy / license this track: ${link}`;
        }
      }
    } catch (e) {
      console.error("[metadata] store link append failed", e);
    }

    await upsertSection(supabase, data.projectId, "metadata", parsed);
    return parsed;
  });

export const updateMetadata = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { projectId: string; payload: MetadataPayload }) => {
    if (!d?.projectId) throw new Error("projectId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { upsertSection } = await import("./sections.server");
    await upsertSection(context.supabase, data.projectId, "metadata", data.payload);
    return { ok: true };
  });