/* =========================================================
   Green Travel — visual experience layer
   - Hero route map: every airport in assets/data/airports.json is a dot (the dots
     draw the continents), with animated great-circle-style arcs from Chicago (ORD).
   - Departures board: split-flap airport codes + live Chicago clock.
   - Scroll progress bar, horizontal "perks" slider.
   ========================================================= */
(() => {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Hero route map ---------- */
  const HUB = "ORD";
  const ROUTES = ["DXB", "IST", "LHR", "CDG", "AMM", "CAI", "JED", "DOH", "BEY", "BGW", "MAD", "FRA", "HND", "GRU", "MEX", "LAX", "JFK"];
  const LABELS = new Set(["ORD", "DXB", "IST", "LHR", "CAI", "AMM", "JED", "HND", "GRU"]);

  function initMap() {
    const canvas = $("#routeMap");
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext("2d");
    const base = document.createElement("canvas");
    const bctx = base.getContext("2d");
    let W = 0, H = 0, dpr = 1, proj = null, arcs = [], dots = [], byCode = {}, running = false, visible = true, raf = 0;

    const project = (lon, lat) => [proj.ox + (lon + 180) * proj.s, proj.oy + (75 - lat) * proj.s];

    function layout() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      canvas.width = base.width = Math.round(W * dpr);
      canvas.height = base.height = Math.round(H * dpr);
      // Equirectangular, latitudes 75°N..56°S, scaled to cover; centred near the Atlantic so Chicago and the Middle East both show
      const s = Math.max(W / 300, H / 118);
      const centerLon = W < 700 ? -30 : 0, centerLat = 28;
      proj = { s, ox: W / 2 - (centerLon + 180) * s, oy: H * 0.46 - (75 - centerLat) * s };
      drawBase();
    }

    function bezier(a, c, b, t) {
      const u = 1 - t;
      return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
    }

    function drawBase() {
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      bctx.clearRect(0, 0, W, H);
      // continents from airport dots
      const r = Math.max(1.3, proj.s * 0.34);
      for (const [lon, lat, big] of dots) {
        const [x, y] = project(lon, lat);
        if (x < -4 || y < -4 || x > W + 4 || y > H + 4) continue;
        bctx.fillStyle = big ? "rgba(170, 235, 150, 0.85)" : "rgba(143, 220, 127, 0.42)";
        bctx.beginPath(); bctx.arc(x, y, big ? r * 0.75 : r * 0.5, 0, Math.PI * 2); bctx.fill();
      }
      bctx.globalAlpha = 1;
      // arcs
      const hub = byCode[HUB];
      if (!hub) return;
      const a = project(hub[0], hub[1]);
      arcs = ROUTES.map((code, i) => {
        const d = byCode[code];
        if (!d) return null;
        const b = project(d[0], d[1]);
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len = Math.hypot(dx, dy);
        const lift = Math.min(len * 0.32, H * 0.35);
        const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - lift];
        return { code, a, b, c, phase: (i * 0.137) % 1, speed: 0.11 + (i % 5) * 0.018 };
      }).filter(Boolean);
      bctx.lineWidth = 1;
      for (const arc of arcs) {
        bctx.strokeStyle = "rgba(143, 220, 127, 0.22)";
        bctx.beginPath();
        bctx.moveTo(arc.a[0], arc.a[1]);
        bctx.quadraticCurveTo(arc.c[0], arc.c[1], arc.b[0], arc.b[1]);
        bctx.stroke();
        // destination point
        bctx.fillStyle = "rgba(255, 179, 33, 0.9)";
        bctx.beginPath(); bctx.arc(arc.b[0], arc.b[1], 2.2, 0, Math.PI * 2); bctx.fill();
        if (LABELS.has(arc.code) && W > 560) label(arc.code, arc.b);
      }
      if (W > 560) label(HUB, a, true);
    }

    function label(text, p, hub) {
      bctx.font = `600 ${hub ? 12 : 10.5}px "IBM Plex Mono", ui-monospace, monospace`;
      bctx.fillStyle = hub ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.6)";
      bctx.fillText(text, p[0] + 6, p[1] - 6);
    }

    function frame(now) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(base, 0, 0, W, H);
      const t = now / 1000;
      // hub pulse
      const hub = byCode[HUB];
      if (hub) {
        const p = project(hub[0], hub[1]);
        const k = (t % 2) / 2;
        ctx.strokeStyle = `rgba(143, 220, 127, ${0.6 * (1 - k)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p[0], p[1], 4 + k * 18, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = "#8fdc7f";
        ctx.beginPath(); ctx.arc(p[0], p[1], 3.5, 0, Math.PI * 2); ctx.fill();
      }
      // moving trails
      for (const arc of arcs) {
        const head = reduce ? 0.62 : (t * arc.speed + arc.phase) % 1;
        const tail = Math.max(0, head - 0.18);
        const steps = 18;
        for (let i = 0; i < steps; i++) {
          const t0 = tail + ((head - tail) * i) / steps, t1 = tail + ((head - tail) * (i + 1)) / steps;
          const p0 = bezier(arc.a, arc.c, arc.b, t0), p1 = bezier(arc.a, arc.c, arc.b, t1);
          ctx.strokeStyle = `rgba(255, 179, 33, ${(i / steps) * 0.9})`;
          ctx.lineWidth = 1 + (i / steps) * 1.6;
          ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
        }
        const ph = bezier(arc.a, arc.c, arc.b, head);
        ctx.fillStyle = "#fff";
        ctx.shadowColor = "rgba(255, 179, 33, 0.9)";
        ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(ph[0], ph[1], 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }
      if (running) raf = requestAnimationFrame(frame);
    }

    function start() {
      if (running || reduce || !visible || document.hidden) return;
      running = true;
      raf = requestAnimationFrame(frame);
    }
    function stop() { running = false; cancelAnimationFrame(raf); }

    fetch("assets/data/airports.json")
      .then((r) => r.json())
      .then((rows) => {
        dots = rows.map((r) => [r[5], r[4], r[6] === 0]);
        rows.forEach((r) => (byCode[r[0]] = [r[5], r[4]]));
        layout();
        frame(performance.now());
        start();
      })
      .catch(() => {});

    let rt;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (dots.length) { layout(); frame(performance.now()); } }, 150); });
    new IntersectionObserver((en) => { visible = en[0].isIntersecting; visible ? start() : stop(); }).observe(canvas);
    document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  }

  /* ---------- Split-flap airport codes ---------- */
  function initFlaps() {
    const flaps = $$("[data-flap]");
    flaps.forEach((el) => { el.innerHTML = [...el.dataset.flap].map((c) => `<span>${c}</span>`).join(""); });
    if (reduce) return;
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const spin = (el, delay) => {
      const target = el.dataset.flap;
      [...el.children].forEach((cell, i) => {
        let n = 8 + i * 4 + Math.floor(Math.random() * 4);
        setTimeout(function tick() {
          if (n-- <= 0) { cell.textContent = target[i]; return; }
          cell.textContent = A[Math.floor(Math.random() * A.length)];
          setTimeout(tick, 55);
        }, delay);
      });
    };
    const board = $(".board");
    if (!board) return;
    const io = new IntersectionObserver((en) => {
      if (!en[0].isIntersecting) return;
      flaps.forEach((el, i) => spin(el, i * 120));
      io.disconnect();
    }, { threshold: 0.3 });
    io.observe(board);
    $$(".board__row").forEach((row) => row.addEventListener("mouseenter", () => spin($("[data-flap]", row), 0)));
  }

  /* ---------- Live Chicago clock ---------- */
  function initClock() {
    const el = $("#chicagoClock");
    if (!el) return;
    let fmt;
    try { fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hour12: false }); } catch (e) { return; }
    const tick = () => (el.textContent = fmt.format(new Date()));
    tick();
    setInterval(tick, 15000);
  }

  /* ---------- Board rows jump to the search ---------- */
  function initBoard() {
    $$(".board__row").forEach((row) => row.addEventListener("click", () => {
      const s = $("#search");
      s && s.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    }));
  }

  /* ---------- Scroll progress ---------- */
  function initProgress() {
    const bar = $("#progressBar");
    if (!bar) return;
    let ticking = false;
    const update = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      bar.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
      ticking = false;
    };
    window.addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }

  /* ---------- Perks slider ---------- */
  function initPerks() {
    const track = $("#perksTrack");
    if (!track) return;
    $$("[data-perk]").forEach((b) => b.addEventListener("click", () => {
      const card = track.querySelector(".perk");
      const step = card ? card.getBoundingClientRect().width + 16 : 320;
      const rtl = document.documentElement.dir === "rtl";
      const dir = (b.dataset.perk === "next" ? 1 : -1) * (rtl ? -1 : 1);
      track.scrollBy({ left: dir * step, behavior: reduce ? "auto" : "smooth" });
    }));
  }

  document.addEventListener("DOMContentLoaded", () => {
    initMap();
    initFlaps();
    initClock();
    initBoard();
    initProgress();
    initPerks();
  });
})();
