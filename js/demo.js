/* The Family Ground — mission demo animator.
   Shows kids how a mission works: two dots trace the left/right paths
   at the same time, looping. Paths come from generator/export_paths.py
   JSON so every future mechanic gets its demo automatically.

   Usage:
     TFGDemo.render(document.getElementById("demoBox"), pathData);
   where pathData = the parsed JSON for a mechanic+age band.
*/
(function () {
  var TRACE = "#B9C2BB", FOREST = "#12503F", GOLD = "#C69420";

  function ptsToPath(pts) {
    return "M" + pts.map(function (p) { return p[0] + "," + p[1]; }).join(" L");
  }

  function starPoints(cx, cy, r) {
    var s = [];
    for (var i = 0; i < 10; i++) {
      var a = Math.PI / 2 + i * Math.PI / 5;
      var rad = (i % 2 === 0) ? r : r * 0.45;
      s.push((cx + rad * Math.cos(a)).toFixed(1) + "," + (cy + rad * Math.sin(a)).toFixed(1));
    }
    return s.join(" ");
  }

  function markersSVG(markers) {
    return markers.map(function (m) {
      if (m.kind === "dot") {
        return '<circle cx="' + m.x + '" cy="' + m.y + '" r="15" fill="#fff" stroke="' + FOREST + '" stroke-width="2.5"/>' +
          '<text x="' + m.x + '" y="' + (m.y + 5) + '" text-anchor="middle" font-size="14" font-weight="bold" fill="' + FOREST + '">' + m.label + "</text>";
      }
      if (m.kind === "star") {
        return '<polygon points="' + starPoints(m.x, m.y, 14) + '" fill="none" stroke="' + FOREST + '" stroke-width="2.5"/>';
      }
      if (m.kind === "x") {
        var s = 14;
        return '<line x1="' + (m.x - s) + '" y1="' + (m.y - s) + '" x2="' + (m.x + s) + '" y2="' + (m.y + s) + '" stroke="' + GOLD + '" stroke-width="5" stroke-linecap="round"/>' +
          '<line x1="' + (m.x - s) + '" y1="' + (m.y + s) + '" x2="' + (m.x + s) + '" y2="' + (m.y - s) + '" stroke="' + GOLD + '" stroke-width="5" stroke-linecap="round"/>';
      }
      return "";
    }).join("");
  }

  function handSVG(label, pts, markers, dotColor, pillBg, pillFg) {
    var d = ptsToPath(pts);
    var dur = Math.min(9, Math.max(4, 4 + pts.length / 45));
    return '<div style="flex:1;min-width:220px;text-align:center;">' +
      '<p style="margin:0 0 6px;"><span style="display:inline-block;background:' + pillBg + ";color:" + pillFg +
      ';font-weight:800;font-size:.8rem;padding:6px 18px;border-radius:99px;">' + label + "</span></p>" +
      '<svg viewBox="0 0 400 300" style="width:100%;background:#fff;border:2px solid #E4E0D2;border-radius:14px;" role="img" aria-label="' + label + ' demo">' +
      '<path d="' + d + '" stroke="' + TRACE + '" stroke-width="11" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
      markersSVG(markers) +
      '<circle r="11" fill="' + dotColor + '" stroke="#fff" stroke-width="3">' +
      '<animateMotion dur="' + dur.toFixed(1) + 's" repeatCount="indefinite" path="' + d + '"/>' +
      "</circle></svg></div>";
  }

  window.TFGDemo = {
    render: function (el, data) {
      el.innerHTML =
        '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
        handSVG("LEFT HAND", data.left, data.left_markers || [], FOREST, FOREST, "#F7F3EA") +
        handSVG("RIGHT HAND", data.right, data.right_markers || [], GOLD, "#8FBC9F", FOREST) +
        "</div>" +
        '<p class="small muted" style="text-align:center;margin:8px 0 0;">Watch the dots — then grab your pencils and copy them!</p>';
    }
  };
})();
