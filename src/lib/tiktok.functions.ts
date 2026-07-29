import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPublicOrigin } from "./public-origin";

const SCOPES = ["user.info.basic", "video.upload", "video.publish"].join(",");


export const getTiktokAuthUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const origin = getPublicOrigin();
    const redirectUri = `${origin}/api/public/tiktok/oauth-callback`;
    const { buildOAuthState } = await import("./oauth-state.server");
    const state = buildOAuthState(context.userId, "tiktok");
    const params = new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES,
      state,
    });
    return { url: `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}` };
  });

export const getTiktokConnectionInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("tiktok_connections")
      .select("display_name, avatar_url, open_id, scope, created_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { connection: data };
  });

export const disconnectTiktok = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase.from("tiktok_connections").delete().eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });