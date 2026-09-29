# The Family Ground — Deploy Summary

Static website (HTML/CSS/JS, no build step) for **thefamilyground.com**:
marketing pages + member signup/login + a protected member dashboard
(chore tracker, family agreement builder with printing, course progress).

## To go live (5 steps)

1. **Supabase keys** — paste Project URL + anon key into `js/config.js`
   (replacing the `PASTE_YOUR_..._HERE` placeholders).
2. **Database** — run `schema.sql` in the Supabase SQL Editor (one click, creates
   5 tables with Row Level Security).
3. **Test** — open `signup.html`, create an account, confirm the dashboard works.
4. **Netlify** — drag the folder onto Netlify, or connect a GitHub repo
   (no build command, publish directory = repo root).
5. **Domain** — add `thefamilyground.com` in Netlify domain settings; add a
   `CNAME` for `blog` → beehiiv so `blog.thefamilyground.com` serves the newsletter.

## Still to decide (see BUILD_NOTES.md)

- Membership price (`PRICE_PLACEHOLDER` in `js/config.js` — currently shows
  "Founding member pricing announced at launch")
- Real course lesson content (DRAFT outlines in place)
- Payment collection (Stripe) — not wired yet

Full details: `BUILD_NOTES.md`.
