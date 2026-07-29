import { createFileRoute } from "@tanstack/react-router";
import { verifyOAuthState } from "@/lib/oauth-state.server";
import { getPublicOrigin } from "@/lib/public-origin";

export const Route = createFileRoute("/api/public/soundcloud/oauth-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const errParam = url.searchParams.get("error_description") ?? url.searchParams.get("error");
        const origin = getPublicOrigin();
        const redir = (qs: string) =>
          new Response(null, { status: 302, headers: { Location: `${origin}/connections?${qs}` } });

        if (errParam) return redir(`soundcloud=error&reason=${encodeURIComponent(errParam)}`);
        if (!code || !state) return redir("soundcloud=error&reason=missing_code");
        const verified = verifyOAuthState(state, "soundcloud");
        if (!verified) return redir("soundcloud=error&reason=invalid_state");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Pull PKCE verifier and consume it
        const { data: pkceRow } = await supabaseAdmin
          .from("soundcloud_oauth_pkce").select("code_verifier, user_id").eq("state", state).maybeSingle();
        if (!pkceRow || pkceRow.user_id !== verified.userId) return redir("soundcloud=error&reason=pkce_missing");
        await supabaseAdmin.from("soundcloud_oauth_pkce").delete().eq("state", state);

        const clientId = process.env.SOUNDCLOUD_CLIENT_ID;
        const clientSecret = process.env.SOUNDCLOUD_CLIENT_SECRET;
        if (!clientId || !clientSecret) return redir("soundcloud=error&reason=server_not_configured");
        const redirectUri = `${origin}/api/public/soundcloud/oauth-callback`;

        const tokRes = await fetch("https://secure.soundcloud.com/oauth/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json; charset=utf-8",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            code,
            code_verifier: pkceRow.code_verifier,
          }),
        });
        if (!tokRes.ok) {
          const t = await tokRes.text();
          console.error("soundcloud token exchange failed", t);
          return redir("soundcloud=error&reason=token_exchange");
        }
        const tok = (await tokRes.json()) as {
          access_token: string;
          refresh_token?: string;
          expires_in?: number;
          scope?: string;
        };

        // Fetch profile via /me
        let username: string | null = null;
        let displayName: string | null = null;
        let avatarUrl: string | null = null;
        let permalink: string | null = null;
        let scId: string | null = null;
        try {
          const meRes = await fetch("https://api.soundcloud.com/me", {
            headers: {
              Authorization: `OAuth ${tok.access_token}`,
              Accept: "application/json; charset=utf-8",
            },
          });
          if (meRes.ok) {
            const me = (await meRes.json()) as {
              id?: number | string;
              username?: string;
              full_name?: string;
              avatar_url?: string;
              permalink_url?: string;
            };
            scId = me.id != null ? String(me.id) : null;
            username = me.username ?? null;
            displayName = me.full_name ?? me.username ?? null;
            avatarUrl = me.avatar_url ?? null;
            permalink = me.permalink_url ?? null;
          }
        } catch { /* ignore */ }

        if (!scId) return redir("soundcloud=error&reason=profile_fetch");

        const expiresAt = tok.expires_in
          ? new Date(Date.now() + (tok.expires_in - 30) * 1000).toISOString()
          : null;

        const { error: upsertErr } = await supabaseAdmin.from("soundcloud_connections").upsert(
          {
            user_id: verified.userId,
            sc_user_id: scId,
            username,
            display_name: displayName,
            avatar_url: avatarUrl,
            permalink_url: permalink,
            access_token: tok.access_token,
            refresh_token: tok.refresh_token ?? null,
            token_expires_at: expiresAt,
            scope: tok.scope ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
        if (upsertErr) {
          console.error("soundcloud upsert failed", upsertErr);
          return redir("soundcloud=error&reason=db");
        }
        return redir(`soundcloud=connected&account=${encodeURIComponent(displayName ?? username ?? "SoundCloud")}`);
      },
    },
  },
});