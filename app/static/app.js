/* ReRouter UI — talks to app/server.py (Flask) which serves the CE-2 models. */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const COLORS = { Low: "#34d399", Medium: "#fbbf24", High: "#f87171", Clear: "#fbbf24", Rain: "#60a5fa", Fog: "#94a3b8" };
  const FAST = "#22d3ee", SHORT = "#c4b5fd";
  const WEATHER_ICON = {
    Clear: '<svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    Rain: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M20 15a4 4 0 0 0-3-7 6 6 0 0 0-11.5 2A3.5 3.5 0 0 0 6 17h11"/><path d="M8 19l-1 2M12 19l-1 2M16 19l-1 2"/></svg>',
    Fog: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 9h16M3 13h18M5 17h14"/></svg>',
  };
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const FIG_TITLES = {
    "01": "Hourly speed & corrected peak hours", "02": "Traffic × weather mean speed", "03": "Simple linear regression",
    "04": "Regression models: 5-fold CV", "05": "Bias–variance: tree depth", "06": "Final regression diagnostics",
    "07": "Confusion matrices (default)", "08": "KNN: choosing k", "09": "Confusion matrices (balanced)",
    "10": "K-Means elbow & silhouette", "11": "K-Means zones (k = 8)", "12": "Hierarchical dendrogram",
    "13": "DBSCAN", "14": "Association rules", "15": "PCA", "16": "Shortest vs fastest route",
    "17": "Q-learning convergence", "18": "Departure-time recommender",
  };

  const state = {
    meta: null,
    route: { src: 1, dst: 7, hour: 12, weather: "Clear", seed: 1, overrides: {}, pickNext: "src", last: null },
    speed: { traffic: "High", weather: "Rain", vehicle: "Car", hour: 9, day: 2, distance: 15 },
    depart: { distance: 15, weather: "Rain", hour: 9, window: 2 },
  };

  // ------------------------------------------------------------------ utils
  async function api(path, body) {
    const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 5000);
  }
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const fmtHour = (h) => `${String(h).padStart(2, "0")}:00`;
  const fmtHour12 = (h) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
  function fmtMin(m) {
    const t = Math.round(m);
    if (t < 60) return `${t} min`;
    const h = Math.floor(t / 60), r = t % 60;
    return r ? `${h} h ${r} min` : `${h} h`;
  }
  const fmtKm = (k) => `${k.toFixed(1)} km`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pathHTML = (p) => p.map((z) => `<span class="z">Z${z}</span>`).join('<span class="arr">→</span>');
  const pairKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const pathEdges = (p) => new Set(p.slice(1).map((z, i) => pairKey(p[i], z)));
  const peakPill = (h) => (state.meta.peak_hours.includes(h) ? ' <span class="pill warn">peak</span>' : "");
  const speedColor = (v) => (v < 25 ? COLORS.High : v < 35 ? COLORS.Medium : COLORS.Low);
  function heatColor(v, lo, hi) {
    // red (slow) -> amber -> green (fast)
    const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)));
    const stops = [[248, 113, 113], [251, 191, 36], [52, 211, 153]];
    const seg = t < 0.5 ? 0 : 1, f = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
    const c = stops[seg].map((x, i) => Math.round(x + (stops[seg + 1][i] - x) * f));
    return `rgb(${c.join(",")})`;
  }
  function segmented(el, options, value, onChange, render) {
    el.innerHTML = "";
    options.forEach((opt) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.value = opt;
      b.innerHTML = render ? render(opt) : esc(opt);
      if (String(opt) === String(value)) b.classList.add("on");
      b.addEventListener("click", () => {
        el.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
        onChange(opt);
      });
      el.appendChild(b);
    });
  }
  const setSeg = (el, value) => el.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.value === String(value)));

  // Chart.js defaults to match the dark theme
  Chart.defaults.color = "#a9b6cf";
  Chart.defaults.borderColor = "rgba(42,58,92,.55)";
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = 11.5;
  Chart.defaults.plugins.legend.labels.boxWidth = 10;
  Chart.defaults.plugins.legend.labels.boxHeight = 10;
  Chart.defaults.plugins.tooltip.backgroundColor = "rgba(11,18,32,.96)";
  Chart.defaults.plugins.tooltip.borderColor = "#2a3a5c";
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.maintainAspectRatio = false;
  const charts = {};
  function chart(id, config) {
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(document.getElementById(id), config);
    return charts[id];
  }

  // ------------------------------------------------------------------- tabs
  function showView(name) {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
    if (name === "route" && map) setTimeout(() => { map.invalidateSize(); if (!mapFitted) fitMap(); }, 50);
    if (location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
    requestAnimationFrame(() => Object.values(charts).forEach((c) => c.resize()));
  }
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => showView(t.dataset.view)));

  // ===================================================================== MAP
  let map, roadLayer, routeLayer, labelLayer, zoneLayer, mapFitted = false;
  const zoneMarkers = {};

  function fitMap() {
    const el = document.getElementById("map");
    if (!el.clientWidth) return;
    map.fitBounds(L.latLngBounds(state.meta.zones.map((z) => [z.lat, z.lon])), { paddingTopLeft: [60, 50], paddingBottomRight: [60, 120] });
    mapFitted = true;
  }

  function initMap() {
    const zones = state.meta.zones;
    map = L.map("map", { zoomControl: true, attributionControl: true, zoomSnap: 0.25 });
    // keyless dark basemap; if offline the network still renders on the plain background
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Tiles &copy; Esri", maxZoom: 16,
    }).addTo(map);
    map.setView([zones[0].lat, zones[0].lon], 9);
    fitMap();
    roadLayer = L.layerGroup().addTo(map);
    routeLayer = L.layerGroup().addTo(map);
    labelLayer = L.layerGroup().addTo(map);
    zoneLayer = L.layerGroup().addTo(map);

    zones.forEach((z) => {
      const m = L.marker([z.lat, z.lon], {
        icon: L.divIcon({ className: "zone-icon", html: `<div class="zone" data-zone="${z.id}">Z${z.id}</div>`, iconSize: [36, 36], iconAnchor: [18, 18] }),
        riseOnHover: true, keyboard: true, title: `Zone ${z.id}`, zIndexOffset: 1000,
      });
      m.bindTooltip(
        `<div><b>Zone Z${z.id}</b></div><div class="tline"><span>Trips starting here</span><span>${z.trips.toLocaleString()}</span></div>` +
        `<div class="tline"><span>Centre</span><span>${z.lat.toFixed(3)}, ${z.lon.toFixed(3)}</span></div><div class="thint"></div>`,
        { className: "tt", direction: "top", offset: [0, -16] });
      m.on("tooltipopen", (e) => {
        const el = e.tooltip.getElement();
        if (el) el.querySelector(".thint").textContent = `Click to set as ${state.route.pickNext === "src" ? "origin A" : "destination B"}`;
      });
      m.on("click", () => pickZone(z.id));
      m.addTo(zoneLayer);
      zoneMarkers[z.id] = m;
    });
  }

  function pickZone(id) {
    const r = state.route;
    if (r.pickNext === "src") {
      if (id === r.dst) r.dst = r.src;
      r.src = id; r.pickNext = "dst";
    } else {
      if (id === r.src) r.src = r.dst;
      r.dst = id; r.pickNext = "src";
    }
    syncRouteControls();
    loadRoute();
  }

  function syncRouteControls() {
    const r = state.route;
    $("#src").value = r.src; $("#dst").value = r.dst;
    $("#pick-hint").innerHTML = `Map click sets <b>${r.pickNext === "src" ? "origin A" : "destination B"}</b>`;
    $("#r-hour-val").innerHTML = `${fmtHour(r.hour)}${peakPill(r.hour)}`;
    $("#seed-label").textContent = `seed ${r.seed}`;
    const nEdits = Object.keys(r.overrides).length;
    $("#clear-overrides").hidden = !nEdits;
    $("#clear-overrides").textContent = `Clear ${nEdits} edit${nEdits === 1 ? "" : "s"}`;
  }

  function drawNetwork(data) {
    const zones = state.meta.zones;
    const ll = (id) => [zones[id].lat, zones[id].lon];
    const fastSet = data.fastest ? pathEdges(data.fastest.path) : new Set();

    roadLayer.clearLayers(); routeLayer.clearLayers(); labelLayer.clearLayers();
    const showTimes = $("#show-times").checked;

    data.edges.forEach((e) => {
      const coords = [ll(e.a), ll(e.b)];
      const line = L.polyline(coords, { color: COLORS[e.traffic], weight: 6, opacity: 0.7, className: "road" });
      line.bindTooltip(
        `<div><b>Z${e.a} ↔ Z${e.b}</b>${e.overridden ? ' <span class="tag Medium">edited</span>' : ""}</div>` +
        `<div class="tline"><span>Road length</span><span>${fmtKm(e.km)}</span></div>` +
        `<div class="tline"><span>Traffic</span><span style="color:${COLORS[e.traffic]}">${e.traffic}</span></div>` +
        `<div class="tline"><span>Predicted speed</span><span>${e.speed.toFixed(1)} km/h</span></div>` +
        `<div class="tline"><span>Travel time</span><span>${fmtMin(e.minutes)}</span></div>` +
        `<div class="thint">Click to change traffic</div>`,
        { className: "tt", sticky: true });
      line.on("mouseover", () => line.setStyle({ weight: 10, opacity: 0.95 }));
      line.on("mouseout", () => line.setStyle({ weight: 6, opacity: 0.7 }));
      line.on("click", () => cycleTraffic(e));
      line.addTo(roadLayer);
      if (e.overridden) L.polyline(coords, { color: "#fff", weight: 2, opacity: 0.9, dashArray: "2 6", interactive: false }).addTo(roadLayer);

      if (showTimes) {
        const mid = [(coords[0][0] + coords[1][0]) / 2, (coords[0][1] + coords[1][1]) / 2];
        L.marker(mid, { interactive: false, keyboard: false,
          icon: L.divIcon({ className: "time-label", html: `<div class="${fastSet.has(e.id) ? "hl" : ""}">${fmtMin(e.minutes)}</div>`, iconSize: [0, 0] }) }).addTo(labelLayer);
      }
    });

    if (data.fastest) {
      if ($("#show-short").checked && !data.same) {
        L.polyline(data.shortest.path.map(ll), { color: SHORT, weight: 3.5, opacity: 0.95, dashArray: "6 8", className: "route-short", interactive: false }).addTo(routeLayer);
      }
      const pts = data.fastest.path.map(ll);
      L.polyline(pts, { color: FAST, weight: 16, opacity: 0.16, className: "route-glow", interactive: false }).addTo(routeLayer);
      L.polyline(pts, { color: FAST, weight: 4.5, opacity: 1, className: "route-fast", interactive: false }).addTo(routeLayer);
    }

    const onPath = new Set(data.fastest ? data.fastest.path : []);
    Object.entries(zoneMarkers).forEach(([id, m]) => {
      const el = m.getElement() && m.getElement().querySelector(".zone");
      if (!el) return;
      const z = +id;
      el.classList.toggle("src", z === state.route.src);
      el.classList.toggle("dst", z === state.route.dst);
      el.classList.toggle("on-path", onPath.has(z));
      el.dataset.tag = z === state.route.src ? "A" : z === state.route.dst ? "B" : "";
    });
  }

  function cycleTraffic(e) {
    const order = ["Low", "Medium", "High"];
    const r = state.route;
    if (!(e.id in r.overrides)) r.overrides[e.id] = order[(order.indexOf(e.traffic) + 1) % 3];
    else {
      const i = order.indexOf(r.overrides[e.id]);
      if (i === 2) delete r.overrides[e.id]; else r.overrides[e.id] = order[i + 1];
    }
    syncRouteControls();
    loadRoute();
  }

  let routeReq = 0;
  async function loadRoute() {
    const r = state.route, id = ++routeReq;
    $("#route-result").style.opacity = 0.65;
    try {
      const data = await api("/api/route", { src: r.src, dst: r.dst, hour: r.hour, weather: r.weather, seed: r.seed, overrides: r.overrides });
      if (id !== routeReq) return;
      r.last = data;
      drawNetwork(data);
      renderRouteResult(data);
      renderEdgeTable(data);
      updateLegend(r.weather);
      $("#q-pill").textContent = "untrained"; $("#q-pill").className = "pill"; $("#q-result").hidden = true;
    } catch (err) { toast(err.message); }
    finally { if (id === routeReq) $("#route-result").style.opacity = 1; }
  }

  function renderRouteResult(d) {
    const s = $("#saving");
    if (d.error) { s.className = "saving same"; s.innerHTML = `<div class="txt">${esc(d.error)}</div>`; return; }
    if (d.same) {
      s.className = "saving same";
      s.innerHTML = `<div class="big">Same route</div><div class="txt">Under these conditions the shortest road is also the fastest. Try another hour, weather or traffic scenario.</div>`;
    } else {
      s.className = "saving win";
      const extra = d.fastest.km - d.shortest.km;
      s.innerHTML = `<div class="big">−${d.saved_pct.toFixed(0)}%</div><div class="txt">ML route saves <b>${fmtMin(d.saved_min)}</b>` +
        (extra > 0.5 ? ` while being <b>${extra.toFixed(1)} km longer</b>.` : ".") + ` It avoids the congested roads the distance-only route takes.</div>`;
    }
    $("#fast-min").textContent = fmtMin(d.fastest.minutes);
    $("#fast-km").textContent = `${fmtKm(d.fastest.km)} · avg ${(d.fastest.km / d.fastest.minutes * 60).toFixed(1)} km/h`;
    $("#fast-path").innerHTML = pathHTML(d.fastest.path);
    $("#short-min").textContent = fmtMin(d.shortest.minutes);
    $("#short-km").textContent = `${fmtKm(d.shortest.km)} · avg ${(d.shortest.km / d.shortest.minutes * 60).toFixed(1)} km/h`;
    $("#short-path").innerHTML = pathHTML(d.shortest.path);
    const ns = d.network_stats;
    $("#netstat").innerHTML = `Across all <b>${ns.pairs}</b> zone pairs in this scenario, the ML route differs from the shortest in <b>${ns.differ}</b>` +
      (ns.differ ? ` and saves <b>${ns.avg_saving_pct.toFixed(1)} %</b> on average.` : ".") +
      ` Dijkstra settled ${d.fastest.explored.map((z) => "Z" + z).join(" → ")} before reaching the destination.`;
  }

  function renderEdgeTable(d) {
    const fast = d.fastest ? pathEdges(d.fastest.path) : new Set();
    const rows = [...d.edges].sort((x, y) => x.minutes - y.minutes).map((e) =>
      `<tr class="${fast.has(e.id) ? "best" : ""}"><td>Z${e.a}–Z${e.b}</td><td>${e.km.toFixed(1)}</td><td><span class="tag ${e.traffic}">${e.traffic}</span></td><td>${e.speed.toFixed(1)}</td><td>${e.minutes.toFixed(0)}</td></tr>`).join("");
    $("#edge-table").innerHTML = `<table><thead><tr><th>Road</th><th>km</th><th>Traffic</th><th>km/h</th><th>min</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  async function trainQ() {
    const r = state.route, btn = $("#q-train"), label = btn.lastChild;
    if (r.src === r.dst) return toast("Pick two different zones first.");
    btn.disabled = true; label.textContent = "Training…";
    $("#q-pill").textContent = "training"; $("#q-pill").className = "pill";
    try {
      const q = await api("/api/qlearn", { src: r.src, dst: r.dst, hour: r.hour, weather: r.weather, seed: r.seed, overrides: r.overrides, episodes: +$("#q-episodes").value });
      $("#q-result").hidden = false;
      $("#q-path").innerHTML = pathHTML(q.path);
      if (q.matches_dijkstra) {
        $("#q-pill").textContent = "matches Dijkstra"; $("#q-pill").className = "pill ok";
        $("#q-summary").innerHTML = `<span class="ok">✓ Optimal.</span> After ${q.episodes.toLocaleString()} episodes the greedy policy follows the Dijkstra route (${fmtMin(q.minutes)}).`;
      } else {
        $("#q-pill").textContent = q.reached ? "sub-optimal" : "not converged"; $("#q-pill").className = "pill warn";
        $("#q-summary").innerHTML = q.reached
          ? `<span class="warn">Close.</span> The agent's route takes ${fmtMin(q.minutes)} against the optimum of ${fmtMin(q.optimal_minutes)}. Train for more episodes.`
          : `<span class="warn">Not converged.</span> The greedy policy does not reach the destination yet. Train for more episodes.`;
      }
      chart("q-chart", {
        type: "line",
        data: {
          labels: q.curve.map((p) => p.episode),
          datasets: [
            { label: "Agent (50-episode avg)", data: q.curve.map((p) => p.minutes), borderColor: "#a78bfa", backgroundColor: "rgba(167,139,250,.12)", fill: true, pointRadius: 0, tension: 0.3, borderWidth: 2 },
            { label: "Dijkstra optimum", data: q.curve.map(() => q.optimal_minutes), borderColor: FAST, borderDash: [5, 5], pointRadius: 0, borderWidth: 1.5 },
          ],
        },
        options: {
          animation: { duration: 600 }, interaction: { mode: "index", intersect: false },
          plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { title: (i) => `Episode ${i[0].label}`, label: (c) => `${c.dataset.label}: ${fmtMin(c.parsed.y)}` } } },
          scales: { x: { ticks: { maxTicksLimit: 6 }, grid: { display: false } }, y: { min: 0, max: Math.ceil(q.optimal_minutes * 3 / 60) * 60, ticks: { callback: (v) => fmtMin(v), maxTicksLimit: 4 } } },
        },
      });
    } catch (err) { toast(err.message); $("#q-pill").textContent = "error"; }
    finally { btn.disabled = false; label.textContent = "Train agent"; }
  }

  function initRouteControls() {
    const r = state.route, zones = state.meta.zones;
    const opts = zones.map((z) => `<option value="${z.id}">Zone Z${z.id}</option>`).join("");
    $("#src").innerHTML = opts; $("#dst").innerHTML = opts;
    $("#src").addEventListener("change", (e) => { const v = +e.target.value; if (v === r.dst) r.dst = r.src; r.src = v; syncRouteControls(); loadRoute(); });
    $("#dst").addEventListener("change", (e) => { const v = +e.target.value; if (v === r.src) r.src = r.dst; r.dst = v; syncRouteControls(); loadRoute(); });
    $("#swap").addEventListener("click", () => { [r.src, r.dst] = [r.dst, r.src]; syncRouteControls(); loadRoute(); });
    segmented($("#r-weather"), state.meta.levels.weather, r.weather, (w) => { r.weather = w; loadRoute(); }, (w) => `${WEATHER_ICON[w]}${w}`);
    const hourDebounced = debounce(loadRoute, 120);
    $("#r-hour").value = r.hour;
    $("#r-hour").addEventListener("input", (e) => { r.hour = +e.target.value; syncRouteControls(); hourDebounced(); });
    $("#reroll").addEventListener("click", () => { r.seed = 1 + Math.floor(Math.random() * 9999); r.overrides = {}; syncRouteControls(); loadRoute(); });
    $("#clear-overrides").addEventListener("click", () => { r.overrides = {}; syncRouteControls(); loadRoute(); });
    $("#show-times").addEventListener("change", () => r.last && drawNetwork(r.last));
    $("#show-short").addEventListener("change", () => r.last && drawNetwork(r.last));
    $("#toggle-edges").addEventListener("click", () => {
      const t = $("#edge-table"); t.hidden = !t.hidden;
      $("#toggle-edges").textContent = t.hidden ? "Road table" : "Hide road table";
    });
    $("#q-train").addEventListener("click", trainQ);
    $("#legend-rows").innerHTML = ["Low", "Medium", "High"].map((t) =>
      `<span class="lg"><i class="ln" style="background:${COLORS[t]}"></i>${t} <span class="mono" data-legend="${t}"></span></span>`).join("");
    syncRouteControls();
  }

  function updateLegend(weather) {
    if (!state.route.last) return;
    // the predicted speed for each traffic level comes straight from the current network
    ["Low", "Medium", "High"].forEach((t) => {
      const e = state.route.last.edges.find((x) => x.traffic === t);
      const el = document.querySelector(`[data-legend="${t}"]`);
      if (el) el.textContent = e ? `${e.speed.toFixed(0)} km/h` : "";
    });
  }

  // ============================================================== SPEED LAB
  function gauge(svg, value, max, text, unit, color, ticks) {
    const pct = Math.max(0, Math.min(1, value / max)) * 100;
    if (!svg.dataset.init) {
      svg.innerHTML = `<path class="track" d="M20 104 A80 80 0 0 1 180 104" pathLength="100"/>` +
        `<path class="val" d="M20 104 A80 80 0 0 1 180 104" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>` +
        `<text class="num" x="100" y="92" text-anchor="middle"></text><text class="unit" x="100" y="112" text-anchor="middle"></text>` +
        `<text class="tick" x="20" y="122" text-anchor="middle">${ticks[0]}</text><text class="tick" x="180" y="122" text-anchor="middle">${ticks[1]}</text>`;
      svg.dataset.init = 1;
    }
    const v = svg.querySelector(".val");
    requestAnimationFrame(() => { v.style.strokeDashoffset = 100 - pct; v.style.stroke = color; });
    svg.querySelector(".num").textContent = text;
    svg.querySelector(".unit").textContent = unit;
  }

  let speedReq = 0;
  async function loadSpeed() {
    const s = state.speed, id = ++speedReq;
    $("#s-hour-val").innerHTML = `${fmtHour(s.hour)}${peakPill(s.hour)}`;
    $("#s-dist-val").textContent = `${s.distance} km`;
    try {
      const p = await api("/api/predict", s);
      if (id !== speedReq) return;
      gauge($("#g-speed"), p.speed_kmh, 60, p.speed_kmh.toFixed(1), "km/h", speedColor(p.speed_kmh), ["0", "60"]);
      const pc = p.congestion_prob * 100;
      gauge($("#g-cong"), pc, 100, `${pc.toFixed(0)}%`, p.congested ? "congestion likely" : "flowing", heatColor(100 - pc, 0, 100), ["0", "100"]);
      $("#s-eta").textContent = fmtMin(p.eta_min);
      const a = $("#s-alert");
      a.textContent = p.congested ? "Warn driver" : "No alert";
      a.className = `kv-v ${p.congested ? "bad" : "good"}`;
      $("#s-peak").textContent = p.is_peak_hour ? "Yes" : "No";
      $("#s-peak").className = `kv-v ${p.is_peak_hour ? "warn" : ""}`;
      const fill = $("#prob-fill");
      fill.style.width = `${pc}%`;
      fill.style.backgroundSize = `${(100 / Math.max(pc, 1)) * 100}% 100%`;

      const maxAbs = Math.max(...p.breakdown.map((t) => Math.abs(t.value)));
      $("#formula").innerHTML = p.breakdown.map((t, i) =>
        `<div class="f-row"><div class="bar" style="width:${(Math.abs(t.value) / maxAbs) * 100}%;background:${t.value >= 0 ? "#34d399" : "#f87171"}"></div>` +
        `<span class="t">${i ? "+ " : ""}${esc(t.term)}</span><span class="v ${i ? (t.value >= 0 ? "pos" : "neg") : ""}">${t.value >= 0 && i ? "+" : ""}${t.value.toFixed(3)}</span></div>`).join("") +
        `<div class="f-row total"><span class="t">= predicted speed</span><span class="v">${p.speed_kmh.toFixed(2)} km/h</span></div>`;

      const g = p.grid, all = g.speed.flat(), lo = Math.min(...all), hi = Math.max(...all);
      let html = `<div class="h"></div>` + g.weather.map((w) => `<div class="h">${WEATHER_ICON[w]}&nbsp;${w}</div>`).join("");
      g.traffic.forEach((t, i) => {
        html += `<div class="h r"><span class="tag ${t}">${t}</span></div>`;
        g.weather.forEach((w, j) => {
          const sel = t === s.traffic && w === s.weather ? "sel" : "";
          html += `<button type="button" class="c ${sel}" data-t="${t}" data-w="${w}" style="background:${heatColor(g.speed[i][j], lo, hi)}" title="${t} traffic, ${w}">${g.speed[i][j].toFixed(1)}</button>`;
        });
      });
      const heat = $("#heat");
      heat.className = "heat clickable"; heat.innerHTML = html;
      heat.querySelectorAll(".c").forEach((c) => c.addEventListener("click", () => {
        s.traffic = c.dataset.t; s.weather = c.dataset.w;
        setSeg($("#s-traffic"), s.traffic); setSeg($("#s-weather"), s.weather);
        loadSpeed();
      }));
    } catch (err) { toast(err.message); }
  }

  function initSpeed() {
    const s = state.speed, lv = state.meta.levels;
    segmented($("#s-traffic"), lv.traffic, s.traffic, (v) => { s.traffic = v; loadSpeed(); }, (t) => `<span class="chip" style="background:${COLORS[t]}"></span>${t}`);
    segmented($("#s-weather"), lv.weather, s.weather, (v) => { s.weather = v; loadSpeed(); }, (w) => `${WEATHER_ICON[w]}${w}`);
    segmented($("#s-vehicle"), lv.vehicle, s.vehicle, (v) => { s.vehicle = v; loadSpeed(); });
    segmented($("#s-day"), [0, 1, 2, 3, 4, 5, 6], s.day, (v) => { s.day = v; loadSpeed(); }, (d) => DAYS[d]);
    const deb = debounce(loadSpeed, 80);
    $("#s-hour").value = s.hour; $("#s-dist").value = s.distance;
    $("#s-hour").addEventListener("input", (e) => { s.hour = +e.target.value; $("#s-hour-val").innerHTML = `${fmtHour(s.hour)}${peakPill(s.hour)}`; deb(); });
    $("#s-dist").addEventListener("input", (e) => { s.distance = +e.target.value; $("#s-dist-val").textContent = `${s.distance} km`; deb(); });
    $("#clf-name").textContent = `${state.meta.kpis.clf_name} · balanced`;
    $("#thr").textContent = state.meta.threshold;
  }

  // ============================================================== DEPARTURE
  let departReq = 0;
  async function loadDepart() {
    const d = state.depart, id = ++departReq;
    $("#d-dist-val").textContent = `${d.distance} km`;
    $("#d-hour-val").innerHTML = `${fmtHour(d.hour)}${peakPill(d.hour)}`;
    try {
      const r = await api("/api/departure", d);
      if (id !== departReq) return;
      const saved = -r.best.delta;
      $("#d-rec").innerHTML = saved > 0.5
        ? `<div class="rec-k">Recommended departure</div><div class="rec-time">${fmtHour12(r.best.hour)}</div>` +
          `<div class="rec-sub">Expected <b>${fmtMin(r.best.minutes)}</b> instead of ${fmtMin(r.desired.minutes)} at ${fmtHour12(d.hour)}, saving <b>${fmtMin(saved)}</b> (${(saved / r.desired.minutes * 100).toFixed(0)} %).</div>`
        : `<div class="rec-k">Recommended departure</div><div class="rec-time">${fmtHour12(d.hour)}</div>` +
          `<div class="rec-sub">Your preferred time is already the best in the ±${d.window} h window, with <b>${fmtMin(r.desired.minutes)}</b> expected.</div>`;

      const maxM = Math.max(...r.options.map((o) => o.minutes));
      const offset = (h) => ((h - d.hour + 36) % 24) - 12;
      $("#d-options").innerHTML = [...r.options].sort((a, b) => offset(a.hour) - offset(b.hour)).map((o) => {
        const best = o.hour === r.best.hour, desired = o.hour === d.hour;
        const peak = r.peak_hours.includes(o.hour) ? '<span class="peak">peak</span>' : "";
        const dl = o.delta;
        return `<div class="opt ${best ? "best" : ""} ${desired ? "desired" : ""}"><span class="oh">${fmtHour(o.hour)}${peak}</span>` +
          `<span class="ob"><i style="width:${(o.minutes / maxM) * 100}%"></i></span>` +
          `<span class="od2 ${dl < -0.05 ? "neg" : dl > 0.05 ? "pos" : ""}">${desired ? "preferred" : (dl > 0 ? "+" : "") + dl.toFixed(1) + " min"}</span></div>`;
      }).join("");

      $("#d-chart-sub").textContent = `${d.distance} km trip`;
      const win = new Set(r.window_hours);
      const bandPlugin = {
        id: "band",
        beforeDatasetsDraw(c) {
          const { ctx, chartArea: a, scales: { x } } = c;
          const step = x.getPixelForValue(1) - x.getPixelForValue(0);
          ctx.save();
          ctx.fillStyle = "rgba(34,211,238,.08)";
          for (let h = 0; h < 24; h++) {
            if (win.has(h)) ctx.fillRect(x.getPixelForValue(h) - step / 2, a.top, step, a.bottom - a.top);
          }
          ctx.restore();
        },
      };
      chart("d-chart", {
        type: "line",
        data: {
          labels: [...Array(24).keys()].map(fmtHour),
          datasets: state.meta.levels.weather.map((w) => {
            const on = w === d.weather;
            return {
              label: w, data: r.curves[w], borderColor: COLORS[w], backgroundColor: COLORS[w],
              borderWidth: on ? 3 : 1.5, borderDash: on ? [] : [4, 4], tension: 0.35,
              pointRadius: (ctx) => (on && (ctx.dataIndex === r.best.hour || ctx.dataIndex === d.hour) ? 6 : on ? 2.5 : 0),
              pointBackgroundColor: (ctx) => (on && ctx.dataIndex === r.best.hour ? FAST : COLORS[w]),
              pointBorderColor: "#0b1220", pointBorderWidth: 2, order: on ? 0 : 1,
            };
          }),
        },
        options: {
          animation: { duration: 300 },
          interaction: { mode: "index", intersect: false },
          plugins: { legend: { position: "top", align: "end" }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y.toFixed(1)} min` } } },
          scales: {
            x: { grid: { display: false }, ticks: { color: (c) => (r.peak_hours.includes(c.index) ? "#fbbf24" : "#6f7f9e"), maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
            y: { title: { display: true, text: "expected minutes" }, ticks: { maxTicksLimit: 6 } },
          },
        },
        plugins: [bandPlugin],
      });

      if (!charts["d-mix"]) {
        chart("d-mix", {
          type: "bar",
          data: {
            labels: [...Array(24).keys()].map(fmtHour),
            datasets: ["Low", "Medium", "High"].map((t) => ({ label: t, data: r.p_traffic_hour[t].map((v) => v * 100), backgroundColor: COLORS[t], borderRadius: 2, stack: "s" })),
          },
          options: {
            interaction: { mode: "index", intersect: false },
            plugins: { legend: { position: "top", align: "end" }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y.toFixed(1)} %` } } },
            scales: {
              x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, maxTicksLimit: 12, color: (c) => (r.peak_hours.includes(c.index) ? "#fbbf24" : "#6f7f9e") } },
              y: { stacked: true, max: 100, ticks: { callback: (v) => `${v}%`, maxTicksLimit: 5 } },
            },
          },
        });
      }
    } catch (err) { toast(err.message); }
  }

  function initDepart() {
    const d = state.depart;
    const deb = debounce(loadDepart, 80);
    $("#d-dist").value = d.distance; $("#d-hour").value = d.hour;
    $("#d-dist").addEventListener("input", (e) => { d.distance = +e.target.value; $("#d-dist-val").textContent = `${d.distance} km`; deb(); });
    $("#d-hour").addEventListener("input", (e) => { d.hour = +e.target.value; $("#d-hour-val").innerHTML = `${fmtHour(d.hour)}${peakPill(d.hour)}`; deb(); });
    segmented($("#d-weather"), state.meta.levels.weather, d.weather, (v) => { d.weather = v; loadDepart(); }, (w) => `${WEATHER_ICON[w]}${w}`);
    segmented($("#d-window"), [1, 2, 3, 4], d.window, (v) => { d.window = v; loadDepart(); }, (w) => `±${w} h`);
  }

  // =============================================================== INSIGHTS
  function initInsights() {
    const m = state.meta, k = m.kpis, rt = k.routing;
    const tiles = [
      ["Speed model R²", k.r2.toFixed(3), `data ceiling ${k.r2_ceiling.toFixed(3)}`, "#22d3ee"],
      ["Speed MAE", `${k.mae.toFixed(1)}`, `km/h · RMSE ${k.rmse.toFixed(1)}`, "#22d3ee"],
      ["Congestion recall", `${(k.recall * 100).toFixed(0)}%`, `F1 ${k.f1.toFixed(2)} · precision ${k.precision.toFixed(2)}`, "#f87171"],
      ["Zone silhouette", k.silhouette.toFixed(2), "K-Means, k = 8 zones", "#a78bfa"],
      ["Best route saving", `${Math.round((rt.short_min - rt.fast_min) / rt.short_min * 100)}%`, `Z${rt.src} → Z${rt.dst}, notebook showcase`, "#34d399"],
      ["Q-learning", k.qlearning_match ? "Optimal" : "Sub-optimal", "agent matches Dijkstra", "#fbbf24"],
    ];
    $("#kpis").innerHTML = tiles.map(([kk, v, s, c]) => `<div class="kpi" style="--c:${c}"><div class="k">${kk}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join("");

    const FINAL_REG = "Polynomial deg 2 (4 key feat.)";
    const reg = m.reg_table;
    chart("i-reg", {
      type: "bar",
      data: { labels: reg.map((r) => r.Model), datasets: [{ label: "Test R²", data: reg.map((r) => r["Test R2"]), backgroundColor: reg.map((r) => (r.Model === FINAL_REG ? FAST : "rgba(167,139,250,.55)")), borderRadius: 5, barThickness: 16 }] },
      options: {
        indexAxis: "y", plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `Test R² ${c.parsed.x.toFixed(4)}` } } },
        scales: { x: { min: 0.45, max: 0.62, ticks: { maxTicksLimit: 6 } }, y: { grid: { display: false }, ticks: { font: { size: 11 } } } },
      },
    });
    $("#i-reg-table").innerHTML = `<table><thead><tr><th>Model</th><th>Train R²</th><th>Test R²</th><th>MAE</th><th>RMSE</th><th>Time (s)</th></tr></thead><tbody>` +
      reg.map((r) => `<tr class="${r.Model === FINAL_REG ? "best" : ""}"><td>${esc(r.Model)}</td><td>${r["Train R2"].toFixed(3)}</td><td>${r["Test R2"].toFixed(3)}</td><td>${r.MAE.toFixed(2)}</td><td>${r.RMSE.toFixed(2)}</td><td>${r["Time (s)"].toFixed(2)}</td></tr>`).join("") +
      `</tbody></table><p class="small muted">★ Chosen: the simplest model that reaches the ceiling. The 16-feature and ensemble models gain nothing on test data and cost more to run.</p>`;

    const clf = m.clf_table;
    chart("i-clf", {
      type: "bar",
      data: {
        labels: clf.map((r) => r.Model.replace(/ \(.*\)/, "")),
        datasets: [
          { label: "Recall", data: clf.map((r) => r.Recall), backgroundColor: "#f87171", borderRadius: 4 },
          { label: "F1", data: clf.map((r) => r.F1), backgroundColor: "#22d3ee", borderRadius: 4 },
          { label: "Precision", data: clf.map((r) => r.Precision), backgroundColor: "rgba(167,139,250,.6)", borderRadius: 4 },
        ],
      },
      options: {
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { position: "top", align: "end" } },
        scales: { y: { min: 0, max: 1, ticks: { maxTicksLimit: 6 } }, x: { grid: { display: false }, ticks: { font: { size: 10.5 }, maxRotation: 0, autoSkip: false } } },
      },
    });
    $("#i-clf-table").innerHTML = `<table><thead><tr><th>Model</th><th>Accuracy</th><th>Precision</th><th>Recall</th><th>F1</th></tr></thead><tbody>` +
      clf.map((r) => `<tr class="${r.Model === k.clf_name ? "best" : ""}"><td>${esc(r.Model)}</td><td>${r.Accuracy.toFixed(3)}</td><td>${r.Precision.toFixed(3)}</td><td>${r.Recall.toFixed(3)}</td><td>${r.F1.toFixed(3)}</td></tr>`).join("") +
      `</tbody></table>`;

    const cm = m.final_clf_cm;
    $("#i-cm").innerHTML = `<div></div><div class="h">Predicted free</div><div class="h">Predicted congested</div>` +
      `<div class="h">Actually free</div><div class="c tn"><div class="n">${cm.TN.toLocaleString()}</div><div class="l">true negative</div></div><div class="c fp"><div class="n">${cm.FP.toLocaleString()}</div><div class="l">false alarm</div></div>` +
      `<div class="h">Actually congested</div><div class="c fn"><div class="n">${cm.FN.toLocaleString()}</div><div class="l">missed</div></div><div class="c tp"><div class="n">${cm.TP.toLocaleString()}</div><div class="l">caught</div></div>`;
    $("#i-cm").insertAdjacentHTML("afterend", `<div class="cm-foot"><div><b>${k.accuracy.toFixed(3)}</b><span>accuracy</span></div><div><b>${k.precision.toFixed(3)}</b><span>precision</span></div><div><b>${k.recall.toFixed(3)}</b><span>recall</span></div><div><b>${k.f1.toFixed(3)}</b><span>F1</span></div></div>`);

    const gm = m.group_means, W = ["Clear", "Rain", "Fog"], T = ["Low", "Medium", "High"];
    const vals = W.flatMap((w) => T.map((t) => gm[w][t])), lo = Math.min(...vals), hi = Math.max(...vals);
    let h = `<div class="h"></div>` + W.map((w) => `<div class="h">${WEATHER_ICON[w]}&nbsp;${w}</div>`).join("");
    T.forEach((t) => { h += `<div class="h r"><span class="tag ${t}">${t}</span></div>` + W.map((w) => `<div class="c" style="background:${heatColor(gm[w][t], lo, hi)}">${gm[w][t].toFixed(1)}</div>`).join(""); });
    $("#i-group").innerHTML = h;
    $("#i-group").insertAdjacentHTML("afterend", `<p class="small muted">The regression reproduces these nine group means almost exactly, so its R² equals the best any model can reach with this data.</p>`);

    $("#i-rules").innerHTML = (m.top_rules || []).slice(0, 4).map((r) => {
      const [lhs, rhs] = r.rule.split(" -> ");
      return `<div class="rule"><div class="r">${esc(lhs)} <span class="muted">⇒</span> <span style="color:#f87171">${esc(rhs)}</span></div>` +
        `<div class="m"><span>conf <b>${r.confidence.toFixed(2)}</b></span><span>lift <b>${r.lift.toFixed(2)}</b></span><span>support <b>${r.support.toFixed(3)}</b></span></div>` +
        `<div class="cbar"><i style="width:${r.confidence * 100}%"></i></div></div>`;
    }).join("");

    const figs = m.figures;
    const figTitle = (f) => FIG_TITLES[f.slice(0, 2)] || f.replace(/^\d+_|\.png$/g, "").replace(/_/g, " ");
    $("#gallery").innerHTML = figs.map((f, i) =>
      `<button type="button" class="thumb" data-i="${i}"><img loading="lazy" src="/figures/${encodeURIComponent(f)}" alt="${esc(figTitle(f))}"><span>${f.slice(0, 2)} · ${esc(figTitle(f))}</span></button>`).join("");
    let cur = 0;
    const lb = $("#lightbox");
    const open = (i) => {
      cur = (i + figs.length) % figs.length;
      const f = figs[cur];
      $("#lb-img").src = `/figures/${encodeURIComponent(f)}`;
      $("#lb-img").alt = figTitle(f);
      $("#lb-cap").textContent = `${f.slice(0, 2)} · ${figTitle(f)}  (${cur + 1}/${figs.length})`;
      lb.hidden = false;
    };
    $("#gallery").querySelectorAll(".thumb").forEach((t) => t.addEventListener("click", () => open(+t.dataset.i)));
    lb.querySelector(".lb-close").addEventListener("click", () => (lb.hidden = true));
    lb.querySelector(".prev").addEventListener("click", (e) => { e.stopPropagation(); open(cur - 1); });
    lb.querySelector(".next").addEventListener("click", (e) => { e.stopPropagation(); open(cur + 1); });
    lb.addEventListener("click", (e) => { if (e.target === lb) lb.hidden = true; });
    document.addEventListener("keydown", (e) => {
      if (lb.hidden) return;
      if (e.key === "Escape") lb.hidden = true;
      if (e.key === "ArrowLeft") open(cur - 1);
      if (e.key === "ArrowRight") open(cur + 1);
    });
  }

  // =================================================================== boot
  async function boot() {
    const st = $("#status");
    try {
      state.meta = await api("/api/meta");
      st.className = "status ok";
      $("#status-text").textContent = `Models loaded · ${state.meta.rows.toLocaleString()} trips · ${state.meta.zones.length} zones`;
    } catch (err) {
      st.className = "status err";
      $("#status-text").textContent = "Backend unreachable";
      toast(`Could not reach the ReRouter server (${err.message}). Start it with: python app/server.py`);
      return;
    }
    const initial = (location.hash || "#route").slice(1);
    showView(["route", "speed", "depart", "insights"].includes(initial) ? initial : "route");
    initMap(); initRouteControls(); initSpeed(); initDepart(); initInsights();
    loadRoute(); loadSpeed(); loadDepart();
    window.addEventListener("resize", debounce(() => map && map.invalidateSize(), 150));
  }
  boot();
})();
