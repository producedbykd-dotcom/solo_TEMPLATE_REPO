/**
 * Browser-only: build the free "tagged" MP3 by overlaying a spoken voice tag
 * over the master at fixed intervals. Pure WebAudio + lamejs (no ffmpeg), so
 * it runs in seconds even on long tracks.
 */
import { Mp3Encoder } from "@breezystack/lamejs";

const OUT_RATE = 44100;
const BITRATE = 128;

async function decode(bytes: ArrayBuffer): Promise<AudioBuffer> {
  const Ctx = (window as any).AudioContext ?? (window as any).webkitAudioContext;
  const ctx = new Ctx({ sampleRate: OUT_RATE });
  const buf = await ctx.decodeAudioData(bytes.slice(0));
  await ctx.close?.();
  return buf;
}

function toMono(b: AudioBuffer): Float32Array {
  if (b.numberOfChannels === 1) return b.getChannelData(0).slice();
  const out = new Float32Array(b.length);
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < b.length; i++) out[i] += d[i];
  }
  for (let i = 0; i < b.length; i++) out[i] /= b.numberOfChannels;
  return out;
}

export async function buildTaggedMp3(opts: {
  masterBytes: ArrayBuffer;
  tagBytes: ArrayBuffer;
  intervalSec?: number;
  tagGain?: number;
  duckDb?: number;
  onProgress?: (pct: number) => void;
}): Promise<Blob> {
  const interval = Math.max(10, opts.intervalSec ?? 25);
  const tagGain = opts.tagGain ?? 0.85;
  const duck = Math.pow(10, (opts.duckDb ?? -6) / 20);

  opts.onProgress?.(5);
  const master = await decode(opts.masterBytes);
  const tag = await decode(opts.tagBytes);
  opts.onProgress?.(35);

  const mix = toMono(master);
  const voice = toMono(tag);
  const rate = master.sampleRate;
  const step = Math.round(interval * rate);
  const firstAt = Math.round(Math.min(8, interval / 2) * rate);

  for (let start = firstAt; start + voice.length < mix.length; start += step) {
    for (let i = 0; i < voice.length; i++) {
      const idx = start + i;
      // Duck the music under the tag, then add the tag on top.
      mix[idx] = Math.max(-1, Math.min(1, mix[idx] * duck + voice[i] * tagGain));
    }
  }
  opts.onProgress?.(60);

  const encoder = new Mp3Encoder(1, rate, BITRATE);
  const chunks: Uint8Array[] = [];
  const block = 1152;
  const pcm = new Int16Array(mix.length);
  for (let i = 0; i < mix.length; i++) {
    const s = Math.max(-1, Math.min(1, mix[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  for (let i = 0; i < pcm.length; i += block) {
    const buf = encoder.encodeBuffer(pcm.subarray(i, i + block));
    if (buf.length) chunks.push(new Uint8Array(buf));
    if (i % (block * 400) === 0) opts.onProgress?.(60 + Math.round((i / pcm.length) * 38));
  }
  const end = encoder.flush();
  if (end.length) chunks.push(new Uint8Array(end));
  opts.onProgress?.(100);

  return new Blob(chunks as BlobPart[], { type: "audio/mpeg" });
}

export function base64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}