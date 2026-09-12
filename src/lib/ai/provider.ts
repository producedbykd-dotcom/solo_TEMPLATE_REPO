/**
 * AI Provider adapter — all AI traffic goes through the Lovable AI Gateway.
 * Call sites keep using the gateway-shaped response
 * (`choices[0].message.content` / `.images`), so nothing upstream changes.
 *
 * Note: GOOGLE_GENERATIVE_AI_API_KEY is no longer read.
 */

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
  /** Kept for call-site compatibility; not sent to the gateway. */
  generationConfig?: Record<string, unknown>;
  /** Request timeout in ms. Default 120_000. */
  timeoutMs?: number;
};

/** Lovable AI Gateway model ids. */
function gatewayModelId(m: AIChatArgs["model"]): string {
  switch (m) {
    case "gemini-pro":   return "google/gemini-3.1-pro-preview";
    case "gemini-image": return "google/gemini-3-pro-image";
    case "gemini-flash":
    default:             return "google/gemini-3.7-flash";
  }
}

function mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const ctrl = new AbortController();
  const onA = () => ctrl.abort((a as any).reason);
  const onB = () => ctrl.abort((b as any).reason);
  if (a.aborted) onA(); else a.addEventListener("abort", onA, { once: true });
  if (b.aborted) onB(); else b.addEventListener("abort", onB, { once: true });
  return ctrl.signal;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Single gateway attempt. Throws an Error carrying `status` on HTTP failure. */
async function gatewayAttempt(args: AIChatArgs, key: string): Promise<any> {
  const body: Record<string, unknown> = {
    model: gatewayModelId(args.model),
    messages: args.messages,
  };
  if (args.modalities) body.modalities = args.modalities;

  const timeoutMs = args.timeoutMs ?? 120_000;
  const timeoutCtrl = new AbortController();
  const t = setTimeout(() => timeoutCtrl.abort(new Error("timeout")), timeoutMs);
  const signal = args.signal ? mergeSignals(args.signal, timeoutCtrl.signal) : timeoutCtrl.signal;

  let r: Response;
  try {
    r = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      signal,
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    if (timeoutCtrl.signal.aborted && !args.signal?.aborted) {
      const err: any = new Error(`AI request timed out after ${timeoutMs}ms`);
      err.status = 504;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(t);
  }

  if (!r.ok) {
    const text = (await r.text()).slice(0, 500);
    let message = text;
    try {
      const j = JSON.parse(text);
      message = j?.error?.message ?? j?.message ?? text;
    } catch { /* keep raw */ }
    const err: any = new Error(`AI gateway ${r.status}: ${message}`);
    err.status = r.status;
    err.bodyPreview = text;
    err.retryAfter = Number(r.headers.get("retry-after")) || undefined;
    throw err;
  }
  return r.json();
}

/**
 * Text or multimodal chat through the Lovable AI Gateway.
 * 429/5xx are retried with bounded backoff; 400/401/402/403 are terminal.
 */
export async function aiChatRaw(args: AIChatArgs): Promise<any> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("AI is not configured on the server (missing LOVABLE_API_KEY)");

  const maxAttempts = 3;
  let lastErr: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await gatewayAttempt(args, key);
    } catch (e: any) {
      lastErr = e;
      const status = Number(e?.status);
      const retryable = status === 429 || (status >= 500 && status <= 599);
      if (!retryable || attempt === maxAttempts) throw e;
      const wait = e?.retryAfter
        ? e.retryAfter * 1000
        : Math.round(800 * 2 ** (attempt - 1) * (1 + Math.random() * 0.3));
      console.warn("[aiChatRaw] retrying gateway call", { status, attempt, waitMs: wait });
      await sleep(wait);
    }
  }
  throw lastErr;
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
