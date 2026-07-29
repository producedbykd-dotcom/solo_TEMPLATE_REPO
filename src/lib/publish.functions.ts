import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Publish a project's longform video + thumbnail + metadata to YouTube.
 * Other platforms (Instagram, TikTok, Facebook) require app-level OAuth
 * apps that aren't registered yet — we surface a clear error for those
 * and the UI keeps them disabled until credentials land.
 */
export const publishToYoutube = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: {
    projectId: string;
    privacyStatus?: "public" | "unlisted" | "private";
    publishAt?: string | null; // ISO; if set, privacy forced to private + scheduled
    overrideTitle?: string | null;
    overrideDescription?: string | null;
    overrideTags?: string[] | null;
  }) => {
    if (!d?.projectId) throw new Error("projectId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1. Project + sections
    const { data: project, error: pErr } = await supabase
      .from("projects").select("id,title,user_id").eq("id", data.projectId).maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!project || project.user_id !== userId) throw new Error("Project not found");

    const { data: rows, error: sErr } = await supabase
      .from("project_sections").select("section,data,status")
      .eq("project_id", data.projectId)
      .in("section", ["longform", "thumbnail", "metadata", "tags"]);
    if (sErr) throw new Error(sErr.message);

    const byKey = Object.fromEntries((rows ?? []).map((r) => [r.section, r.data as any]));
    const longform = byKey.longform;
    const thumb = byKey.thumbnail;
    const meta = byKey.metadata ?? {};
    const tagsRow = byKey.tags ?? {};

    if (!longform?.storagePath) throw new Error("Render a longform video first.");
    const title = (
      data.overrideTitle ??
      meta.selectedTitle ??
      meta.title ??
      (Array.isArray(meta.titles) ? meta.titles[0] : null) ??
      project.title ??
      "Untitled"
    ).toString().slice(0, 100);
    const description = (data.overrideDescription ?? meta.description ?? "").toString().slice(0, 4900);
    const tags = (data.overrideTags ?? tagsRow.tags ?? meta.tags ?? []) as string[];

    // 2. YouTube access token
    const { getYoutubeAccessToken } = await import("./youtube-token.server");
    const tok = await getYoutubeAccessToken(userId);

    // 3. Signed URLs + download
    const { data: vSigned } = await supabase.storage.from("videos")
      .createSignedUrl(longform.storagePath, 60 * 60);
    if (!vSigned?.signedUrl) throw new Error("Could not sign video URL");
    const vRes = await fetch(vSigned.signedUrl);
    if (!vRes.ok) throw new Error(`Video fetch failed (${vRes.status})`);
    const videoBytes = new Uint8Array(await vRes.arrayBuffer());

    // 4. Insert publish_job row (uploading)
    const { data: job, error: jErr } = await supabase.from("publish_jobs").insert({
      project_id: data.projectId,
      platform: "youtube" as const,
      status: "uploading" as const,
      overrides: { title, descriptionLen: description.length, tags } as any,
    }).select("id").single();
    if (jErr || !job) throw new Error(jErr?.message ?? "Could not create job");
    const jobId = job.id;

    async function failJob(err: string): Promise<never> {
      await supabase.from("publish_jobs").update({ status: "failed", error: err.slice(0, 500) }).eq("id", jobId);
      throw new Error(err);
    }

    // 5. Multipart upload — snippet + status + video bytes
    const privacy = data.publishAt ? "private" : (data.privacyStatus ?? "public");
    const snippetStatus: any = {
      snippet: { title, description, tags: tags.slice(0, 30), categoryId: "10" /* Music */ },
      status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
    };
    if (data.publishAt) snippetStatus.status.publishAt = data.publishAt;

    const boundary = "----releaseEngine" + Math.random().toString(36).slice(2);
    const enc = new TextEncoder();
    const head = enc.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(snippetStatus)}\r\n` +
      `--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`
    );
    const tail = enc.encode(`\r\n--${boundary}--\r\n`);
    const body = new Uint8Array(head.length + videoBytes.length + tail.length);
    body.set(head, 0); body.set(videoBytes, head.length); body.set(tail, head.length + videoBytes.length);

    const upRes = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tok.accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    );
    if (!upRes.ok) {
      const t = await upRes.text();
      return failJob(`YouTube upload ${upRes.status}: ${t.slice(0, 300)}`);
    }
    const upJson = (await upRes.json()) as { id?: string };
    const videoId = upJson.id;
    if (!videoId) return failJob("YouTube upload returned no video id");

    // 6. Thumbnail (best-effort)
    if (thumb?.storagePath) {
      try {
        const { data: tSigned } = await supabase.storage.from("videos").createSignedUrl(thumb.storagePath, 600);
        if (tSigned?.signedUrl) {
          const tRes = await fetch(tSigned.signedUrl);
          if (tRes.ok) {
            const tBytes = await tRes.arrayBuffer();
            await fetch(
              `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`,
              { method: "POST", headers: { Authorization: `Bearer ${tok.accessToken}`, "Content-Type": tRes.headers.get("content-type") ?? "image/jpeg" }, body: tBytes }
            );
          }
        }
      } catch { /* ignore thumbnail failure */ }
    }

    const url = `https://youtu.be/${videoId}`;
    await supabase.from("publish_jobs").update({
      status: data.publishAt ? "scheduled" : "published",
      platform_post_id: videoId,
      platform_url: url,
      published_at: data.publishAt ? null : new Date().toISOString(),
      scheduled_for: data.publishAt ?? null,
    }).eq("id", jobId);

    return { ok: true as const, videoId, url, jobId };
  });

export const listPublishJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { projectId: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("publish_jobs").select("*")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { jobs: rows ?? [] };
  });

/* -------------------- shared helpers -------------------- */

async function loadProjectAssets(supabase: any, userId: string, projectId: string) {
  const { data: project, error: pErr } = await supabase
    .from("projects").select("id,title,user_id,primary_audio_path").eq("id", projectId).maybeSingle();
  if (pErr) throw new Error(pErr.message);
  if (!project || project.user_id !== userId) throw new Error("Project not found");

  const { data: rows, error: sErr } = await supabase
    .from("project_sections").select("section,data,status")
    .eq("project_id", projectId)
    .in("section", ["longform", "shorts", "thumbnail", "metadata", "tags"]);
  if (sErr) throw new Error(sErr.message);
  const byKey = Object.fromEntries((rows ?? []).map((r: any) => [r.section, r.data]));
  return { project, byKey };
}

async function signedUrl(supabase: any, path: string, seconds = 60 * 60) {
  const { data } = await supabase.storage.from("videos").createSignedUrl(path, seconds);
  if (!data?.signedUrl) throw new Error("Could not sign asset URL");
  return data.signedUrl as string;
}

function captionFor(meta: any, tags: string[], project: { title: string }) {
  const title = (
    meta?.selectedTitle ??
    meta?.title ??
    (Array.isArray(meta?.titles) ? meta.titles[0] : null) ??
    project.title ??
    ""
  ).toString();
  const desc = (meta?.description ?? "").toString();
  const hash = (tags ?? []).slice(0, 15).map((t) => `#${t.replace(/[^a-z0-9]/gi, "")}`).filter(Boolean).join(" ");
  return [title, desc, hash].filter(Boolean).join("\n\n").slice(0, 2150);
}

/* -------------------- Facebook (Page video) -------------------- */

export const publishToFacebook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { projectId: string; shortIndex?: number | null }) => {
    if (!d?.projectId) throw new Error("projectId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { project, byKey } = await loadProjectAssets(supabase, userId, data.projectId);
    const shorts = byKey.shorts;
    const longform = byKey.longform;
    const meta = byKey.metadata ?? {};
    const tagsRow = byKey.tags ?? {};
    const clip = typeof data.shortIndex === "number" ? shorts?.clips?.[data.shortIndex] : null;
    const videoPath = clip?.storagePath ?? longform?.storagePath;
    if (!videoPath) throw new Error("Render a video first.");

    const { getMetaConnection } = await import("./meta-token.server");
    const m = await getMetaConnection(userId);
    if (!m.pageId || !m.pageAccessToken) {
      throw new Error("No Facebook Page linked to the connected account.");
    }

    const videoUrl = await signedUrl(supabase, videoPath);
    const caption = captionFor(meta, tagsRow.tags ?? meta.tags ?? [], project);

    const { data: job, error: jErr } = await supabase.from("publish_jobs").insert({
      project_id: data.projectId,
      platform: "facebook" as const,
      status: "uploading" as const,
      overrides: { caption: caption.length, shortIndex: data.shortIndex ?? null } as any,
    }).select("id").single();
    if (jErr || !job) throw new Error(jErr?.message ?? "Could not create job");
    const jobId = job.id;

    const params = new URLSearchParams({
      file_url: videoUrl,
      description: caption,
      access_token: m.pageAccessToken,
    });
    const upRes = await fetch(`https://graph-video.facebook.com/v21.0/${m.pageId}/videos`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const upJson = (await upRes.json()) as { id?: string; error?: { message?: string } };
    if (!upRes.ok || !upJson.id) {
      const msg = upJson.error?.message ?? `Facebook upload failed (${upRes.status})`;
      await supabase.from("publish_jobs").update({ status: "failed", error: msg.slice(0, 500) }).eq("id", jobId);
      throw new Error(msg);
    }

    const url = `https://www.facebook.com/${m.pageId}/videos/${upJson.id}`;
    await supabase.from("publish_jobs").update({
      status: "published",
      platform_post_id: upJson.id,
      platform_url: url,
      published_at: new Date().toISOString(),
    }).eq("id", jobId);
    return { ok: true as const, id: upJson.id, url, jobId };
  });

/* -------------------- Instagram (Reels) -------------------- */

export const publishToInstagram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { projectId: string; shortIndex?: number | null }) => {
    if (!d?.projectId) throw new Error("projectId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { project, byKey } = await loadProjectAssets(supabase, userId, data.projectId);
    const shorts = byKey.shorts;
    const meta = byKey.metadata ?? {};
    const tagsRow = byKey.tags ?? {};
    const clip = typeof data.shortIndex === "number"
      ? shorts?.clips?.[data.shortIndex]
      : shorts?.clips?.[0];
    if (!clip?.storagePath) throw new Error("Render a Short first — Instagram Reels needs a vertical clip.");

    const { getMetaConnection } = await import("./meta-token.server");
    const m = await getMetaConnection(userId);
    if (!m.igUserId || !m.pageAccessToken) {
      throw new Error("Connected Facebook Page has no Instagram Business account linked.");
    }

    const videoUrl = await signedUrl(supabase, clip.storagePath);
    const caption = captionFor(meta, tagsRow.tags ?? meta.tags ?? [], project);

    const { data: job, error: jErr } = await supabase.from("publish_jobs").insert({
      project_id: data.projectId,
      platform: "instagram" as const,
      status: "uploading" as const,
      overrides: { shortIndex: data.shortIndex ?? 0 } as any,
    }).select("id").single();
    if (jErr || !job) throw new Error(jErr?.message ?? "Could not create job");
    const jobId = job.id;
    async function fail(msg: string): Promise<never> {
      await supabase.from("publish_jobs").update({ status: "failed", error: msg.slice(0, 500) }).eq("id", jobId);
      throw new Error(msg);
    }

    // 1. Create container
    const createRes = await fetch(`https://graph.facebook.com/v21.0/${m.igUserId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        media_type: "REELS",
        video_url: videoUrl,
        caption,
        access_token: m.pageAccessToken,
      }).toString(),
    });
    const createJson = (await createRes.json()) as { id?: string; error?: { message?: string } };
    if (!createRes.ok || !createJson.id) {
      return fail(createJson.error?.message ?? `IG container failed (${createRes.status})`);
    }
    const containerId = createJson.id;

    // 2. Poll status (Reels need processing)
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const stRes = await fetch(
        `https://graph.facebook.com/v21.0/${containerId}?fields=status_code&access_token=${encodeURIComponent(m.pageAccessToken)}`,
      );
      const stJson = (await stRes.json()) as { status_code?: string };
      if (stJson.status_code === "FINISHED") break;
      if (stJson.status_code === "ERROR" || stJson.status_code === "EXPIRED") {
        return fail(`IG container status ${stJson.status_code}`);
      }
    }

    // 3. Publish
    const pubRes = await fetch(`https://graph.facebook.com/v21.0/${m.igUserId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ creation_id: containerId, access_token: m.pageAccessToken }).toString(),
    });
    const pubJson = (await pubRes.json()) as { id?: string; error?: { message?: string } };
    if (!pubRes.ok || !pubJson.id) return fail(pubJson.error?.message ?? `IG publish failed (${pubRes.status})`);

    const url = m.igUsername
      ? `https://www.instagram.com/${m.igUsername}/reel/${pubJson.id}/`
      : `https://www.instagram.com/reel/${pubJson.id}/`;
    await supabase.from("publish_jobs").update({
      status: "published",
      platform_post_id: pubJson.id,
      platform_url: url,
      published_at: new Date().toISOString(),
    }).eq("id", jobId);
    return { ok: true as const, id: pubJson.id, url, jobId };
  });

/* -------------------- TikTok (video) -------------------- */

export const publishToTiktok = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: {
    projectId: string;
    shortIndex?: number | null;
    privacy?: "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "SELF_ONLY";
  }) => {
    if (!d?.projectId) throw new Error("projectId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { project, byKey } = await loadProjectAssets(supabase, userId, data.projectId);
    const shorts = byKey.shorts;
    const longform = byKey.longform;
    const meta = byKey.metadata ?? {};
    const tagsRow = byKey.tags ?? {};
    const clip = typeof data.shortIndex === "number"
      ? shorts?.clips?.[data.shortIndex]
      : (shorts?.clips?.[0] ?? null);
    const videoPath = clip?.storagePath ?? longform?.storagePath;
    if (!videoPath) throw new Error("Render a video first.");

    const { getTiktokAccessToken } = await import("./tiktok-token.server");
    const tok = await getTiktokAccessToken(userId);

    // Download video to memory
    const videoUrl = await signedUrl(supabase, videoPath, 600);
    const vRes = await fetch(videoUrl);
    if (!vRes.ok) throw new Error(`Could not fetch video (${vRes.status})`);
    const videoBytes = new Uint8Array(await vRes.arrayBuffer());
    const videoSize = videoBytes.length;

    const caption = captionFor(meta, tagsRow.tags ?? meta.tags ?? [], project).slice(0, 2200);
    const privacy = data.privacy ?? "SELF_ONLY";

    const { data: job, error: jErr } = await supabase.from("publish_jobs").insert({
      project_id: data.projectId,
      platform: "tiktok" as const,
      status: "uploading" as const,
      overrides: { privacy, shortIndex: data.shortIndex ?? null, sizeBytes: videoSize } as any,
    }).select("id").single();
    if (jErr || !job) throw new Error(jErr?.message ?? "Could not create job");
    const jobId = job.id;
    async function fail(msg: string): Promise<never> {
      await supabase.from("publish_jobs").update({ status: "failed", error: msg.slice(0, 500) }).eq("id", jobId);
      throw new Error(msg);
    }

    // 1. init publish
    const initBody = {
      post_info: {
        title: caption || (project.title ?? "Release"),
        privacy_level: privacy,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: "FILE_UPLOAD" as const,
        video_size: videoSize,
        chunk_size: videoSize,
        total_chunk_count: 1,
      },
    };
    const initRes = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tok.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(initBody),
    });
    const initJson = (await initRes.json()) as {
      data?: { publish_id?: string; upload_url?: string };
      error?: { message?: string; code?: string };
    };
    if (!initRes.ok || !initJson.data?.upload_url || !initJson.data?.publish_id) {
      return fail(initJson.error?.message ?? `TikTok init failed (${initRes.status})`);
    }

    // 2. upload bytes (single chunk PUT)
    const upRes = await fetch(initJson.data.upload_url, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Range": `bytes 0-${videoSize - 1}/${videoSize}`,
        "Content-Length": String(videoSize),
      },
      body: videoBytes,
    });
    if (!upRes.ok) {
      const t = await upRes.text();
      return fail(`TikTok upload ${upRes.status}: ${t.slice(0, 300)}`);
    }

    const publishId = initJson.data.publish_id;
    await supabase.from("publish_jobs").update({
      status: "scheduled",
      platform_post_id: publishId,
      scheduled_for: new Date().toISOString(),
    }).eq("id", jobId);

    return {
      ok: true as const,
      publishId,
      jobId,
      note: "Uploaded to TikTok. Open the TikTok app to review and post (required while the app is in review).",
    };
  });
/* -------------------- SoundCloud (audio track) -------------------- */

export const publishToSoundcloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: {
    projectId: string;
    trackId?: string | null;            // pick a specific project_tracks row; defaults to first
    overrideTitle?: string | null;       // SoundCloud-specific title (separate from YouTube title)
    overrideDescription?: string | null;
    overrideTags?: string[] | null;
    sharing?: "public" | "private";
    downloadable?: boolean;
    artworkStoragePath?: string | null;  // explicit image pick; falls back to selected cover
  }) => {
    if (!d?.projectId) throw new Error("projectId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { project, byKey } = await loadProjectAssets(supabase, userId, data.projectId);
    const meta = byKey.metadata ?? {};
    const tagsRow = byKey.tags ?? {};
    const thumb = byKey.thumbnail;

    // Locate audio: prefer project_tracks (compilations); fall back to projects.primary_audio_path (single-track).
    let trackQuery = supabase
      .from("project_tracks")
      .select("id, audio_path, title, position")
      .eq("project_id", data.projectId)
      .order("position", { ascending: true });
    if (data.trackId) trackQuery = trackQuery.eq("id", data.trackId);
    const { data: trackRows, error: tErr } = await trackQuery;
    if (tErr) throw new Error(tErr.message);
    const track = trackRows?.[0] ?? null;
    const audioPath: string | null =
      track?.audio_path ?? (project as any).primary_audio_path ?? null;
    if (!audioPath) throw new Error("No audio file found for this project.");
    const trackTitle: string | null = track?.title ?? null;
    const trackId: string | null = track?.id ?? null;

    const { getSoundcloudAccessToken } = await import("./soundcloud-token.server");
    const tok = await getSoundcloudAccessToken(userId);

    // Resolve title/description/tags (SoundCloud title is independent of YouTube title)
    const title = (
      data.overrideTitle ??
      meta.selectedTitle ??
      meta.title ??
      (Array.isArray(meta.titles) ? meta.titles[0] : null) ??
      trackTitle ??
      project.title ??
      "Untitled"
    ).toString().slice(0, 100);
    const description = (data.overrideDescription ?? meta.description ?? "").toString().slice(0, 4000);
    const tags = (data.overrideTags ?? tagsRow.tags ?? meta.tags ?? []) as string[];
    // SoundCloud tag_list is space-separated; multi-word tags must be quoted.
    const tagList = tags.slice(0, 30).map((t) => {
      const clean = t.toString().trim();
      return /\s/.test(clean) ? `"${clean.replace(/"/g, "")}"` : clean;
    }).join(" ");
    const sharing = data.sharing ?? "public";

    // Download audio bytes
    const { data: aSigned } = await supabase.storage.from("audio").createSignedUrl(audioPath, 60 * 60);
    if (!aSigned?.signedUrl) throw new Error("Could not sign audio URL");
    const aRes = await fetch(aSigned.signedUrl);
    if (!aRes.ok) throw new Error(`Audio fetch failed (${aRes.status})`);
    const audioBytes = await aRes.arrayBuffer();
    const audioMime = aRes.headers.get("content-type") ?? "audio/mpeg";
    const audioFilename = audioPath.split("/").pop() ?? "track.mp3";

    // Resolve artwork. Order of precedence:
    //  1. Caller-supplied artworkStoragePath (UI picker)
    //  2. Selected album cover from the "artwork" section (1:1, SoundCloud-ready)
    //  3. First album cover
    //  4. Selected YouTube thumbnail (16:9 — SoundCloud will crop)
    //  5. Rendered project thumbnail
    let artworkBlob: Blob | null = null;
    let artworkFilename = "cover.jpg";
    const { data: artRow } = await supabase
      .from("project_sections")
      .select("data")
      .eq("project_id", data.projectId)
      .eq("section", "artwork")
      .maybeSingle();
    const artwork = (artRow?.data ?? null) as null | {
      covers?: Array<{ id: string; storagePath: string }>;
      thumbnails?: Array<{ id: string; storagePath: string }>;
      selectedCoverId?: string;
      selectedThumbnailId?: string;
    };
    const selectedCover = artwork?.covers?.find((c) => c.id === artwork?.selectedCoverId) ?? artwork?.covers?.[0];
    const selectedThumb = artwork?.thumbnails?.find((t) => t.id === artwork?.selectedThumbnailId) ?? artwork?.thumbnails?.[0];
    const artPath =
      data.artworkStoragePath ||
      selectedCover?.storagePath ||
      selectedThumb?.storagePath ||
      thumb?.storagePath ||
      null;
    if (artPath) {
      try {
        const { data: cSigned } = await supabase.storage.from("videos").createSignedUrl(artPath, 600);
        if (cSigned?.signedUrl) {
          const cRes = await fetch(cSigned.signedUrl);
          if (cRes.ok) {
            artworkBlob = new Blob([await cRes.arrayBuffer()], { type: cRes.headers.get("content-type") ?? "image/jpeg" });
            artworkFilename = artPath.split("/").pop() ?? "cover.jpg";
          }
        }
      } catch { /* ignore artwork failure */ }
    }

    const { data: job, error: jErr } = await supabase.from("publish_jobs").insert({
      project_id: data.projectId,
      platform: "soundcloud" as const,
      status: "uploading" as const,
      overrides: { title, sharing, tagCount: tags.length, trackId } as any,
    }).select("id").single();
    if (jErr || !job) throw new Error(jErr?.message ?? "Could not create job");
    const jobId = job.id;
    async function fail(msg: string): Promise<never> {
      await supabase.from("publish_jobs").update({ status: "failed", error: msg.slice(0, 500) }).eq("id", jobId);
      throw new Error(msg);
    }

    // POST /tracks (multipart)
    const form = new FormData();
    form.append("track[title]", title);
    form.append("track[description]", description);
    form.append("track[sharing]", sharing);
    form.append("track[downloadable]", data.downloadable ? "true" : "false");
    if (tagList) form.append("track[tag_list]", tagList);
    form.append("track[asset_data]", new Blob([audioBytes], { type: audioMime }), audioFilename);
    if (artworkBlob) form.append("track[artwork_data]", artworkBlob, artworkFilename);

    const upRes = await fetch("https://api.soundcloud.com/tracks", {
      method: "POST",
      headers: {
        Authorization: `OAuth ${tok.accessToken}`,
        Accept: "application/json; charset=utf-8",
      },
      body: form,
    });
    if (!upRes.ok) {
      const t = await upRes.text();
      return fail(`SoundCloud upload ${upRes.status}: ${t.slice(0, 300)}`);
    }
    const upJson = (await upRes.json()) as {
      id?: number | string;
      permalink_url?: string;
      title?: string;
    };
    if (!upJson.id) return fail("SoundCloud upload returned no track id");

    await supabase.from("publish_jobs").update({
      status: "published",
      platform_post_id: String(upJson.id),
      platform_url: upJson.permalink_url ?? null,
      published_at: new Date().toISOString(),
    }).eq("id", jobId);

    return { ok: true as const, id: String(upJson.id), url: upJson.permalink_url ?? null, jobId };
  });

/* -------------------- YouTube Shorts (each rendered clip) -------------------- */

/**
 * Upload each rendered short clip as its own YouTube video. YouTube auto-
 * classifies vertical videos ≤60s as Shorts; we also append #Shorts to the
 * title/description as the current best-practice hint.
 */
export const publishShortsToYoutube = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: {
    projectId: string;
    privacyStatus?: "public" | "unlisted" | "private";
  }) => {
    if (!d?.projectId) throw new Error("projectId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { project, byKey } = await loadProjectAssets(supabase, userId, data.projectId);
    const shorts = byKey.shorts;
    const meta = byKey.metadata ?? {};
    const tagsRow = byKey.tags ?? {};
    const thumb = byKey.thumbnail;
    const clips: Array<{ id: string; storagePath: string; label?: string | null }> =
      shorts?.clips ?? [];
    if (!clips.length) throw new Error("No shorts rendered yet.");

    const { getYoutubeAccessToken } = await import("./youtube-token.server");
    const tok = await getYoutubeAccessToken(userId);

    const baseTitle = (
      meta.selectedTitle ??
      meta.title ??
      (Array.isArray(meta.titles) ? meta.titles[0] : null) ??
      project.title ??
      "Untitled"
    ).toString();
    const baseDesc = (meta.description ?? "").toString();
    const tags = ((tagsRow.tags ?? meta.tags ?? []) as string[]).slice(0, 28);
    if (!tags.includes("Shorts")) tags.push("Shorts");
    const privacy = data.privacyStatus ?? "public";

    const results: Array<{ clipId: string; videoId?: string; url?: string; error?: string }> = [];

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const label = clip.label ? ` (${clip.label})` : ` (${i + 1}/${clips.length})`;
      const title = `${baseTitle}${label} #Shorts`.slice(0, 100);
      const description = (`${baseDesc}\n\n#Shorts`).slice(0, 4900);

      const { data: job, error: jErr } = await supabase.from("publish_jobs").insert({
        project_id: data.projectId,
        platform: "youtube" as const,
        status: "uploading" as const,
        overrides: { title, kind: "short", clipId: clip.id, shortIndex: i } as any,
      }).select("id").single();
      if (jErr || !job) {
        results.push({ clipId: clip.id, error: jErr?.message ?? "Could not create job" });
        continue;
      }
      const jobId = job.id;

      try {
        const vUrl = await signedUrl(supabase, clip.storagePath);
        const vRes = await fetch(vUrl);
        if (!vRes.ok) throw new Error(`Video fetch failed (${vRes.status})`);
        const videoBytes = new Uint8Array(await vRes.arrayBuffer());

        const snippetStatus: any = {
          snippet: { title, description, tags: tags.slice(0, 30), categoryId: "10" },
          status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
        };
        const boundary = "----releaseEngineShort" + Math.random().toString(36).slice(2);
        const enc = new TextEncoder();
        const head = enc.encode(
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(snippetStatus)}\r\n` +
          `--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`
        );
        const tail = enc.encode(`\r\n--${boundary}--\r\n`);
        const body = new Uint8Array(head.length + videoBytes.length + tail.length);
        body.set(head, 0); body.set(videoBytes, head.length); body.set(tail, head.length + videoBytes.length);

        const upRes = await fetch(
          "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${tok.accessToken}`,
              "Content-Type": `multipart/related; boundary=${boundary}`,
            },
            body,
          },
        );
        if (!upRes.ok) {
          const t = await upRes.text();
          throw new Error(`YouTube upload ${upRes.status}: ${t.slice(0, 300)}`);
        }
        const upJson = (await upRes.json()) as { id?: string };
        const videoId = upJson.id;
        if (!videoId) throw new Error("YouTube upload returned no video id");

        // Best-effort thumbnail (the rendered 1:1/16:9 cover). YouTube uses
        // the middle frame for Shorts thumbnails, but a custom thumbnail
        // still shows on the channel/playlist grid.
        if (thumb?.storagePath) {
          try {
            const tSigned = await signedUrl(supabase, thumb.storagePath, 600);
            const tRes = await fetch(tSigned);
            if (tRes.ok) {
              const tBytes = await tRes.arrayBuffer();
              await fetch(
                `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${tok.accessToken}`,
                    "Content-Type": tRes.headers.get("content-type") ?? "image/jpeg",
                  },
                  body: tBytes,
                },
              );
            }
          } catch { /* ignore */ }
        }

        const url = `https://youtube.com/shorts/${videoId}`;
        await supabase.from("publish_jobs").update({
          status: "published",
          platform_post_id: videoId,
          platform_url: url,
          published_at: new Date().toISOString(),
        }).eq("id", jobId);
        results.push({ clipId: clip.id, videoId, url });
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        await supabase.from("publish_jobs").update({
          status: "failed",
          error: msg.slice(0, 500),
        }).eq("id", jobId);
        results.push({ clipId: clip.id, error: msg });
      }
    }

    const uploaded = results.filter((r) => r.videoId).length;
    return { ok: uploaded > 0, uploaded, total: clips.length, results };
  });
