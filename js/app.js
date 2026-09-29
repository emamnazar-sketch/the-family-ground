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
      return res.data.user || null;
    } catch (e) {
      return null;
    }
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
      var res = await sb.from("kid_profiles").select("id, parent_id, kid_label").eq("id", user.id).maybeSingle();
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
        .select("id, kid_label, created_at").eq("parent_id", user.id).order("created_at", { ascending: true });
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
      var found = await sb.from("invite_codes")
        .select("id, parent_id, kid_label").eq("code", code).eq("is_active", true).maybeSingle();
      if (found.error) return { error: friendlyError(found.error) };
      if (!found.data) return { error: "That code did not work. Ask your parent for a new one." };
      var ins = await sb.from("kid_profiles")
        .insert({ id: user.id, parent_id: found.data.parent_id, kid_label: found.data.kid_label || "" })
        .select().single();
      if (ins.error) return { error: friendlyError(ins.error) };
      // Single use: burn the code.
      await sb.from("invite_codes").update({ is_active: false }).eq("id", found.data.id);
      return { kid: ins.data };
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

  /* ---------------- Course catalog data ----------------
     Single source of truth for the dashboard "My Courses" tab.
     Lesson bodies are DRAFT outlines — Amam will write the real lessons.
  ------------------------------------------------------ */
  TFG.COURSES = [
    {
      slug: "screen-reset",
      title: "7-Day Family Screen Reset",
      status: "members", // "members" | "coming-soon"
      tagline: "One small step a day to take your evenings back.",
      description: "A week of short, practical steps that help your family agree on screen limits — without the daily fights. Built for real homes with real kids, not perfect ones.",
      lessons: [
        { slug: "day-1", title: "Day 1 — See the real picture" },
        { slug: "day-2", title: "Day 2 — Talk, don't lecture" },
        { slug: "day-3", title: "Day 3 — Pick your phone-free times" },
        { slug: "day-4", title: "Day 4 — Build the agreement together" },
        { slug: "day-5", title: "Day 5 — Handle the pushback" },
        { slug: "day-6", title: "Day 6 — Make the evenings yours again" },
        { slug: "day-7", title: "Day 7 — Keep it going" }
      ]
    },
    {
      slug: "calm-mornings",
      title: "Calm Mornings, Peaceful Bedtimes",
      status: "coming-soon",
      tagline: "Routines that end the yelling at both ends of the day.",
      description: "Simple morning and bedtime routines your kids help build — so the day starts and ends with calm instead of chaos.",
      lessons: [
        { slug: "m-1", title: "Why routines beat reminders" },
        { slug: "m-2", title: "Building the morning checklist together" },
        { slug: "m-3", title: "The bedtime wind-down that actually works" },
        { slug: "m-4", title: "When the routine falls apart" },
        { slug: "m-5", title: "Keeping it alive past week two" }
      ]
    },
    {
      slug: "agreement-workshop",
      title: "The Family Agreement Workshop",
      status: "coming-soon",
      tagline: "Write the agreement your whole family will actually follow.",
      description: "A guided workshop that walks you through creating your family's own agreement — rules, rewards, consequences, and what to do when you disagree — with your kids at the table.",
      lessons: [
        { slug: "w-1", title: "Setting up the family meeting" },
        { slug: "w-2", title: "Rules your kids help write" },
        { slug: "w-3", title: "Rewards and consequences that are fair" },
        { slug: "w-4", title: "Signing day and the weekly check-in" }
      ]
    }
  ];

  TFG.renderCourseCatalog = function (container) {
    if (!container) return;
    var html = TFG.COURSES.map(function (course, i) {
      var isMembers = course.status === "members";
      var badge = isMembers
        ? '<span class="course-status status-members">Members only</span>'
        : '<span class="course-status status-soon">Coming soon</span>';
      var lessons = course.lessons.map(function (l, n) {
        return '<li><span class="lesson-num">' + (n + 1) + '</span><span>' + esc(l.title) + '</span></li>';
      }).join("");
      var cta = isMembers
        ? '<a class="btn btn-primary btn-sm" href="signup.html">Become a member to start</a>'
        : '<p class="small muted" style="margin-top:16px;">This course is on its way. Members will get it first.</p>';
      return (
        '<div class="card course-card">' + badge +
        '<h3>' + esc(course.title) + '</h3>' +
        '<p class="muted">' + esc(course.tagline) + '</p>' +
        '<p>' + esc(course.description) + '</p>' +
        '<p class="lesson-count">' + course.lessons.length + ' lessons</p>' +
        '<ul class="lesson-list">' + lessons + '</ul>' +
        '<div class="mt-2">' + cta + '</div>' +
        '</div>'
      );
    }).join("");
    container.innerHTML = html;
  };

  TFG.renderMyCourses = async function (container) {
    if (!container) return;
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) { container.innerHTML = "<p>Please log in to see your courses.</p>"; return; }
      var progressRes = await sb.from("course_progress").select("course_slug, lesson_slug").eq("user_id", user.id);
      var done = {};
      (progressRes.data || []).forEach(function (r) { done[r.course_slug + "|" + r.lesson_slug] = true; });

      container.innerHTML = TFG.COURSES.map(function (course) {
        if (course.status !== "members") {
          return '<div class="card course-card"><span class="course-status status-soon">Coming soon</span>' +
            '<h3>' + esc(course.title) + '</h3><p>' + esc(course.description) + '</p>' +
            '<p class="small muted">Members will get this course first.</p></div>';
        }
        var total = course.lessons.length;
        var completed = course.lessons.filter(function (l) { return done[course.slug + "|" + l.slug]; }).length;
        var pct = total ? Math.round((completed / total) * 100) : 0;
        var lessons = course.lessons.map(function (l) {
          var key = course.slug + "|" + l.slug;
          var isDone = !!done[key];
          return '<label class="lesson-check"><input type="checkbox" data-course="' + esc(course.slug) +
            '" data-lesson="' + esc(l.slug) + '"' + (isDone ? " checked" : "") + '>' +
            '<span class="' + (isDone ? "done" : "") + '">' + esc(l.title) + '</span></label>';
        }).join("");
        return '<div class="card course-card"><span class="course-status status-members">Members only</span>' +
          '<h3>' + esc(course.title) + '</h3><p>' + esc(course.description) + '</p>' +
          '<div class="progress"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
          '<p class="progress-label">' + completed + ' of ' + total + ' lessons complete</p>' +
          '<div class="mt-2">' + lessons + '</div></div>';
      }).join("");

      // Wire lesson checkboxes (event delegation).
      container.querySelectorAll('input[type="checkbox"][data-course]').forEach(function (box) {
        box.addEventListener("change", async function () {
          var res = await TFG.toggleLesson(box.getAttribute("data-course"), box.getAttribute("data-lesson"));
          if (res.error) {
            box.checked = !box.checked;
            alert(res.error);
            return;
          }
          var label = box.closest(".lesson-check").querySelector("span");
          if (label) label.classList.toggle("done", box.checked);
          // Refresh progress bars.
          TFG.renderMyCourses(container);
        });
      });
    } catch (e) {
      container.innerHTML = '<p class="muted">Could not load your courses: ' + esc(friendlyError(e)) + '</p>';
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

  /* ---------------- Course progress ---------------- */

  TFG.toggleLesson = async function (courseSlug, lessonSlug) {
    try {
      var sb = getClient();
      var user = await TFG.getUser();
      if (!user) return { error: "Please log in first." };
      var existing = await sb.from("course_progress")
        .select("id").eq("user_id", user.id).eq("course_slug", courseSlug).eq("lesson_slug", lessonSlug).maybeSingle();
      if (existing.error) return { error: friendlyError(existing.error) };
      if (existing.data) {
        var del = await sb.from("course_progress").delete().eq("id", existing.data.id);
        if (del.error) return { error: friendlyError(del.error) };
        return { done: false };
      }
      var ins = await sb.from("course_progress").insert({ user_id: user.id, course_slug: courseSlug, lesson_slug: lessonSlug });
      if (ins.error) return { error: friendlyError(ins.error) };
      return { done: true };
    } catch (e) {
      return { error: friendlyError(e) };
    }
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

    // Public course catalog.
    var catalog = document.getElementById("courseCatalog");
    if (catalog) TFG.renderCourseCatalog(catalog);
  });
})();
