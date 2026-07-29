import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type KeywordRow = {
  term: string;
  resultCount: number;       // total result volume signal (search.list totalResults)
  avgViews: number;          // top-10 average views
  topChannelSubs: number;    // largest channel competing in top 10
  competition: "low" | "medium" | "high";
  opportunity: number;       // 0-100
  demandScore: number;       // 0-100, derived from top-10 view + recency + engagement
  estMonthlySearches: number;// rough banded estimate (0, 1000, 5000, 25000, 100000, 500000)
  failed?: boolean;          // true when the external research call failed after retries
  failedReason?: { code: "quota" | "rate" | "bad_request" | "network" | "unknown"; status?: number; message?: string };
  researchedAt?: string;     // ISO time the row's underlying YouTube calls completed
};

export type KeywordsPayload = {
  seeds: string[];
  rows: KeywordRow[];
  generatedAt: string;
  failedSeeds?: string[];
  /** Set when the last run hit YouTube's daily quota. UI shows a blocker
   *  banner with the reset time instead of letting users mash Retry. */
  quotaExhausted?: boolean;
  quotaExhaustedAt?: string;
  topDescriptionSamples?: string[];
  topThumbnailUrls?: string[];
  topTags?: string[];
  topTitles?: string[];
};

function apiKey() {
  const k = process.env.YOUTUBE_API_KEY;
  if (!k) throw new Error("YOUTUBE_API_KEY not configured");
  return k;
}

async function ytSearch(key: string, q: string) {
  const u = new URL("https://www.googleapis.com/youtube/v3/search");
  u.searchParams.set("part", "snippet");
  u.searchParams.set("q", q);
  u.searchParams.set("type", "video");
  u.searchParams.set("maxResults", "10");
  u.searchParams.set("order", "relevance");
  u.searchParams.set("key", key);
  const r = await fetch(u);
  if (!r.ok) {
    const body = (await r.text()).slice(0, 400);
    const err: any = new Error(`YouTube search failed (${r.status}): ${body}`);
    err.status = r.status;
    err.body = body;
    throw err;
  }
  return r.json() as Promise<{
    pageInfo: { totalResults: number };
    items: Array<{ id: { videoId: string }; snippet: { channelId: string } }>;
  }>;
}

function isRateLimit(e: any): boolean {
  return e?.status === 403 || e?.status === 429 || (e?.status >= 500 && e?.status < 600);
}
function isHardQuota(e: any): boolean {
  const body = String(e?.body || e?.message || "");
  // YouTube can return either 403 or 429 for exhausted daily quota,
  // especially for the Search Queries per day metric. Treat both as a
  // hard stop so we do not retry every keyword and burn more calls.
  return (e?.status === 403 || e?.status === 429) && /quotaExceeded|dailyLimitExceeded|Search Queries per day/i.test(body);
}
function classifyError(e: any): NonNullable<KeywordRow["failedReason"]> {
  if (isHardQuota(e)) return { code: "quota", status: e?.status, message: "YouTube daily quota exhausted" };
  if (e?.status === 429 || (e?.status >= 500 && e?.status < 600)) {
    return { code: "rate", status: e?.status, message: "YouTube temporarily rate-limited or unavailable" };
  }
  if (e?.status >= 400 && e?.status < 500) {
    return { code: "bad_request", status: e?.status, message: String(e?.body || e?.message || "").slice(0, 200) };
  }
  return { code: "unknown", status: e?.status, message: String(e?.message || "").slice(0, 200) };
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Build a YouTube-friendly query for a display keyword. Single-token genres like
 *  "R&B" or "Trap" return mixed results, so we append " music" only for the API
 *  call — the display label stays the user's original term. */
function normalizeQuery(keyword: string): string {
  const trimmed = keyword.replace(/\s+/g, " ").trim();
  if (!trimmed) return trimmed;
  const lower = trimmed.toLowerCase();
  // Already has a music-intent word, leave alone.
  if (/(music|beat|type beat|instrumental|playlist|mix|song|track|cover|remix|live|lyric|video|bpm)/i.test(lower)) {
    return trimmed;
  }
  // Short genre-like keywords → add "music" so YouTube returns musical results.
  if (trimmed.split(/\s+/).length <= 2) return `${trimmed} music`;
  return trimmed;
}

async function ytVideos(key: string, ids: string[]) {
  if (!ids.length) return { items: [] as any[] };
  const u = new URL("https://www.googleapis.com/youtube/v3/videos");
  u.searchParams.set("part", "statistics,snippet");
  u.searchParams.set("id", ids.join(","));
  u.searchParams.set("key", key);
  const r = await fetch(u);
  if (!r.ok) {
    const body = (await r.text()).slice(0, 400);
    const err: any = new Error(`YouTube videos failed (${r.status}): ${body}`);
    err.status = r.status;
    err.body = body;
    throw err;
  }
  return r.json() as Promise<{
    items: Array<{
      statistics: { viewCount?: string; likeCount?: string; commentCount?: string };
      snippet: {
        channelId: string;
        description?: string;
        title?: string;
        publishedAt?: string;
        tags?: string[];
        thumbnails?: { high?: { url: string }; medium?: { url: string }; default?: { url: string } };
      };
    }>;
  }>;
}

async function ytChannels(key: string, ids: string[]) {
  if (!ids.length) return { items: [] as any[] };
  const u = new URL("https://www.googleapis.com/youtube/v3/channels");
  u.searchParams.set("part", "statistics");
  u.searchParams.set("id", ids.join(","));
  u.searchParams.set("key", key);
  const r = await fetch(u);
  if (!r.ok) {
    const body = (await r.text()).slice(0, 400);
    const err: any = new Error(`YouTube channels failed (${r.status}): ${body}`);
    err.status = r.status;
    err.body = body;
    throw err;
  }
  return r.json() as Promise<{ items: Array<{ id: string; statistics: { subscriberCount?: string } }> }>;
}

function scoreRow(resultCount: number, avgViews: number, topSubs: number): { competition: KeywordRow["competition"]; opportunity: number } {
  const competition = topSubs > 1_000_000 ? "high" : topSubs > 100_000 ? "medium" : "low";
  // Opportunity favors high views with low competition.
  const viewScore = Math.min(60, Math.log10(Math.max(avgViews, 10)) * 12);
  const compPenalty = competition === "high" ? 30 : competition === "medium" ? 12 : 0;
  const volumeBonus = Math.min(40, Math.log10(Math.max(resultCount, 10)) * 6);
  return { competition, opportunity: Math.max(0, Math.min(100, Math.round(viewScore + volumeBonus - compPenalty))) };
}

/** Demand score: blend of audience size (top-10 view sum), per-video avg views,
 *  recency (share of top-10 within 90 days), and engagement.
 *  Returns 0-100. Pure-function of values we already fetch — no extra quota. */
function computeDemand(args: {
  views: number[];
  publishedDates: string[];
  likes: number[];
  comments: number[];
}): number {
  const { views, publishedDates, likes, comments } = args;
  if (!views.length) return 0;
  const sum = views.reduce((a, b) => a + b, 0);
  const avg = sum / views.length;
  // Audience depth: log10 of cumulative top-10 views.  10k→4, 1M→6, 100M→8.
  const depth = Math.min(35, (Math.log10(Math.max(sum, 10)) - 3) * 9); // 0..35
  // Per-video traction
  const pv = Math.min(35, (Math.log10(Math.max(avg, 10)) - 2) * 10); // 0..35
  // Recency boost: share of top-10 published in last 90d
  const now = Date.now();
  const recentShare =
    publishedDates.filter((d) => {
      const t = Date.parse(d);
      return Number.isFinite(t) && now - t < 90 * 86400_000;
    }).length / publishedDates.length;
  const recency = Math.round(recentShare * 20); // 0..20
  // Engagement: avg (likes+comments)/views
  const eng =
    views.reduce((acc, v, i) => acc + (v > 0 ? ((likes[i] || 0) + (comments[i] || 0)) / v : 0), 0) /
    views.length;
  const engBoost = Math.min(10, eng * 1000); // typical eng ~0.005 → 5
  return Math.max(0, Math.min(100, Math.round(depth + pv + recency + engBoost)));
}

/** Banded estimate of monthly searches from top-10 view behavior.
 *  Heuristic — labeled "est." in the UI.
 *
 *  Equation (designed to reflect *search* demand, not catalog popularity —
 *  YouTube music videos accumulate most views from Browse / Suggested /
 *  Playlists, so dividing raw lifetime views by age overcounts search):
 *    medianViews   = median of top-10 view counts (kills viral-outlier bias)
 *    proxyTotal    = medianViews * 10
 *    avgAgeMonths  = mean months since each top-10 video was published (floored at 3)
 *    monthlyViews  = proxyTotal / avgAgeMonths
 *    SEARCH_SHARE  = 0.08 (YouTube search drives ~5–15% of music views)
 *    monthlySearches ≈ monthlyViews * SEARCH_SHARE * demandTilt(0.9..1.1)
 *    Catalog-dominated queries (avgAgeMonths > 48) are multiplied by 0.5
 *    to acknowledge most of those views are historical, not recent search.
 *    Result is snapped to standard bands, capped at 1,000,000.
 */
function estimateMonthlySearches(args: {
  views: number[];
  publishedDates: string[];
  demand: number;
}): number {
  const { views, publishedDates, demand } = args;
  if (!views.length || !views.some((v) => v > 0)) return 0;
  const sorted = [...views].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianViews =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const proxyTotal = medianViews * 10;
  const now = Date.now();
  const monthMs = 30 * 86400_000;
  const ages = publishedDates
    .map((d) => {
      const t = Date.parse(d);
      return Number.isFinite(t) ? Math.max(3, (now - t) / monthMs) : null;
    })
    .filter((x): x is number => x !== null);
  const avgAgeMonths = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : 18;
  const SEARCH_SHARE = 0.08;
  const monthlyViews = proxyTotal / avgAgeMonths;
  const demandTilt = 0.9 + (demand / 100) * 0.2; // 0.9..1.1
  const catalogFactor = avgAgeMonths > 48 ? 0.5 : 1;
  const monthlySearches = monthlyViews * SEARCH_SHARE * demandTilt * catalogFactor;
  const bands = [
    0, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000,
    100_000, 250_000, 500_000, 1_000_000,
  ];
  let best = 0;
  for (const b of bands) if (monthlySearches >= b) best = b;
  return best;
}

function failedKeywordRow(term: string, reason?: KeywordRow["failedReason"]): KeywordRow {
  return {
    term,
    resultCount: 0,
    avgViews: 0,
    topChannelSubs: 0,
    competition: "low",
    opportunity: 0,
    demandScore: 0,
    estMonthlySearches: 0,
    failed: true,
    failedReason: reason,
  };
}

function compactErrorForLog(e: any) {
  const status = e?.status;
  const body = String(e?.body || e?.message || "");
  const reason = /quotaExceeded|dailyLimitExceeded|Search Queries per day/i.test(body)
    ? "quota"
    : /keyInvalid|API key|forbidden|badRequest/i.test(body)
      ? "configuration"
      : status === 429
        ? "rate"
        : "unknown";
  return { status, reason, message: body.slice(0, 220) };
}

export const researchKeywords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { projectId: string; seeds: string[]; forceRefresh?: boolean }) => {
    if (!d?.projectId) throw new Error("projectId required");
    if (!Array.isArray(d.seeds) || d.seeds.length === 0) throw new Error("Provide at least one keyword");
    if (d.seeds.length > 30) throw new Error("Max 30 keywords per run");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { upsertSection } = await import("./sections.server");
    const key = apiKey();

    const researchedRows: KeywordRow[] = [];
    const descSamples: Array<{ views: number; description: string }> = [];
    const topPerformers: Array<{ views: number; thumbnail: string; title: string; tags: string[] }> = [];

    // Load previous payload so we can preserve prior good rows for keywords that
    // fail this run (transient API errors should not erase real data).
    const { data: prior } = await supabase
      .from("project_sections")
      .select("data")
      .eq("project_id", data.projectId)
      .eq("section", "keywords")
      .maybeSingle();
    const priorPayload = (prior?.data ?? null) as KeywordsPayload | null;
    const priorRowByTerm = new Map<string, KeywordRow>();
    (priorPayload?.rows ?? []).forEach((r) => priorRowByTerm.set(r.term.toLowerCase(), r));
    const isRetrySubset = Boolean(
      priorPayload?.seeds?.length &&
      data.seeds.length < priorPayload.seeds.length &&
      data.seeds.every((seed) => priorPayload.seeds.some((s) => s.toLowerCase() === seed.toLowerCase())),
    );

    // Reuse non-failed rows under 24h old to protect YouTube quota.
    // forceRefresh=true (user clicked "Re-run research") skips this cache.
    const FRESH_MS = 24 * 60 * 60 * 1000;
    const force = data.forceRefresh === true;
    function freshPriorRow(seed: string): KeywordRow | null {
      const prev = priorRowByTerm.get(seed.toLowerCase());
      if (!prev || prev.failed) return null;
      const ts = prev.researchedAt ? Date.parse(prev.researchedAt) : NaN;
      if (!Number.isFinite(ts)) return null;
      if (Date.now() - ts > FRESH_MS) return null;
      return prev;
    }

    async function processKeyword(keyword: string): Promise<KeywordRow> {
      const q = normalizeQuery(keyword);
      const s = await ytSearch(key, q);
        const vidIds = s.items.map((i) => i.id.videoId).filter(Boolean);
        const v = await ytVideos(key, vidIds);
        const chIds = Array.from(new Set(v.items.map((i) => i.snippet.channelId)));
        const c = await ytChannels(key, chIds);
        const views = v.items.map((i) => Number(i.statistics.viewCount || 0));
        const avgViews = views.length ? Math.round(views.reduce((a, b) => a + b, 0) / views.length) : 0;
        const topSubs = Math.max(0, ...c.items.map((i) => Number(i.statistics.subscriberCount || 0)));
        let bestIdx = -1, bestViews = -1;
        v.items.forEach((it, i) => {
          const vn = Number(it.statistics.viewCount || 0);
          if (vn > bestViews && (it.snippet.description || "").trim().length > 80) { bestViews = vn; bestIdx = i; }
        });
        if (bestIdx >= 0) {
          const d = (v.items[bestIdx].snippet.description || "").trim().slice(0, 800);
          descSamples.push({ views: bestViews, description: d });
        }
        v.items.forEach((it) => {
          const vn = Number(it.statistics.viewCount || 0);
          const thumb = it.snippet.thumbnails?.high?.url || it.snippet.thumbnails?.medium?.url;
          if (thumb) topPerformers.push({ views: vn, thumbnail: thumb, title: it.snippet.title || "", tags: it.snippet.tags || [] });
        });
        const scored = scoreRow(s.pageInfo.totalResults, avgViews, topSubs);
        const demandScore = computeDemand({
          views,
          publishedDates: v.items.map((i) => i.snippet.publishedAt || ""),
          likes: v.items.map((i) => Number(i.statistics.likeCount || 0)),
          comments: v.items.map((i) => Number(i.statistics.commentCount || 0)),
        });
        const estMonthlySearches = estimateMonthlySearches({
          views,
          publishedDates: v.items.map((i) => i.snippet.publishedAt || ""),
          demand: demandScore,
        });
      return {
          term: keyword,
          resultCount: s.pageInfo.totalResults,
          avgViews,
          topChannelSubs: topSubs,
          ...scored,
          demandScore,
          estMonthlySearches,
          researchedAt: new Date().toISOString(),
      };
    }

    // Process sequentially with retry/backoff so every keyword is researched
    // independently and YouTube per-second limits are less likely to trigger.
    // If quota is hit, stop calling YouTube and reuse prior rows for the rest.
    let quotaExhausted = false;
    for (let i = 0; i < data.seeds.length; i++) {
      const keyword = data.seeds[i];
      // Cache-reuse: fresh prior good row, no API call.
      if (!force) {
        const fresh = freshPriorRow(keyword);
        if (fresh) { researchedRows.push({ ...fresh, term: keyword, failed: false }); continue; }
      }
      if (quotaExhausted) {
        const prev = priorRowByTerm.get(keyword.toLowerCase());
        researchedRows.push(
          prev && !prev.failed
            ? { ...prev, term: keyword, failed: false }
            : failedKeywordRow(keyword, { code: "quota", message: "Skipped — YouTube daily quota exhausted on this run" }),
        );
        continue;
      }
      let attempt = 0;
      let lastErr: any = null;
      while (attempt < 4) {
        try {
          const row = await processKeyword(keyword);
          researchedRows.push({ ...row, failed: false });
          lastErr = null;
          break;
        } catch (e: any) {
          lastErr = e;
          if (isHardQuota(e)) { quotaExhausted = true; break; }
          if (attempt >= 3) break;
          await sleep(attempt === 0 ? 400 : attempt === 1 ? 1200 : isRateLimit(e) ? 3000 : 1800);
          attempt++;
        }
      }
      if (lastErr) {
        console.error("keyword failed", keyword, compactErrorForLog(lastErr));
        const reason = classifyError(lastErr);
        const prev = priorRowByTerm.get(keyword.toLowerCase());
        if (prev && !prev.failed) {
          researchedRows.push({ ...prev, term: keyword, failed: false }); // preserve previous good row
        } else {
          researchedRows.push(failedKeywordRow(keyword, reason));
        }
      }
      if (i < data.seeds.length - 1) await sleep(150);
    }

    const researchedByTerm = new Map<string, KeywordRow>();
    researchedRows.forEach((row) => researchedByTerm.set(row.term.toLowerCase(), row));
    const outputSeeds = isRetrySubset ? (priorPayload?.seeds ?? data.seeds) : data.seeds;
    const rows = outputSeeds.map((seed) => {
      const fresh = researchedByTerm.get(seed.toLowerCase());
      if (fresh) return fresh;
      const prev = priorRowByTerm.get(seed.toLowerCase());
      return prev ?? failedKeywordRow(seed);
    });
    const finalFailedSeeds = rows.filter((row) => row.failed).map((row) => row.term);

    rows.sort((a, b) => Number(Boolean(a.failed)) - Number(Boolean(b.failed)) || b.opportunity - a.opportunity);
    const topDescriptionSamples = descSamples
      .sort((a, b) => b.views - a.views)
      .slice(0, 3)
      .map((x) => x.description);
    // Dedupe & rank top performers for downstream use (artwork, metadata).
    const sortedPerf = topPerformers.sort((a, b) => b.views - a.views).slice(0, 12);
    const topThumbnailUrls = Array.from(new Set(sortedPerf.map((p) => p.thumbnail))).slice(0, 5);
    const topTitles = Array.from(new Set(sortedPerf.map((p) => p.title).filter(Boolean))).slice(0, 8);
    const tagFreq = new Map<string, number>();
    sortedPerf.forEach((p) => p.tags.forEach((t) => {
      const k = t.toLowerCase().trim();
      if (k) tagFreq.set(k, (tagFreq.get(k) || 0) + 1);
    }));
    const topTags = [...tagFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([t]) => t);
    const payload: KeywordsPayload = {
      seeds: outputSeeds,
      rows,
      generatedAt: new Date().toISOString(),
      failedSeeds: finalFailedSeeds,
      quotaExhausted: quotaExhausted || undefined,
      quotaExhaustedAt: quotaExhausted ? new Date().toISOString() : undefined,
      // Fall back to previous research context when this run had no fresh samples.
      topDescriptionSamples: topDescriptionSamples.length ? topDescriptionSamples : (priorPayload?.topDescriptionSamples ?? []),
      topThumbnailUrls: topThumbnailUrls.length ? topThumbnailUrls : (priorPayload?.topThumbnailUrls ?? []),
      topTags: topTags.length ? topTags : (priorPayload?.topTags ?? []),
      topTitles: topTitles.length ? topTitles : (priorPayload?.topTitles ?? []),
    };
    await upsertSection(supabase, data.projectId, "keywords", payload);
    return payload;
  });

export const updateKeywords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { projectId: string; payload: KeywordsPayload }) => {
    if (!d?.projectId) throw new Error("projectId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { upsertSection } = await import("./sections.server");
    await upsertSection(context.supabase, data.projectId, "keywords", data.payload);
    return { ok: true };
  });

function dedupe(arr: string[], limit = 15) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    const cleaned = raw.replace(/\s+/g, " ").trim();
    const s = cleaned.toLowerCase();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(cleaned);
    if (out.length >= limit) break;
  }
  return out;
}

function primaryDescriptor(text: string): string {
  return text
    .split(/,|\band\b|\/|;/i)
    .map((x) => x.trim())
    .filter(Boolean)[0] ?? "";
}

function extractJsonArray(text: string): string[] | null {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : null;
  } catch { return null; }
}

export const suggestKeywordSeeds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { projectId: string; steering?: string }) => {
    if (!d?.projectId) throw new Error("projectId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row } = await supabase
      .from("project_sections")
      .select("data")
      .eq("project_id", data.projectId)
      .eq("section", "analysis")
      .maybeSingle();
    const a = (row?.data ?? null) as null | {
      genre?: string; niche?: string; mood?: string; bpm?: number | null; key?: string;
    };
    if (!a?.genre && !a?.niche) {
      throw new Error("Run Analysis first — keywords are derived from the detected genre and niche.");
    }

    const genre = (a.genre || "").trim();
    const niche = (a.niche || "").trim();
    const mood = (a.mood || "").trim();
    const primaryMood = primaryDescriptor(mood) || mood;
    const bpm = a.bpm ?? null;

    const base = [
      niche,
      genre,
      niche && `${niche} type beat`,
      genre && primaryMood && `${genre} ${primaryMood}`,
      niche && bpm && `${niche} ${bpm} bpm`,
      genre && `${genre} instrumental`,
      niche && `new ${niche} 2026`,
    ].filter(Boolean) as string[];

    // Ask Gemini for 3 long-tail variants conditioned strictly on the analysis.
    let longTails: string[] = [];
    const apiKeyAi = process.env.LOVABLE_API_KEY;
    if (apiKeyAi) {
      try {
        const sys = `You are a YouTube keyword strategist for music. Given a track's analysis, return STRICT JSON: a JSON array of 3 long-tail YouTube search phrases (3-6 words each, lowercase, no hashtags, no quotes) that real listeners would type to discover this exact sound. Do NOT include the base genre/niche alone. No prose, no code fence.`;
        const usr = `Analysis: ${JSON.stringify(a)}${data.steering ? `\nExtra direction: ${data.steering}` : ""}\nReturn the JSON array now.`;
        const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKeyAi}` },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: sys },
              { role: "user", content: usr },
            ],
          }),
        });
        if (r.ok) {
          const j = await r.json();
          const text: string = j?.choices?.[0]?.message?.content ?? "";
          longTails = extractJsonArray(text) ?? [];
        }
      } catch (e) { console.error("long-tail gen failed", e); }
    }

    const seeds = dedupe([...base, ...longTails], 12);
    return { seeds, source: { genre, niche, mood, bpm } };
  });

export type KeywordOpportunity = { term: string; why: string };

/** Discover *new* keyword/niche opportunities that aren't already in the table.
 *  Conditions on the analysis + existing keywords + top-performer titles & tags. */
export const discoverKeywordOpportunities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { projectId: string; steering?: string }) => {
    if (!d?.projectId) throw new Error("projectId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const { data: rows } = await supabase
      .from("project_sections")
      .select("section, data")
      .eq("project_id", data.projectId)
      .in("section", ["analysis", "keywords"]);
    const analysis = rows?.find((r) => r.section === "analysis")?.data as any;
    const kw = rows?.find((r) => r.section === "keywords")?.data as KeywordsPayload | undefined;
    if (!analysis) throw new Error("Run Analysis first.");

    const existing = new Set(
      (kw?.seeds ?? []).concat(kw?.rows?.map((r) => r.term) ?? []).map((s) => s.toLowerCase()),
    );

    const sys = `You are a YouTube discovery strategist for independent musicians. Return STRICT JSON only — a JSON array of up to 8 objects: [{"term": "<lowercase 2-6 word search phrase>", "why": "<one sentence reason in <=18 words>"}]. Rules: every term must be NEW (not present in the "existing" list), describe a realistic niche or audience this track could reach, no hashtags, no quotes, no clickbait, no duplicates. No prose, no code fence.`;
    const usr = JSON.stringify({
      analysis: { genre: analysis.genre, niche: analysis.niche, mood: analysis.mood, bpm: analysis.bpm, key: analysis.key },
      existing: [...existing].slice(0, 40),
      topTitles: (kw?.topTitles ?? []).slice(0, 6),
      topTags: (kw?.topTags ?? []).slice(0, 10),
      steering: data.steering ?? null,
    });

    async function callOnce(): Promise<KeywordOpportunity[]> {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 45_000);
      try {
        const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          signal: ctrl.signal,
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: sys },
              { role: "user", content: `Context:\n${usr}\nReturn the JSON array now.` },
            ],
          }),
        });
        if (!r.ok) {
          const status = r.status;
          const body = (await r.text()).slice(0, 200);
          const err: any = new Error(`AI gateway ${status}: ${body}`);
          err.status = status;
          throw err;
        }
        const j = await r.json();
        const text: string = j?.choices?.[0]?.message?.content ?? "";
        const m = text.match(/\[[\s\S]*\]/);
        if (!m) throw new Error("Could not parse opportunities");
        const arr = JSON.parse(m[0]);
        return (Array.isArray(arr) ? arr : [])
          .map((o: any) => ({ term: String(o?.term ?? "").trim().toLowerCase(), why: String(o?.why ?? "").trim() }))
          .filter((o: KeywordOpportunity) => o.term && !existing.has(o.term));
      } finally {
        clearTimeout(t);
      }
    }

    let parsed: KeywordOpportunity[] = [];
    try {
      parsed = await callOnce();
    } catch (e: any) {
      const retryable = e?.name === "AbortError" || e?.status === 524 || (e?.status >= 500 && e?.status < 600);
      if (!retryable) throw e;
      try {
        parsed = await callOnce();
      } catch (e2: any) {
        if (e2?.name === "AbortError" || e2?.status === 524) {
          throw new Error("Discovery timed out — try again or narrow your keywords.");
        }
        throw e2;
      }
    }
    return { opportunities: parsed.slice(0, 8) };
  });