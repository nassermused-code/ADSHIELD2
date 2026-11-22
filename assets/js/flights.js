/* =========================================================
   Green Travel — airport autocomplete + flight results
   - Autocomplete over every airport with scheduled service (assets/data/airports.json)
   - Results view with estimated fares, filters and sorting.
     Fares are estimates computed in the browser (distance, cabin, dates, passengers);
     the agent confirms the final price before ticketing.
   ========================================================= */
(() => {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];

  /* ---------- Arabic city names for common airports ---------- */
  const AR = {};
  (typeof AIRPORTS !== "undefined" ? AIRPORTS : []).forEach((s) => {
    const m = s.match(/^(.*) \(([A-Z]{3})\)$/);
    if (m) AR[m[2]] = m[1];
  });
  Object.assign(AR, {
    ORD: "شيكاغو أوهير", MDW: "شيكاغو ميدواي", DTW: "ديترويت", JFK: "نيويورك", LGA: "نيويورك لاغوارديا", EWR: "نيوارك",
    IAD: "واشنطن دالاس", DCA: "واشنطن ريغان", BWI: "بالتيمور", LAX: "لوس أنجلوس", SFO: "سان فرانسيسكو", SJC: "سان خوسيه",
    SAN: "سان دييغو", SEA: "سياتل", IAH: "هيوستن", HOU: "هيوستن هوبي", DFW: "دالاس", DAL: "دالاس لوف فيلد", MIA: "ميامي",
    FLL: "فورت لودرديل", MCO: "أورلاندو", TPA: "تامبا", ATL: "أتلانتا", BOS: "بوسطن", PHL: "فيلادلفيا", CLT: "شارلوت",
    DEN: "دنفر", LAS: "لاس فيغاس", PHX: "فينيكس", MSP: "مينيابوليس", STL: "سانت لويس", MKE: "ميلووكي", IND: "إنديانابوليس",
    CLE: "كليفلاند", CMH: "كولومبوس", PIT: "بيتسبرغ", BNA: "ناشفيل", AUS: "أوستن", SAT: "سان أنطونيو", SLC: "سولت ليك سيتي",
    PDX: "بورتلاند", HNL: "هونولولو", YVR: "فانكوفر", YYC: "كالغاري", YOW: "أوتاوا", MEX: "مكسيكو سيتي", CUN: "كانكون",
    GRU: "ساو باولو", EZE: "بوينس آيرس", BOG: "بوغوتا", LIM: "ليما",
    SAH: "صنعاء", ADE: "عدن", BEN: "بنغازي", MJI: "طرابلس", DAM: "دمشق", ALP: "حلب", BSR: "البصرة", NJF: "النجف",
    ISU: "السليمانية", NKC: "نواكشوط", PZU: "بورتسودان", LXR: "الأقصر", ASW: "أسوان", YNB: "ينبع", ORN: "وهران",
    CZL: "قسنطينة", AGA: "أغادير", FEZ: "فاس", TNG: "طنجة", DJE: "جربة", HBE: "الإسكندرية", SPX: "سفنكس", RKT: "رأس الخيمة",
    DWC: "دبي آل مكتوم", KHI: "كراتشي", LHE: "لاهور", DAC: "دكا", KTM: "كاتماندو", HKG: "هونغ كونغ", PEK: "بكين",
    PKX: "بكين داشينغ", PVG: "شنغهاي", CAN: "قوانغتشو", NRT: "طوكيو ناريتا", KIX: "أوساكا", LGW: "لندن غاتويك",
    STN: "لندن ستانستد", ORY: "باريس أورلي", BRU: "بروكسل", CPH: "كوبنهاغن", ARN: "ستوكهولم", OSL: "أوسلو", HEL: "هلسنكي",
    DUB: "دبلن", LIS: "لشبونة", ATH: "أثينا", PRG: "براغ", BUD: "بودابست", WAW: "وارسو", BER: "برلين", DUS: "دوسلدورف",
    HAM: "هامبورغ", SVO: "موسكو", ESB: "أنقرة", ADB: "إزمير", BJV: "بودروم", DLM: "دالامان", JNB: "جوهانسبرغ", CPT: "كيب تاون",
    LOS: "لاغوس", ACC: "أكرا", DKR: "داكار", MBA: "مومباسا", DAR: "دار السلام", EBB: "عنتيبي", MRU: "موريشيوس", SEZ: "سيشل",
    AKL: "أوكلاند", BNE: "بريزبن", PER: "بيرث", CEB: "سيبو", SGN: "هو تشي منه", HAN: "هانوي", PNH: "بنوم بنه",
    MLE: "ماليه", CMB: "كولومبو", BLR: "بنغالور", HYD: "حيدر أباد", MAA: "تشيناي", COK: "كوتشي", TRV: "تريفاندروم",
  });

  /* ---------- Text helpers ---------- */
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[ً-ْـ]/g, "")
      .replace(/[أإآٱ]/g, "ا")
      .replace(/ة/g, "ه")
      .replace(/ى/g, "ي");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let regionAr, regionEn;
  try { regionAr = new Intl.DisplayNames(["ar"], { type: "region" }); regionEn = new Intl.DisplayNames(["en"], { type: "region" }); } catch (e) {}
  const countryAr = (cc) => { try { return regionAr ? regionAr.of(cc) : cc; } catch (e) { return cc; } };
  const countryEn = (cc) => { try { return regionEn ? regionEn.of(cc) : cc; } catch (e) { return cc; } };

  /* ---------- Airport data ---------- */
  let DB = null, BY = {}, loading = null;
  function loadAirports() {
    if (DB) return Promise.resolve(DB);
    if (!loading) {
      loading = fetch("assets/data/airports.json")
        .then((r) => { if (!r.ok) throw new Error("airports"); return r.json(); })
        .then((rows) => {
          DB = rows.map(([code, name, city, cc, lat, lon, rank, cont]) => {
            const ar = AR[code] || "";
            const car = countryAr(cc), cen = countryEn(cc);
            return { code, name, city, cc, lat, lon, rank, cont, ar, car, cen,
              kCode: code.toLowerCase(), kAr: norm(ar), kCity: norm(city), kCountry: norm(car) + " " + norm(cen), kAll: norm([name, city, ar, car, cen].join(" ")) };
          });
          DB.forEach((a) => (BY[a.code] = a));
          return DB;
        })
        .catch((e) => { loading = null; throw e; });
    }
    return loading;
  }
  const label = (a) => `${a.ar || a.city || a.name} (${a.code})`;
  const POPULAR = ["ORD", "JFK", "DTW", "IAD", "LAX", "IAH", "DFW", "DXB", "DOH", "IST", "CAI", "AMM", "JED", "RUH", "MED", "LHR", "CDG", "KRT", "BGW", "BEY"];

  // Main international gateways in North America (foreign carriers fly long-haul only to these)
  const NA_GW = new Set(["ORD", "JFK", "EWR", "IAD", "IAH", "LAX", "SFO", "DFW", "ATL", "BOS", "MIA", "SEA", "DTW", "PHL", "MCO", "DEN", "YYZ", "YUL", "YVR", "MEX"]);
  let MAJOR = null;
  const isMajor = (code) => {
    if (!MAJOR) MAJOR = new Set([...POPULAR, ...NA_GW, ...CARRIERS.flatMap((c) => c.hubs), "CAI", "CMN", "TUN", "ALG", "KWI", "BAH", "MCT", "SIN", "HKG", "BKK", "KUL", "DEL", "BOM", "NBO", "ADD", "JNB", "SYD", "GRU", "LGW", "MAN", "FCO", "MAD", "BCN"]);
    return MAJOR.has(code);
  };

  function searchAirports(q) {
    const qn = norm(q).trim();
    if (!qn) return { title: "وجهات شائعة", list: POPULAR.map((c) => BY[c]).filter(Boolean) };
    const words = qn.split(/\s+/);
    const scored = [];
    for (const a of DB) {
      let s = 0;
      if (a.kCode === qn) s = 1000;
      else if (a.kAr && a.kAr.startsWith(qn)) s = 650;
      else if (a.kCity.startsWith(qn)) s = 560;
      else if (a.kCountry.split(" ").some((w) => w.startsWith(qn)) || a.kCountry.startsWith(qn)) s = 320;
      else if (words.every((w) => a.kAll.includes(w))) s = a.kAll.split(/[\s/,-]+/).some((w) => w.startsWith(words[0])) ? 220 : 120;
      else if (qn.length === 3 && a.kCode.startsWith(qn.slice(0, 2))) s = 0;
      if (s > 0) scored.push([s - a.rank * 45 + (isMajor(a.code) ? 70 : 0), a]);
    }
    scored.sort((x, y) => y[0] - x[0]);
    const list = scored.slice(0, 40).map((x) => x[1]);
    const countryHit = list.length && scored[0][0] < 400 && scored[0][0] >= 230;
    return { title: countryHit ? `مطارات ${list[0].car}` : "", list };
  }

  /* ---------- Autocomplete widget ---------- */
  function attachAutocomplete(input) {
    const field = input.closest(".field");
    const box = document.createElement("div");
    box.className = "ac";
    box.id = input.id + "-ac";
    box.setAttribute("role", "listbox");
    box.hidden = true;
    field.appendChild(box);
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", box.id);
    input.setAttribute("aria-expanded", "false");
    let items = [], active = -1;

    const close = () => { box.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; };
    const choose = (a) => {
      input.value = label(a);
      input.dataset.code = a.code;
      close();
      field.classList.remove("is-invalid");
      input.dispatchEvent(new CustomEvent("airport-chosen", { bubbles: true }));
    };
    const render = () => {
      const { title, list } = searchAirports(input.value);
      items = list;
      active = list.length ? 0 : -1;
      if (!list.length) {
        box.innerHTML = `<p class="ac__empty">لم نجد مطاراً بهذا الاسم. جرّب اسم المدينة أو الدولة أو رمز المطار (مثل ORD)، أو اكتب لنا على واتساب ونحجز لك.</p>`;
      } else {
        box.innerHTML = (title ? `<p class="ac__title">${esc(title)}</p>` : "") +
          `<ul>${list.map((a, i) => `<li role="option" id="${box.id}-${i}" data-i="${i}" class="${i === 0 ? "is-active" : ""}" aria-selected="${i === 0}">
            <b class="ac__code">${a.code}</b>
            <span class="ac__text"><span class="ac__city">${esc(a.ar || a.city || a.name)}${a.ar && a.city ? ` <small dir="ltr">${esc(a.city)}</small>` : ""}</span>
            <small class="ac__sub"><span dir="ltr">${esc(a.name)}</span> · ${esc(a.car)}</small></span>
            ${a.rank === 0 ? '<span class="ac__tag">رئيسي</span>' : ""}</li>`).join("")}</ul>`;
      }
      box.hidden = false;
      input.setAttribute("aria-expanded", "true");
      input.setAttribute("aria-activedescendant", active >= 0 ? `${box.id}-0` : "");
    };
    const move = (d) => {
      if (!items.length) return;
      const lis = $$("li", box);
      lis[active]?.classList.remove("is-active");
      lis[active]?.setAttribute("aria-selected", "false");
      active = (active + d + items.length) % items.length;
      lis[active].classList.add("is-active");
      lis[active].setAttribute("aria-selected", "true");
      lis[active].scrollIntoView({ block: "nearest" });
      input.setAttribute("aria-activedescendant", lis[active].id);
    };
    const open = () => {
      loadAirports().then(render).catch(() => {
        box.innerHTML = '<p class="ac__empty">تعذّر تحميل قائمة المطارات. اكتب رمز المطار المكوّن من 3 أحرف (مثل ORD).</p>';
        box.hidden = false;
      });
    };
    input.addEventListener("focus", () => { if (!input.dataset.code) open(); });
    input.addEventListener("click", () => { if (box.hidden) open(); });
    input.addEventListener("input", () => { delete input.dataset.code; open(); });
    input.addEventListener("keydown", (e) => {
      if (box.hidden && (e.key === "ArrowDown" || e.key === "ArrowUp")) { open(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter" && !box.hidden && active >= 0) { e.preventDefault(); choose(items[active]); }
      else if (e.key === "Escape" && !box.hidden) { e.stopPropagation(); close(); }
      else if (e.key === "Tab" && !box.hidden && active >= 0 && input.value.trim() && !input.dataset.code) choose(items[active]);
    });
    box.addEventListener("pointerdown", (e) => {
      const li = e.target.closest("li[data-i]");
      if (!li) return;
      e.preventDefault();
      choose(items[+li.dataset.i]);
    });
    input.addEventListener("blur", () => setTimeout(close, 120));
  }

  function resolveAirport(input) {
    if (!DB) return null;
    if (input.dataset.code && BY[input.dataset.code]) return BY[input.dataset.code];
    const v = input.value.trim();
    const m = v.match(/\(([A-Za-z]{3})\)\s*$/) || v.match(/^([A-Za-z]{3})$/);
    if (m && BY[m[1].toUpperCase()]) return BY[m[1].toUpperCase()];
    if (v) { const r = searchAirports(v).list; if (r.length === 1 || (r.length && norm(r[0].ar) === norm(v))) return r[0]; }
    return null;
  }

  /* ---------- Fare engine (estimates) ---------- */
  const CARRIERS = [
    ["EK", "طيران الإمارات", "AE", ["DXB"], "#D71921", 1.12, "full"], ["QR", "الخطوط القطرية", "QA", ["DOH"], "#5C0D34", 1.1, "full"],
    ["EY", "الاتحاد للطيران", "AE", ["AUH"], "#BD8B13", 1.05, "full"], ["TK", "الخطوط التركية", "TR", ["IST"], "#C70A0C", 0.98, "full"],
    ["SV", "الخطوط السعودية", "SA", ["JED", "RUH"], "#026938", 1.0, "full"], ["XY", "طيران ناس", "SA", ["RUH", "JED"], "#1B2D5B", 0.7, "low"],
    ["FZ", "فلاي دبي", "AE", ["DXB"], "#1A3D6E", 0.74, "low"], ["MS", "مصر للطيران", "EG", ["CAI"], "#00265D", 0.92, "full"],
    ["RJ", "الملكية الأردنية", "JO", ["AMM"], "#7A1E3B", 0.95, "full"], ["GF", "طيران الخليج", "BH", ["BAH"], "#AE8F4E", 0.96, "full"],
    ["WY", "الطيران العُماني", "OM", ["MCT"], "#8C6E3D", 0.98, "full"], ["KU", "الخطوط الكويتية", "KW", ["KWI"], "#0B4EA2", 0.95, "full"],
    ["ME", "طيران الشرق الأوسط", "LB", ["BEY"], "#00843D", 1.0, "full"], ["AT", "الخطوط الملكية المغربية", "MA", ["CMN"], "#C1272D", 0.93, "full"],
    ["TU", "الخطوط التونسية", "TN", ["TUN"], "#D0021B", 0.9, "full"], ["AH", "الخطوط الجوية الجزائرية", "DZ", ["ALG"], "#D7141A", 0.9, "full"],
    ["PC", "طيران بيغاسوس", "TR", ["SAW"], "#FDC300", 0.68, "low"], ["LH", "لوفتهانزا", "DE", ["FRA", "MUC"], "#05164D", 1.08, "full"],
    ["AF", "الخطوط الفرنسية", "FR", ["CDG"], "#002157", 1.06, "full"], ["KL", "الخطوط الهولندية", "NL", ["AMS"], "#00A1DE", 1.04, "full"],
    ["BA", "الخطوط البريطانية", "GB", ["LHR"], "#2E5C99", 1.1, "full"], ["IB", "إيبيريا", "ES", ["MAD"], "#D7192D", 0.98, "full"],
    ["LX", "الخطوط السويسرية", "CH", ["ZRH"], "#E2001A", 1.1, "full"], ["OS", "الخطوط النمساوية", "AT", ["VIE"], "#E30613", 1.02, "full"],
    ["AA", "الخطوط الأمريكية", "US", ["DFW", "ORD", "MIA", "CLT", "PHL", "JFK"], "#0078D2", 1.0, "full"],
    ["UA", "يونايتد إيرلاينز", "US", ["ORD", "EWR", "IAD", "SFO", "IAH", "DEN"], "#002244", 1.0, "full"],
    ["DL", "دلتا إيرلاينز", "US", ["ATL", "JFK", "DTW", "MSP", "SEA", "LAX"], "#C01933", 1.02, "full"],
    ["WN", "ساوث ويست", "US", [], "#304CB2", 0.78, "low"], ["AC", "طيران كندا", "CA", ["YYZ", "YUL", "YVR"], "#F01428", 1.0, "full"],
    ["SQ", "الخطوط السنغافورية", "SG", ["SIN"], "#F99F1C", 1.12, "full"], ["CX", "كاثي باسيفيك", "HK", ["HKG"], "#006564", 1.08, "full"],
    ["QF", "كانتاس", "AU", ["SYD", "MEL"], "#E40000", 1.08, "full"], ["AI", "طيران الهند", "IN", ["DEL", "BOM"], "#DA0E29", 0.88, "full"],
    ["ET", "الخطوط الإثيوبية", "ET", ["ADD"], "#078930", 0.9, "full"], ["KQ", "الخطوط الكينية", "KE", ["NBO"], "#B5121B", 0.95, "full"],
    ["PK", "الخطوط الباكستانية", "PK", ["KHI", "ISB", "LHE"], "#006A4E", 0.85, "full"],
  ].map(([c, n, cc, hubs, col, tier, type]) => ({ c, n, cc, hubs, col, tier, type }));

  // Continents each airline flies to (OurAirports codes: NA, SA, EU, AF, AS, OC)
  const REACH = {
    EK: "NA SA EU AF AS OC", QR: "NA SA EU AF AS OC", EY: "NA EU AF AS OC", TK: "NA SA EU AF AS OC", SV: "NA EU AF AS",
    XY: "EU AF AS", FZ: "EU AF AS", MS: "NA EU AF AS", RJ: "NA EU AF AS", GF: "EU AF AS", WY: "EU AF AS", KU: "NA EU AF AS",
    ME: "EU AF AS", AT: "NA SA EU AF AS", TU: "EU AF AS", AH: "EU AF AS", PC: "EU AF AS",
    LH: "NA SA EU AF AS OC", AF: "NA SA EU AF AS OC", KL: "NA SA EU AF AS", BA: "NA SA EU AF AS OC", IB: "NA SA EU AF AS",
    LX: "NA SA EU AF AS", OS: "NA EU AF AS", AA: "NA SA EU AS OC", UA: "NA SA EU AS OC AF", DL: "NA SA EU AS OC AF", WN: "NA",
    AC: "NA SA EU AS OC", SQ: "NA EU AS OC", CX: "NA EU AS OC", QF: "NA EU AS OC", AI: "NA EU AS OC", ET: "NA SA EU AF AS", KQ: "EU AF AS", PK: "EU AS",
  };
  const homeCont = (cr) => (BY[cr.hubs[0]] || {}).cont;
  function carrierServes(cr, a) {
    const hc = homeCont(cr);
    if (a.cont === hc || a.cc === cr.cc) return true;
    if (!(REACH[cr.c] || "").includes(a.cont)) return false;
    if (a.rank !== 0) return false;
    if (a.cont === "NA" && !NA_GW.has(a.code)) return false;
    return true;
  }

  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dist = (a, b) => {
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rnd = (seed) => { let t = seed >>> 0; return () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; };
  const tz = (a) => Math.round(a.lon / 15);
  const legMinutes = (km) => Math.round((km / 830) * 60 + 32);
  const baseFare = (km) => (km < 3000 ? 45 + 0.1 * km : 345 + 0.068 * (km - 3000));
  const CABIN = { economy: 1, premium: 1.65, business: 3.3, first: 5.4 };
  const CABIN_AR = { economy: "الدرجة السياحية", premium: "السياحية الممتازة", business: "درجة رجال الأعمال", first: "الدرجة الأولى" };

  function routeOptions(o, d) {
    const km = dist(o, d);
    const domestic = o.cc === d.cc;
    const small = o.rank === 2 || d.rank === 2;
    const out = [];
    for (const cr of CARRIERS) {
      if (cr.type === "low" && km > 5200) continue;
      if (cr.c === "WN" && !(domestic && o.cc === "US")) continue;
      const home = cr.cc === o.cc || cr.cc === d.cc;
      if (domestic && cr.cc !== o.cc) continue;
      if (!domestic && (!carrierServes(cr, o) || !carrierServes(cr, d))) continue;
      const servesEnd = cr.hubs.includes(o.code) || cr.hubs.includes(d.code);
      const directOk = (home || servesEnd) && km < 15800 && (!small || km < 1800) && (domestic || servesEnd || (o.rank === 0 && d.rank === 0 && km < 9000));
      if (directOk && (servesEnd || domestic || home)) out.push({ cr, via: null, km, legs: [km] });
      let best = null;
      for (const hc of cr.hubs) {
        const h = BY[hc];
        if (!h || hc === o.code || hc === d.code) continue;
        const a1 = dist(o, h), a2 = dist(h, d);
        if (a1 < 250 || a2 < 250) continue;
        const ratio = (a1 + a2) / km;
        if (ratio <= (home ? 1.45 : 1.2) && (!best || ratio < best.ratio)) best = { h, a1, a2, ratio };
      }
      if (best && !(directOk && cr.type === "low")) out.push({ cr, via: best.h, km, legs: [best.a1, best.a2] });
    }
    if (!out.length) {
      const generic = { c: "", n: domestic ? "شركة طيران محلية" : "شركة طيران شريكة", cc: o.cc, hubs: [], col: "#5b6b82", tier: 1, type: "full" };
      out.push({ cr: generic, via: null, km, legs: [km] });
      if (!domestic) {
        const hubs = ["DXB", "DOH", "IST", "FRA", "CDG", "LHR", "AMS"].map((c) => BY[c]).filter(Boolean);
        const h = hubs.sort((x, y) => dist(o, x) + dist(x, d) - (dist(o, y) + dist(y, d)))[0];
        if (h && h.code !== o.code && h.code !== d.code) out.push({ cr: generic, via: h, km, legs: [dist(o, h), dist(h, d)] });
      }
    }
    return out;
  }

  function priceFor(opt, dateIso, cabin, seedKey) {
    const r = rnd(hash(seedKey));
    const days = Math.max(0, Math.round((new Date(dateIso) - new Date(new Date().toDateString())) / 864e5));
    const adv = days < 7 ? 1.38 : days < 21 ? 1.16 : days < 60 ? 1 : 0.94;
    const dow = new Date(dateIso).getDay();
    const wk = dow === 5 || dow === 6 || dow === 0 ? 1.06 : 1;
    const stop = opt.via ? 0.9 : 1.1;
    let p = baseFare(opt.km) * opt.cr.tier * adv * wk * stop * CABIN[cabin] * (0.9 + r() * 0.22);
    return Math.max(39, p);
  }

  const SLOTS = [60, 135, 370, 455, 530, 615, 720, 805, 890, 985, 1080, 1170, 1265, 1350];
  function buildLeg(opt, from, to, dateIso, seedKey) {
    const r = rnd(hash(seedKey + "t"));
    const dep = SLOTS[Math.floor(r() * SLOTS.length)];
    const layover = opt.via ? 70 + Math.floor(r() * 170) : 0;
    const flying = opt.legs.reduce((s, k) => s + legMinutes(k), 0);
    const dur = flying + layover;
    const arrLocal = dep + dur + (tz(to) - tz(from)) * 60;
    return { from, to, via: opt.via, dateIso, dep, arr: ((arrLocal % 1440) + 1440) % 1440, plus: Math.floor(arrLocal / 1440), dur, layover };
  }

  function generate(q, departIso, returnIso) {
    const out = [];
    const optsOut = routeOptions(q.o, q.d);
    const optsRet = returnIso ? routeOptions(q.d, q.o) : null;
    const paxF = q.pax.adults + q.pax.children * 0.78 + q.pax.infants * 0.12;
    optsOut.forEach((opt, idx) => {
      if ((opt.cr.type === "low") && (q.cabin === "business" || q.cabin === "first")) return;
      const reps = opt.via ? 1 : 2;
      for (let k = 0; k < reps; k++) {
        const key = `${q.o.code}-${q.d.code}-${departIso}-${opt.cr.c || "G"}-${opt.via ? opt.via.code : "D"}-${k}`;
        if (k === 1 && rnd(hash(key))() < 0.45) continue;
        let per = priceFor(opt, departIso, q.cabin, key);
        const legOut = buildLeg(opt, q.o, q.d, departIso, key);
        let legRet = null;
        if (optsRet) {
          const back = optsRet.find((x) => x.cr === opt.cr && !!x.via === !!opt.via) || optsRet.find((x) => x.cr === opt.cr) || optsRet[0];
          const rkey = `${q.d.code}-${q.o.code}-${returnIso}-${back.cr.c || "G"}-${back.via ? back.via.code : "D"}-${k}`;
          per = (per + priceFor(back, returnIso, q.cabin, rkey)) * 0.93;
          legRet = buildLeg(back, q.d, q.o, returnIso, rkey);
        }
        per = Math.round(per);
        out.push({ id: key, cr: opt.cr, legs: legRet ? [legOut, legRet] : [legOut], stops: opt.via ? 1 : 0, per, total: Math.round(per * paxF), dur: legOut.dur + (legRet ? legRet.dur : 0) });
      }
    });
    return out;
  }

  /* ---------- Formatting ---------- */
  const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const durAr = (m) => `${Math.floor(m / 60)}س ${String(m % 60).padStart(2, "0")}د`;
  const dateAr = (iso, opts = { weekday: "short", day: "numeric", month: "short" }) => new Date(iso + "T12:00:00").toLocaleDateString("ar", opts);
  const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const todayIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  const cityName = (a) => a.ar || a.city || a.name;

  function logoHtml(cr) {
    const tile = cr.c && document.querySelector(`.airline[data-code="${cr.c}"] svg`);
    if (tile) return `<span class="fl__logo" style="--brand:${cr.col}">${tile.outerHTML}</span>`;
    return `<span class="fl__logo fl__logo--txt" style="--brand:${cr.col}">${cr.c || "✈"}</span>`;
  }

  /* ---------- Results view ---------- */
  let state = null;

  function ensureView() {
    let sec = $("#results");
    if (sec) return sec;
    sec = document.createElement("section");
    sec.id = "results";
    sec.className = "results";
    sec.hidden = true;
    sec.innerHTML = `
      <div class="container">
        <div class="res-head">
          <div class="res-head__route" id="resRoute"></div>
          <div class="res-head__actions">
            <button type="button" class="btn btn--ghost btn--sm" id="resEdit"><svg class="i"><use href="#i-search"/></svg>تعديل البحث</button>
            <button type="button" class="btn btn--ghost btn--sm res-filter-toggle" id="resFilterToggle" aria-expanded="false" aria-controls="resFilters"><svg class="i"><use href="#i-list"/></svg>الفلاتر</button>
          </div>
        </div>
        <div class="date-strip" id="resDates" role="tablist" aria-label="تواريخ قريبة"></div>
        <div class="res-body">
          <aside class="res-filters" id="resFilters" aria-label="الفلاتر">
            <div class="rf"><h4>عدد التوقفات</h4><div id="fStops"></div></div>
            <div class="rf"><h4>وقت المغادرة</h4><div id="fTimes"></div></div>
            <div class="rf"><h4>السعر الأقصى للفرد</h4><input type="range" id="fPrice" min="0" max="100" step="1"><div class="rf__range"><span id="fPriceMin"></span><b id="fPriceVal"></b></div></div>
            <div class="rf"><h4>شركات الطيران</h4><div id="fAir"></div></div>
            <button type="button" class="btn btn--ghost btn--sm btn--block" id="fReset">إعادة ضبط الفلاتر</button>
          </aside>
          <div class="res-main">
            <div class="res-sort" role="tablist" aria-label="ترتيب النتائج">
              <button type="button" class="res-sort__btn is-active" data-sort="cheap"><span>الأرخص</span><b id="sCheap" dir="ltr"></b></button>
              <button type="button" class="res-sort__btn" data-sort="fast"><span>الأسرع</span><b id="sFast"></b></button>
              <button type="button" class="res-sort__btn" data-sort="best"><span>الأفضل</span><b id="sBest" dir="ltr"></b></button>
            </div>
            <p class="res-count" id="resCount" aria-live="polite"></p>
            <div class="res-list" id="resList"></div>
            <p class="price-note"><svg class="i"><use href="#i-tag"/></svg>الأسعار تقديرية وتتغير حسب التوفر وتاريخ الحجز. يؤكد وكيلنا السعر النهائي قبل إصدار التذكرة.</p>
          </div>
        </div>
      </div>`;
    $(".hero").after(sec);

    $("#resEdit", sec).addEventListener("click", () => {
      $("#search").scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => $("#from").focus({ preventScroll: true }), 500);
    });
    $("#resFilterToggle", sec).addEventListener("click", (e) => {
      const open = sec.classList.toggle("filters-open");
      e.currentTarget.setAttribute("aria-expanded", String(open));
    });
    $$(".res-sort__btn", sec).forEach((b) => b.addEventListener("click", () => {
      $$(".res-sort__btn", sec).forEach((x) => x.classList.toggle("is-active", x === b));
      state.sort = b.dataset.sort;
      renderList();
    }));
    $("#fPrice", sec).addEventListener("input", (e) => { state.f.max = +e.target.value; $("#fPriceVal").textContent = usd.format(state.f.max); renderList(); });
    $("#fReset", sec).addEventListener("click", () => { initFilters(); renderList(); });
    sec.addEventListener("change", (e) => {
      const t = e.target;
      if (t.name === "fStop") state.f.stops = $$('input[name="fStop"]:checked', sec).map((x) => +x.value);
      if (t.name === "fTime") state.f.times = $$('input[name="fTime"]:checked', sec).map((x) => +x.value);
      if (t.name === "fAir") state.f.air = $$('input[name="fAir"]:checked', sec).map((x) => x.value);
      renderList();
    });
    $("#resDates", sec).addEventListener("click", (e) => {
      const b = e.target.closest("[data-date]");
      if (!b) return;
      const shift = Math.round((new Date(b.dataset.date) - new Date(state.depart)) / 864e5);
      state.depart = b.dataset.date;
      if (state.ret) state.ret = addDays(state.ret, shift);
      $("#depart").value = state.depart;
      if (state.ret) $("#return").value = state.ret;
      run(true);
    });
    $("#resList", sec).addEventListener("click", (e) => {
      const b = e.target.closest("[data-book-flight]");
      if (b) book(state.results.find((r) => r.id === b.dataset.bookFlight));
    });
    return sec;
  }

  const TIME_BUCKETS = [["فجراً", "00–06", 0, 360], ["صباحاً", "06–12", 360, 720], ["ظهراً", "12–18", 720, 1080], ["مساءً", "18–24", 1080, 1440]];
  const airName = (cr) => cr.n;

  function initFilters() {
    const res = state.results;
    const prices = res.map((r) => r.per);
    const min = Math.min(...prices), max = Math.max(...prices);
    state.f = { stops: [0, 1], times: [0, 1, 2, 3], air: [...new Set(res.map((r) => airName(r.cr)))], max };
    const cheapest = (fn) => { const l = res.filter(fn); return l.length ? usd.format(Math.min(...l.map((r) => r.per))) : "—"; };
    $("#fStops").innerHTML = [[0, "مباشر"], [1, "توقف واحد"]].map(([v, t]) => `<label class="rf__opt"><input type="checkbox" name="fStop" value="${v}" checked ${res.some((r) => r.stops === v) ? "" : "disabled"}><span>${t}</span><small>${cheapest((r) => r.stops === v)}</small></label>`).join("");
    $("#fTimes").innerHTML = TIME_BUCKETS.map(([t, h], i) => `<label class="rf__opt"><input type="checkbox" name="fTime" value="${i}" checked><span>${t} <small dir="ltr">${h}</small></span></label>`).join("");
    const airs = [...new Set(res.map((r) => airName(r.cr)))].map((n) => [n, Math.min(...res.filter((r) => airName(r.cr) === n).map((r) => r.per))]).sort((a, b) => a[1] - b[1]);
    $("#fAir").innerHTML = airs.map(([n, p]) => `<label class="rf__opt"><input type="checkbox" name="fAir" value="${esc(n)}" checked><span>${esc(n)}</span><small>${usd.format(p)}</small></label>`).join("");
    const pr = $("#fPrice");
    pr.min = min; pr.max = max; pr.value = max; pr.step = Math.max(1, Math.round((max - min) / 60));
    $("#fPriceMin").textContent = usd.format(min);
    $("#fPriceVal").textContent = usd.format(max);
  }

  function filtered() {
    const f = state.f;
    return state.results.filter((r) => {
      const dep = r.legs[0].dep;
      const bucket = TIME_BUCKETS.findIndex(([, , a, b]) => dep >= a && dep < b);
      return f.stops.includes(r.stops) && f.times.includes(bucket) && f.air.includes(airName(r.cr)) && r.per <= f.max;
    });
  }
  const score = (r, minP, minD) => r.per / minP + (r.dur / minD) * 0.8;

  function legHtml(l, label) {
    const stopTxt = l.via ? `توقف في <b dir="ltr">${l.via.code}</b> · ${durAr(l.layover)}` : "مباشر";
    return `<div class="leg">
      <span class="leg__tag">${label}<small>${dateAr(l.dateIso)}</small></span>
      <div class="leg__pt"><b dir="ltr">${hm(l.dep)}</b><span dir="ltr">${l.from.code}</span><small>${esc(cityName(l.from))}</small></div>
      <div class="leg__mid"><small>${durAr(l.dur)}</small><div class="leg__line ${l.via ? "has-stop" : ""}"><i></i><svg class="i"><use href="#i-plane"/></svg></div><small class="${l.via ? "is-stop" : "is-direct"}">${stopTxt}</small></div>
      <div class="leg__pt"><b dir="ltr">${hm(l.arr)}${l.plus ? `<sup>+${l.plus}</sup>` : ""}</b><span dir="ltr">${l.to.code}</span><small>${esc(cityName(l.to))}</small></div>
    </div>`;
  }

  function renderList() {
    const list = filtered();
    const all = state.results;
    const minP = Math.min(...all.map((r) => r.per)), minD = Math.min(...all.map((r) => r.dur));
    const sorters = { cheap: (a, b) => a.per - b.per, fast: (a, b) => a.dur - b.dur, best: (a, b) => score(a, minP, minD) - score(b, minP, minD) };
    const byCheap = [...all].sort(sorters.cheap)[0], byFast = [...all].sort(sorters.fast)[0], byBest = [...all].sort(sorters.best)[0];
    $("#sCheap").textContent = usd.format(byCheap.per);
    $("#sFast").textContent = durAr(byFast.legs[0].dur);
    $("#sBest").textContent = usd.format(byBest.per);
    list.sort(sorters[state.sort]);
    const n = state.pax.adults + state.pax.children + state.pax.infants;
    $("#resCount").textContent = list.length ? `${list.length} خيار من ${all.length} · الأسعار بالدولار الأمريكي` : "";
    $("#resList").innerHTML = list.length
      ? list.map((r, i) => `<article class="fl" style="--d:${Math.min(i, 8) * 60}ms">
          ${r.id === byCheap.id ? '<span class="fl__badge">الأرخص</span>' : r.id === byFast.id ? '<span class="fl__badge fl__badge--fast">الأسرع</span>' : ""}
          <div class="fl__air">${logoHtml(r.cr)}<div><b>${esc(r.cr.n)}</b><small>${CABIN_AR[state.cabin]}${r.cr.type === "low" ? " · منخفض التكلفة" : ""}</small></div></div>
          <div class="fl__legs">${r.legs.map((l, j) => legHtml(l, r.legs.length > 1 ? (j ? "العودة" : "الذهاب") : "الذهاب")).join("")}</div>
          <div class="fl__price"><small>تقديري للفرد</small><b dir="ltr">${usd.format(r.per)}</b><small>${n > 1 ? `الإجمالي <span dir="ltr">${usd.format(r.total)}</span> · ${n} مسافرين` : r.legs.length > 1 ? "ذهاب وعودة" : "ذهاب فقط"}</small>
            <button type="button" class="btn btn--accent btn--sm" data-book-flight="${r.id}">احجز الآن</button></div>
        </article>`).join("")
      : `<div class="res-empty"><svg class="i"><use href="#i-search"/></svg><h3>لا توجد نتائج مطابقة للفلاتر</h3><p>غيّر الفلاتر أو أعد ضبطها لرؤية كل الخيارات.</p></div>`;
  }

  function renderDates() {
    const t = todayIso();
    const days = [];
    for (let k = -3; k <= 3; k++) {
      const dIso = addDays(state.depart, k);
      if (dIso < t) continue;
      const rIso = state.ret ? addDays(state.ret, k) : null;
      const res = generate(state, dIso, rIso);
      days.push([dIso, res.length ? Math.min(...res.map((r) => r.per)) : null]);
    }
    const low = Math.min(...days.map((d) => d[1] || Infinity));
    $("#resDates").innerHTML = days.map(([dIso, p]) => `<button type="button" role="tab" data-date="${dIso}" class="${dIso === state.depart ? "is-active" : ""} ${p === low ? "is-low" : ""}" aria-selected="${dIso === state.depart}">
        <span>${dateAr(dIso)}</span><b dir="ltr">${p ? usd.format(p) : "—"}</b></button>`).join("");
  }

  function renderHead() {
    const s = state;
    const n = s.pax.adults + s.pax.children + s.pax.infants;
    $("#resRoute").innerHTML = `<h2><span>${esc(cityName(s.o))} <small dir="ltr">${s.o.code}</small></span><svg class="i"><use href="#i-${s.ret ? "swap" : "arrow"}"/></svg><span>${esc(cityName(s.d))} <small dir="ltr">${s.d.code}</small></span></h2>
      <p>${dateAr(s.depart, { weekday: "long", day: "numeric", month: "long" })}${s.ret ? ` – ${dateAr(s.ret, { weekday: "long", day: "numeric", month: "long" })}` : ""} · ${n} ${n === 1 ? "مسافر" : "مسافرين"} · ${CABIN_AR[s.cabin]} · ${s.o.cc === s.d.cc ? "رحلة داخلية" : "رحلة دولية"} · <span dir="ltr">${Math.round(dist(s.o, s.d)).toLocaleString("en-US")} km</span></p>`;
  }

  function showLoading() {
    $("#resList").innerHTML = `<div class="res-loading"><div class="res-loading__bar"><svg class="i"><use href="#i-plane"/></svg></div><p>نبحث في رحلات أكثر من 35 شركة طيران…</p></div>` +
      Array.from({ length: 3 }, () => '<div class="fl fl--skel"><i></i><i></i><i></i></div>').join("");
    $("#resCount").textContent = "";
  }

  function run(keepScroll) {
    const sec = ensureView();
    document.body.classList.add("is-results");
    sec.hidden = false;
    if (location.hash !== "#results") history.pushState(null, "", "#results");
    renderHead();
    showLoading();
    if (!keepScroll) setTimeout(() => sec.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    clearTimeout(run.t);
    run.t = setTimeout(() => {
      state.results = generate(state, state.depart, state.ret);
      state.sort = state.sort || "cheap";
      renderDates();
      initFilters();
      renderList();
    }, 900);
  }

  function exitResults() {
    document.body.classList.remove("is-results");
    const sec = $("#results");
    if (sec) sec.hidden = true;
  }

  function book(r) {
    if (!r) return;
    const n = state.pax.adults + state.pax.children + state.pax.infants;
    const legTxt = (l) => `${dateAr(l.dateIso, { weekday: "short", day: "numeric", month: "long" })} · ${hm(l.dep)} ${l.from.code} ← ${hm(l.arr)}${l.plus ? "(+" + l.plus + ")" : ""} ${l.to.code} · ${l.via ? "توقف في " + l.via.code : "مباشر"}`;
    const rows = [
      ["المسار", `${cityName(state.o)} (${state.o.code}) ← ${cityName(state.d)} (${state.d.code})`],
      ["شركة الطيران", r.cr.n],
      ["الذهاب", legTxt(r.legs[0])],
      r.legs[1] ? ["العودة", legTxt(r.legs[1])] : null,
      ["المسافرون", $("#paxLabel") ? $("#paxLabel").textContent : String(n)],
      ["الدرجة", CABIN_AR[state.cabin]],
      ["السعر التقديري", `${usd.format(r.per)} للفرد${n > 1 ? ` · ${usd.format(r.total)} إجمالي` : ""}`],
    ].filter(Boolean);
    if (typeof openModal === "function") openModal("طلب حجز رحلة", rows);
  }

  /* ---------- Public API ---------- */
  window.GTFlights = {
    search(d, pax) {
      const fromEl = $("#from"), toEl = $("#to");
      if (!DB) {
        loadAirports().then(() => window.GTFlights.search(d, pax)).catch(() => toast && toast("تعذّر تحميل قائمة المطارات، حاول مجدداً"));
        return true;
      }
      const o = resolveAirport(fromEl), dd = resolveAirport(toEl);
      fromEl.closest(".field").classList.toggle("is-invalid", !o);
      toEl.closest(".field").classList.toggle("is-invalid", !dd);
      if (!o || !dd) { (o ? toEl : fromEl).focus(); toast("اختر مطار المغادرة والوصول من القائمة"); return true; }
      if (o.code === dd.code) { toast("مطار المغادرة والوصول متطابقان"); return true; }
      fromEl.value = label(o); fromEl.dataset.code = o.code;
      toEl.value = label(dd); toEl.dataset.code = dd.code;
      const ret = d.trip === "round" && d.return ? d.return : null;
      state = { o, d: dd, depart: d.depart, ret, cabin: d.cabin || "economy", pax: { ...pax }, sort: state ? state.sort : "cheap" };
      run(false);
      return true;
    },
    exit: exitResults,
  };

  /* ---------- Boot ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    ["#from", "#to"].forEach((s) => $(s) && attachAutocomplete($(s)));
    // Warm the airport list in the background so the first search is instant
    const warm = () => loadAirports().catch(() => {});
    "requestIdleCallback" in window ? requestIdleCallback(warm, { timeout: 2500 }) : setTimeout(warm, 1200);
    window.addEventListener("hashchange", () => { if (location.hash !== "#results") exitResults(); });
    window.addEventListener("popstate", () => { if (location.hash !== "#results") exitResults(); });
  });
})();
