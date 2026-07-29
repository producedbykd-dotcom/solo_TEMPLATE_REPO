import { createHmac, randomBytes, timingSafeEqual } from "crypto";

function signState(payload: string): string {
  const secret = process.env.YOUTUBE_OAUTH_STATE_SECRET!;
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function buildSignedState(userId: string): string {
  const nonce = randomBytes(12).toString("hex");
  const ts = Date.now().toString();
  const payload = `${userId}.${nonce}.${ts}`;
  const sig = signState(payload);
  return `${payload}.${sig}`;
}

export function verifySignedState(state: string): { userId: string } | null {
  const parts = state.split(".");
  if (parts.length !== 4) return null;
  const [userId, nonce, ts, sig] = parts;
  const expected = signState(`${userId}.${nonce}.${ts}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Date.now() - Number(ts) > 15 * 60 * 1000) return null;
  return { userId };
}