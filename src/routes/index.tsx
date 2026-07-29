import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Brand } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { ArrowRight, Music4, Store, Wand2 } from "lucide-react";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Release Engine — Solo Studio" },
      {
        name: "description",
        content:
          "Your private release studio. Drop a track, let the AI handle titles, tags, artwork, video and shorts, then publish everywhere.",
      },
      { property: "og:title", content: "Release Engine — Solo Studio" },
      {
        property: "og:description",
        content: "Your private release studio. Drop a track and publish everywhere.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SoloHome,
});

function SoloHome() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
  }, []);

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px] opacity-30 blur-3xl"
        style={{ backgroundImage: "var(--gradient-accent)" }}
      />
      <header className="relative z-10 mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <Brand />
        <Button asChild variant="ghost" size="sm">
          <Link to={signedIn ? "/projects" : "/auth"}>
            {signedIn ? "Open studio" : "Sign in"}
          </Link>
        </Button>
      </header>

      <main className="relative z-10 mx-auto max-w-3xl px-6 pb-24 pt-16 text-center">
        <h1 className="font-display text-5xl leading-tight sm:text-6xl">
          Drop your track.
          <br />
          Post it everywhere.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-muted-foreground">
          Your own private release studio. The AI handles your title, tags, description,
          artwork, thumbnail, video creation, shorts and marketing — all based on your music.
        </p>

        <div className="mt-8 flex justify-center">
          <Button asChild size="lg">
            <Link to={signedIn ? "/projects" : "/auth"}>
              {signedIn ? "Go to your projects" : "Sign in to your studio"}
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
        </div>

        <div className="mt-16 grid gap-4 text-left sm:grid-cols-3">
          {[
            { icon: Music4, title: "Analyse", body: "Key, BPM, genre, mood and niche read straight from the audio." },
            { icon: Wand2, title: "Create", body: "Artwork, covers, longform video and three shorts, rendered for you." },
            { icon: Store, title: "Sell", body: "Your own storefront for beats, singles and licences. You keep it all." },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-2xl border border-border bg-card/50 p-5">
              <Icon className="h-5 w-5 text-[color:var(--gold)]" />
              <p className="mt-3 font-display text-lg">{title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="relative z-10 border-t border-border/60 py-8 text-center text-xs text-muted-foreground">
        <p>Release Engine — Solo Edition · Licensed for single-owner use.</p>
      </footer>
    </div>
  );
}