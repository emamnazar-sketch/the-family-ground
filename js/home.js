/* ============================================================
   The Family Ground — homepage: hero search + newsline
   Search data + engine live in js/search-index.js, newsline
   items in js/newsline.js. This file only renders.
   ============================================================ */
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* ---------------- Newsline ---------------- */

  function renderNewsline() {
    var list = document.getElementById("newsline-list");
    if (!list || !window.TFG_NEWSLINE) return;
    list.innerHTML = window.TFG_NEWSLINE.map(function (item) {
      return (
        '<article class="news-item">' +
          (item.img
            ? '<a class="news-thumb-link" href="' + esc(item.url) + '"><img class="news-thumb" src="' + esc(item.img) + '" alt="' + esc(item.title) + '" loading="lazy"' + (item.pos ? ' style="object-position: ' + esc(item.pos) + '"' : '') + '></a>'
            : "") +
          '<p class="news-source">' + esc(item.source) + "</p>" +
          '<h3 class="news-title"><a href="' + esc(item.url) + '">' + esc(item.title) + "</a></h3>" +
          '<p class="news-note">' + esc(item.note) + "</p>" +
        "</article>"
      );
    }).join("");
  }

  /* ---------------- Hero search ---------------- */

  function resultCard(result) {
    return (
      '<a class="result-card" href="' + esc(result.url) + '">' +
        '<span class="result-source">' + esc(result.sourceLabel) + "</span>" +
        '<span class="result-title">' + esc(result.title) + "</span>" +
        '<span class="result-desc">' + esc(result.description) + "</span>" +
      "</a>"
    );
  }

  function initSearch() {
    var form = document.getElementById("site-search");
    var input = document.getElementById("site-search-input");
    var box = document.getElementById("search-results");
    if (!form || !input || !box || !window.TFG_SEARCH) return;

    function run() {
      var q = input.value.trim();
      if (!q) {
        box.hidden = true;
        box.innerHTML = "";
        return;
      }
      var results = window.TFG_SEARCH.search(q);
      box.hidden = false;
      if (results.length) {
        box.innerHTML =
          '<p class="search-count">' + results.length + (results.length === 1 ? " match" : " matches") + " on The Family Ground</p>" +
          results.map(resultCard).join("");
      } else {
        box.innerHTML =
          '<div class="search-empty">' +
            "<p><b>Nothing on the site matches that yet.</b></p>" +
            "<p>Try one of these instead:</p>" +
            '<div class="search-chips">' +
              '<button type="button" class="chip" data-search-chip="screen time">screen time</button>' +
              '<button type="button" class="chip" data-search-chip="chores">chores</button>' +
              '<button type="button" class="chip" data-search-chip="family meeting">family meeting</button>' +
              '<button type="button" class="chip" data-search-chip="waking up for school">waking up for school</button>' +
            "</div>" +
          "</div>";
      }
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      run();
    });
    input.addEventListener("input", run);

    // Quick-pick chips (including any rendered later inside the empty state)
    document.addEventListener("click", function (event) {
      var chip = event.target.closest ? event.target.closest("[data-search-chip]") : null;
      if (!chip) return;
      input.value = chip.getAttribute("data-search-chip");
      run();
      input.focus();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      renderNewsline();
      initSearch();
    });
  } else {
    renderNewsline();
    initSearch();
  }
})();
