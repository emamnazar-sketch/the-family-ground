/* ============================================================
   The Family Ground — stripe-webhook
   POST /.netlify/functions/stripe-webhook
   Receives Stripe events and marks members in Supabase.

   This is the ONLY writer of profiles.membership_status
   (see the protect_membership_columns trigger in schema.sql).

   Env (set in Netlify dashboard — never in code):
     STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

   In the Stripe dashboard, register this endpoint and subscribe to:
     checkout.session.completed
     customer.subscription.updated
     customer.subscription.deleted
     invoice.payment_failed
   ============================================================ */

const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

function statusForSubscription(subStatus) {
  switch (subStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    default:
      return "canceled";
  }
}

exports.handler = async (event) => {
  const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } =
    process.env;

  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: "Webhook is not configured." };
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY);
  const signature = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];

  let stripeEvent;
  try {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return { statusCode: 400, body: "Bad signature." };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  async function findProfileId(customerId, fallbackUserId) {
    if (customerId) {
      const { data } = await supabase
        .from("profiles")
        .select("id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();
      if (data) return data.id;
    }
    if (fallbackUserId) {
      const { data } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", fallbackUserId)
        .maybeSingle();
      if (data) return data.id;
    }
    return null;
  }

  async function setMembership(profileId, patch) {
    if (!profileId) return;
    const clean = { membership_updated_at: new Date().toISOString() };
    Object.keys(patch || {}).forEach(function (k) {
      if (patch[k] !== undefined && patch[k] !== null) clean[k] = patch[k];
    });
    await supabase.from("profiles").update(clean).eq("id", profileId);
  }

  try {
    switch (stripeEvent.type) {
      case "checkout.session.completed": {
        const session = stripeEvent.data.object;
        const userId = session.metadata && session.metadata.supabase_user_id;
        const profileId = await findProfileId(session.customer, userId);
        await setMembership(profileId, {
          membership_status: "active",
          stripe_customer_id: session.customer || undefined,
          stripe_subscription_id: session.subscription || undefined,
        });
        break;
      }

      case "customer.subscription.updated": {
        const sub = stripeEvent.data.object;
        const userId = sub.metadata && sub.metadata.supabase_user_id;
        const profileId = await findProfileId(sub.customer, userId);
        await setMembership(profileId, {
          membership_status: statusForSubscription(sub.status),
          stripe_customer_id: sub.customer || undefined,
          stripe_subscription_id: sub.id || undefined,
        });
        break;
      }

      case "customer.subscription.deleted": {
        const sub = stripeEvent.data.object;
        const userId = sub.metadata && sub.metadata.supabase_user_id;
        const profileId = await findProfileId(sub.customer, userId);
        await setMembership(profileId, {
          membership_status: "canceled",
          stripe_subscription_id: sub.id || undefined,
        });
        break;
      }

      case "invoice.payment_failed": {
        const invoice = stripeEvent.data.object;
        const profileId = await findProfileId(invoice.customer, null);
        await setMembership(profileId, { membership_status: "past_due" });
        break;
      }

      default:
        break; // ignore anything else
    }
  } catch (e) {
    // Return 500 so Stripe retries the delivery.
    return { statusCode: 500, body: "Webhook handler failed." };
  }

  return { statusCode: 200, body: "ok" };
};
