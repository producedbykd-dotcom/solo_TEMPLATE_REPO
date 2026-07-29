// Browser-only: concatenate multiple audio tracks into a single audio blob
// using ffmpeg.wasm's concat demuxer, then hand off to buildLongformVideo to
// produce one cohesive longform mp4 (cover + waveform).
import { getFFmpeg } from "@/lib/longform";
import { fetchFile } from "@ffmpeg/util";
import { buildLongformVideo } from "@/lib/longform";

export async function concatAudioToMp3(audios: Array<{ blob: Blob; ext: string }>): Promise<Blob> {
  const ff = await getFFmpeg();
  const names: string[] = [];
  for (let i = 0; i < audios.length; i++) {
    const name = `part-${i}.${audios[i].ext || "mp3"}`;
    await ff.writeFile(name, await fetchFile(audios[i].blob));
    names.push(name);
  }
  // Build a concat list file.
  const list = names.map((n) => `file '${n}'`).join("\n") + "\n";
  await ff.writeFile("list.txt", new TextEncoder().encode(list));
  const out = "combined.mp3";
  const code = await ff.exec([
    "-f", "concat",
    "-safe", "0",
    "-i", "list.txt",
    "-vn",
    "-c:a", "libmp3lame",
    "-b:a", "192k",
    out,
  ]);
  if (code !== 0) throw new Error(`Audio concat failed (ffmpeg exit ${code})`);
  const data = await ff.readFile(out);
  for (const n of names) try { await ff.deleteFile(n); } catch { /* */ }
  try { await ff.deleteFile("list.txt"); } catch { /* */ }
  try { await ff.deleteFile(out); } catch { /* */ }
  const arr =
    data instanceof Uint8Array
      ? data
      : typeof data === "string"
        ? new TextEncoder().encode(data)
        : new Uint8Array(data as unknown as ArrayBuffer);
  const buf = new ArrayBuffer(arr.byteLength);
  new Uint8Array(buf).set(arr);
  return new Blob([buf], { type: "audio/mpeg" });
}

export async function renderCompilationVideo(args: {
  audios: Array<{ blob: Blob; ext: string }>;
  coverBlob: Blob;
  coverMime: string;
  onProgress?: (pct: number) => void;
  onLog?: (line: string) => void;
}): Promise<Blob> {
  const combined = await concatAudioToMp3(args.audios);
  return buildLongformVideo({
    thumbnailBlob: args.coverBlob,
    thumbnailMime: args.coverMime,
    audioBlob: combined,
    audioFilename: "audio.mp3",
    resolution: "1080p",
    showWaveform: true,
    animateThumbnail: true,
    onProgress: args.onProgress,
    onLog: args.onLog,
  });
}