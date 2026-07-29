import { createFileRoute } from "@tanstack/react-router";
import { verifyOAuthState } from "@/lib/oauth-state.server";
import { getPublicOrigin } from "@/lib/public-origin";

export const Route = createFileRoute("/api/public/meta/oauth-callback")({
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

        if (error) return redir(`meta=error&reason=${encodeURIComponent(error)}`);
        if (!code || !state) return redir("meta=error&reason=missing_code");
        const verified = verifyOAuthState(state, "meta");
        if (!verified) return redir("meta=error&reason=invalid_state");

        const redirectUri = `${origin}/api/public/meta/oauth-callback`;

        // 1. Short-lived user access token
        const tokRes = await fetch(
          `https://graph.facebook.com/v21.0/oauth/access_token?` +
            new URLSearchParams({
              client_id: process.env.META_APP_ID!,
              client_secret: process.env.META_APP_SECRET!,
              redirect_uri: redirectUri,
              code,
            }).toString(),
        );
        if (!tokRes.ok) {
          const t = await tokRes.text();
          console.error("meta token exchange failed", t);
          return redir("meta=error&reason=token_exchange");
        }
        const shortTok = (await tokRes.json()) as { access_token: string };

        // 2. Long-lived token (~60 days)
        const llRes = await fetch(
          `https://graph.facebook.com/v21.0/oauth/access_token?` +
            new URLSearchParams({
              grant_type: "fb_exchange_token",
              client_id: process.env.META_APP_ID!,
              client_secret: process.env.META_APP_SECRET!,
              fb_exchange_token: shortTok.access_token,
            }).toString(),
        );
        const llJson = (await llRes.json()) as { access_token: string; expires_in?: number };
        const userAccessToken = llJson.access_token ?? shortTok.access_token;
        const expiresAt = llJson.expires_in
          ? new Date(Date.now() + llJson.expires_in * 1000).toISOString()
          : null;

        // 3. Fetch FB user
        const meRes = await fetch(
          `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${encodeURIComponent(userAccessToken)}`,
        );
        const me = (await meRes.json()) as { id: string; name: string };

        // 4. Fetch pages — pick first one
        const pagesRes = await fetch(
          `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${encodeURIComponent(userAccessToken)}`,
        );
        const pagesJson = (await pagesRes.json()) as {
          data?: Array<{
            id: string;
            name: string;
            access_token: string;
            instagram_business_account?: { id: string };
          }>;
        };
        const page = pagesJson.data?.[0] ?? null;

        let igUserId: string | null = null;
        let igUsername: string | null = null;
        if (page?.instagram_business_account?.id) {
          igUserId = page.instagram_business_account.id;
          try {
            const igRes = await fetch(
              `https://graph.facebook.com/v21.0/${igUserId}?fields=username&access_token=${encodeURIComponent(page.access_token)}`,
            );
            const igJson = (await igRes.json()) as { username?: string };
            igUsername = igJson.username ?? null;
          } catch {/* ignore */}
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error: upsertErr } = await supabaseAdmin.from("meta_connections").upsert(
          {
            user_id: verified.userId,
            fb_user_id: me.id,
            fb_user_name: me.name ?? null,
            page_id: page?.id ?? null,
            page_name: page?.name ?? null,
            page_access_token: page?.access_token ?? null,
            ig_user_id: igUserId,
            ig_username: igUsername,
            user_access_token: userAccessToken,
            token_expires_at: expiresAt,
            scope: null,
          },
          { onConflict: "user_id" },
        );
        if (upsertErr) {
          console.error("meta upsert failed", upsertErr);
          return redir("meta=error&reason=db");
        }
        const label = page?.name ?? me.name ?? "Meta";
        return redir(`meta=connected&account=${encodeURIComponent(label)}`);
      },
    },
  },
});