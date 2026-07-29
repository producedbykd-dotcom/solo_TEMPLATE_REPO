import { createFileRoute } from "@tanstack/react-router";
import { verifySignedState } from "@/lib/youtube-state.server";
import { getPublicOrigin } from "@/lib/public-origin";

export const Route = createFileRoute("/api/public/youtube/oauth-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");
        const origin = getPublicOrigin();

        function redirect(qs: string) {
          return new Response(null, {
            status: 302,
            headers: { Location: `${origin}/connections?${qs}` },
          });
        }

        if (error) return redirect(`youtube=error&reason=${encodeURIComponent(error)}`);
        if (!code || !state) return redirect("youtube=error&reason=missing_code");

        const verified = verifySignedState(state);
        if (!verified) return redirect("youtube=error&reason=invalid_state");

        const redirectUri = `${origin}/api/public/youtube/oauth-callback`;

        // Exchange code for tokens
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: process.env.YOUTUBE_OAUTH_CLIENT_ID!,
            client_secret: process.env.YOUTUBE_OAUTH_CLIENT_SECRET!,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
          }),
        });

        if (!tokenRes.ok) {
          const t = await tokenRes.text();
          console.error("youtube token exchange failed", t);
          return redirect("youtube=error&reason=token_exchange");
        }

        const token = (await tokenRes.json()) as {
          access_token: string;
          refresh_token?: string;
          expires_in: number;
          scope: string;
          token_type: string;
        };

        // Fetch channel info
        const chRes = await fetch(
          "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
          { headers: { Authorization: `Bearer ${token.access_token}` } },
        );
        if (!chRes.ok) {
          const t = await chRes.text();
          console.error("youtube channel fetch failed", t);
          return redirect("youtube=error&reason=channel_fetch");
        }
        const chJson = (await chRes.json()) as {
          items?: Array<{
            id: string;
            snippet: { title: string; thumbnails?: { default?: { url?: string } } };
          }>;
        };
        const channel = chJson.items?.[0];
        if (!channel) return redirect("youtube=error&reason=no_channel");

        const expiresAt = new Date(Date.now() + (token.expires_in - 30) * 1000).toISOString();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error: upsertErr } = await supabaseAdmin
          .from("youtube_connections")
          .upsert(
            {
              user_id: verified.userId,
              channel_id: channel.id,
              channel_title: channel.snippet.title,
              channel_thumbnail: channel.snippet.thumbnails?.default?.url ?? null,
              access_token: token.access_token,
              refresh_token: token.refresh_token ?? null,
              scope: token.scope,
              token_expires_at: expiresAt,
            },
            { onConflict: "user_id" },
          );
        if (upsertErr) {
          console.error("youtube upsert failed", upsertErr);
          return redirect("youtube=error&reason=db");
        }

        return redirect(`youtube=connected&channel=${encodeURIComponent(channel.snippet.title)}`);
      },
    },
  },
});