/**
 * Browser-only producer-tag FX chain. Takes the raw TTS bytes and turns them
 * into something that sounds like a real tag: pitch/formant shift, a detuned
 * double, slap delay, a short tail, saturation and an optional phone band.
 * Pure WebAudio (OfflineAudioContext) + lamejs, same approach as
 * ./tagged-download.ts, so no ffmpeg is needed.
 */
import { Mp3Encoder } from "@breezystack/lamejs";

export type TagFxSettings = {
  pitch: number;   // semitones, -12..12
  double: number;  // 0..1
  slap: number;    // 0..1
  reverb: number;  // 0..1
  drive: number;   // 0..1
  phone: boolean;
  gain: number;    // 0.2..2
};

export const NEUTRAL_FX: TagFxSettings = {
  pitch: 0, double: 0, slap: 0, reverb: 0, drive: 0, phone: false, gain: 1,
};

const RATE = 44100;
const BITRATE = 128;

function driveCurve(amount: number): Float32Array {
  const k = 1 + amount * 40;
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

function makeTail(ctx: OfflineAudioContext, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
  }
  return buf;
}

async function decode(bytes: ArrayBuffer): Promise<AudioBuffer> {
  const Ctx = (window as any).AudioContext ?? (window as any).webkitAudioContext;
  const ctx = new Ctx({ sampleRate: RATE });
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

function encodeMp3(mono: Float32Array, rate: number): Blob {
  const encoder = new Mp3Encoder(1, rate, BITRATE);
  const chunks: Uint8Array[] = [];
  const pcm = new Int16Array(mono.length);
  for (let i = 0; i < mono.length; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const block = 1152;
  for (let i = 0; i < pcm.length; i += block) {
    const buf = encoder.encodeBuffer(pcm.subarray(i, i + block));
    if (buf.length) chunks.push(new Uint8Array(buf));
  }
  const end = encoder.flush();
  if (end.length) chunks.push(new Uint8Array(end));
  return new Blob(chunks as BlobPart[], { type: "audio/mpeg" });
}

/** Render the FX chain over the given tag audio and return a fresh mp3. */
export async function applyTagFx(tagBytes: ArrayBuffer, fx: TagFxSettings): Promise<Blob> {
  const src = await decode(tagBytes);
  const semis = Math.max(-12, Math.min(12, fx.pitch || 0));
  const ratio = Math.pow(2, semis / 12);
  // Pitch shift by resampling: render at a scaled rate so the whole take moves.
  const tailSec = fx.reverb > 0 ? 0.9 : 0;
  const outLen = Math.ceil((src.length / ratio) + (tailSec + 0.4) * RATE);
  const ctx = new OfflineAudioContext(1, outLen, RATE);

  const out = ctx.createGain();
  out.gain.value = Math.max(0.2, Math.min(2, fx.gain || 1));

  const shaper = ctx.createWaveShaper();
  shaper.curve = driveCurve(Math.max(0, Math.min(1, fx.drive || 0))) as unknown as Float32Array<ArrayBuffer>;
  shaper.oversample = "4x";
  shaper.connect(out);

  let chainIn: AudioNode = shaper;
  if (fx.phone) {
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 500;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 3200;
    hp.connect(lp); lp.connect(shaper);
    chainIn = hp;
  }

  const addVoice = (detuneCents: number, delaySec: number, level: number) => {
    const node = ctx.createBufferSource();
    node.buffer = src;
    node.playbackRate.value = ratio * Math.pow(2, detuneCents / 1200);
    const g = ctx.createGain();
    g.gain.value = level;
    node.connect(g); g.connect(chainIn);
    node.start(delaySec);
    return g;
  };

  addVoice(0, 0, 1);
  if (fx.double > 0) addVoice(-12, 0.022, Math.min(1, fx.double));
  if (fx.double > 0) addVoice(11, 0.035, Math.min(1, fx.double) * 0.7);

  if (fx.slap > 0) {
    const d = ctx.createDelay(1);
    d.delayTime.value = 0.115;
    const g = ctx.createGain();
    g.gain.value = Math.min(1, fx.slap) * 0.6;
    const fb = ctx.createGain();
    fb.gain.value = 0.18;
    shaper.connect(d); d.connect(g); g.connect(out);
    d.connect(fb); fb.connect(d);
  }

  if (fx.reverb > 0) {
    const conv = ctx.createConvolver();
    conv.buffer = makeTail(ctx, 0.8);
    const g = ctx.createGain();
    g.gain.value = Math.min(1, fx.reverb) * 0.8;
    shaper.connect(conv); conv.connect(g); g.connect(out);
  }

  out.connect(ctx.destination);
  const rendered = await ctx.startRendering();
  return encodeMp3(toMono(rendered), rendered.sampleRate);
}

export function blobToArrayBuffer(b: Blob): Promise<ArrayBuffer> {
  return b.arrayBuffer();
}
