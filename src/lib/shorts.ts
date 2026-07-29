// Browser-only: render a vertical (1080x1920) short MP4 from the project's
// thumbnail + a slice of the original audio. Uses the same ffmpeg.wasm
// instance as the longform renderer so we only pay the load cost once.
import { fetchFile } from "@ffmpeg/util";
import { getFFmpeg } from "./longform";

export type ShortOptions = {
  thumbnailBlob: Blob;
  thumbnailMime: string;
  audioBlob: Blob;
  audioFilename: string;
  startSec: number;
  durationSec: number; // 5..60
  showWaveform: boolean;
  onProgress?: (pct: number) => void;
  onLog?: (line: string) => void;
};

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

export async function buildShortVideo(opts: ShortOptions): Promise<Blob> {
  const ff = await getFFmpeg();
  const W = 1080;
  const H = 1920;
  const dur = Math.max(3, Math.min(60, Math.round(opts.durationSec)));
  const start = Math.max(0, opts.startSec);

  const thumbExt = opts.thumbnailMime.includes("png") ? "png" : "jpg";
  const audioName = audioNameFor(opts.audioBlob, opts.audioFilename || "audio.mp3");
  const thumbName = `sthumb.${thumbExt}`;
  const outName = `short_${Date.now()}.mp4`;

  const logLines: string[] = [];
  const onLog = ({ message }: { message: string }) => {
    logLines.push(message);
    if (logLines.length > 200) logLines.splice(0, logLines.length - 200);
    opts.onLog?.(message);
  };
  ff.on("log", onLog);

  await ff.writeFile(thumbName, await fetchFile(opts.thumbnailBlob));
  await ff.writeFile(audioName, await fetchFile(opts.audioBlob));

  // Contain-fit the thumbnail into a 9:16 canvas so the whole image is
  // visible; pad the empty area (top/bottom for landscape/square covers).
  const videoChain =
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30`;

  const waveH = Math.floor(H * 0.14);
  const filter = opts.showWaveform
    ? `${videoChain}[bg];` +
      `[1:a]atrim=start=${start}:duration=${dur},asetpts=PTS-STARTPTS,` +
      `showwaves=s=${W}x${waveH}:mode=cline:colors=0xE94CFF|0xFF7A29:rate=30,` +
      `format=yuva420p,colorchannelmixer=aa=0.85[wave];` +
      `[bg][wave]overlay=0:H-h-${Math.floor(H * 0.06)}:format=auto[v]`
    : `${videoChain}[v]`;

  const onProg = ({ progress }: { progress: number }) => {
    opts.onProgress?.(Math.max(0, Math.min(100, Math.round(progress * 100))));
  };
  ff.on("progress", onProg);

  try {
    const code = await ff.exec([
      "-loop", "1",
      "-framerate", "30",
      "-i", thumbName,
      "-ss", String(start),
      "-t", String(dur),
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
      "-threads", "0",
      "-c:a", "aac",
      "-b:a", "160k",
      "-t", String(dur),
      "-movflags", "+faststart",
      outName,
    ]);
    if (code !== 0) {
      const tail = logLines.slice(-12).join("\n");
      throw new Error(`Short encode failed (ffmpeg exit ${code}).\n${tail}`);
    }
  } catch (e) {
    const tail = logLines.slice(-12).join("\n");
    const msg = (e as Error)?.message || "ffmpeg error";
    throw new Error(`${msg}${tail ? `\n${tail}` : ""}`);
  } finally {
    ff.off("progress", onProg);
    ff.off("log", onLog);
  }

  const out = await ff.readFile(outName);
  try { await ff.deleteFile(thumbName); } catch { /* ignore */ }
  try { await ff.deleteFile(audioName); } catch { /* ignore */ }
  try { await ff.deleteFile(outName); } catch { /* ignore */ }

  const arr =
    out instanceof Uint8Array
      ? out
      : typeof out === "string"
        ? new TextEncoder().encode(out)
        : new Uint8Array(out as unknown as ArrayBuffer);
  const buf = new ArrayBuffer(arr.byteLength);
  new Uint8Array(buf).set(arr);
  return new Blob([buf], { type: "video/mp4" });
}