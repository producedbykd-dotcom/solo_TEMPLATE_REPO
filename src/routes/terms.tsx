import { createFileRoute } from "@tanstack/react-router";
import appIcon from "@/assets/release-engine-icon.png.asset.json";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Release Engine Terms of Service" },
      { name: "description", content: "The terms that govern your use of Release Engine." },
      { property: "og:title", content: "Release Engine Terms of Service" },
      { property: "og:description", content: "The terms that govern your use of Release Engine." },
      { property: "og:url", content: "https://release-engine.lovable.app/terms" },
    ],
    links: [{ rel: "canonical", href: "https://release-engine.lovable.app/terms" }],
  }),
  component: TermsPage,
});

function TermsPage() {
  const updated = "June 29, 2026";
  return (
    <div className="mx-auto max-w-3xl px-6 py-16 text-foreground">
      <div className="mb-6 flex items-center gap-3">
        <img src={appIcon.url} alt="Release Engine app icon" className="h-10 w-10 rounded-md" />
        <span className="font-display text-lg font-semibold">Release Engine</span>
      </div>
      <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Legal</p>
      <h1 className="mt-2 font-display text-4xl">Release Engine Terms of Service</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: {updated}</p>

      <div className="prose prose-invert mt-8 max-w-none text-sm leading-relaxed space-y-6">
        <section>
          <h2 className="font-display text-xl">1. Agreement</h2>
          <p>
            These Terms of Service ("Terms") govern your access to and use of Release Engine
            ("Service", "we", "us"). By creating an account or using the Service, you agree to
            these Terms. If you do not agree, do not use the Service.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl">2. Eligibility & Accounts</h2>
          <p>
            You must be at least 13 years old (or the minimum age required in your country) to use
            the Service. You are responsible for your account credentials and for all activity
            under your account.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl">3. Your Content</h2>
          <p>
            You retain all ownership rights to the audio, artwork, video, and metadata you upload
            ("Your Content"). You grant us a limited, worldwide, non-exclusive license to host,
            process, transform, and transmit Your Content solely to operate the Service and to
            publish to third-party platforms you explicitly connect and authorize.
          </p>
          <p>
            You represent that you own or have all necessary rights to Your Content, including any
            samples, vocals, artwork, and third-party material, and that publishing it through the
            Service does not violate any law or third-party right.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl">4. AI-Generated Output</h2>
          <p>
            The Service uses AI models to generate suggestions including artwork, titles,
            descriptions, tags, and video assets. AI output may be inaccurate, biased, or
            duplicative of other works. You are responsible for reviewing and approving any
            AI-generated output before publishing it.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl">5. Third-Party Platforms</h2>
          <p>
            When you connect YouTube, Meta (Facebook/Instagram), TikTok, or other third-party
            services, your use of those platforms is governed by their own terms and policies. We
            act only as a tool to publish content you authorize. We are not responsible for the
            availability, decisions, or actions of those platforms.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl">5a. Aggregator Role — No Responsibility for User Content</h2>
          <p>
            Release Engine is an aggregate middle layer. We do not host a public feed, distribute
            your music on our own behalf, or act as a publisher of your content. The Service simply
            lets you push releases you create to your own private, third-party accounts (YouTube,
            Instagram, Facebook, TikTok, SoundCloud, etc.) using your own credentials and
            authorization.
          </p>
          <p>
            You alone are responsible for everything you upload, generate, post, publish, schedule,
            or distribute through the Service — including audio, lyrics, artwork, thumbnails,
            videos, titles, descriptions, tags, and any AI-assisted output you choose to use. We
            take no responsibility and assume no liability for content posted to your connected
            accounts, for how those platforms moderate, monetize, demote, or remove it, or for any
            consequences (legal, financial, reputational, or otherwise) that result from your use
            of the Service.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl">6. Acceptable Use</h2>
          <p>You agree not to use the Service to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Upload or publish content that infringes intellectual-property rights;</li>
            <li>Publish unlawful, harassing, deceptive, or harmful content;</li>
            <li>Attempt to reverse engineer, scrape, or disrupt the Service;</li>
            <li>Bypass rate limits, quotas, or platform policies of connected services.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-xl">7. Fees</h2>
          <p>
            Some features may require a paid plan. Fees, billing cycles, and refund terms will be
            disclosed at the point of purchase. Taxes may apply based on your location.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl">8. Termination</h2>
          <p>
            You may stop using the Service and delete your account at any time. We may suspend or
            terminate your access if you breach these Terms, create risk for us or other users, or
            for prolonged inactivity. Provisions that by their nature should survive (ownership,
            disclaimers, limitations of liability, indemnity, governing law) will survive
            termination.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl">9. Disclaimers</h2>
          <p>
            THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND,
            EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
            NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE,
            OR THAT AI OUTPUT WILL MEET YOUR EXPECTATIONS.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl">10. Limitation of Liability</h2>
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE WILL NOT BE LIABLE FOR ANY INDIRECT,
            INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS,
            REVENUE, DATA, OR GOODWILL. OUR TOTAL LIABILITY FOR ANY CLAIM ARISING OUT OF OR
            RELATING TO THE SERVICE WILL NOT EXCEED THE GREATER OF (A) THE AMOUNTS YOU PAID US IN
            THE 12 MONTHS BEFORE THE CLAIM OR (B) USD $100.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl">11. Indemnification</h2>
          <p>
            You will indemnify and hold us harmless from any claim arising out of Your Content,
            your use of the Service, or your violation of these Terms or applicable law.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl">12. Changes to the Service or Terms</h2>
          <p>
            We may modify the Service or these Terms at any time. Material changes will be
            communicated through the app or via email. Continued use after changes take effect
            constitutes acceptance.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl">13. Governing Law</h2>
          <p>
            These Terms are governed by the laws of the jurisdiction in which the Service operator
            is established, without regard to conflict-of-law rules. Disputes will be resolved in
            the courts of that jurisdiction unless required otherwise by applicable consumer law.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl">14. Contact</h2>
          <p>
            Questions about these Terms can be sent to{" "}
            <a className="underline" href="mailto:legal@release-engine.lovable.app">legal@release-engine.lovable.app</a>.
          </p>
        </section>
      </div>
      <p className="mt-12 text-center text-xs text-muted-foreground">© Traksorce Music 2026</p>
    </div>
  );
}