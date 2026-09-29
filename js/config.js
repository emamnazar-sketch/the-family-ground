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

  // Membership price — DECISION NEEDED (Amam):
  // Set when founding-member pricing is announced at launch.
  // Example: "$9/month" or "$79/year". Shown on signup.html.
  PRICE_PLACEHOLDER: "PRICE_NOT_SET"
};
