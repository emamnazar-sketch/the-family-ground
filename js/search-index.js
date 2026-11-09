/* ============================================================
   The Family Ground — search index + matching engine
   Phase 1: searches this site's own pages and the blog.
   Later phases plug in here: add another source to SOURCES
   (for example, local activities) and its items flow through
   the same renderer on the homepage (js/home.js).
   ============================================================ */
(function () {
  "use strict";

  var BLOG = "https://blog.thefamilyground.com/p/";

  var SOURCES = [
    {
      id: "site",
      label: "On this site",
      items: [
        {
          title: "Family Meeting Agenda — a Real 20-Minute One",
          url: "family-meeting.html",
          description: "Check-in, highs and lows, the week ahead, one thing to try, and a thank-you round. Read a real agenda, then print your own.",
          keywords: "family meeting weekly meeting agenda talk together check-in sunday meeting sit down"
        },
        {
          title: "Printable Chore Chart for Ages 7–9",
          url: "chore-chart.html",
          description: "See one real week of a chore chart — the good days and the gaps — then print a blank one for your own kid.",
          keywords: "chores chore chart printable kids chores routine jobs morning bed dishes responsibility"
        },
        {
          title: "Spiral vs Lightning — a Free Weekend Mission",
          url: "mission-preview.html",
          description: "A screen-free game mission with a printable sheet for every age band. Try a real one from inside the membership, free.",
          keywords: "weekend mission game screen-free screen time printable play together boredom activity"
        },
        {
          title: "My Home — Member Tools",
          url: "dashboard.html",
          description: "Chore tracker, family agreement builder, and your courses, all in one place. Free — just sign in with Google.",
          keywords: "family agreement agreement builder house rules sign in member dashboard my home tools"
        },
        {
          title: "About Amam",
          url: "about.html",
          description: "Meet Amam, a dad of six trying things in his own home and sharing what happens — the good days and the messy ones.",
          keywords: "about amam dad of six story who"
        }
      ]
    },
    {
      id: "blog",
      label: "From the blog",
      items: [
        {
          title: "The Nightly Phone Fight",
          url: BLOG + "the-nightly-phone-fight",
          description: "Why the phone argument repeats every night, and the agreement that ends it.",
          keywords: "phone screen time screens fight night bedtime teenager rules agreement"
        },
        {
          title: "56% of Working Parents Say They Miss Too Much. I Am One of Them.",
          url: BLOG + "too-little-time-with-kids",
          description: "More than half of working parents feel they spend too little time with their kids. A dad of six on making the hours he has count.",
          keywords: "time with kids working parent busy work guilt miss too little time quality time"
        },
        {
          title: "Teens and AI Chatbots",
          url: BLOG + "teens-ai-chatbots",
          description: "What teens are actually telling chatbots, and the questions to ask your teen.",
          keywords: "ai chatbot chatgpt teens artificial intelligence online safety screen"
        },
        {
          title: "How Do I Help My Tween Feel Confident Around Loud, Bigger Personalities?",
          url: BLOG + "tween-confidence",
          description: "Girls' confidence drops through the school years. What helps a quieter tween trust herself in loud rooms.",
          keywords: "tween confidence shy quiet daughter self-esteem loud personalities school"
        },
        {
          title: "Kids Sneaking Screens at Night",
          url: BLOG + "kids-sneaking-screens-at-night",
          description: "What the midnight scrolling is really about, and what to do instead of confiscating.",
          keywords: "screen time screens night sneaking bedtime phone tablet sleep midnight scrolling"
        },
        {
          title: "How Do I Give My Quieter Child Enough Attention When Their Sibling Always Needs Something?",
          url: BLOG + "quieter-child-attention-siblings",
          description: "Your quieter child is not asking for equal minutes. They are asking for one small proof that they are seen.",
          keywords: "quiet child attention siblings favorite fairness seen one-on-one"
        },
        {
          title: "How Do I Get My Husband to Stop Raising His Voice at Our Son?",
          url: BLOG + "partner-yelling-at-kids",
          description: "Your partner yells, you hate it, and the research says the kid learns the volume — not the lesson.",
          keywords: "yelling partner husband shouting voice discipline anger calm"
        },
        {
          title: "The Teen Who Will Not Wake Up for School",
          url: BLOG + "teen-will-not-wake-up-for-school",
          description: "The morning fight, every school day. Why teens struggle to wake up, and what one family is trying.",
          keywords: "waking up wake up school morning teen sleep alarm late"
        },
        {
          title: "When Do Kids Start Thinking Before They Act?",
          url: BLOG + "when-do-kids-think-before-acting",
          description: "About half of parents expect self-control years too early. When kids really start thinking before they act — and what helps meanwhile.",
          keywords: "impulse self-control young child thinking before acting toddler preschool behavior"
        },
        {
          title: "Where Do You Draw the Line on Punishment for a Young Child?",
          url: BLOG + "where-to-draw-line-on-punishment",
          description: "A short, close, connected consequence teaches. A big, late one mostly teaches a child to hide the next bad day.",
          keywords: "punishment discipline consequences young child time-out line too much"
        }
      ]
    }
  ];

  function normalize(text) {
    return String(text == null ? "" : text).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  }

  function scoreItem(item, query, tokens) {
    var title = normalize(item.title);
    var keywords = normalize(item.keywords);
    var description = normalize(item.description);
    var score = 0;
    if (query && title.indexOf(query) !== -1) score += 6;
    if (query && keywords.indexOf(query) !== -1) score += 5;
    tokens.forEach(function (token) {
      if (!token) return;
      if (title.split(" ").indexOf(token) !== -1) score += 3;
      else if (title.indexOf(token) !== -1) score += 2;
      if (keywords.split(" ").indexOf(token) !== -1) score += 2;
      else if (keywords.indexOf(token) !== -1) score += 1;
      if (description.indexOf(token) !== -1) score += 1;
    });
    return score;
  }

  var STOPWORDS = { the: 1, a: 1, an: 1, for: 1, up: 1, my: 1, your: 1, our: 1, with: 1, and: 1, or: 1, to: 1, of: 1, in: 1, on: 1, do: 1, does: 1, how: 1, what: 1, when: 1, why: 1, i: 1, me: 1, is: 1, it: 1 };

  /* Returns a flat list of {title, url, description, sourceLabel},
     best matches first. Empty array when nothing matches. */
  function search(rawQuery) {
    var query = normalize(rawQuery);
    if (!query) return [];
    var tokens = query.split(" ").filter(function (t) { return t.length > 1 && !STOPWORDS[t]; });
    if (!tokens.length) tokens = [query];
    var results = [];
    SOURCES.forEach(function (source) {
      source.items.forEach(function (item) {
        var score = scoreItem(item, query, tokens);
        if (score >= 3) {
          results.push({
            title: item.title,
            url: item.url,
            description: item.description,
            sourceLabel: source.label,
            score: score
          });
        }
      });
    });
    results.sort(function (a, b) { return b.score - a.score; });
    return results.slice(0, 8);
  }

  window.TFG_SEARCH = { sources: SOURCES, search: search };
})();
