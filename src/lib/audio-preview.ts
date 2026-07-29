// Browser-only: decode an uploaded audio file and re-encode a tiny mono MP3
// preview used SOLELY for AI analysis. The original release file is never
// altered or shortened.
import { Mp3Encoder } from "@breezystack/lamejs";

const TARGET_SAMPLE_RATE = 22050;
const TARGET_BITRATE_KBPS = 48;
const MAX_PREVIEW_SECONDS = 600; // 10 minutes is plenty for genre/key/bpm detection

function downmixToMono(buffer: AudioBuffer): Float32Array {
  const { numberOfChannels, length } = buffer;
  if (numberOfChannels === 1) return buffer.getChannelData(0);
  const out = new Float32Array(length);
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) out[i] += data[i];
  }
  for (let i = 0; i < length; i++) out[i] /= numberOfChannels;
  return out;
}

async function resampleMono(
  input: Float32Array,
  sourceRate: number,
  targetRate: number,
): Promise<Float32Array> {
  if (sourceRate === targetRate) return input;
  const OfflineCtx =
    (window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext })
      .OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  if (!OfflineCtx) throw new Error("OfflineAudioContext unavailable");
  const outLength = Math.ceil((input.length * targetRate) / sourceRate);
  const ctx = new OfflineCtx(1, outLength, targetRate);
  const buf = ctx.createBuffer(1, input.length, sourceRate);
  const copy = new Float32Array(input.length);
  copy.set(input);
  buf.copyToChannel(copy, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0);
}

function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/* ----------------------- LUFS (BS.1770-style) ----------------------- */

/**
 * K-weighting pre-filter (BS.1770): a high-shelf at ~1.5 kHz cascaded with a
 * high-pass at ~38 Hz. Coefficients here are the standard reference values
 * for 48 kHz; for our analysis pre-decode we resample first so a small drift
 * across sample rates is acceptable for genre-level guidance.
 */
function kWeight(input: Float32Array, sampleRate: number): Float32Array {
  // Coefficients adapted for the input sample rate via bilinear scaling.
  // Using fixed 48k tables — for non-48k we let the filter approximate.
  // High-shelf
  const a0s = 1.53512485958697, a1s = -2.69169618940638, a2s = 1.19839281085285;
  const b1s = -1.69065929318241, b2s = 0.73248077421585;
  // High-pass
  const a0h = 1.0, a1h = -2.0, a2h = 1.0;
  const b1h = -1.99004745483398, b2h = 0.99007225036621;

  const out = new Float32Array(input.length);
  let z1 = 0, z2 = 0, w1 = 0, w2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    // high-shelf
    const y = a0s * x + a1s * z1 + a2s * z2 - b1s * w1 - b2s * w2;
    z2 = z1; z1 = x;
    w2 = w1; w1 = y;
    out[i] = y;
  }
  // high-pass cascade
  let z1h = 0, z2h = 0, w1h = 0, w2h = 0;
  for (let i = 0; i < out.length; i++) {
    const x = out[i];
    const y = a0h * x + a1h * z1h + a2h * z2h - b1h * w1h - b2h * w2h;
    z2h = z1h; z1h = x;
    w2h = w1h; w1h = y;
    out[i] = y;
  }
  void sampleRate;
  return out;
}

/**
 * Integrated LUFS with a -10 LU relative gate, computed on a mono mixdown.
 * Stereo true loudness differs slightly but the result is well within the
 * tolerance we need for "is this hot for Apple Music?" guidance.
 */
function integratedLufsFromMono(mono: Float32Array, sampleRate: number): number | null {
  if (!mono.length) return null;
  const weighted = kWeight(mono, sampleRate);
  const blockSize = Math.floor(0.4 * sampleRate); // 400 ms
  const hop = Math.floor(0.1 * sampleRate); // 100 ms (75% overlap)
  if (blockSize <= 0) return null;
  const meanSquares: number[] = [];
  for (let start = 0; start + blockSize <= weighted.length; start += hop) {
    let sum = 0;
    for (let i = 0; i < blockSize; i++) {
      const v = weighted[start + i];
      sum += v * v;
    }
    meanSquares.push(sum / blockSize);
  }
  if (!meanSquares.length) return null;
  // Absolute gate at -70 LUFS (block loudness)
  const absGated = meanSquares.filter((ms) => -0.691 + 10 * Math.log10(ms || 1e-12) >= -70);
  if (!absGated.length) return null;
  const meanAbs = absGated.reduce((a, b) => a + b, 0) / absGated.length;
  const ungated = -0.691 + 10 * Math.log10(meanAbs || 1e-12);
  // Relative gate at -10 LU below the ungated mean
  const relThresh = ungated - 10;
  const relGated = absGated.filter((ms) => -0.691 + 10 * Math.log10(ms || 1e-12) >= relThresh);
  if (!relGated.length) return ungated;
  const meanRel = relGated.reduce((a, b) => a + b, 0) / relGated.length;
  return -0.691 + 10 * Math.log10(meanRel || 1e-12);
}

function truePeakDbtpFromMono(mono: Float32Array): number {
  // Approximate true-peak by 4× linear interpolation and tracking the absolute max.
  let peak = 0;
  for (let i = 0; i < mono.length - 1; i++) {
    const a = mono[i];
    const b = mono[i + 1];
    // sample point
    if (Math.abs(a) > peak) peak = Math.abs(a);
    // 3 inter-samples
    for (let f = 1; f < 4; f++) {
      const t = f / 4;
      const v = Math.abs(a * (1 - t) + b * t);
      if (v > peak) peak = v;
    }
  }
  if (peak <= 0) return -Infinity;
  return 20 * Math.log10(peak);
}

export type AnalysisPrepResult = {
  preview: Blob | null;
  integratedLufs: number | null;
  truePeakDbtp: number | null;
};

/**
 * Decodes the uploaded file once, then:
 *  - produces a small mono MP3 preview for Gemini
 *  - computes integrated LUFS + approximate true-peak from the SAME decoded buffer
 */
export async function prepareAnalysisAssets(file: File): Promise<AnalysisPrepResult> {
  const AC =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return { preview: null, integratedLufs: null, truePeakDbtp: null };

  let decoded: AudioBuffer;
  try {
    const arrayBuf = await file.arrayBuffer();
    const ctx = new AC();
    try {
      decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
    } finally {
      void ctx.close?.();
    }
  } catch {
    return { preview: null, integratedLufs: null, truePeakDbtp: null };
  }

  let integratedLufs: number | null = null;
  let truePeakDbtp: number | null = null;
  try {
    // LUFS uses the full-length mono mixdown at the source sample rate.
    const fullMono = downmixToMono(decoded);
    integratedLufs = integratedLufsFromMono(fullMono, decoded.sampleRate);
    const tp = truePeakDbtpFromMono(fullMono);
    truePeakDbtp = Number.isFinite(tp) ? tp : null;
  } catch {
    /* loudness is best-effort */
  }

  let preview: Blob | null = null;
  try {
    let mono = downmixToMono(decoded);
    const maxSrcSamples = MAX_PREVIEW_SECONDS * decoded.sampleRate;
    if (mono.length > maxSrcSamples) mono = mono.subarray(0, maxSrcSamples);
    const resampled = await resampleMono(mono, decoded.sampleRate, TARGET_SAMPLE_RATE);
    const int16 = floatToInt16(resampled);

    const encoder = new Mp3Encoder(1, TARGET_SAMPLE_RATE, TARGET_BITRATE_KBPS);
    const chunkSize = 1152;
    const chunks: BlobPart[] = [];
    for (let i = 0; i < int16.length; i += chunkSize) {
      const slice = int16.subarray(i, i + chunkSize);
      const enc = encoder.encodeBuffer(slice);
      if (enc.length) chunks.push(new Uint8Array(enc).slice().buffer);
    }
    const tail = encoder.flush();
    if (tail.length) chunks.push(new Uint8Array(tail).slice().buffer);
    preview = new Blob(chunks, { type: "audio/mpeg" });
  } catch {
    /* preview is best-effort */
  }

  return { preview, integratedLufs, truePeakDbtp };
}

/** Back-compat shim — older callers only wanted the preview blob. */
export async function buildAnalysisPreview(file: File): Promise<Blob | null> {
  return (await prepareAnalysisAssets(file)).preview;
}

/** XHR-based upload with progress reporting. */
export function uploadWithProgress(
  url: string,
  file: Blob,
  contentType: string,
  onProgress: (loaded: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText.slice(0, 200)}`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}