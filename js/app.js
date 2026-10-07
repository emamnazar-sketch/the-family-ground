/* ============================================================
   The Family Ground — App logic
   Supabase Auth + data layer + shared UI behavior.
   Requires: supabase-js v2 CDN + js/config.js loaded first.
   No inline onclick anywhere — all wiring via addEventListener.
   ============================================================ */
(function () {
  "use strict";

  var cfg = window.TFG_CONFIG || {};
  var TFG = {};
  window.TFG = TFG;

  /* ---------------- Supabase client ---------------- */

  var client = null;

  function configError() {
    if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.indexOf("PASTE_") === 0) return true;
    if (!cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY.indexOf("PASTE_") === 0) return true;
    return false;
  }

  function getClient() {
    if (client) return client;
    if (typeof window.supabase === "undefined") {
      throw new Error("Could not reach the server library. Check your internet connection and reload the page.");
    }
    if (configError()) {
      throw new Error("This site is not connected yet. The owner needs to add the Supabase keys in js/config.js (see BUILD_NOTES.md).");
    }
    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    return client;
  }

  TFG.isConfigured = function () { return !configError(); };

  /* ---------------- Helpers ---------------- */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  TFG.esc = esc;

  function friendlyError(err) {
    // Already-friendly strings pass through untouched (prevents double-wrapping
    // which used to collapse every message into the generic fallback).
    if (typeof err === "string") return err || "Something went wrong. Please try again.";
    var msg = (err && err.message) ? err.message : "Something went wrong. Please try again.";
    if (/invalid login credentials/i.test(msg)) return "That email and password do not match. Please try again.";
    if (/user already registered/i.test(msg)) return "An account with this email already exists. Try logging in instead.";
    if (/password should be at least/i.test(msg)) return "Please choose a password with at least 6 characters.";
    if (/unable to validate email/i.test(msg)) return "That email address does not look valid. Please check it.";
    if (/email not confirmed/i.test(msg)) return "Please confirm your email first — check your inbox for the confirmation link.";
    if (/rate limit/i.test(msg)) return "Too many attempts. Please wait a minute and try again.";
    if (/provider is not enabled|unsupported provider/i.test(msg)) return "Google sign-in is not switched on yet. Please try again in a few minutes.";
    return msg;
  }
  TFG.friendlyError = friendlyError;

  TFG.showFormError = function (form, message) {
    var box = form.querySelector(".form-error");
    if (!box) return;
    box.textContent = message;
    box.classList.add("visible");
    var ok = form.querySelector(".form-success");
    if (ok) ok.classList.remove("visible");
  };

  TFG.showFormSuccess = function (form, message) {
    var box = form.querySelector(".form-success");
    if (!box) return;
    box.textContent = message;
    box.classList.add("visible");
    var err = form.querySelector(".form-error");
    if (err) err.classList.remove("visible");
  };

  TFG.clearFormMessages = function (form) {
    form.querySelectorAll(".form-error.visible, .form-success.visible").forEach(function (b) {
      b.classList.remove("visible");
    });
  };

  /* ---------------- Auth ---------------- */

  TFG.signUp = async function (fullName, email, password) {
    try {
      var sb = getClient();
      var res = await sb.auth.signUp({
        email: email,
        password: password,
        options: { data: { full_name: fullName } }
      });
      if (res.error) return { error: friendlyError(res.error) };
      if (res.data && res.data.user && !res.data.session) {
        return { needsConfirmation: true, user: res.data.user };
      }
      // Create the profile row for the new member.
      if (res.data && res.data.user) {
        await sb.from("profiles").insert({ id: res.data.user.id, full_name: fullName });
      }
      return { user: res.data.user, session: res.data.session };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  TFG.signIn = async function (email, password) {
    try {
      var sb = getClient();
      var res = await sb.auth.signInWithPassword({ email: email, password: password });
      if (res.error) return { error: friendlyError(res.error) };
      return { session: res.data.session };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  // Starts the Google (Gmail) OAuth flow. On success the browser leaves
  // for Google and comes back to dashboard.html with a session.
  TFG.signInWithGoogle = async function () {
    try {
      var sb = getClient();
      var res = await sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin + "/dashboard.html" }
      });
      if (res.error) return { error: friendlyError(res.error) };
      return { ok: true };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  TFG.signOut = async function () {
    try {
      var sb = getClient();
      await sb.auth.signOut();
    } catch (e) { /* non-fatal */ }
    window.location.href = "index.html";
  };

  TFG.resetPassword = async function (email) {
    try {
      var sb = getClient();
      var res = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname.replace(/[^/]*$/, "") + "login.html"
      });
      if (res.error) return { error: friendlyError(res.error) };
      return { ok: true };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  TFG.getSession = async function () {
    try {
      var sb = getClient();
      var res = await sb.auth.getSession();
      return res.data.session || null;
    } catch (e) {
      return null;
    }
  };

  TFG.getUser = async function () {
    try {
      var sb = getClient();
      var res = await sb.auth.getUser();
      if (res.data && res.data.user) return res.data.user;
      // The access token can expire while the page sits open (tablets
      // that fall asleep are the classic case). Try one silent refresh
      // before reporting the user as logged out.
      try {
        var ref = await sb.auth.refreshSession();
        if (ref.data && ref.data.user) return ref.data.user;
        var retry = await sb.auth.getUser();
        return (retry.data && retry.data.user) || null;
      } catch (e2) {
        return null;
      }
    } catch (e) {
      return null;
    }
  };

  /* ---------------- Onboarding (welcome questionnaire) ---------------- */
  TFG.getOnboarding = async function () {
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) return { data: null };
      var res = await sb.from("onboarding").select("kids_ages, struggle, completed_at")
        .eq("user_id", user.id).maybeSingle();
      if (res.error) return { data: null };
      return { data: res.data };
    } catch (e) {
      return { data: null };
    }
  };

  TFG.saveOnboarding = async function (kidsAges, struggle) {
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) return { error: "Please log in first." };
      var res = await sb.from("onboarding").upsert({
        user_id: user.id,
        kids_ages: kidsAges,
        struggle: struggle,
        completed_at: new Date().toISOString()
      }, { onConflict: "user_id" });
      if (res.error) return { error: "Couldn't save — please try again." };
      return { ok: true };
    } catch (e) {
      return { error: "Couldn't save — please try again." };
    }
  };

  /* ---------------- Kid join QR codes ----------------
     Kids join in the browser (it's a web app, not a native app):
     the QR opens kid-login.html?code=XXXXXX which signs them in. */
  TFG.kidJoinUrl = function (code) {
    return "https://thefamilyground.com/kid-login.html?code=" + encodeURIComponent(code);
  };

  TFG.renderKidQR = function (el, code, size) {
    if (!el || typeof window.QRCode === "undefined") return false;
    el.innerHTML = "";
    try {
      new window.QRCode(el, {
        text: TFG.kidJoinUrl(code),
        width: size || 160,
        height: size || 160,
        correctLevel: window.QRCode.CorrectLevel.M
      });
      return true;
    } catch (e) { return false; }
  };

  // Creates the profiles row for OAuth members (Google sign-in skips
  // the email sign-up path that normally creates it).
  TFG.ensureProfile = async function () {
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) return { error: "Please log in first." };
      var existing = await sb.from("profiles").select("id").eq("id", user.id).maybeSingle();
      if (existing.error) return { error: friendlyError(existing.error) };
      if (existing.data) return { ok: true };
      var meta = user.user_metadata || {};
      var fullName = meta.full_name || meta.name || user.email || "Member";
      var ins = await sb.from("profiles").insert({ id: user.id, full_name: fullName });
      if (ins.error) return { error: friendlyError(ins.error) };
      return { ok: true };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  // Redirects to login.html when there is no active session.
  TFG.requireAuth = async function () {
    var session = await TFG.getSession();
    if (!session) {
      window.location.href = "login.html";
      return null;
    }
    return session;
  };

  /* ---------------- Parent / kid dashboards ----------------
     Kids join with a one-time parent code via anonymous sign-in:
     no email or phone needed for kids.
  ------------------------------------------------------ */

  // Anonymous sign-in (used by kids).
  TFG.signInAnonymously = async function () {
    try {
      var sb = getClient();
      var res = await sb.auth.signInAnonymously();
      if (res.error) return { error: friendlyError(res.error) };
      return { session: res.data.session, user: res.data.user };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  // The kid_profiles row for the current user, or null.
  TFG.getKidProfile = async function () {
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) return { kid: null };
      var res = await sb.from("kid_profiles").select("id, parent_id, kid_label, age_band").eq("id", user.id).maybeSingle();
      if (res.error) return { error: friendlyError(res.error) };
      return { kid: res.data || null };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  // Parent pages: bounce kid sessions to the kid dashboard.
  TFG.requireParent = async function () {
    var session = await TFG.requireAuth();
    if (!session) return null;
    var kp = await TFG.getKidProfile();
    if (kp && kp.kid) {
      window.location.href = "kid-dashboard.html";
      return null;
    }
    return session;
  };

  // Kid pages: bounce anyone who is not a kid to the login page.
  TFG.requireKid = async function () {
    var session = await TFG.requireAuth();
    if (!session) return null;
    var kp = await TFG.getKidProfile();
    if (!kp || !kp.kid) {
      window.location.href = "login.html";
      return null;
    }
    return { session: session, kid: kp.kid };
  };

  TFG.signOutKid = async function () {
    try {
      var sb = getClient();
      await sb.auth.signOut();
    } catch (e) { /* non-fatal */ }
    window.location.href = "kid-login.html";
  };

  // Sign out without leaving the page (used when a kid takes over a
  // shared device where a parent is still logged in).
  TFG.signOutSilent = async function () {
    try {
      var sb = getClient();
      await sb.auth.signOut();
    } catch (e) { /* non-fatal */ }
  };

  // 6-char code from an unambiguous charset (no I, L, O, 0, 1).
  var CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  TFG.makeInviteCode = function () {
    var code = "";
    for (var i = 0; i < 6; i++) {
      code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
    }
    return code;
  };

  TFG.createInviteCode = async function (kidLabel) {
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) return { error: "Please log in first." };
      var code = TFG.makeInviteCode();
      var res = await sb.from("invite_codes")
        .insert({ parent_id: user.id, code: code, kid_label: kidLabel || "" })
        .select().single();
      if (res.error) return { error: friendlyError(res.error) };
      return { invite: res.data };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  // The parent's kids plus their active (unused) invite codes.
  TFG.getKids = async function () {
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) return { error: "Please log in first." };
      var kidsRes = await sb.from("kid_profiles")
        .select("id, kid_label, age_band, created_at").eq("parent_id", user.id).order("created_at", { ascending: true });
      if (kidsRes.error) return { error: friendlyError(kidsRes.error) };
      var codesRes = await sb.from("invite_codes")
        .select("id, code, kid_label, is_active, created_at").eq("parent_id", user.id).eq("is_active", true)
        .order("created_at", { ascending: false });
      if (codesRes.error) return { error: friendlyError(codesRes.error) };
      return { kids: kidsRes.data || [], codes: codesRes.data || [] };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  // Fresh code for a kid label (deactivates their old active codes).
  TFG.newInviteCodeForKid = async function (kidLabel) {
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) return { error: "Please log in first." };
      await sb.from("invite_codes").update({ is_active: false })
        .eq("parent_id", user.id).eq("kid_label", kidLabel || "").eq("is_active", true);
      return await TFG.createInviteCode(kidLabel);
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  // Remove a kid: burn their codes, delete the profile row.
  // Their chores stay but become unassigned (on delete set null).
  TFG.removeKid = async function (kidId, kidLabel) {
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) return { error: "Please log in first." };
      await sb.from("invite_codes").update({ is_active: false })
        .eq("parent_id", user.id).eq("kid_label", kidLabel || "");
      var res = await sb.from("kid_profiles").delete().eq("id", kidId).eq("parent_id", user.id);
      if (res.error) return { error: friendlyError(res.error) };
      return { ok: true };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  /* ---- Chores with kid assignment ---- */

  // The parent's own chores (not assigned to any kid).
  TFG.getParentChores = async function () {
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) return { error: "Please log in first." };
      var res = await sb.from("chores").select("*")
        .eq("user_id", user.id).is("assigned_to", null).order("created_at", { ascending: true });
      if (res.error) return { error: friendlyError(res.error) };
      return { chores: res.data || [] };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  // All chores the parent assigned to kids.
  TFG.getAssignedChores = async function () {
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) return { error: "Please log in first." };
      var res = await sb.from("chores").select("*")
        .eq("user_id", user.id).not("assigned_to", "is", null).order("created_at", { ascending: true });
      if (res.error) return { error: friendlyError(res.error) };
      return { chores: res.data || [] };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  // The signed-in kid's own chores.
  TFG.getMyChores = async function () {
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) return { error: "Please log in first." };
      var res = await sb.from("chores").select("*")
        .eq("assigned_to", user.id).order("created_at", { ascending: true });
      if (res.error) return { error: friendlyError(res.error) };
      return { chores: res.data || [] };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  // Parent review: approve the chore or ask the kid to redo it,
  // with an optional note the kid will see.
  TFG.reviewChore = async function (choreId, status, parentNote) {
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) return { error: "Please log in first." };
      if (status !== "approved" && status !== "resubmit") return { error: "Unknown review action." };
      var res = await sb.from("chores").update({ status: status, parent_note: parentNote || null })
        .eq("id", choreId).eq("user_id", user.id).select().single();
      if (res.error) return { error: friendlyError(res.error) };
      return { chore: res.data };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  // Kid marks a chore done. proofPath: storage path in chore-proof, or null.
  TFG.submitChore = async function (choreId, proofPath) {
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) return { error: "Please log in first." };
      var res = await sb.from("chores")
        .update({ status: "submitted", proof_url: proofPath || null })
        .eq("id", choreId).eq("assigned_to", user.id).select().single();
      if (res.error) return { error: friendlyError(res.error) };
      return { chore: res.data };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  // Kid uploads a proof photo. Path: {kidId}/{choreId}.jpg (upsert).
  TFG.uploadProof = async function (choreId, file) {
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) return { error: "Please log in first." };
      var path = user.id + "/" + choreId + ".jpg";
      var res = await sb.storage.from("chore-proof").upload(path, file, {
        upsert: true,
        contentType: file.type || "image/jpeg"
      });
      if (res.error) return { error: friendlyError(res.error) };
      return { path: path };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  // Signed URL so the parent can view a proof photo.
  TFG.getProofUrl = async function (path) {
    try {
      var sb = getClient();
      var res = await sb.storage.from("chore-proof").createSignedUrl(path, 3600);
      if (res.error) return { error: friendlyError(res.error) };
      return { url: res.data.signedUrl };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  // Kid redemption: code -> kid_profiles row -> the code is used up.
  TFG.redeemInviteCode = async function (rawCode) {
    try {
      var sb = getClient();
      var code = String(rawCode || "").trim().toUpperCase();
      if (!code) return { error: "Please enter the code from your parent." };
      var user = await TFG.getUser();
      if (!user) return { error: "Could not start. Please reload and try again." };
      // Already joined before? Go straight in.
      var existing = await sb.from("kid_profiles").select("id").eq("id", user.id).maybeSingle();
      if (existing.data) return { kid: existing.data, already: true };
      // Redeem atomically: validates the code, burns it, and creates the
      // kid_profiles row (including reattach) in one step.
      var redeemed = await sb.rpc("redeem_invite_code", { p_code: code });
      if (redeemed.error) return { error: "That code did not work. Ask your parent for a new one." };
      var row = redeemed.data && redeemed.data[0];
      if (!row || !row.parent_id) return { error: "That code did not work. Ask your parent for a new one." };
      var kp = await sb.from("kid_profiles").select("id").eq("id", user.id).maybeSingle();
      if (kp.error || !kp.data) return { error: "Something went wrong setting up. Please try again." };
      return { kid: kp.data };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  // Show/hide nav items based on auth state.
  TFG.updateNav = async function () {
    var session = await TFG.getSession();
    var loggedIn = !!session;
    document.querySelectorAll('[data-auth="logged-in"]').forEach(function (el) {
      el.hidden = !loggedIn;
    });
    document.querySelectorAll('[data-auth="logged-out"]').forEach(function (el) {
      el.hidden = loggedIn;
    });
    // Show member's first name in the dashboard chip, if present.
    var chip = document.getElementById("memberName");
    if (chip && session && session.user) {
      var meta = session.user.user_metadata || {};
      var name = meta.full_name || session.user.email || "Member";
      chip.textContent = String(name).split(" ")[0];
      var avatar = document.getElementById("memberAvatar");
      if (avatar) avatar.textContent = String(name).trim().charAt(0).toUpperCase();
    }
  };

  /* ---------------- Chores ---------------- */

  TFG.getChores = async function () {
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) return { error: "Please log in first." };
      var res = await sb.from("chores").select("*").eq("user_id", user.id).order("created_at", { ascending: true });
      if (res.error) return { error: friendlyError(res.error) };
      return { chores: res.data || [] };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  TFG.addChore = async function (fields) {
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) return { error: "Please log in first." };
      var res = await sb.from("chores").insert({
        user_id: user.id,
        kid_label: fields.kid_label,
        title: fields.title,
        frequency: fields.frequency || "daily",
        assigned_to: fields.assigned_to || null,
        proof_required: !!fields.proof_required,
        status: "assigned"
      }).select().single();
      if (res.error) return { error: friendlyError(res.error) };
      return { chore: res.data };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  TFG.deleteChore = async function (choreId) {
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) return { error: "Please log in first." };
      var res = await sb.from("chores").delete().eq("id", choreId).eq("user_id", user.id);
      if (res.error) return { error: friendlyError(res.error) };
      return { ok: true };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  // mondayISO: "YYYY-MM-DD" of the week's Monday. Returns rows {chore_id, completed_on}.
  TFG.getWeekCompletions = async function (mondayISO) {
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) return { error: "Please log in first." };
      var sunday = addDays(parseISO(mondayISO), 6);
      var res = await sb.from("chore_completions")
        .select("chore_id, completed_on")
        .eq("user_id", user.id)
        .gte("completed_on", mondayISO)
        .lte("completed_on", isoDate(sunday));
      if (res.error) return { error: friendlyError(res.error) };
      return { completions: res.data || [] };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  TFG.toggleCompletion = async function (choreId, dateISO) {
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) return { error: "Please log in first." };
      var existing = await sb.from("chore_completions")
        .select("id").eq("chore_id", choreId).eq("completed_on", dateISO).eq("user_id", user.id).maybeSingle();
      if (existing.error) return { error: friendlyError(existing.error) };
      if (existing.data) {
        var del = await sb.from("chore_completions").delete().eq("id", existing.data.id);
        if (del.error) return { error: friendlyError(del.error) };
        return { done: false };
      }
      var ins = await sb.from("chore_completions").insert({ chore_id: choreId, user_id: user.id, completed_on: dateISO });
      if (ins.error) return { error: friendlyError(ins.error) };
      return { done: true };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  /* ---------------- Agreements ---------------- */

  // body shape: { rules: [], rewards: [], consequences: [], disagree: "", signatures: [{name, date}] }
  TFG.getAgreements = async function () {
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) return { error: "Please log in first." };
      var res = await sb.from("agreements").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
      if (res.error) return { error: friendlyError(res.error) };
      return { agreements: res.data || [] };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  TFG.saveAgreement = async function (fields) {
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) return { error: "Please log in first." };
      var payload = { user_id: user.id, title: fields.title, body: fields.body };
      var res;
      if (fields.id) {
        res = await sb.from("agreements").update(payload).eq("id", fields.id).eq("user_id", user.id).select().single();
      } else {
        res = await sb.from("agreements").insert(payload).select().single();
      }
      if (res.error) return { error: friendlyError(res.error) };
      return { agreement: res.data };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  TFG.deleteAgreement = async function (agreementId) {
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) return { error: "Please log in first." };
      var res = await sb.from("agreements").delete().eq("id", agreementId).eq("user_id", user.id);
      if (res.error) return { error: friendlyError(res.error) };
      return { ok: true };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

/* ---------------- Memberships: trial codes + paywall gate ----------------
   Parents enter a beta invite code for free trial access.
   The dashboard gate redirects: no membership -> welcome.html,
   expired trial -> paywall.html.
---------------------------------------------------------------------- */

  // 'ok' | 'welcome' | 'paywall' | 'login'
  TFG.membershipStatus = async function () {
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) return 'login';
      var res = await sb.from("memberships").select("status, trial_ends_at")
        .eq("user_id", user.id).maybeSingle();
      if (res.error || !res.data) return 'welcome';
      var m = res.data;
      if (m.status === 'active') return 'ok';
      if (m.status === 'trialing') {
        if (m.trial_ends_at && new Date(m.trial_ends_at).getTime() < Date.now()) return 'paywall';
        return 'ok';
      }
      return 'paywall';
    } catch (e) {
      return 'welcome';
    }
  };

  // Enforces the gate on member pages. Call after requireParent().
  // Redirects when the member cannot proceed; returns 'ok' otherwise.
  // The site owner always passes (manages invite codes from the dashboard).
  TFG.requireMembership = async function () {
    var st = await TFG.membershipStatus();
    if (st === 'login') { window.location.href = "login.html"; return null; }
    if (st === 'ok') return st;
    if (await TFG.isOwner()) return 'ok';
    if (st === 'welcome') { window.location.href = "welcome.html"; return null; }
    if (st === 'paywall') { window.location.href = "paywall.html"; return null; }
    return st;
  };

  // Redeem a beta invite code -> trialing membership for the code's days.
  TFG.redeemBetaCode = async function (rawCode) {
    try {
      var sb = getClient();
      var code = String(rawCode || "").trim();
      if (!code) return { error: "Please enter your invite code." };
      var res = await sb.rpc("redeem_beta_code", { p_code: code });
      if (res.error) {
        var msg = String(res.error.message || "").toLowerCase();
        if (msg.indexOf("invalid code") >= 0) return { error: "That code didn't work. Check it and try again." };
        if (msg.indexOf("fully used") >= 0) return { error: "That code has already been used up." };
        return { error: friendlyError(res.error) };
      }
      var row = res.data && res.data[0];
      return { ok: true, trialEndsAt: row && row.trial_ends_at };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  // Owner-only helpers. Non-owners get "Not allowed" from the database.
  TFG.isOwner = async function () {
    try {
      var user = await TFG.getUser();
      if (!user || !user.email) return false;
      var em = String(user.email).toLowerCase();
      return em === "emamnazar@gmail.com" || em === "thefamilyground@gmail.com";
    } catch (e) {
      return false;
    }
  };

  TFG.adminCreateBetaCode = async function (code, days, maxUses, note) {
    try {
      var sb = getClient();
      var res = await sb.rpc("admin_create_beta_code", {
        p_code: code, p_days: days, p_max_uses: maxUses, p_note: note || ""
      });
      if (res.error) return { error: friendlyError(res.error) };
      return { code: res.data && res.data[0] };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  TFG.adminListBetaCodes = async function () {
    try {
      var sb = getClient();
      var res = await sb.rpc("admin_list_beta_codes");
      if (res.error) return { error: friendlyError(res.error) };
      return { codes: res.data || [] };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  TFG.adminToggleBetaCode = async function (id, active) {
    try {
      var sb = getClient();
      var res = await sb.rpc("admin_toggle_beta_code", { p_id: id, p_active: active });
      if (res.error) return { error: friendlyError(res.error) };
      return { ok: true };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  TFG.adminStats = async function () {
    try {
      var sb = getClient();
      var res = await sb.rpc("admin_stats");
      if (res.error) return { error: friendlyError(res.error) };
      return { stats: res.data || {} };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  TFG.adminListUsers = async function () {
    try {
      var sb = getClient();
      var res = await sb.rpc("admin_list_users");
      if (res.error) return { error: friendlyError(res.error) };
      return { users: res.data || [] };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  TFG.adminExtendTrial = async function (userId, days) {
    try {
      var sb = getClient();
      var res = await sb.rpc("admin_extend_trial", { p_user_id: userId, p_days: days });
      if (res.error) return { error: friendlyError(res.error) };
      return { trialEndsAt: res.data };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  /* ---------------- Daily affirmations ---------------- */

  TFG.AFFIRMATION_BANDS = ["4-6", "7-9", "10-12", "13+"];

  // Guess a band from a free-text kid label like "Age 9". Returns null if no number found.
  TFG.bandForLabel = function (label) {
    var m = String(label || "").match(/\d+/);
    if (!m) return null;
    var age = parseInt(m[0], 10);
    if (age <= 6) return "4-6";
    if (age <= 9) return "7-9";
    if (age <= 12) return "10-12";
    return "13+";
  };

  // Whole-day index, stable across the day in any timezone.
  TFG.todayIndex = function () {
    return Math.floor(Date.now() / 86400000);
  };

  // Deterministic daily pick: 3 consecutive items from the band's rotation,
  // wrapping around. Same 3 all day for every kid in the band.
  TFG.pickDailyAffirmations = function (list, count) {
    list = list || [];
    count = count || 3;
    if (!list.length) return [];
    var out = [];
    var start = (TFG.todayIndex() * count) % list.length;
    for (var i = 0; i < count && i < list.length; i++) {
      out.push(list[(start + i) % list.length]);
    }
    return out;
  };

  TFG.getAffirmations = async function (band) {
    try {
      var sb = getClient();
      var res = await sb.from("affirmations")
        .select("id, text, pillar, sort_order")
        .eq("age_band", band)
        .order("sort_order", { ascending: true });
      if (res.error) return { error: friendlyError(res.error) };
      return { affirmations: res.data || [] };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  // Kid taps "I said it".
  TFG.sayAffirmation = async function (affirmationId) {
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) return { error: "Please log in first." };
      var today = new Date().toISOString().slice(0, 10);
      var res = await sb.from("affirmation_checkins").upsert(
        { kid_id: user.id, affirmation_id: affirmationId, said_on: today },
        { onConflict: "kid_id,affirmation_id,said_on" }
      );
      if (res.error) return { error: friendlyError(res.error) };
      return { ok: true };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  // Kid's own check-ins for today: { affirmationId: true }.
  TFG.getMyAffirmationCheckins = async function () {
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) return { said: {} };
      var today = new Date().toISOString().slice(0, 10);
      var res = await sb.from("affirmation_checkins")
        .select("affirmation_id").eq("kid_id", user.id).eq("said_on", today);
      if (res.error) return { error: friendlyError(res.error) };
      var said = {};
      (res.data || []).forEach(function (r) { said[r.affirmation_id] = true; });
      return { said: said };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  // Parent sets a kid's age band.
  TFG.setKidAgeBand = async function (kidId, band) {
    try {
      var sb = getClient();
      var res = await sb.from("kid_profiles").update({ age_band: band || null }).eq("id", kidId);
      if (res.error) return { error: friendlyError(res.error) };
      return { ok: true };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  // Parent view: today's check-ins across all their kids: { kidId: { affirmationId: true } }.
  TFG.getKidsAffirmationStatus = async function () {
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) return { error: "Please log in first." };
      var kidsRes = await sb.from("kid_profiles").select("id").eq("parent_id", user.id);
      if (kidsRes.error) return { error: friendlyError(kidsRes.error) };
      var ids = (kidsRes.data || []).map(function (k) { return k.id; });
      if (!ids.length) return { status: {} };
      var today = new Date().toISOString().slice(0, 10);
      var res = await sb.from("affirmation_checkins")
        .select("kid_id, affirmation_id").in("kid_id", ids).eq("said_on", today);
      if (res.error) return { error: friendlyError(res.error) };
      var status = {};
      (res.data || []).forEach(function (r) {
        (status[r.kid_id] = status[r.kid_id] || {})[r.affirmation_id] = true;
      });
      return { status: status };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  // Read one aloud (for little kids who can't read yet).
  TFG.speakAffirmation = function (text) {
    try {
      if (!("speechSynthesis" in window)) return false;
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.rate = 0.9;
      window.speechSynthesis.speak(u);
      return true;
    } catch (e) {
      return false;
    }
  };

  /* ---------------- PWA: service worker + install prompt ---------------- */

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }

  var deferredInstallPrompt = null;

  TFG.installApp = async function () {
    try {
      if (!deferredInstallPrompt) return { error: "not-available" };
      deferredInstallPrompt.prompt();
      var choice = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      return { accepted: choice && choice.outcome === "accepted" };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  };

  // Shows the [data-install-app] banner when the browser offers installation,
  // or iOS "Add to Home Screen" instructions on iPhones/iPads.
  TFG.initInstallBanner = function () {
    var banner = document.getElementById("installBanner");
    if (!banner) return;
    try {
      if (localStorage.getItem("tfg-install-dismissed") === "1") return;
    } catch (e) {}
    var btn = banner.querySelector("[data-install-app]");
    var iosNote = banner.querySelector("[data-install-ios]");
    var dismiss = banner.querySelector("[data-install-dismiss]");
    function hide() {
      banner.hidden = true;
      try { localStorage.setItem("tfg-install-dismissed", "1"); } catch (e) {}
    }
    if (dismiss) dismiss.addEventListener("click", hide);
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || "") && !window.MSStream;
    var standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone;
    if (standalone) return; // Already installed.
    if (isIOS) {
      if (iosNote) iosNote.hidden = false;
      if (btn) btn.hidden = true;
      banner.hidden = false;
      return;
    }
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferredInstallPrompt = e;
      banner.hidden = false;
    });
    if (btn) btn.addEventListener("click", function () {
      TFG.installApp().then(function () { hide(); });
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", TFG.initInstallBanner);
  } else {
    TFG.initInstallBanner();
  }

  // Starts Stripe checkout. Wired up when Amam connects Stripe;
  // until then the paywall shows the honest "opening soon" state.
  TFG.startCheckout = async function () {
    var key = (cfg.STRIPE_PUBLISHABLE_KEY || "");
    if (!key || key.indexOf("PASTE_") === 0) {
      return { error: "Payments aren't open yet — we'll let you know the moment they are." };
    }
    // TODO: create a Checkout Session via a secure backend endpoint and
    // redirect to Stripe. Never put the secret key in this file.
    return { error: "Checkout is being connected. Please try again soon." };
  };

/* ---------------- Date helpers ---------------- */

  function parseISO(s) {
    var parts = s.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  function isoDate(d) {
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }
  function addDays(d, n) {
    var c = new Date(d);
    c.setDate(c.getDate() + n);
    return c;
  }
  function mondayOf(d) {
    var c = new Date(d);
    var dow = (c.getDay() + 6) % 7; // Monday = 0
    c.setDate(c.getDate() - dow);
    c.setHours(0, 0, 0, 0);
    return c;
  }
  TFG.dates = { parseISO: parseISO, isoDate: isoDate, addDays: addDays, mondayOf: mondayOf };

  /* ---------------- Shared page behavior ---------------- */

  document.addEventListener("DOMContentLoaded", function () {
    // Footer year.
    document.querySelectorAll("#year").forEach(function (el) {
      el.textContent = new Date().getFullYear();
    });

    // Mobile hamburger.
    var burger = document.getElementById("hamburger");
    var navLinks = document.getElementById("navLinks");
    if (burger && navLinks) {
      burger.addEventListener("click", function () {
        var open = navLinks.classList.toggle("open");
        burger.setAttribute("aria-expanded", open ? "true" : "false");
      });
      navLinks.querySelectorAll("a").forEach(function (a) {
        a.addEventListener("click", function () { navLinks.classList.remove("open"); });
      });
    }

    // Auth-aware nav + sign out buttons.
    TFG.updateNav();
    document.querySelectorAll("[data-action='sign-out']").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        if (e && e.preventDefault) e.preventDefault();
        TFG.signOut();
      });
    });

    // Generic tabs: [data-tab-target] buttons, .tab-panel panels.
    document.querySelectorAll("[data-tab-target]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = btn.getAttribute("data-tab-target");
        var scope = btn.closest("[data-tabs]") || document;
        scope.querySelectorAll("[data-tab-target]").forEach(function (b) { b.classList.remove("active"); });
        scope.querySelectorAll(".tab-panel").forEach(function (p) { p.classList.remove("active"); });
        btn.classList.add("active");
        var panel = document.getElementById(target);
        if (panel) panel.classList.add("active");
      });
    });

    // Support ?tab= query param (used by dashboard deep links).
    var params = new URLSearchParams(window.location.search);
    var wantTab = params.get("tab");
    if (wantTab) {
      var btn = document.querySelector('[data-tab-target="panel-' + wantTab + '"]');
      if (btn) btn.click();
    }

    // Membership price placeholder injection.
    document.querySelectorAll("[data-price]").forEach(function (el) {
      el.textContent = (cfg.PRICE_PLACEHOLDER && cfg.PRICE_PLACEHOLDER !== "PRICE_NOT_SET")
        ? cfg.PRICE_PLACEHOLDER
        : "Founding member pricing announced at launch";
    });
  });
})();
