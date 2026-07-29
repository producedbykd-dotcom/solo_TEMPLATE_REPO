import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** YouTube Music outlook — measures how much of a keyword's top traffic is
 *  going to the "Topic" auto-channels and the Music category (videoCategoryId=10).
 *  Those are the surfaces that count toward DistroKid / distributor royalties. */
export type MusicStatRow = {
  term: string;
  musicShare: number;              // 0..1 share of top-10 results inside Music category
  topicShare: number;              // 0..1 share that are "<Artist> - Topic" auto-uploads
  avgMusicViews: number;           // avg view count across the music-category top 10
  estMonthlyMusicPlays: number;    // banded estimate of monthly YT Music plays
  distroPayable: boolean;          // heuristic — true if topicShare >= 0.4
  failed?: boolean;
};
export type YoutubeMusicPayload = {
  rows: MusicStatRow[];
  generatedAt: string;
  quotaExhausted?: boolean;
};

function apiKey() {
  const k = process.env.YOUTUBE_API_KEY;
  if (!k) throw new Error("YOUTUBE_API_KEY not configured");
  return k;
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function isHardQuota(e: any) {
  return e?.status === 403 && /quotaExceeded|dailyLimitExceeded/i.test(String(e?.body || e?.message || ""));
}

async function ytSearchMusic(key: string, q: string) {
  const u = new URL("https://www.googleapis.com/youtube/v3/search");
  u.searchParams.set("part", "snippet");
  u.searchParams.set("q", q);
  u.searchParams.set("type", "video");
  u.searchParams.set("maxResults", "10");
  u.searchParams.set("order", "viewCount");
  u.searchParams.set("videoCategoryId", "10"); // Music
  u.searchParams.set("topicId", "/m/04rlf");   // Music topic
  u.searchParams.set("key", key);
  const r = await fetch(u);
  if (!r.ok) {
    const body = (await r.text()).slice(0, 300);
    const err: any = new Error(`YouTube music search failed (${r.status}): ${body}`);
    err.status = r.status; err.body = body;
    throw err;
  }
  return r.json() as Promise<{ items: Array<{ id: { videoId: string }; snippet: { channelTitle?: string } }> }>;
}

async function ytVideos(key: string, ids: string[]) {
  if (!ids.length) return { items: [] as any[] };
  const u = new URL("https://www.googleapis.com/youtube/v3/videos");
  u.searchParams.set("part", "statistics,snippet");
  u.searchParams.set("id", ids.join(","));
  u.searchParams.set("key", key);
  const r = await fetch(u);
  if (!r.ok) {
    const body = (await r.text()).slice(0, 300);
    const err: any = new Error(`YouTube videos failed (${r.status}): ${body}`);
    err.status = r.status; err.body = body;
    throw err;
  }
  return r.json() as Promise<{
    items: Array<{
      snippet: { channelTitle?: string; categoryId?: string };
      statistics: { viewCount?: string };
    }>;
  }>;
}

function bandMonthly(n: number) {
  const bands = [0, 1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];
  let best = 0;
  for (const b of bands) if (n >= b) best = b;
  return best;
}

export const researchMusicStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { projectId: string; terms: string[] }) => {
    if (!d?.projectId) throw new Error("projectId required");
    if (!Array.isArray(d.terms) || d.terms.length === 0) throw new Error("No terms");
    if (d.terms.length > 10) throw new Error("Max 10 terms");
    return d;
  })
  .handler(async ({ data, context }) => {
    const key = apiKey();
    const { upsertSection } = await import("./sections.server");
    const rows: MusicStatRow[] = [];
    let quotaExhausted = false;
    for (let i = 0; i < data.terms.length; i++) {
      const term = data.terms[i];
      if (quotaExhausted) { rows.push({ term, musicShare: 0, topicShare: 0, avgMusicViews: 0, estMonthlyMusicPlays: 0, distroPayable: false, failed: true }); continue; }
      try {
        const s = await ytSearchMusic(key, term);
        const ids = s.items.map((i) => i.id.videoId).filter(Boolean);
        const v = await ytVideos(key, ids);
        const total = v.items.length || 1;
        const inMusic = v.items.filter((x) => x.snippet.categoryId === "10").length;
        const topic = v.items.filter((x) => /\s-\s?Topic$/i.test(x.snippet.channelTitle || "")).length;
        const views = v.items.map((x) => Number(x.statistics.viewCount || 0));
        const avg = views.length ? Math.round(views.reduce((a, b) => a + b, 0) / views.length) : 0;
        const topicShare = topic / total;
        rows.push({
          term,
          musicShare: inMusic / total,
          topicShare,
          avgMusicViews: avg,
          estMonthlyMusicPlays: bandMonthly(Math.round(avg * 0.04)),
          distroPayable: topicShare >= 0.4,
        });
      } catch (e: any) {
        if (isHardQuota(e)) quotaExhausted = true;
        console.error("music stat failed", term, e);
        rows.push({ term, musicShare: 0, topicShare: 0, avgMusicViews: 0, estMonthlyMusicPlays: 0, distroPayable: false, failed: true });
      }
      if (i < data.terms.length - 1) await sleep(180);
    }
    const payload: YoutubeMusicPayload = { rows, generatedAt: new Date().toISOString(), quotaExhausted: quotaExhausted || undefined };
    await upsertSection(context.supabase, data.projectId, "music_stats" as any, payload);
    return payload;
  });