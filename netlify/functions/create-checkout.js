/* ============================================================
   The Family Ground — create-checkout
   POST /.netlify/functions/create-checkout
   Creates a Stripe Checkout Session for the $9.99/month membership.

   Auth: Authorization: Bearer <supabase access token>
   Env (set in Netlify dashboard — never in code):
     STRIPE_SECRET_KEY, STRIPE_PRICE_ID,
     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL
   ============================================================ */

const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const JSON_HEADERS = { "Content-Type": "application/json" };

function fail(statusCode, message) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify({ error: message }) };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return fail(405, "That did not work. Please try again.");
  }

  const {
    STRIPE_SECRET_KEY,
    STRIPE_PRICE_ID,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    SITE_URL,
  } = process.env;

  if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return fail(503, "Payments are not switched on yet. Please try again soon.");
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return fail(401, "Please log in first, then try again.");
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Verify the caller's Supabase session.
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData || !userData.user) {
    return fail(401, "Please log in first, then try again.");
  }
  const user = userData.user;

  // Kids use anonymous sign-in and have no profiles row — only parents can pay.
  const { data: kidRow } = await supabase
    .from("kid_profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (kidRow) {
    return fail(403, "Kids cannot start a membership. Please ask your parent to do this part.");
  }

  // Make sure the parent has a profiles row (Google sign-in can skip it).
  let { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id, full_name")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) {
    const fullName =
      (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || null;
    const { data: created, error: createError } = await supabase
      .from("profiles")
      .insert({ id: user.id, full_name: fullName })
      .select("stripe_customer_id, full_name")
      .single();
    if (createError || !created) {
      return fail(500, "We could not set up your account. Please try again.");
    }
    profile = created;
  }

  // Already an active member? Send them home instead of charging again.
  const { data: statusRow } = await supabase
    .from("profiles")
    .select("membership_status")
    .eq("id", user.id)
    .maybeSingle();
  if (statusRow && statusRow.membership_status === "active") {
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ alreadyMember: true }),
    };
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY);

  // Reuse the Stripe customer if we made one before.
  let customerId = profile.stripe_customer_id;
  if (!customerId) {
    try {
      const customer = await stripe.customers.create({
        email: user.email || undefined,
        name: profile.full_name || undefined,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await supabase.from("profiles").update({ stripe_customer_id: customerId }).eq("id", user.id);
    } catch (e) {
      return fail(500, "We could not reach the payment page. Please try again.");
    }
  }

  const site = (SITE_URL || "https://thefamilyground.com").replace(/\/$/, "");

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      success_url: site + "/membership-success.html?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: site + "/membership.html",
      metadata: { supabase_user_id: user.id },
      subscription_data: { metadata: { supabase_user_id: user.id } },
    });
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ url: session.url }),
    };
  } catch (e) {
    return fail(500, "We could not reach the payment page. Please try again.");
  }
};
