import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPublicOrigin } from "./public-origin";

// SoundCloud's new OAuth (api-v2 / api.soundcloud.com) requires PKCE.
// We generate a verifier server-side, persist it in soundcloud_oauth_pkce
// keyed by a signed state value, and the OAuth callback exchanges the code.

export const getSoundcloudAuthUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const clientId = process.env.SOUNDCLOUD_CLIENT_ID;
    if (!clientId) throw new Error("SoundCloud is not configured yet. Add SOUNDCLOUD_CLIENT_ID/SECRET once your developer app is approved.");
    const origin = getPublicOrigin();
    const redirectUri = `${origin}/api/public/soundcloud/oauth-callback`;

    const { buildOAuthState } = await import("./oauth-state.server");
    const { randomBytes, createHash } = await import("crypto");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const state = buildOAuthState(context.userId, "soundcloud");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");

    await supabaseAdmin.from("soundcloud_oauth_pkce").insert({
      state, user_id: context.userId, code_verifier: verifier,
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
    });
    return { url: `https://secure.soundcloud.com/authorize?${params.toString()}` };
  });

export const getSoundcloudConnectionInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("soundcloud_connections")
      .select("username, display_name, avatar_url, permalink_url, sc_user_id, scope, created_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { connection: data };
  });

export const disconnectSoundcloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("soundcloud_connections").delete().eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });