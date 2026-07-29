// Browser-only: build a longform MP4 (static thumbnail + audio + optional
// waveform overlay + optional Ken Burns zoom) using @ffmpeg/ffmpeg in a Web
// Worker. The original audio file is never altered.
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import coreJsUrl from "@/assets/ffmpeg/ffmpeg-core.js?url";
// Self-host ffmpeg core so renders don't depend on third-party CDNs. Keep the
// JS core as a Vite asset and the large wasm binary as a managed asset.
// Do not import @ffmpeg/core/dist/* directly — those subpaths are not exported.
const coreWasmUrl = "/__l5e/assets-v1/a34a8624-47e2-420f-a1ea-7b7bcde5a0e9/ffmpeg-core.wasm";

let cached: FFmpeg | null = null;

export async function getFFmpeg(): Promise<FFmpeg> {
  if (cached) return cached;
  const ff = new FFmpeg();
  // Try the self-hosted bundle first; fall back to public CDNs only if the
  // local asset fails to fetch (e.g. service-worker interference).
  const sources: Array<{ core: string; wasm: string }> = [
    { core: coreJsUrl, wasm: coreWasmUrl },
    {
      core: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js",
      wasm: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm",
    },
    {
      core: "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js",
      wasm: "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm",
    },
  ];
  let lastErr: unknown = null;
  for (const src of sources) {
    try {
      const [coreURL, wasmURL] = await Promise.all([
        toBlobURL(src.core, "text/javascript"),
        toBlobURL(src.wasm, "application/wasm"),
      ]);
      await ff.load({ coreURL, wasmURL });
      cached = ff;
      return ff;
    } catch (e) {
      lastErr = e;
      console.warn("[ffmpeg] source failed", {
        core: src.core,
        wasm: src.wasm,
        error: (e as Error)?.message,
      });
    }
  }
  throw new Error(
    `Video engine (ffmpeg-core.wasm) failed to load. Refresh once; if it persists, an ad-blocker or privacy extension is likely blocking the CDN. Last error: ${(lastErr as Error)?.message || "unknown"}`,
  );
}

/** Fire-and-forget preloader — call from the workspace page on mount so the
 *  ~25 MB ffmpeg core is already resident by the time the user hits render.
 *  Never throws; failures fall back to the on-demand load path. */
export function warmupFFmpeg(): void {
  getFFmpeg().catch(() => { /* best-effort */ });
}

/** Downscale a large image blob (e.g. a 3000×3000 album cover) to the target
 *  canvas dimensions before feeding ffmpeg. Removes the scale+crop filter
 *  cost and shrinks ffmpeg's input by ~10× for cover-sourced art. Falls back
 *  to the original blob on any failure. */
export async function preresizeThumbnail(
  blob: Blob,
  targetW: number,
  targetH: number,
): Promise<{ blob: Blob; mime: string }> {
  try {
    const bmp = await createImageBitmap(blob);
    // Cover-fit: fill the target box and crop overflow.
    const scale = Math.max(targetW / bmp.width, targetH / bmp.height);
    const drawW = bmp.width * scale;
    const drawH = bmp.height * scale;
    const dx = (targetW - drawW) / 2;
    const dy = (targetH - drawH) / 2;
    const canvas = typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(targetW, targetH)
      : Object.assign(document.createElement("canvas"), { width: targetW, height: targetH });
    const ctx = (canvas as any).getContext("2d");
    if (!ctx) throw new Error("no 2d ctx");
    ctx.drawImage(bmp, dx, dy, drawW, drawH);
    const out: Blob = canvas instanceof OffscreenCanvas
      ? await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 })
      : await new Promise<Blob>((resolve, reject) =>
          (canvas as HTMLCanvasElement).toBlob(
            (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
            "image/jpeg",
            0.92,
          ),
        );
    bmp.close?.();
    return { blob: out, mime: "image/jpeg" };
  } catch {
    return { blob, mime: blob.type || "image/png" };
  }
}

// Pick a sensible filename + extension for ffmpeg based on the blob's MIME.
function audioNameFor(blob: Blob, fallback: string): string {
  const t = (blob.type || "").toLowerCase();
  if (t.includes("mpeg") || t.includes("mp3")) return "audio.mp3";
  if (t.includes("wav")) return "audio.wav";
  if (t.includes("flac")) return "audio.flac";
  if (t.includes("ogg")) return "audio.ogg";
  if (t.includes("aac")) return "audio.aac";
  if (t.includes("mp4") || t.includes("m4a")) return "audio.m4a";
  if (t.includes("webm")) return "audio.webm";
  return fallback || "audio.mp3";
}

export type LongformOptions = {
  thumbnailBlob: Blob;
  thumbnailMime: string; // image/png | image/jpeg
  audioBlob: Blob;
  audioFilename: string; // e.g. "audio.mp3" — extension matters for ffmpeg demuxer
  resolution: "1080p" | "4k";
  showWaveform: boolean;
  animateThumbnail: boolean; // Ken Burns
  /** When known, skip the internal probe pass (a full audio decode) and use
   *  this value directly. Big speed win. */
  audioDurationSec?: number | null;
  onProgress?: (pct: number) => void;
  onLog?: (line: string) => void;
};

function parseHHMMSStoSec(s: string): number | null {
  const m = s.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export async function buildLongformVideo(opts: LongformOptions): Promise<Blob> {
  const ff = await getFFmpeg();
  const dims = opts.resolution === "4k"
    ? { w: 3840, h: 2160 }
    : { w: 1920, h: 1080 };

  const thumbExt = opts.thumbnailMime.includes("png") ? "png" : "jpg";
  const audioName = audioNameFor(opts.audioBlob, opts.audioFilename || "audio.mp3");
  const thumbName = `thumb.${thumbExt}`;
  const outName = "out.mp4";

  // Collect log lines so we can surface the tail on failure.
  const logLines: string[] = [];
  const collectLog = ({ message }: { message: string }) => {
    logLines.push(message);
    if (logLines.length > 200) logLines.splice(0, logLines.length - 200);
    opts.onLog?.(message);
  };
  ff.on("log", collectLog);

  await ff.writeFile(thumbName, await fetchFile(opts.thumbnailBlob));
  await ff.writeFile(audioName, await fetchFile(opts.audioBlob));

  // Duration is required only for the Ken Burns ramp. Prefer the caller-
  // supplied value; only fall back to a probe pass (full audio decode) when
  // the caller doesn't know it. Skipping the probe is a large speed win.
  let audioDurationSec: number | null = opts.audioDurationSec ?? null;
  if (opts.animateThumbnail && (audioDurationSec == null || audioDurationSec <= 1)) {
    const onLogProbe = ({ message }: { message: string }) => {
      const m = message.match(/Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/);
      if (m) audioDurationSec = parseHHMMSStoSec(m[1]);
    };
    ff.on("log", onLogProbe);
    try {
      await ff.exec(["-i", audioName, "-f", "null", "-"]);
    } catch {
      /* ffmpeg exits non-zero on null muxer; we only want logs. */
    }
    ff.off("log", onLogProbe);
  }

  // Build the filter graph.
  // - Scale the still to canvas size, pad if needed.
  // - Optional Ken Burns: slow zoom from 1.0 -> 1.08 with a tiny pan.
  // - Optional waveform overlay drawn from the audio: showwaves outputs an
  //   image strip that we overlay along the bottom.
  const baseScale = `scale=${dims.w}:${dims.h}:force_original_aspect_ratio=increase,crop=${dims.w}:${dims.h}`;
  let videoChain = `[0:v]${baseScale},setsar=1`;
  if (opts.animateThumbnail && audioDurationSec && audioDurationSec > 1) {
    const frames = Math.max(60, Math.floor(audioDurationSec * 30));
    // zoompan needs an integer frame count — slow continuous zoom + drift.
    videoChain = `[0:v]${baseScale},zoompan=z='min(zoom+0.0005,1.08)':d=${frames}:s=${dims.w}x${dims.h}:fps=30,setsar=1`;
  }

  let filter: string;
  const waveH = Math.floor(dims.h * 0.18);
  if (opts.showWaveform) {
    filter =
      `${videoChain}[bg];` +
      `[1:a]showwaves=s=${dims.w}x${waveH}:mode=cline:colors=0xE94CFF|0xFF7A29:rate=30,format=yuva420p,` +
      `colorchannelmixer=aa=0.85[wave];` +
      `[bg][wave]overlay=0:H-h-${Math.floor(dims.h * 0.04)}:format=auto[v]`;
  } else {
    filter = `${videoChain}[v]`;
  }

  // Progress: ffmpeg.wasm emits 0..1 events keyed off the longest stream.
  const onProg = ({ progress }: { progress: number }) => {
    const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
    opts.onProgress?.(pct);
  };
  ff.on("progress", onProg);

  try {
    // Speed-tuned x264 settings: ultrafast preset, slightly higher CRF, fewer
    // reference frames, no B-frames, fast-decode tuning. With a still image
    // background most frames compress trivially so visual quality stays high
    // while encode time drops 3–5x compared to "fast"/CRF 20.
    const code = await ff.exec([
      "-loop", "1",
      "-framerate", "30",
      "-i", thumbName,
      "-i", audioName,
      "-filter_complex", filter,
      "-map", "[v]",
      "-map", "1:a",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-tune", "stillimage",
      "-pix_fmt", "yuv420p",
      "-crf", "23",
      "-x264-params", "ref=1:bframes=0:keyint=120:scenecut=0",
      "-c:a", "aac",
      "-b:a", "160k",
      "-shortest",
      "-movflags", "+faststart",
      "-threads", "0",
      outName,
    ]);
    if (code !== 0) {
      const tail = logLines.slice(-12).join("\n");
      throw new Error(`Video encode failed (ffmpeg exit ${code}).\n${tail}`);
    }
  } catch (e) {
    const tail = logLines.slice(-12).join("\n");
    const msg = (e as Error)?.message || "ffmpeg error";
    throw new Error(`${msg}${tail ? `\n${tail}` : ""}`);
  } finally {
    ff.off("progress", onProg);
    ff.off("log", collectLog);
  }

  const out = await ff.readFile(outName);
  // Best-effort cleanup so a second render in the same session starts clean.
  try { await ff.deleteFile(thumbName); } catch { /* ignore */ }
  try { await ff.deleteFile(audioName); } catch { /* ignore */ }
  try { await ff.deleteFile(outName); } catch { /* ignore */ }

  const arr =
    out instanceof Uint8Array
      ? out
      : typeof out === "string"
        ? new TextEncoder().encode(out)
        : new Uint8Array(out as unknown as ArrayBuffer);
  // Copy into a fresh ArrayBuffer so the Blob owns standalone memory.
  const buf = new ArrayBuffer(arr.byteLength);
  new Uint8Array(buf).set(arr);
  return new Blob([buf], { type: "video/mp4" });
}