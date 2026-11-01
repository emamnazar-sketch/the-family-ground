/* ============================================================
   The Family Ground — Configuration
   ------------------------------------------------------------
   SETUP: paste your Supabase project keys below.
   Supabase dashboard → Project Settings → API:
     - Project URL        → SUPABASE_URL
     - anon / public key  → SUPABASE_ANON_KEY
   Then run schema.sql in the Supabase SQL editor (see BUILD_NOTES.md).
   ============================================================ */

window.TFG_CONFIG = {
  // TODO (Amam): paste your Supabase Project URL here
  SUPABASE_URL: "https://ppukwdvmwrdhnlogfvax.supabase.co",

  // TODO (Amam): paste your Supabase anon/public key here
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwdWt3ZHZtd3JkaG5sb2dmdmF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2NDgwMTEsImV4cCI6MjEwNjIyNDAxMX0.mYMoGZp_EK-Pq1fDhUkiTC7AlbooUD5CY64Yz15eCLM",

  // Membership is FREE — Amam's order, 2026-11-01. No price, no payment.
  // Parents join by signing in with Google; that's the whole gate.
  // Shown everywhere [data-price] appears (homepage, signup).
  PRICE_PLACEHOLDER: "Free",

  // Stripe is NOT connected and NOT used: memberships are free, so
  // there is no checkout. Left empty on purpose — do not wire payments
  // without Amam's explicit say-so.
  STRIPE_PUBLISHABLE_KEY: ""
};
