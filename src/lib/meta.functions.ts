import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPublicOrigin } from "./public-origin";

const SCOPES = [
  "public_profile",
  "email",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "business_management",
  "instagram_basic",
  "instagram_content_publish",
].join(",");


export const getMetaAuthUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const origin = getPublicOrigin();
    const redirectUri = `${origin}/api/public/meta/oauth-callback`;
    const { buildOAuthState } = await import("./oauth-state.server");
    const state = buildOAuthState(context.userId, "meta");
    const params = new URLSearchParams({
      client_id: process.env.META_APP_ID!,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES,
      state,
    });
    return { url: `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}` };
  });

export const getMetaConnectionInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("meta_connections")
      .select("fb_user_name, page_name, page_id, ig_username, ig_user_id, scope, created_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { connection: data };
  });

export const disconnectMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase.from("meta_connections").delete().eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });