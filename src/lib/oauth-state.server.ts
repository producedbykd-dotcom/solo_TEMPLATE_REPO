import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/** Generic signed-state helper reused for Meta and TikTok OAuth.
 *  We reuse the YouTube state secret so we only need one env var. */
function secret() {
  return process.env.YOUTUBE_OAUTH_STATE_SECRET!;
}
function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export function buildOAuthState(userId: string, provider: string): string {
  const nonce = randomBytes(12).toString("hex");
  const ts = Date.now().toString();
  const payload = `${provider}.${userId}.${nonce}.${ts}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyOAuthState(state: string, provider: string): { userId: string } | null {
  const parts = state.split(".");
  if (parts.length !== 5) return null;
  const [prov, userId, nonce, ts, sig] = parts;
  if (prov !== provider) return null;
  const expected = sign(`${prov}.${userId}.${nonce}.${ts}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Date.now() - Number(ts) > 15 * 60 * 1000) return null;
  return { userId };
}