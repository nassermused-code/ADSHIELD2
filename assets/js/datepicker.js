/* =========================================================
   Green Travel — Arabic date-range calendar
   Replaces the native date boxes (flights + hotels) with a calendar popover.
   The original inputs stay in the form (as hidden inputs holding YYYY-MM-DD),
   so validation, FormData and the results page keep working unchanged.
   ========================================================= */
(() => {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const pad = (n) => String(n).padStart(2, "0");
  const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d, 12); };
  const todayIso = () => isoOf(new Date());
  const fmtBtn = (iso) => parse(iso).toLocaleDateString(I18N.locale, { weekday: "short", day: "numeric", month: "short" });
  const fmtMonth = (d) => d.toLocaleDateString(I18N.locale, { month: "long", year: "numeric" });
  const WEEK = I18N.en ? ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] : ["أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];
  const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  // Pairs of [start, end] inputs; `round` says whether the end date is in use
  const PAIRS = [
    { start: "#depart", end: "#return", prices: true, words: [T("اختر تاريخ الذهاب", "Choose your departure date"), T("اختر تاريخ العودة", "Choose your return date")], round: () => !!$('input[name="trip"][value="round"]:checked') },
    { start: "#hin", end: "#hout", prices: false, words: [T("اختر تاريخ الوصول", "Choose check-in date"), T("اختر تاريخ المغادرة", "Choose check-out date")], round: () => true },
  ];

  let pop, ctx = null, view = null, hoverIso = null;

  function buildPopover() {
    pop = document.createElement("div");
    pop.className = "dp";
    pop.hidden = true;
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", T("اختر التاريخ", "Choose a date"));
    pop.innerHTML = `
      <div class="dp__head">
        <button type="button" class="dp__nav" data-nav="-1" aria-label="${T("الشهر السابق", "Previous month")}"><svg class="i flip"><use href="#i-arrow"/></svg></button>
        <div class="dp__hint" aria-live="polite"></div>
        <button type="button" class="dp__nav" data-nav="1" aria-label="${T("الشهر التالي", "Next month")}"><svg class="i"><use href="#i-arrow"/></svg></button>
      </div>
      <div class="dp__months"></div>
      <div class="dp__foot">
        <p class="dp__sel"></p>
        <div class="dp__actions">
          <button type="button" class="btn btn--ghost btn--sm" data-act="clear">${T("مسح", "Clear")}</button>
          <button type="button" class="btn btn--primary btn--sm" data-act="done">${T("تم", "Done")}</button>
        </div>
      </div>`;
    document.body.appendChild(pop);

    pop.addEventListener("click", (e) => {
      const nav = e.target.closest("[data-nav]");
      if (nav) { if (!nav.disabled) { view.setMonth(view.getMonth() + Number(nav.dataset.nav)); render(); } return; }
      const day = e.target.closest("[data-iso]");
      if (day && !day.disabled) return pick(day.dataset.iso);
      const act = e.target.closest("[data-act]");
      if (act && act.dataset.act === "done") close(true);
      if (act && act.dataset.act === "clear") { setVal(ctx.startEl, ""); setVal(ctx.endEl, ""); ctx.phase = "start"; render(); }
    });
    pop.addEventListener("mouseover", (e) => {
      const day = e.target.closest("[data-iso]");
      const iso = day && !day.disabled ? day.dataset.iso : null;
      if (ctx && ctx.phase === "end" && iso !== hoverIso) { hoverIso = iso; paintRange(); }
    });
    pop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.stopPropagation(); close(true); }
      const day = e.target.closest("[data-iso]");
      if (!day) return;
      const side = I18N.en ? -1 : 1; // RTL: left = next day; LTR: right = next day
      const step = { ArrowLeft: side, ArrowRight: -side, ArrowDown: 7, ArrowUp: -7 }[e.key];
      if (step) {
        e.preventDefault();
        const d = parse(day.dataset.iso); d.setDate(d.getDate() + step);
        const iso = isoOf(d);
        let el = $(`[data-iso="${iso}"]`, pop);
        if (!el) { view.setMonth(view.getMonth() + (step > 0 ? 1 : -1)); render(); el = $(`[data-iso="${iso}"]`, pop); }
        el && el.focus();
      }
    });
    document.addEventListener("pointerdown", (e) => {
      if (!pop.hidden && !pop.contains(e.target) && !e.target.closest(".date-btn")) close(true);
    });
    window.addEventListener("resize", () => !pop.hidden && place());
    window.addEventListener("scroll", () => !pop.hidden && place(), { passive: true });
  }

  function setVal(el, v) {
    el.value = v;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    refresh();
  }

  function minFor(el) { return el.min && el.min > todayIso() ? el.min : todayIso(); }

  function open(pair, phase) {
    if (!pop) buildPopover();
    const startEl = $(pair.start), endEl = $(pair.end);
    const round = pair.round() && !endEl.disabled;
    ctx = { pair, startEl, endEl, round, phase: round ? phase : "start", anchor: (phase === "end" ? endEl : startEl).closest(".field") };
    const base = (ctx.phase === "end" && endEl.value) || startEl.value || todayIso();
    view = parse(base); view.setDate(1);
    hoverIso = null;
    pop.hidden = false;
    $$(".date-btn").forEach((b) => b.classList.remove("is-open"));
    ctx.anchor.querySelector(".date-btn").classList.add("is-open");
    ctx.anchor.querySelector(".date-btn").setAttribute("aria-expanded", "true");
    render();
    place();
    requestAnimationFrame(() => {
      const focusIso = (ctx.phase === "end" ? endEl.value : startEl.value) || minFor(startEl);
      ($(`[data-iso="${focusIso}"]`, pop) || $(".dp__day:not(:disabled)", pop))?.focus({ preventScroll: true });
    });
  }

  function close(returnFocus) {
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    $$(".date-btn").forEach((b) => { b.classList.remove("is-open"); b.setAttribute("aria-expanded", "false"); });
    if (returnFocus && ctx) ctx.anchor.querySelector(".date-btn").focus({ preventScroll: true });
  }

  function pick(iso) {
    const { startEl, endEl } = ctx;
    if (ctx.phase === "start" || !ctx.round) {
      setVal(startEl, iso);
      if (ctx.round) {
        if (endEl.value && endEl.value < iso) setVal(endEl, "");
        ctx.phase = "end";
        ctx.anchor = endEl.closest(".field");
        $$(".date-btn").forEach((b) => b.classList.toggle("is-open", b === ctx.anchor.querySelector(".date-btn")));
        render();
      } else {
        render();
        setTimeout(() => close(true), 180);
      }
    } else {
      if (iso < startEl.value) { setVal(startEl, iso); render(); return; }
      setVal(endEl, iso);
      render();
      setTimeout(() => close(true), 220);
    }
  }

  function priceMap(months) {
    if (!ctx.pair.prices || ctx.phase !== "start" || !window.GTFlights || !window.GTFlights.dayPrices) return null;
    const from = months[0], to = new Date(months[months.length - 1].getFullYear(), months[months.length - 1].getMonth() + 1, 0, 12);
    return window.GTFlights.dayPrices(isoOf(from), isoOf(to));
  }

  function render() {
    const single = window.matchMedia("(max-width: 720px)").matches;
    const months = [new Date(view)];
    if (!single) { const n = new Date(view); n.setMonth(n.getMonth() + 1); months.push(n); }
    const min = minFor(ctx.startEl);
    const minMonth = parse(min); minMonth.setDate(1);
    $('[data-nav="-1"]', pop).disabled = view <= minMonth;
    const prices = priceMap(months);
    const low = prices ? Math.min(...Object.values(prices).filter(Boolean)) : null;
    const s = ctx.startEl.value, e = ctx.round ? ctx.endEl.value : "";
    const t = todayIso();

    $(".dp__months", pop).innerHTML = months.map((m) => {
      const first = new Date(m.getFullYear(), m.getMonth(), 1, 12);
      const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
      let cells = "";
      for (let i = 0; i < first.getDay(); i++) cells += '<span class="dp__blank"></span>';
      for (let d = 1; d <= days; d++) {
        const iso = `${m.getFullYear()}-${pad(m.getMonth() + 1)}-${pad(d)}`;
        const dis = iso < min || (ctx.phase === "end" && iso < s);
        const cls = ["dp__day", iso === t ? "is-today" : "", iso === s ? "is-start" : "", iso === e ? "is-end" : "", s && e && iso > s && iso < e ? "is-in" : ""].join(" ");
        const p = prices && prices[iso];
        cells += `<button type="button" class="${cls}" data-iso="${iso}" ${dis ? "disabled" : ""} aria-pressed="${iso === s || iso === e}" aria-label="${parse(iso).toLocaleDateString(I18N.locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}${p ? " · " + usd.format(p) : ""}">
          <span class="dp__n">${d}</span>${p && !dis ? `<small class="dp__p ${p === low ? "is-low" : ""}" dir="ltr">${usd.format(p)}</small>` : ""}</button>`;
      }
      return `<div class="dp__month"><h4>${fmtMonth(m)}</h4><div class="dp__grid">${WEEK.map((w) => `<span class="dp__wd">${w}</span>`).join("")}${cells}</div></div>`;
    }).join("");

    const hint = ctx.round ? ctx.pair.words[ctx.phase === "start" ? 0 : 1] : T("اختر التاريخ", "Choose a date");
    $(".dp__hint", pop).textContent = hint + (prices ? T(" · الأسعار تقديرية للفرد", " · estimated fares per person") : "");
    const nights = s && e ? Math.round((parse(e) - parse(s)) / 864e5) : 0;
    $(".dp__sel", pop).innerHTML = s
      ? `<b>${fmtBtn(s)}</b>${ctx.round ? ` ${T("←", "→")} <b>${e ? fmtBtn(e) : "…"}</b>${nights ? ` · ${nights} ${ctx.pair.prices ? (nights === 1 ? T("يوم", "day") : T("أيام", "days")) : nights === 1 ? T("ليلة", "night") : T("ليالٍ", "nights")}` : ""}` : ""}`
      : T("لم يتم اختيار تاريخ", "No date selected");
    pop.classList.toggle("dp--single", single);
    paintRange();
  }

  function paintRange() {
    const s = ctx.startEl.value;
    $$(".dp__day.is-hover", pop).forEach((b) => b.classList.remove("is-hover"));
    if (ctx.phase !== "end" || !s || !hoverIso || hoverIso <= s) return;
    $$(".dp__day", pop).forEach((b) => { if (b.dataset.iso > s && b.dataset.iso <= hoverIso) b.classList.add("is-hover"); });
  }

  function place() {
    const search = $("#search");
    const box = (ctx.anchor.closest(".search") || search).getBoundingClientRect();
    const f = ctx.anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const vw = document.documentElement.clientWidth;
    let left = f.left + f.width / 2 - w / 2 + window.scrollX;
    left = Math.max(window.scrollX + Math.max(8, box.left), Math.min(left, window.scrollX + Math.min(vw - 8, box.right) - w));
    if (w > vw - 32) left = window.scrollX + (vw - w) / 2;
    pop.style.left = `${left}px`;
    pop.style.top = `${f.bottom + window.scrollY + 8}px`;
  }

  function refresh() {
    PAIRS.forEach((pair) => [pair.start, pair.end].forEach((sel) => {
      const el = $(sel);
      const btn = el && el.closest(".field").querySelector(".date-btn");
      if (!btn) return;
      const empty = !el.value;
      const d = !empty && parse(el.value);
      btn.querySelector(".date-btn__v").innerHTML = empty
        ? T("اختر التاريخ", "Choose a date")
        : `<b>${d.toLocaleDateString(I18N.locale, { day: "numeric", month: I18N.en ? "short" : "long" })}</b> <small>${d.toLocaleDateString(I18N.locale, { weekday: I18N.en ? "short" : "long" })}</small>`;
      btn.classList.toggle("is-empty", empty);
      btn.disabled = el.disabled;
    }));
  }

  function enhance(pair) {
    [pair.start, pair.end].forEach((sel, i) => {
      const el = $(sel);
      if (!el) return;
      const field = el.closest(".field");
      el.type = "hidden";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "date-btn is-empty";
      btn.id = el.id + "Btn";
      btn.setAttribute("aria-haspopup", "dialog");
      btn.setAttribute("aria-expanded", "false");
      btn.innerHTML = `<svg class="i"><use href="#i-calendar"/></svg><span class="date-btn__v">${T("اختر التاريخ", "Choose a date")}</span>`;
      el.after(btn);
      const lab = field.querySelector("label");
      if (lab) lab.setAttribute("for", btn.id);
      btn.addEventListener("click", () => {
        if (!pop || pop.hidden || ctx.anchor !== field) open(pair, i === 0 ? "start" : "end");
        else close(false);
      });
    });
  }

  window.GTDate = { refresh, close: () => close(false) };

  document.addEventListener("DOMContentLoaded", () => {
    PAIRS.forEach(enhance);
    refresh();
    $$('input[name="trip"]').forEach((r) => r.addEventListener("change", () => { refresh(); close(false); }));
    // Re-label when another script changes a date (e.g. the results date strip)
    document.addEventListener("change", (e) => { if (e.target.matches && e.target.matches("#depart, #return, #hin, #hout")) refresh(); });
  });
})();
