# The Family Ground — Build Notes

Static multi-page website. No build step — deploys as-is on Netlify.

## Page inventory

| File | What it is |
|---|---|
| `index.html` | Homepage: hero, problem section, 3 pillars (Track/Agree/Learn), how membership works, about strip, FAQ, CTA band |
| `courses.html` | Public course catalog (cards rendered from `js/app.js` → `TFG.COURSES`) |
| `about.html` | Amam's story — verified facts only |
| `signup.html` | Membership signup → Supabase Auth signUp, redirects to dashboard |
| `login.html` | Login → Supabase Auth signIn, plus forgot-password via `resetPasswordForEmail` |
| `dashboard.html` | Protected member area (redirects to login when no session). Tabs: Chore Tracker, Family Agreement (builder + print), My Courses |
| `styles.css` | Full design system ("Forest Own") + print stylesheet for the agreement |
| `js/config.js` | Supabase keys (paste yours) + `PRICE_PLACEHOLDER` |
| `js/app.js` | Supabase client, auth helpers, chores/agreements/progress data functions, course catalog data, shared UI (nav, tabs, hamburger) |
| `schema.sql` | Database tables + Row Level Security policies |
| `README.md` | One-page deploy summary |

Blog lives separately on beehiiv at `blog.thefamilyground.com` — nav "Blog" links there. Not part of this build.

## Setup: connect Supabase (do once)

1. Create a free project at [supabase.com](https://supabase.com) (if you don't have one).
2. In the Supabase dashboard: **Project Settings → API**. Copy:
   - **Project URL** → paste into `js/config.js` as `SUPABASE_URL`
   - **anon / public key** → paste into `js/config.js` as `SUPABASE_ANON_KEY`
   - (Replace the `PASTE_YOUR_..._HERE` placeholders. Keep the quotes.)
3. In the Supabase dashboard: **SQL Editor → New query**. Paste the entire contents of
   `schema.sql` and click **Run**. This creates 5 tables (`profiles`, `chores`,
   `chore_completions`, `agreements`, `course_progress`) with Row Level Security so
   members can only ever see and edit their own rows.
4. **Authentication → Providers → Email**: make sure Email is enabled.
   - If "Confirm email" is ON: new members get a confirmation link first (the signup
     page handles this and tells them to check their inbox).
   - If OFF: members land straight in the dashboard after signup.
5. Open `signup.html` and create a test account. You should land in `dashboard.html`.

## Decisions Amam must make

- [ ] **Membership price.** `js/config.js` has `PRICE_PLACEHOLDER` (currently `"PRICE_NOT_SET"`).
      Every `[data-price]` spot on the site shows "Founding member pricing announced at
      launch" until you set it, e.g. `PRICE_PLACEHOLDER: "$9/month"`.
      (Real payment collection — Stripe etc. — is a separate step, not wired yet.)
- [ ] **Real course lessons.** `js/app.js` → `TFG.COURSES` holds titles + lesson lists;
      lesson bodies are DRAFT outlines (marked in `courses.html` comments). Write the real
      lessons, then decide how lesson content is delivered (pages, PDFs, video).
- [ ] **FAQ tweaks** on `index.html` — adjust answers to match your final policies.
- [ ] **Blog subdomain DNS:** create a `CNAME` record for `blog` → your beehiiv
      publication domain (beehiiv shows the exact target in publication settings),
      so `blog.thefamilyground.com` serves the beehiiv blog.
- [ ] **Custom domain on Netlify** (below) — point `thefamilyground.com` at the site.

## Netlify deploy

**Option A — drag and drop (fastest):** Netlify dashboard → Sites → drag the
`the-family-ground` folder onto the deploy area. Done — you get a live URL.

**Option B — from Git (recommended, auto-deploys on every push):**
1. Push this folder to a GitHub repo.
2. Netlify → Add new site → Import an existing project → connect the repo.
3. Build settings: **no build command**, **publish directory = the repo root**
   (or the folder name if the repo contains other things).
4. Deploy. Every `git push` redeploys automatically.
5. Site settings → Domain management → add `thefamilyground.com` (Netlify shows
   the DNS records to add at your registrar).

## Notes for future edits

- Course catalog content lives in ONE place: `TFG.COURSES` in `js/app.js`.
  `courses.html` and the dashboard "My Courses" tab both render from it.
- Brand tokens live at the top of `styles.css` (`:root`). Change once, applies everywhere.
- Header/footer markup is duplicated per page (by design — no build step).
  If you change the nav, change it in all 7 HTML files.
