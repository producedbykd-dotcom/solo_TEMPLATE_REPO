import { createFileRoute } from "@tanstack/react-router";
import { verifyOAuthState } from "@/lib/oauth-state.server";
import { getPublicOrigin } from "@/lib/public-origin";

export const Route = createFileRoute("/api/public/tiktok/oauth-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");
        const origin = getPublicOrigin();
        const redir = (qs: string) =>
          new Response(null, { status: 302, headers: { Location: `${origin}/connections?${qs}` } });

        if (error) return redir(`tiktok=error&reason=${encodeURIComponent(error)}`);
        if (!code || !state) return redir("tiktok=error&reason=missing_code");
        const verified = verifyOAuthState(state, "tiktok");
        if (!verified) return redir("tiktok=error&reason=invalid_state");

        const redirectUri = `${origin}/api/public/tiktok/oauth-callback`;

        const tokRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_key: process.env.TIKTOK_CLIENT_KEY!,
            client_secret: process.env.TIKTOK_CLIENT_SECRET!,
            code,
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
          }),
        });
        if (!tokRes.ok) {
          const t = await tokRes.text();
          console.error("tiktok token exchange failed", t);
          return redir("tiktok=error&reason=token_exchange");
        }
        const tok = (await tokRes.json()) as {
          access_token: string;
          refresh_token: string;
          expires_in: number;
          refresh_expires_in: number;
          open_id: string;
          scope: string;
        };

        // Fetch user info
        let displayName: string | null = null;
        let avatarUrl: string | null = null;
        let unionId: string | null = null;
        try {
          const infoRes = await fetch(
            "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name",
            { headers: { Authorization: `Bearer ${tok.access_token}` } },
          );
          const infoJson = (await infoRes.json()) as {
            data?: { user?: { display_name?: string; avatar_url?: string; union_id?: string } };
          };
          displayName = infoJson.data?.user?.display_name ?? null;
          avatarUrl = infoJson.data?.user?.avatar_url ?? null;
          unionId = infoJson.data?.user?.union_id ?? null;
        } catch {/* ignore */}

        const expiresAt = new Date(Date.now() + (tok.expires_in - 30) * 1000).toISOString();
        const refreshExpires = new Date(Date.now() + tok.refresh_expires_in * 1000).toISOString();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error: upsertErr } = await supabaseAdmin.from("tiktok_connections").upsert(
          {
            user_id: verified.userId,
            open_id: tok.open_id,
            union_id: unionId,
            display_name: displayName,
            avatar_url: avatarUrl,
            access_token: tok.access_token,
            refresh_token: tok.refresh_token,
            token_expires_at: expiresAt,
            refresh_expires_at: refreshExpires,
            scope: tok.scope,
          },
          { onConflict: "user_id" },
        );
        if (upsertErr) {
          console.error("tiktok upsert failed", upsertErr);
          return redir("tiktok=error&reason=db");
        }
        return redir(`tiktok=connected&account=${encodeURIComponent(displayName ?? "TikTok")}`);
      },
    },
  },
});