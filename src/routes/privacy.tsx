import { createFileRoute } from "@tanstack/react-router";
import appIcon from "@/assets/release-engine-icon.png.asset.json";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Release Engine Privacy Policy" },
      { name: "description", content: "How Release Engine collects, uses, and protects your data." },
      { property: "og:title", content: "Release Engine Privacy Policy" },
      { property: "og:description", content: "How Release Engine collects, uses, and protects your data." },
      { property: "og:url", content: "https://release-engine.lovable.app/privacy" },
    ],
    links: [{ rel: "canonical", href: "https://release-engine.lovable.app/privacy" }],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  const updated = "June 29, 2026";
  return (
    <div className="mx-auto max-w-3xl px-6 py-16 text-foreground">
      <div className="mb-6 flex items-center gap-3">
        <img src={appIcon.url} alt="Release Engine app icon" className="h-10 w-10 rounded-md" />
        <span className="font-display text-lg font-semibold">Release Engine</span>
      </div>
      <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Legal</p>
      <h1 className="mt-2 font-display text-4xl">Release Engine Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: {updated}</p>

      <div className="prose prose-invert mt-8 max-w-none text-sm leading-relaxed space-y-6">
        <section>
          <h2 className="font-display text-xl">1. Introduction</h2>
          <p>
            Release Engine ("we", "us", "our") provides tools that help musicians analyze, package, and publish
            their music to platforms such as YouTube, Instagram, Facebook, and TikTok. This Privacy Policy explains
            what information we collect, how we use it, and the choices you have. By using Release Engine you agree
            to this policy.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl">2. Information We Collect</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Account information:</strong> name, email address, and authentication identifiers provided when you sign in.</li>
            <li><strong>Content you upload:</strong> audio files, artwork, video renders, titles, descriptions, and tags.</li>
            <li><strong>Connected platform data:</strong> when you connect YouTube, Instagram, Facebook, or TikTok, we receive OAuth tokens and basic profile/channel/page information to publish on your behalf.</li>
            <li><strong>Usage data:</strong> logs, device information, and analytics needed to operate the service.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-xl">3. How We Use Information</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>Analyze your audio and generate metadata, artwork, and video assets you request.</li>
            <li>Publish content to the third-party platforms you explicitly connect and authorize.</li>
            <li>Operate, maintain, secure, and improve the service.</li>
            <li>Communicate with you about your account, security, and product updates.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-xl">4. Sharing of Information</h2>
          <p>
            We do not sell your personal data. We share data only with: (a) the platforms you connect (e.g. YouTube,
            Meta/Instagram/Facebook, TikTok) to perform the actions you request; (b) infrastructure and AI providers
            (such as Google Cloud and our hosting provider) that process data on our behalf under contract; and
            (c) authorities when required by law.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl">5. Meta Platforms (Facebook & Instagram)</h2>
          <p>
            When you connect a Facebook Page or Instagram Business/Creator account, we request the minimum
            permissions required to publish posts, reels, and videos you approve. We use access tokens solely to
            execute publishing actions you initiate. You can revoke access at any time from your Facebook account
            settings under <em>Business Integrations</em>, or from the Connections page inside Release Engine.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl">6. Data Retention</h2>
          <p>
            We retain your account data and uploaded content while your account is active. You may delete projects,
            assets, or your entire account at any time. When you delete content, we remove it from our active
            systems within 30 days, subject to backup rotation and legal retention requirements.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl">7. Your Rights</h2>
          <p>
            Depending on your jurisdiction, you may have rights to access, correct, export, or delete your personal
            data, and to withdraw consent. To exercise these rights, contact us at the email below.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl">8. Security</h2>
          <p>
            We use industry-standard safeguards including encryption in transit, scoped access tokens, and
            role-based access controls. No system is perfectly secure, but we work to protect your data and notify
            you of material incidents as required by law.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl">9. Children</h2>
          <p>Release Engine is not directed to children under 13, and we do not knowingly collect their data.</p>
        </section>

        <section>
          <h2 className="font-display text-xl">10. Changes to This Policy</h2>
          <p>
            We may update this policy from time to time. Material changes will be communicated through the app or
            via email. Continued use of the service after changes take effect constitutes acceptance.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl">11. Contact</h2>
          <p>
            Questions or requests about this policy can be sent to{" "}
            <a className="underline" href="mailto:privacy@release-engine.lovable.app">privacy@release-engine.lovable.app</a>.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl">12. Our Role — Aggregator, Not Publisher</h2>
          <p>
            Release Engine is an aggregate middle layer. We do not publish your content on our own
            behalf or operate a public feed. The Service simply allows you to push releases you
            create to your own private third-party accounts (YouTube, Instagram, Facebook, TikTok,
            SoundCloud, and similar platforms) using your own credentials. We take no
            responsibility for what you choose to upload, generate, post, or publish through the
            Service, and we are not responsible for how connected platforms handle, moderate, or
            monetize that content.
          </p>
        </section>
      </div>
      <p className="mt-12 text-center text-xs text-muted-foreground">© Traksorce Music 2026</p>
    </div>
  );
}