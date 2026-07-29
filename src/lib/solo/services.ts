/**
 * Everything a Solo Edition owner has to sign up for, with honest costs.
 *
 * Single source of truth for the /solo sales page AND the /setup wizard.
 * `url` is the plain product link today — swap in an affiliate link later and
 * both surfaces update at once.
 */

export type ServiceRequirement = {
  id: string;
  name: string;
  /** What breaks without it. */
  purpose: string;
  /** Plain-language cost. */
  cost: string;
  /** Free-tier headline, if any. */
  freeTier?: string;
  required: boolean;
  notes?: string;
  /** Sign-up link. Replace with an affiliate URL when available. */
  url: string;
  /** Env vars the setup wizard collects for this service. */
  envKeys?: string[];
};

export const SERVICES: ServiceRequirement[] = [
  {
    id: "cloudflare",
    name: "Cloudflare Workers",
    purpose: "Hosts the app itself",
    cost: "Free to start · $5/mo Workers Paid if you outgrow it",
    freeTier: "100,000 requests/day",
    required: true,
    notes: "Release Engine already targets this runtime, so it deploys as-is.",
    url: "https://workers.cloudflare.com/",
  },
  {
    id: "supabase",
    name: "Supabase",
    purpose: "Database, file storage and your owner login",
    cost: "Free to start · $25/mo Pro when you outgrow it",
    freeTier: "500 MB database, 1 GB file storage",
    required: true,
    notes: "One project. The setup wizard creates every table and bucket for you.",
    url: "https://supabase.com/",
    envKeys: ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
  },
  {
    id: "gemini",
    name: "Google Gemini API",
    purpose: "Music analysis, titles, tags, descriptions, artwork",
    cost: "Pay as you go — roughly $0.05–$0.25 per finished release",
    required: true,
    notes: "You need billing enabled on your Google Cloud project. You pay Google directly; nothing routes through us.",
    url: "https://aistudio.google.com/apikey",
    envKeys: ["GOOGLE_GENERATIVE_AI_API_KEY"],
  },
  {
    id: "domain",
    name: "Your own domain",
    purpose: "A branded URL for your store",
    cost: "About $10–15 per year",
    freeTier: "Optional — a free yourname.workers.dev address works fine",
    required: false,
    url: "https://www.cloudflare.com/products/registrar/",
  },
  {
    id: "youtube",
    name: "YouTube Data API (Google Cloud)",
    purpose: "Publishing videos and Shorts to your channel",
    cost: "Free — quota limited",
    required: false,
    notes: "You create your own OAuth app. Google verification is required before it can be used publicly.",
    url: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
    envKeys: ["YOUTUBE_OAUTH_CLIENT_ID", "YOUTUBE_OAUTH_CLIENT_SECRET", "YOUTUBE_API_KEY"],
  },
  {
    id: "meta",
    name: "Meta developer app",
    purpose: "Instagram Reels and Facebook Page posting",
    cost: "Free",
    required: false,
    notes: "Meta app review is required before you can post to accounts other than your own test account.",
    url: "https://developers.facebook.com/",
    envKeys: ["META_APP_ID", "META_APP_SECRET"],
  },
  {
    id: "tiktok",
    name: "TikTok developer app",
    purpose: "Posting to TikTok",
    cost: "Free",
    required: false,
    notes: "TikTok audits every app. Expect a review period before posting is enabled.",
    url: "https://developers.tiktok.com/",
    envKeys: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  },
  {
    id: "soundcloud",
    name: "SoundCloud API",
    purpose: "Uploading tracks to SoundCloud",
    cost: "Free",
    required: false,
    notes: "API applications are approved in batches, so allow some lead time.",
    url: "https://developers.soundcloud.com/",
    envKeys: ["SOUNDCLOUD_CLIENT_ID", "SOUNDCLOUD_CLIENT_SECRET"],
  },
  {
    id: "paypal",
    name: "PayPal",
    purpose: "Getting paid for beats, singles and licences in your store",
    cost: "PayPal's standard fee (about 2.9% + a fixed amount per sale)",
    required: false,
    notes: "You only enter your PayPal email — no API keys, no client secrets.",
    url: "https://www.paypal.com/business",
  },
];

export const ALTERNATIVES = [
  {
    instead: "Cloudflare Workers",
    option: "Vercel",
    cost: "Free Hobby tier · $20/mo Pro",
    url: "https://vercel.com/",
    note: "Works, but Cloudflare is the tested path.",
  },
  {
    instead: "Supabase Cloud",
    option: "Self-hosted Supabase",
    cost: "Your server bill only (a $6–12/mo VPS is enough to start)",
    url: "https://supabase.com/docs/guides/self-hosting",
    note: "Full control, more maintenance. Same migrations apply.",
  },
];

/** Headline running-cost summary shown on the sales page. */
export const COST_SUMMARY = {
  starting: "$0 / month",
  busy: "about $25–30 / month",
  perRelease: "a few cents to ~$0.25 in AI usage",
};

export const SOLO_PRICE = { now: 99, was: 149, currency: "USD" };