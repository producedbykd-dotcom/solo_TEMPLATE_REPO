/**
 * AI Provider adapter — talks directly to the Google Generative Language API
 * (Gemini). Uses GOOGLE_GENERATIVE_AI_API_KEY. All call sites keep using the
 * same gateway-shaped response (`choices[0].message.content` / `.images`) so
 * upstream helpers don't need to change.
 *
 * Fallback: if GOOGLE_GENERATIVE_AI_API_KEY is missing but the legacy
 * USE_LOVABLE_GATEWAY=1 env flag is set, we route through the Lovable AI
 * Gateway instead. This is a one-release rollback path only.
 */

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export type AIChatPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "input_audio"; input_audio: { data: string; format: string } };

export type AIChatMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "user"; content: AIChatPart[] };

export type AIChatArgs = {
  model?: "gemini-flash" | "gemini-pro" | "gemini-image";
  messages: AIChatMessage[];
  signal?: AbortSignal;
  modalities?: Array<"image" | "text">;
  /** Passthrough to Gemini generationConfig (e.g. responseMimeType). */
  generationConfig?: Record<string, unknown>;
  /** Request timeout in ms. Default 90_000. */
  timeoutMs?: number;
};

/** Gemini direct-API model ids. */
function geminiModel(m: AIChatArgs["model"]): string {
  switch (m) {
    case "gemini-pro":   return "gemini-2.5-pro";
    case "gemini-image": return "gemini-2.5-flash-image";
    case "gemini-flash":
    default:             return "gemini-2.5-flash";
  }
}

/** Lovable Gateway model ids (fallback only). */
function gatewayModelId(m: AIChatArgs["model"]): string {
  switch (m) {
    case "gemini-pro":   return "google/gemini-2.5-pro";
    case "gemini-image": return "google/gemini-3-pro-image";
    case "gemini-flash":
    default:             return "google/gemini-2.5-flash";
  }
}

function mimeForAudio(format: string): string {
  const f = format.toLowerCase();
  if (f === "wav") return "audio/wav";
  if (f === "flac") return "audio/flac";
  if (f === "m4a" || f === "mp4") return "audio/mp4";
  if (f === "ogg") return "audio/ogg";
  return "audio/mpeg";
}

function partsToGemini(content: string | AIChatPart[]): unknown[] {
  if (typeof content === "string") return [{ text: content }];
  return content.map((p) => {
    if (p.type === "text") return { text: p.text };
    if (p.type === "input_audio") {
      return { inline_data: { mime_type: mimeForAudio(p.input_audio.format), data: p.input_audio.data } };
    }
    const url = p.image_url.url;
    if (url.startsWith("data:")) {
      const m = url.match(/^data:([^;]+);base64,(.+)$/);
      if (m) return { inline_data: { mime_type: m[1], data: m[2] } };
    }
    return { text: `[reference image URL: ${url}]` };
  });
}

/** Approximate wire size of a Gemini request. Base64 audio dominates. */
function estimateBytes(messages: AIChatMessage[]): number {
  let n = 0;
  for (const m of messages) {
    const c: unknown = m.content;
    if (typeof c === "string") { n += c.length; continue; }
    if (Array.isArray(c)) {
      for (const p of c as AIChatPart[]) {
        if (p.type === "text") n += p.text.length;
        else if (p.type === "input_audio") n += p.input_audio.data.length;
        else if (p.type === "image_url") n += p.image_url.url.length;
      }
    }
  }
  return n;
}

/** Upload audio to Gemini Files API and return a file_uri. */
async function uploadAudioToFilesApi(
  b64: string,
  mime: string,
  key: string,
  signal?: AbortSignal,
): Promise<{ uri: string; name: string }> {
  // Decode b64 to bytes for the upload body.
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  // Start resumable upload session.
  const startRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": key,
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength),
        "X-Goog-Upload-Header-Content-Type": mime,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: `analysis-${Date.now()}` } }),
      signal,
    },
  );
  if (!startRes.ok) {
    throw new Error(`Files API start failed ${startRes.status}: ${(await startRes.text()).slice(0, 300)}`);
  }
  const uploadUrl = startRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Files API start: missing upload URL");

  const finRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(bytes.byteLength),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: bytes,
    signal,
  });
  if (!finRes.ok) {
    throw new Error(`Files API upload failed ${finRes.status}: ${(await finRes.text()).slice(0, 300)}`);
  }
  const finJson: any = await finRes.json();
  const file = finJson?.file;
  if (!file?.uri || !file?.name) throw new Error("Files API upload: missing uri/name in response");

  // Poll until ACTIVE (usually immediate for audio under a few MB).
  let state: string = file.state ?? "PROCESSING";
  const deadline = Date.now() + 30_000;
  while (state !== "ACTIVE" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    const g = await fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}`, {
      headers: { "x-goog-api-key": key },
      signal,
    });
    if (!g.ok) throw new Error(`Files API poll failed ${g.status}`);
    const gj: any = await g.json();
    state = gj?.state ?? state;
    if (state === "FAILED") throw new Error("Files API: upload processing FAILED");
  }
  if (state !== "ACTIVE") throw new Error(`Files API: upload not ACTIVE within 30s (state=${state})`);
  return { uri: file.uri, name: file.name };
}

async function deleteFilesApi(name: string, key: string): Promise<void> {
  try {
    await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}`, {
      method: "DELETE",
      headers: { "x-goog-api-key": key },
    });
  } catch { /* best-effort */ }
}

/** Direct Google Gemini API call. Normalizes to gateway-shaped response. */
async function aiChatDirect(args: AIChatArgs, key: string): Promise<any> {
  const model = geminiModel(args.model);

  // If total inline payload would exceed ~18 MB, upload any inline_audio parts
  // via Files API and replace them with file_data references.
  const INLINE_LIMIT = 18 * 1024 * 1024;
  const bytes = estimateBytes(args.messages);
  const cleanupNames: string[] = [];
  let workingMessages = args.messages;
  if (bytes > INLINE_LIMIT) {
    const rebuilt: AIChatMessage[] = [];
    for (const msg of args.messages) {
      if (msg.role !== "system" && Array.isArray(msg.content)) {
        const newParts: AIChatPart[] = [];
        for (const p of msg.content as AIChatPart[]) {
          if (p.type === "input_audio") {
            const mime = mimeForAudio(p.input_audio.format);
            const uploaded = await uploadAudioToFilesApi(p.input_audio.data, mime, key, args.signal);
            cleanupNames.push(uploaded.name);
            // Encode as a text placeholder — we'll transform in partsToGemini via a sentinel.
            // Easier: push a synthetic part using image_url with a data URL wrapper we detect below.
            (newParts as any).push({ __file_data: { file_uri: uploaded.uri, mime_type: mime } });
          } else {
            newParts.push(p);
          }
        }
        rebuilt.push({ role: msg.role as any, content: newParts as any });
      } else {
        rebuilt.push(msg);
      }
    }
    workingMessages = rebuilt;
  }

  const systemParts: Array<{ text: string }> = [];
  const contents: Array<{ role: string; parts: unknown[] }> = [];
  for (const msg of workingMessages) {
    if (msg.role === "system") {
      const content: unknown = msg.content;
      const t = typeof content === "string"
        ? content
        : Array.isArray(content)
          ? (content as AIChatPart[]).map((c) => (c.type === "text" ? c.text : "")).join("\n")
          : "";
      if (t) systemParts.push({ text: t });
      continue;
    }
    let parts: unknown[];
    if (Array.isArray(msg.content) && (msg.content as any[]).some((p) => p && (p as any).__file_data)) {
      parts = (msg.content as any[]).map((p) => {
        if (p && p.__file_data) return { file_data: p.__file_data };
        return partsToGemini([p as AIChatPart])[0];
      });
    } else {
      parts = partsToGemini(msg.content);
    }
    contents.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts,
    });
  }

  const body: Record<string, unknown> = { contents };
  if (systemParts.length) body.systemInstruction = { parts: systemParts };
  const gc: Record<string, unknown> = { ...(args.generationConfig ?? {}) };
  if (args.modalities?.includes("image")) {
    gc.responseModalities = ["IMAGE", "TEXT"];
  }
  if (Object.keys(gc).length) body.generationConfig = gc;

  const url = `${GEMINI_BASE}/${model}:generateContent`;
  const timeoutMs = args.timeoutMs ?? 90_000;
  const timeoutCtrl = new AbortController();
  const t = setTimeout(() => timeoutCtrl.abort(new Error("timeout")), timeoutMs);
  const combined = args.signal
    ? mergeSignals(args.signal, timeoutCtrl.signal)
    : timeoutCtrl.signal;

  let r: Response;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: combined,
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    clearTimeout(t);
    for (const n of cleanupNames) void deleteFilesApi(n, key);
    if (timeoutCtrl.signal.aborted) {
      throw new Error(`Gemini request timed out after ${timeoutMs}ms (model=${model}, bytes=${bytes})`);
    }
    throw e;
  }
  clearTimeout(t);
  for (const n of cleanupNames) void deleteFilesApi(n, key);

  if (!r.ok) {
    const text = (await r.text()).slice(0, 500);
    const err: any = new Error(`Gemini ${r.status}: ${text}`);
    err.status = r.status;
    err.bodyPreview = text;
    throw err;
  }
  const j = await r.json();
  const finishReason: string | undefined = j?.candidates?.[0]?.finishReason;
  const blockReason: string | undefined = j?.promptFeedback?.blockReason;
  if (finishReason && finishReason !== "STOP") {
    console.warn("[aiChatDirect] non-STOP finishReason", { model, finishReason, blockReason });
  }
  const parts: any[] = j?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter((p) => typeof p?.text === "string").map((p) => p.text).join("");
  const images = parts
    .map((p) => p?.inlineData || p?.inline_data)
    .filter((d) => d && typeof d.data === "string")
    .map((d) => ({ image_url: { url: `data:${d.mimeType || d.mime_type || "image/png"};base64,${d.data}` } }));
  return {
    choices: [{ message: { content: text, images } }],
    finishReason,
    blockReason,
    _raw: j,
  };
}

function mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const ctrl = new AbortController();
  const onA = () => ctrl.abort((a as any).reason);
  const onB = () => ctrl.abort((b as any).reason);
  if (a.aborted) onA(); else a.addEventListener("abort", onA, { once: true });
  if (b.aborted) onB(); else b.addEventListener("abort", onB, { once: true });
  return ctrl.signal;
}

/** Legacy Lovable Gateway call, kept behind USE_LOVABLE_GATEWAY=1 for rollback. */
async function aiChatGateway(args: AIChatArgs, key: string): Promise<any> {
  // Rebuild messages into gateway (OpenAI-compatible) shape — pass through the
  // gateway-specific `input_audio` part unchanged.
  const body: Record<string, unknown> = {
    model: gatewayModelId(args.model),
    messages: args.messages,
  };
  if (args.modalities) body.modalities = args.modalities;
  const r = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    signal: args.signal,
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = (await r.text()).slice(0, 400);
    const err: any = new Error(`AI gateway ${r.status}: ${text}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

/** Text or multimodal chat. Returns a gateway-shaped payload. */
export async function aiChatRaw(args: AIChatArgs): Promise<any> {
  const useGateway = process.env.USE_LOVABLE_GATEWAY === "1";
  const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const lovableKey = process.env.LOVABLE_API_KEY;

  // Explicit override: force gateway.
  if (useGateway && lovableKey) return aiChatGateway(args, lovableKey);

  // Preferred path: direct Google Gemini with fast timeout + auto-fallback to
  // Lovable Gateway on quota/billing errors so users get a seamless experience
  // while their paid Google account is still propagating.
  if (geminiKey) {
    const directArgs = { ...args, timeoutMs: args.timeoutMs ?? 45_000 };
    try {
      return await aiChatDirect(directArgs, geminiKey);
    } catch (e: any) {
      if (!lovableKey) throw e;
      const status = e?.status;
      const body = String(e?.bodyPreview ?? "");
      const msg = String(e?.message ?? "");
      const quotaLike =
        status === 429 ||
        /RESOURCE_EXHAUSTED|prepayment|quota|billing|PERMISSION_DENIED|timed out/i.test(body + " " + msg);
      if (!quotaLike) throw e;
      console.warn("[aiChatRaw] direct Gemini failed, falling back to Lovable Gateway", {
        status,
        preview: (body || msg).slice(0, 200),
      });
      try {
        return await aiChatGateway(args, lovableKey);
      } catch (gErr: any) {
        console.error("[aiChatRaw] gateway fallback also failed", {
          message: String(gErr?.message ?? gErr),
        });
        throw e; // surface original direct-API error
      }
    }
  }

  if (lovableKey) return aiChatGateway(args, lovableKey);
  throw new Error("No AI credential configured (set GOOGLE_GENERATIVE_AI_API_KEY)");
}

/** Convenience helper for plain-text completions. */
export async function aiChat(args: AIChatArgs): Promise<string> {
  const j = await aiChatRaw(args);
  return j?.choices?.[0]?.message?.content ?? "";
}

/** Image generation. Returns data URL. */
export async function aiImage(prompt: string, refImageDataUrls: string[] = []): Promise<string> {
  const content: any[] = [{ type: "text", text: prompt }];
  for (const url of refImageDataUrls.slice(0, 3)) {
    content.push({ type: "image_url", image_url: { url } });
  }
  const j = await aiChatRaw({
    model: "gemini-image",
    modalities: ["image", "text"],
    messages: [{ role: "user", content } as AIChatMessage],
  });
  const url: string | undefined = j?.choices?.[0]?.message?.images?.[0]?.image_url?.url
    ?? j?.choices?.[0]?.message?.images?.[0]?.url;
  if (!url) throw new Error("No image returned");
  return url;
}