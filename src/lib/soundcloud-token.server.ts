import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type SoundcloudToken = {
  accessToken: string;
  scUserId: string;
  username: string | null;
};

export async function getSoundcloudAccessToken(userId: string): Promise<SoundcloudToken> {
  const { data, error } = await supabaseAdmin
    .from("soundcloud_connections")
    .select("access_token, refresh_token, token_expires_at, sc_user_id, username")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("SoundCloud not connected. Connect it from the Connections page.");

  const expiresAt = data.token_expires_at ? new Date(data.token_expires_at).getTime() : 0;
  const needsRefresh = !data.access_token || (expiresAt > 0 && Date.now() > expiresAt - 60_000);

  if (!needsRefresh) {
    return { accessToken: data.access_token!, scUserId: data.sc_user_id, username: data.username };
  }
  if (!data.refresh_token) throw new Error("SoundCloud session expired. Reconnect SoundCloud.");

  const clientId = process.env.SOUNDCLOUD_CLIENT_ID;
  const clientSecret = process.env.SOUNDCLOUD_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("SoundCloud is not configured on this server.");

  const res = await fetch("https://secure.soundcloud.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json; charset=utf-8",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: data.refresh_token,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`SoundCloud token refresh failed: ${t.slice(0, 200)}`);
  }
  const tok = (await res.json()) as {
    access_token: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
  };
  const newExpires = tok.expires_in
    ? new Date(Date.now() + (tok.expires_in - 30) * 1000).toISOString()
    : null;
  await supabaseAdmin
    .from("soundcloud_connections")
    .update({
      access_token: tok.access_token,
      refresh_token: tok.refresh_token ?? data.refresh_token,
      token_expires_at: newExpires,
    })
    .eq("user_id", userId);

  return { accessToken: tok.access_token, scUserId: data.sc_user_id, username: data.username };
}