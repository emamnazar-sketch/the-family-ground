/* ============================================================
   The Family Ground — homepage: local activities search
   Free data, no API keys, all calls happen in the visitor's
   browser:
   - Geocoding: OpenStreetMap Nominatim
   - Places:    OpenStreetMap via the Overpass API
   - Weather:   api.weather.gov (National Weather Service, US)
   Place data © OpenStreetMap contributors (shown by results).
   ============================================================ */
(function () {
  "use strict";

  var RADIUS_M = 15000; /* about 9 miles */
  var PER_CATEGORY = 25;
  var MAX_CARDS = 30;
  var OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
  ];

  var CATEGORIES = [
    { key: "park", label: "Park", clauses: ['nwr["leisure"="park"]'] },
    { key: "playground", label: "Playground", clauses: ['nwr["leisure"="playground"]'] },
    { key: "library", label: "Library", clauses: ['nwr["amenity"="library"]'] },
    {
      key: "pool",
      label: "Swimming pool",
      clauses: [
        'nwr["leisure"="swimming_pool"]["access"!~"private|no"]',
        'nwr["amenity"="public_bath"]'
      ]
    },
    { key: "museum", label: "Museum", clauses: ['nwr["tourism"="museum"]'] },
    { key: "community", label: "Community centre", clauses: ['nwr["amenity"="community_centre"]'] }
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

  function categoryOf(tags) {
    if (!tags) return null;
    if (tags.leisure === "park") return "park";
    if (tags.leisure === "playground") return "playground";
    if (tags.amenity === "library") return "library";
    if (tags.leisure === "swimming_pool" || tags.amenity === "public_bath") return "pool";
    if (tags.tourism === "museum") return "museum";
    if (tags.amenity === "community_centre") return "community";
    return null;
  }

  function categoryLabel(key) {
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].key === key) return CATEGORIES[i].label;
    }
    return key;
  }

  function addressOf(tags) {
    if (!tags) return "";
    var line1 = "";
    if (tags["addr:housenumber"] || tags["addr:street"]) {
      line1 = ((tags["addr:housenumber"] || "") + " " + (tags["addr:street"] || "")).trim();
    }
    var city = tags["addr:city"] || tags["addr:town"] || tags["addr:village"] || "";
    if (line1 && city) return line1 + ", " + city;
    return line1 || city || "";
  }

  function buildOverpassQuery(lat, lon) {
    var around = "(around:" + RADIUS_M + "," + lat + "," + lon + ")";
    var parts = ["[out:json][timeout:25];"];
    CATEGORIES.forEach(function (cat) {
      cat.clauses.forEach(function (clause) {
        parts.push(clause + around + ";");
      });
      parts.push("out center " + PER_CATEGORY + ";");
    });
    return parts.join("\n");
  }

  function fetchPlaces(lat, lon, endpointIdx) {
    var query = buildOverpassQuery(lat, lon);
    return fetchWithTimeout(OVERPASS_ENDPOINTS[endpointIdx], {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: "data=" + encodeURIComponent(query)
    }, 45000).then(function (res) {
      if (!res.ok) throw new Error("overpass " + res.status);
      return res.json();
    }).catch(function (err) {
      if (endpointIdx + 1 < OVERPASS_ENDPOINTS.length) {
        return fetchPlaces(lat, lon, endpointIdx + 1);
      }
      throw err;
    });
  }

  function toPlaces(data, lat, lon) {
    var seen = {};
    var places = [];
    (data.elements || []).forEach(function (el) {
      var id = el.type + "/" + el.id;
      if (seen[id]) return;
      var elLat = el.lat != null ? el.lat : (el.center && el.center.lat);
      var elLon = el.lon != null ? el.lon : (el.center && el.center.lon);
      if (elLat == null || elLon == null) return;
      var cat = categoryOf(el.tags);
      if (!cat) return;
      seen[id] = true;
      places.push({
        name: (el.tags && el.tags.name) || categoryLabel(cat),
        category: cat,
        distance: distanceMi(lat, lon, elLat, elLon),
        address: addressOf(el.tags),
        lat: elLat,
        lon: elLon
      });
    });
    places.sort(function (a, b) { return a.distance - b.distance; });
    return places;
  }

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

  function renderResults(box, state) {
    var html = "";
    html += '<p class="search-count">Family places near ' + esc(state.placeName) + "</p>";

    if (state.weather && state.weather.length) {
      html += '<div class="weather-strip"><p class="weather-head">Weather for getting out</p>';
      state.weather.forEach(function (p) {
        html += '<p class="weather-line"><b>' + esc(p.name) + ":</b> " +
          esc(p.shortForecast) + ", " + esc(p.temperature) + "&deg;" + esc(p.temperatureUnit) + "</p>";
      });
      html += '<p class="weather-credit">Forecast from the National Weather Service</p></div>';
    }

    var counts = {};
    state.places.forEach(function (p) { counts[p.category] = (counts[p.category] || 0) + 1; });
    var filterable = CATEGORIES.filter(function (c) { return counts[c.key]; });
    if (filterable.length > 1) {
      html += '<div class="search-chips place-filters" role="group" aria-label="Filter by kind of place">';
      html += '<button type="button" class="chip' + (state.filter === "all" ? " is-active" : "") + '" data-place-filter="all">All (' + state.places.length + ")</button>";
      filterable.forEach(function (c) {
        html += '<button type="button" class="chip' + (state.filter === c.key ? " is-active" : "") +
          '" data-place-filter="' + c.key + '">' + esc(c.label) + " (" + counts[c.key] + ")</button>";
      });
      html += "</div>";
    }

    var shown = state.places.filter(function (p) {
      return state.filter === "all" || p.category === state.filter;
    }).slice(0, MAX_CARDS);

    if (!shown.length) {
      html += '<div class="search-empty"><p><b>Nothing in that group nearby.</b></p>' +
        "<p>Try a different kind of place above.</p></div>";
    } else {
      html += shown.map(placeCard).join("");
    }
    html += '<p class="place-attrib">Place data &copy; OpenStreetMap contributors &middot; Distances are straight-line, as the crow flies</p>';
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

    var state = { places: [], weather: null, placeName: "", filter: "all" };

    function search(lat, lon, placeName) {
      state = { places: [], weather: null, placeName: placeName, filter: "all" };
      box.hidden = false;
      box.innerHTML = '<p class="activity-status">Looking for parks, playgrounds, libraries and more near ' +
        esc(placeName) + "&hellip;</p>";
      var weatherDone = fetchWeather(lat, lon).then(function (periods) {
        state.weather = periods;
      }).catch(function () { state.weather = null; });
      fetchPlaces(lat, lon, 0).then(function (data) {
        state.places = toPlaces(data, lat, lon);
        if (!state.places.length) {
          renderMessage(box,
            "Nothing showed up near " + placeName + ".",
            "The map volunteers may not have added your area yet. Try a bigger nearby town — or search our guides instead, they work everywhere.");
          return;
        }
        renderResults(box, state);
        weatherDone.then(function () {
          if (state.places.length) renderResults(box, state);
        });
      }).catch(function () {
        renderMessage(box,
          "The activity finder could not load just now.",
          "The free map service is busy or unreachable. Give it a minute and try again — or search our guides instead, they always work.");
      });
    }

    actForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var q = input.value.trim();
      if (!q) {
        renderMessage(box, "Type a town or a ZIP code first.", "For example: Sacramento, or 95814.");
        return;
      }
      box.hidden = false;
      box.innerHTML = '<p class="activity-status">Finding ' + esc(q) + "&hellip;</p>";
      fetchWithTimeout(
        "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" + encodeURIComponent(q),
        { headers: { "Accept": "application/json" } }, 15000
      ).then(function (res) {
        if (!res.ok) throw new Error("nominatim " + res.status);
        return res.json();
      }).then(function (results) {
        if (!results || !results.length) {
          renderMessage(box,
            "We could not find that place.",
            "Check the spelling, or try the nearest bigger town plus your state — like “Springfield, IL”.");
          return;
        }
        var top = results[0];
        var name = (top.display_name || q).split(",").slice(0, 2).join(",");
        search(parseFloat(top.lat), parseFloat(top.lon), name);
      }).catch(function () {
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
      var chip = event.target.closest ? event.target.closest("[data-place-filter]") : null;
      if (!chip) return;
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
