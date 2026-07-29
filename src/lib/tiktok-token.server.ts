import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type TiktokToken = { accessToken: string; openId: string; displayName: string | null };

export async function getTiktokAccessToken(userId: string): Promise<TiktokToken> {
  const { data, error } = await supabaseAdmin
    .from("tiktok_connections")
    .select("access_token, refresh_token, token_expires_at, open_id, display_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("TikTok not connected. Connect it from the Connections page.");

  const expiresAt = data.token_expires_at ? new Date(data.token_expires_at).getTime() : 0;
  const needsRefresh = !data.access_token || Date.now() > expiresAt - 30_000;

  if (!needsRefresh) {
    return { accessToken: data.access_token!, openId: data.open_id, displayName: data.display_name };
  }
  if (!data.refresh_token) throw new Error("TikTok session expired. Reconnect TikTok.");

  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: data.refresh_token,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`TikTok token refresh failed: ${t.slice(0, 200)}`);
  }
  const tok = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string; refresh_expires_in?: number };
  const newExpires = new Date(Date.now() + (tok.expires_in - 30) * 1000).toISOString();
  const refreshExpires = tok.refresh_expires_in
    ? new Date(Date.now() + tok.refresh_expires_in * 1000).toISOString()
    : null;
  await supabaseAdmin
    .from("tiktok_connections")
    .update({
      access_token: tok.access_token,
      refresh_token: tok.refresh_token ?? data.refresh_token,
      token_expires_at: newExpires,
      refresh_expires_at: refreshExpires,
    })
    .eq("user_id", userId);

  return { accessToken: tok.access_token, openId: data.open_id, displayName: data.display_name };
}