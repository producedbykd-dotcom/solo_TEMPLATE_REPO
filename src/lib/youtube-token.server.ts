import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type YoutubeToken = { accessToken: string; channelId: string; channelTitle: string };

/** Returns a valid YouTube access token for the user, refreshing if needed. */
export async function getYoutubeAccessToken(userId: string): Promise<YoutubeToken> {
  const { data, error } = await supabaseAdmin
    .from("youtube_connections")
    .select("access_token, refresh_token, token_expires_at, channel_id, channel_title")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("YouTube not connected. Connect it from the Connections page.");

  const expiresAt = data.token_expires_at ? new Date(data.token_expires_at).getTime() : 0;
  const needsRefresh = !data.access_token || Date.now() > expiresAt - 30_000;

  if (!needsRefresh) {
    return { accessToken: data.access_token!, channelId: data.channel_id!, channelTitle: data.channel_title! };
  }

  if (!data.refresh_token) {
    throw new Error("YouTube session expired and no refresh token. Reconnect YouTube.");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.YOUTUBE_OAUTH_CLIENT_ID!,
      client_secret: process.env.YOUTUBE_OAUTH_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: data.refresh_token,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`YouTube token refresh failed: ${t.slice(0, 200)}`);
  }
  const tok = (await res.json()) as { access_token: string; expires_in: number };
  const newExpires = new Date(Date.now() + (tok.expires_in - 30) * 1000).toISOString();
  await supabaseAdmin
    .from("youtube_connections")
    .update({ access_token: tok.access_token, token_expires_at: newExpires })
    .eq("user_id", userId);

  return { accessToken: tok.access_token, channelId: data.channel_id!, channelTitle: data.channel_title! };
}