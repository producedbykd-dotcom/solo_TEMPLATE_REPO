# Release Engine — Solo Edition

Your own private release studio. No subscriptions, no credits, no other users —
just you, your music, and your storefront.

Read `LICENSE-SOLO.md` before you begin. Short version: run one instance for
yourself, sell your own music, keep every cent. Running it as a service for
other people needs a separate licence.

---

## What you need

**Required**

| Service                                                 | What it does                  | Cost                                           |
| ------------------------------------------------------- | ----------------------------- | ---------------------------------------------- |
| [Cloudflare Workers](https://workers.cloudflare.com/)   | Hosts the app                 | Free to start, $5/mo if you outgrow it         |
| [Supabase](https://supabase.com/)                       | Database, storage, your login | Free to start, $25/mo Pro later                |
| [Google Gemini API](https://aistudio.google.com/apikey) | Analysis, metadata, artwork   | Pay as you go, roughly $0.05–$0.25 per release |

**Optional** — add these whenever you're ready: YouTube, Instagram/Facebook,
TikTok, SoundCloud (each needs its own developer app and platform review), a
custom domain (~$12/yr), and a PayPal business account for the store.

Starting cost: **$0/month.** Busy month: **about $25–30.**

---

## Install (no terminal needed)

1. Open your private install page (the link in your purchase email) and click
   **Deploy to Cloudflare**. Cloudflare copies this repo into your account,
   builds it and puts it online — all in the browser.
2. When Cloudflare asks for variables, paste your Supabase URL, keys and your
   Google Gemini key. You can also add them later under
   **Workers → your project → Settings → Variables and Secrets**.
3. Open your new site at `/setup`. That wizard verifies your keys, hands you
   one block of SQL to paste into the Supabase SQL editor, creates your storage
   buckets and creates your owner login. It closes itself for good afterwards.

---

## Environment variables

```
SUPABASE_URL=                    # required
SUPABASE_PUBLISHABLE_KEY=        # required
SUPABASE_SERVICE_ROLE_KEY=       # required — server only, never expose
VITE_SUPABASE_URL=               # same as SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY=   # same as SUPABASE_PUBLISHABLE_KEY
GOOGLE_GENERATIVE_AI_API_KEY=    # required

YOUTUBE_OAUTH_CLIENT_ID=         # optional
YOUTUBE_OAUTH_CLIENT_SECRET=
YOUTUBE_API_KEY=
YOUTUBE_OAUTH_STATE_SECRET=      # any long random string
META_APP_ID=
META_APP_SECRET=
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
SOUNDCLOUD_CLIENT_ID=
SOUNDCLOUD_CLIENT_SECRET=
```

On Cloudflare, set the server-side ones as Worker secrets under
**Workers → your project → Settings → Variables and Secrets**.

---

## Connecting platforms

Each platform needs its own developer app registered under **your** account,
with the redirect URL pointing at your domain:

- YouTube → `https://yourdomain.com/api/public/youtube/callback`
- Meta → `https://yourdomain.com/api/public/meta/callback`
- TikTok → `https://yourdomain.com/api/public/tiktok/callback`
- SoundCloud → `https://yourdomain.com/api/public/soundcloud/callback`

YouTube, Meta and TikTok all require platform review before you can post
publicly. That's their process, not ours — start it early.

---

## Your store

Go to **My Store**, set your handle, logo and accent colour, add your PayPal
email, and publish. Your storefront lives at `/store/your-handle`. Buyers pay
you directly through PayPal and get their licence PDF automatically. There is
no platform cut.

---

## Updates

Updates ship automatically to your private copy. There is nothing to run.

---

## If something breaks

**Video rendering fails** — rendering happens in your browser and needs a
desktop Chrome or Edge with a few GB of free memory.

**Analysis hangs or errors** — almost always Gemini quota. Check billing is
enabled on your Google Cloud project.

**Can't sign in** — this build has no public sign-up by design. If you never
finished `/setup`, no account exists yet.

**Uploads fail** — confirm your `audio`, `videos` and `store` storage buckets
exist and are private. The `/setup` wizard creates them automatically.
