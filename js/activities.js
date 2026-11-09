/* ============================================================
   The Family Ground — homepage: local activities search
   Free data, no API keys:
   - Geocoding: OpenStreetMap Nominatim (limit=5; administrative
     matches like counties are dropped when a real town matches,
     and same-name towns in different states get a chooser)
   - Places:    our own static index of U.S. family places, built
     from OpenStreetMap data and hosted on this site as small
     map tiles (see scripts/activities-index/). A search fetches
     the 1-4 tiles around the town from our own pages — no live
     map server is involved, so answers come back in about a
     second. The index is rebuilt monthly.
   - Cache:     each town's results are saved on the phone for a
     day, so repeat searches show results instantly
   - Weather:   api.weather.gov (National Weather Service, US)
   Place data © OpenStreetMap contributors (shown by results).
   ============================================================ */
(function () {
  "use strict";

  var RADIUS_M = 12000; /* about 7.5 miles */
  var RADIUS_MI = RADIUS_M / 1609.344;
  var MAX_CARDS = 30;
  var CACHE_TTL_MS = 24 * 60 * 60 * 1000; /* 24 hours */
  var TILE_BASE = "/data/places/";

  var CATEGORIES = [
    { key: "park", label: "Park", plural: "parks" },
    { key: "playground", label: "Playground", plural: "playgrounds" },
    { key: "library", label: "Library", plural: "libraries" },
    { key: "pool", label: "Swimming pool", plural: "pools" },
    { key: "museum", label: "Museum", plural: "museums" },
    { key: "community", label: "Community centre", plural: "community centres" }
  ];

  /* Short category codes used inside the tile files. */
  var CODE_TO_CATEGORY = {
    park: "park",
    play: "playground",
    lib: "library",
    pool: "pool",
    mus: "museum",
    comm: "community"
  };

  /* Nominatim addresstype values that mean an actual place people
     live in / go to — as opposed to an administrative area like a
     county or a state, which shares the name but is not the town. */
  var POPULATED_TYPES = [
    "city", "town", "village", "hamlet", "suburb", "neighbourhood",
    "borough", "municipality", "locality", "isolated_dwelling"
  ];

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fetchWithTimeout(url, options, ms) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, ms);
    options = options || {};
    options.signal = controller.signal;
    return fetch(url, options).finally(function () { clearTimeout(timer); });
  }

  function distanceMi(lat1, lon1, lat2, lon2) {
    var R = 3958.8;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function categoryByKey(key) {
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].key === key) return CATEGORIES[i];
    }
    return null;
  }

  function categoryLabel(key) {
    var cat = categoryByKey(key);
    return cat ? cat.label : key;
  }

  /* ---------------- Places: our own static tiles ----------------
     The index is sliced into 0.5° x 0.5° cells named by their
     south-west corner indices: la<floor(lat*2)>_lo<floor(lon*2)>.
     A 12 km search circle touches 1-4 cells; each is a small JSON
     file of [name, categoryCode, lat, lon, address] rows. Cells
     with no places have no file — a 404 just means "empty cell". */

  var indexMonth = null; /* filled lazily from the index manifest */

  function loadIndexMonth() {
    fetch(TILE_BASE + "manifest.json").then(function (res) {
      if (!res.ok) throw new Error("manifest " + res.status);
      return res.json();
    }).then(function (m) {
      if (m && m.month) indexMonth = m.month;
    }).catch(function () { /* freshness line is a bonus; skip it */ });
  }

  function cellsCovering(lat, lon) {
    var dLat = RADIUS_M / 111000;
    var cos = Math.max(Math.cos(lat * Math.PI / 180), 0.2);
    var dLon = dLat / cos;
    var la0 = Math.floor((lat - dLat) * 2), la1 = Math.floor((lat + dLat) * 2);
    var lo0 = Math.floor((lon - dLon) * 2), lo1 = Math.floor((lon + dLon) * 2);
    var cells = [];
    for (var la = la0; la <= la1; la++) {
      for (var lo = lo0; lo <= lo1; lo++) {
        cells.push([la, lo]);
      }
    }
    return cells;
  }

  function fetchTile(cell) {
    var url = TILE_BASE + "la" + cell[0] + "_lo" + cell[1] + ".json";
    return fetchWithTimeout(url, {}, 15000).then(function (res) {
      if (res.status === 404) return [];
      if (!res.ok) throw new Error("tile " + res.status);
      return res.json();
    });
  }

  /* Fetch every covering tile and merge the rows into places.
     Rejects only when every tile failed with a real error (a 404
     is an empty cell, not an error). */
  function fetchPlaces(lat, lon) {
    var cells = cellsCovering(lat, lon);
    var errors = 0;
    var jobs = cells.map(function (cell) {
      return fetchTile(cell).catch(function () {
        errors++;
        return null;
      });
    });
    return Promise.all(jobs).then(function (tileRows) {
      if (errors === cells.length) throw new Error("tiles failed");
      var places = [];
      tileRows.forEach(function (rows) {
        if (!rows) return;
        rows.forEach(function (row) {
          var cat = CODE_TO_CATEGORY[row[1]];
          if (!cat) return;
          var pLat = row[2], pLon = row[3];
          var dist = distanceMi(lat, lon, pLat, pLon);
          if (dist > RADIUS_MI + 0.02) return;
          places.push({
            name: row[0] || categoryLabel(cat),
            category: cat,
            distance: dist,
            address: row[4] || "",
            lat: pLat,
            lon: pLon
          });
        });
      });
      places.sort(function (a, b) { return a.distance - b.distance; });
      return places;
    });
  }

  /* ---------------- On-phone cache (localStorage, 24h) ---------------- */

  function cacheKey(lat, lon) {
    return "tfg-act2:" + lat.toFixed(2) + "," + lon.toFixed(2);
  }

  function cacheRead(lat, lon) {
    try {
      var raw = window.localStorage.getItem(cacheKey(lat, lon));
      if (!raw) return null;
      var entry = JSON.parse(raw);
      if (!entry || !entry.t || (Date.now() - entry.t) > CACHE_TTL_MS) return null;
      if (!Array.isArray(entry.places)) return null;
      /* Distances were measured from the day-old search centre;
         re-measure against today's so they stay honest. */
      return entry.places.map(function (p) {
        return {
          name: p.name, category: p.category, address: p.address,
          lat: p.lat, lon: p.lon,
          distance: distanceMi(lat, lon, p.lat, p.lon)
        };
      }).filter(function (p) { return p.distance <= RADIUS_MI + 0.02; });
    } catch (e) {
      return null;
    }
  }

  function cacheWrite(lat, lon, places) {
    try {
      window.localStorage.setItem(
        cacheKey(lat, lon),
        JSON.stringify({ t: Date.now(), places: places })
      );
    } catch (e) {
      /* Storage blocked or full — the cache is a bonus, never required. */
    }
  }

  /* ---------------- Weather ---------------- */

  function fetchWeather(lat, lon) {
    return fetchWithTimeout(
      "https://api.weather.gov/points/" + lat.toFixed(4) + "," + lon.toFixed(4),
      { headers: { "Accept": "application/geo+json" } }, 10000
    ).then(function (res) {
      if (!res.ok) throw new Error("points " + res.status);
      return res.json();
    }).then(function (points) {
      var url = points && points.properties && points.properties.forecast;
      if (!url) throw new Error("no forecast url");
      return fetchWithTimeout(url, { headers: { "Accept": "application/geo+json" } }, 10000);
    }).then(function (res) {
      if (!res.ok) throw new Error("forecast " + res.status);
      return res.json();
    }).then(function (data) {
      var periods = (data.properties && data.properties.periods) || [];
      return periods.slice(0, 2);
    });
  }

  /* ---------------- Rendering ---------------- */

  function placeCard(place) {
    var dist = place.distance < 0.1 ? "under 0.1 mi" : place.distance.toFixed(1) + " mi away";
    var mapUrl = "https://www.google.com/maps/search/?api=1&query=" +
      encodeURIComponent(place.name + " @" + place.lat + "," + place.lon);
    return (
      '<article class="result-card place-card">' +
        '<span class="result-source">' + esc(categoryLabel(place.category)) + " &middot; " + esc(dist) + "</span>" +
        '<span class="result-title">' + esc(place.name) + "</span>" +
        (place.address ? '<span class="result-desc">' + esc(place.address) + "</span>" : "") +
        '<a class="place-map" href="' + esc(mapUrl) + '" target="_blank" rel="noopener">See it on a map &rarr;</a>' +
      "</article>"
    );
  }

  function collectPlaces(state) {
    var all = [];
    CATEGORIES.forEach(function (cat) {
      (state.byCat[cat.key] || []).forEach(function (p) { all.push(p); });
    });
    all.sort(function (a, b) { return a.distance - b.distance; });
    return all;
  }

  function groupByCat(places) {
    var byCat = {};
    places.forEach(function (p) {
      if (!byCat[p.category]) byCat[p.category] = [];
      byCat[p.category].push(p);
    });
    return byCat;
  }

  /* One renderer for every stage of the search: cached cards first,
     then the fresh tile results swap in when they land. */
  function renderResults(box, state) {
    var places = collectPlaces(state);
    var done = !state.pending;
    var html = "";
    html += '<p class="search-count">Family places near ' + esc(state.placeName) + "</p>";

    if (state.weather && state.weather.length && (places.length || done)) {
      html += '<div class="weather-strip"><p class="weather-head">Weather for getting out</p>';
      state.weather.forEach(function (p) {
        html += '<p class="weather-line"><b>' + esc(p.name) + ":</b> " +
          esc(p.shortForecast) + ", " + esc(p.temperature) + "&deg;" + esc(p.temperatureUnit) + "</p>";
      });
      html += '<p class="weather-credit">Forecast from the National Weather Service</p></div>';
    }

    if (places.length) {
      var counts = {};
      places.forEach(function (p) { counts[p.category] = (counts[p.category] || 0) + 1; });
      var filterable = CATEGORIES.filter(function (c) { return counts[c.key]; });
      if (filterable.length > 1) {
        html += '<div class="search-chips place-filters" role="group" aria-label="Filter by kind of place">';
        html += '<button type="button" class="chip' + (state.filter === "all" ? " is-active" : "") + '" data-place-filter="all">All (' + places.length + ")</button>";
        filterable.forEach(function (c) {
          html += '<button type="button" class="chip' + (state.filter === c.key ? " is-active" : "") +
            '" data-place-filter="' + c.key + '">' + esc(c.label) + " (" + counts[c.key] + ")</button>";
        });
        html += "</div>";
      }

      var shown = places.filter(function (p) {
        return state.filter === "all" || p.category === state.filter;
      }).slice(0, MAX_CARDS);

      if (!shown.length) {
        html += '<div class="search-empty"><p><b>Nothing in that group nearby.</b></p>' +
          "<p>Try a different kind of place above.</p></div>";
      } else {
        html += shown.map(placeCard).join("");
      }
    } else if (!done) {
      html += '<p class="activity-status">Looking for parks, playgrounds, libraries and more near ' +
        esc(state.placeName) + "&hellip;</p>";
    } else if (state.loadError) {
      html += '<div class="search-empty"><p><b>The activity finder could not load just now.</b></p>' +
        "<p>Something went wrong loading the places list. Check your connection, give it a moment and try again — or search our guides instead, they always work.</p>" +
        '<div class="search-chips"><button type="button" class="chip" data-retry-failed="1">Try again</button></div></div>';
    } else {
      html += '<div class="search-empty"><p><b>Nothing showed up near ' + esc(state.placeName) + ".</b></p>" +
        "<p>The map volunteers may not have added your area yet. Try a bigger nearby town — or search our guides instead, they work everywhere.</p></div>";
    }

    if (places.length) {
      html += '<p class="place-attrib">Place data &copy; OpenStreetMap contributors' +
        (indexMonth ? " &middot; U.S. index updated " + esc(indexMonth) : "") +
        " &middot; Distances are straight-line, as the crow flies</p>";
    }
    box.innerHTML = html;
  }

  function renderMessage(box, title, body) {
    box.hidden = false;
    box.innerHTML =
      '<div class="search-empty"><p><b>' + esc(title) + "</b></p><p>" + esc(body) + "</p></div>";
  }

  /* ---------------- Search flow ---------------- */

  function init() {
    var guidesForm = document.getElementById("site-search");
    var actForm = document.getElementById("activity-search");
    var input = document.getElementById("activity-input");
    var box = document.getElementById("activity-results");
    var locateBtn = document.getElementById("activity-locate");
    if (!actForm || !input || !box) return;

    loadIndexMonth();

    /* Mode toggle */
    var modeBtns = document.querySelectorAll("[data-mode]");
    modeBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var mode = btn.getAttribute("data-mode");
        modeBtns.forEach(function (b) {
          var active = b === btn;
          b.classList.toggle("is-active", active);
          b.setAttribute("aria-selected", active ? "true" : "false");
        });
        if (guidesForm) guidesForm.hidden = mode !== "guides";
        actForm.hidden = mode !== "activities";
        if (mode === "activities") input.focus();
      });
    });

    var searchToken = 0; /* stale async work checks this before touching the page */
    var state = null;
    var pendingChoices = null;
    var lastSearch = null;

    function search(lat, lon, placeName) {
      var token = ++searchToken;
      pendingChoices = null;
      lastSearch = { lat: lat, lon: lon, placeName: placeName };
      state = {
        lat: lat, lon: lon, placeName: placeName,
        byCat: {}, weather: state ? state.weather : null, filter: "all",
        pending: true, loadError: false
      };
      box.hidden = false;

      /* Instant first paint: anything saved on this phone in the
         last day shows up before the network answers at all. */
      var cached = cacheRead(lat, lon);
      if (cached && cached.length) state.byCat = groupByCat(cached);
      renderResults(box, state);

      fetchWeather(lat, lon).then(function (periods) {
        if (token !== searchToken || !state) return;
        state.weather = periods;
        renderResults(box, state);
      }).catch(function () { /* weather is a bonus; places carry on without it */ });

      fetchPlaces(lat, lon).then(function (places) {
        if (token !== searchToken || !state) return;
        cacheWrite(lat, lon, places);
        state.byCat = groupByCat(places);
        state.pending = false;
        renderResults(box, state);
      }).catch(function () {
        if (token !== searchToken || !state) return;
        state.pending = false;
        /* A failed refresh never removes cached cards already shown. */
        if (!collectPlaces(state).length) state.loadError = true;
        renderResults(box, state);
      });
    }

    function retryFailed() {
      if (lastSearch) search(lastSearch.lat, lastSearch.lon, lastSearch.placeName);
    }

    /* -------- Geocoding: pick the town, not the county -------- */

    function resultLabel(r) {
      var parts = (r.display_name || "").split(",").map(function (s) { return s.trim(); });
      var statePart = (r.address && r.address.state) ||
        (parts.length >= 3 ? parts[parts.length - 2] : parts[1]);
      return statePart ? parts[0] + ", " + statePart : parts[0];
    }

    function renderChooser(queryName, candidates) {
      pendingChoices = candidates.map(function (r) {
        return {
          label: resultLabel(r),
          lat: parseFloat(r.lat),
          lon: parseFloat(r.lon)
        };
      });
      box.hidden = false;
      var html = '<div class="search-empty"><p><b>Which ' + esc(queryName) + " did you mean?</b></p>" +
        '<div class="search-chips" role="group" aria-label="Choose your town">';
      pendingChoices.forEach(function (choice, i) {
        html += '<button type="button" class="chip" data-place-choice="' + i + '">' + esc(choice.label) + "</button>";
      });
      html += "</div></div>";
      box.innerHTML = html;
    }

    function pickFromGeocode(q, results) {
      var direct = /^\d{5}(-\d{4})?$/.test(q) || q.indexOf(",") !== -1;
      if (direct || results.length === 1) return { pick: results[0] };

      var populated = results.filter(function (r) {
        return POPULATED_TYPES.indexOf(r.addresstype) !== -1;
      });
      /* Counties and states share town names but are not towns —
         they only get used when nothing populated matched at all. */
      var pool = populated.length ? populated : results;
      if (pool.length === 1) return { pick: pool[0] };

      var states = {};
      pool.forEach(function (r) {
        var st = (r.address && r.address.state) || resultLabel(r);
        states[st] = true;
      });
      if (Object.keys(states).length === 1) return { pick: pool[0] };

      /* Same name, different states: ask, don't guess. */
      var seen = {};
      var unique = pool.filter(function (r) {
        var label = resultLabel(r);
        if (seen[label]) return false;
        seen[label] = true;
        return true;
      });
      return { choices: unique };
    }

    actForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var q = input.value.trim();
      if (!q) {
        renderMessage(box, "Type a town or a ZIP code first.", "For example: Sacramento, or 95814.");
        return;
      }
      var token = ++searchToken;
      pendingChoices = null;
      state = null;
      box.hidden = false;
      box.innerHTML = '<p class="activity-status">Finding ' + esc(q) + "&hellip;</p>";
      fetchWithTimeout(
        "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=us&addressdetails=1&q=" + encodeURIComponent(q),
        { headers: { "Accept": "application/json" } }, 15000
      ).then(function (res) {
        if (!res.ok) throw new Error("nominatim " + res.status);
        return res.json();
      }).then(function (results) {
        if (token !== searchToken) return;
        if (!results || !results.length) {
          renderMessage(box,
            "We could not find that place.",
            "Check the spelling, or try the nearest bigger town plus your state — like “Springfield, IL”.");
          return;
        }
        var decision = pickFromGeocode(q, results);
        if (decision.choices) {
          renderChooser(q, decision.choices);
          return;
        }
        var top = decision.pick;
        var name = (top.display_name || q).split(",").slice(0, 2).join(",");
        search(parseFloat(top.lat), parseFloat(top.lon), name);
      }).catch(function () {
        if (token !== searchToken) return;
        renderMessage(box,
          "The town lookup could not load just now.",
          "Give it a minute and try again — or use the “Use my location instead” button below if you are already there.");
      });
    });

    if (locateBtn) {
      locateBtn.addEventListener("click", function () {
        if (!navigator.geolocation) {
          renderMessage(box, "This browser cannot share a location.", "Type your town or ZIP code above instead — that works just as well.");
          return;
        }
        box.hidden = false;
        box.innerHTML = '<p class="activity-status">Asking your browser for your location&hellip;</p>';
        navigator.geolocation.getCurrentPosition(function (pos) {
          search(pos.coords.latitude, pos.coords.longitude, "you");
        }, function () {
          renderMessage(box, "We could not get your location.", "No problem — type your town or ZIP code above and we will look there instead.");
        }, { timeout: 12000, maximumAge: 300000 });
      });
    }

    box.addEventListener("click", function (event) {
      var target = event.target.closest ? event.target : null;
      if (!target) return;

      var choice = target.closest("[data-place-choice]");
      if (choice && pendingChoices) {
        var picked = pendingChoices[parseInt(choice.getAttribute("data-place-choice"), 10)];
        pendingChoices = null;
        if (picked) search(picked.lat, picked.lon, picked.label);
        return;
      }

      if (target.closest("[data-retry-failed]")) {
        retryFailed();
        return;
      }

      var chip = target.closest("[data-place-filter]");
      if (!chip || !state) return;
      state.filter = chip.getAttribute("data-place-filter");
      renderResults(box, state);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
