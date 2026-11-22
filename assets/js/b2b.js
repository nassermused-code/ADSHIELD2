/* =========================================================
   Green Travel — Partner (B2B) portal  ·  DEMO MODE
   ---------------------------------------------------------
   IMPORTANT: this demo keeps accounts, profiles and quotes in the visitor's
   browser (localStorage). It is NOT secure: anyone can read this file.
   For real partners, move login and data to a backend with per-partner
   access rules (e.g. Supabase Auth + row-level security).

   Pricing rule (set by Green Travel, per partner):
     our cost (net)  = public website fare / (1 + publicMarkup)
     partner fee     = flat  (if net < threshold)
                     = net × pct  (if net ≥ threshold)
     partner price   = net + fee   — always kept below the public fare
     suggested sell  = partner price × (1 + partner's own markup), capped at the public fare
   ========================================================= */
(() => {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- Green Travel settings ---------- */
  const DEFAULT_PRICING = {
    publicMarkup: 0.08, // Green Travel's markup on the public website (used to back out our cost)
    flat: 20,           // flat fee per ticket for tickets below the threshold
    threshold: 1000,    // USD, on our cost
    pct: 0.02,          // percentage for tickets at or above the threshold (2% × $1,000 = $20, so no jump)
  };
  // Demo partner accounts. Real accounts belong on a server.
  const ACCOUNTS = [
    { email: "demo@partner.com", password: "demo1234", agency: "Demo Partner Travel", contact: "Partner Manager", phone: "+1 (312) 555-0100", partnerEmail: "demo@partner.com", website: "", pricing: {} },
  ];

  const KEY_SESSION = "gt-b2b-session", KEY_PROFILE = "gt-b2b-profile:", KEY_QUOTES = "gt-b2b-quotes:";
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };

  let session = store.get(KEY_SESSION, null);
  const account = () => ACCOUNTS.find((a) => session && a.email === session.email);
  const profile = () => {
    const a = account();
    if (!a) return null;
    return Object.assign({ agency: a.agency, contact: a.contact, phone: a.phone, email: a.partnerEmail, website: a.website, logo: "", sellMarkup: 6 }, store.get(KEY_PROFILE + a.email, {}));
  };
  const pricing = () => Object.assign({}, DEFAULT_PRICING, (account() || {}).pricing || {});

  function price(pub) {
    const c = pricing();
    const net = pub / (1 + c.publicMarkup);
    let fee = net < c.threshold ? c.flat : net * c.pct;
    fee = Math.min(fee, (pub - net) * 0.6); // safety: the partner always pays less than the public fare
    const partner = Math.round(net + fee);
    const pr = profile();
    const sell = Math.max(partner, Math.min(pub, Math.round(partner * (1 + (pr ? pr.sellMarkup : 6) / 100))));
    return { pub, net: Math.round(net), fee: Math.round(fee), partner, sell, profit: sell - partner };
  }

  /* ---------- Login ---------- */
  function showApp() {
    const logged = !!account();
    $("#b2bLogin").hidden = logged;
    $("#b2bApp").hidden = !logged;
    $$("[data-b2b-logout]").forEach((b) => (b.hidden = !logged));
    window.GTB2B.active = logged;
    if (logged) { renderProfile(); renderRules(); renderQuotes(); }
  }

  function initLogin() {
    const form = $("#loginForm");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = $("#lgEmail").value.trim().toLowerCase(), pass = $("#lgPass").value;
      const acc = ACCOUNTS.find((a) => a.email === email && a.password === pass);
      const st = $("#loginStatus");
      if (!acc) { st.textContent = T("البريد الإلكتروني أو كلمة المرور غير صحيحة.", "Incorrect email or password."); st.className = "form-status err"; return; }
      session = { email: acc.email, at: Date.now() };
      store.set(KEY_SESSION, session);
      st.textContent = "";
      showApp();
      window.scrollTo({ top: 0 });
    });
    $("#fillDemo").addEventListener("click", () => { $("#lgEmail").value = "demo@partner.com"; $("#lgPass").value = "demo1234"; });
    $$("[data-b2b-logout]").forEach((b) => b.addEventListener("click", () => {
      store.del(KEY_SESSION); session = null;
      if (window.GTFlights) window.GTFlights.exit();
      showApp();
    }));
  }

  /* ---------- Profile (branding on quotes) ---------- */
  function renderProfile() {
    const p = profile();
    $("#pfAgency").value = p.agency || "";
    $("#pfContact").value = p.contact || "";
    $("#pfPhone").value = p.phone || "";
    $("#pfEmail").value = p.email || "";
    $("#pfWebsite").value = p.website || "";
    $("#pfMarkup").value = p.sellMarkup;
    paintLogo(p.logo);
    $$("[data-agency-name]").forEach((el) => (el.textContent = p.agency || T("شريكنا", "Partner")));
  }
  function paintLogo(src) {
    const box = $("#pfLogoPreview");
    box.innerHTML = src ? `<img src="${src}" alt="">` : `<span>${esc((profile().agency || "?").slice(0, 2).toUpperCase())}</span>`;
  }
  function initProfile() {
    $("#pfLogo").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > 400 * 1024) { toast(T("الشعار كبير جداً، الحد الأقصى 400 كيلوبايت", "Logo is too large (max 400 KB)")); e.target.value = ""; return; }
      const rd = new FileReader();
      rd.onload = () => { const p = profile(); p.logo = rd.result; saveProfile(p); paintLogo(p.logo); };
      rd.readAsDataURL(f);
    });
    $("#pfLogoClear").addEventListener("click", () => { const p = profile(); p.logo = ""; saveProfile(p); paintLogo(""); });
    $("#profileForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const p = profile();
      Object.assign(p, {
        agency: $("#pfAgency").value.trim(), contact: $("#pfContact").value.trim(), phone: $("#pfPhone").value.trim(),
        email: $("#pfEmail").value.trim(), website: $("#pfWebsite").value.trim(),
        sellMarkup: Math.max(0, Math.min(30, parseFloat($("#pfMarkup").value) || 0)),
      });
      saveProfile(p);
      renderProfile();
      toast(T("تم حفظ بيانات وكالتك", "Your agency details were saved"));
      if (window.GTFlights && document.body.classList.contains("is-results")) $("#search .search__panel.is-active").requestSubmit();
    });
  }
  function saveProfile(p) { store.set(KEY_PROFILE + account().email, p); }

  /* ---------- Pricing rules card ---------- */
  function renderRules() {
    const c = pricing();
    $("#ruleFlat").textContent = usd.format(c.flat);
    $("#ruleThreshold").textContent = usd.format(c.threshold);
    $("#rulePct").textContent = (c.pct * 100).toFixed(1).replace(/\.0$/, "") + "%";
    const ex = [400, 1250, 3000].map((pub) => { const p = price(pub); return `<tr><td dir="ltr">${usd.format(pub)}</td><td dir="ltr">${usd.format(p.partner)}</td><td dir="ltr">${usd.format(p.fee)}</td><td dir="ltr">${usd.format(p.pub - p.partner)}</td></tr>`; });
    $("#ruleExamples").innerHTML = ex.join("");
  }

  /* ---------- Quotes ---------- */
  let current = null;
  const quotes = () => store.get(KEY_QUOTES + account().email, []);
  const saveQuotes = (q) => store.set(KEY_QUOTES + account().email, q);

  function openQuote(data) {
    const p = profile();
    const pr = price(data.r.pub);
    const k = data.r.total / data.r.per;
    current = {
      ref: "Q-" + new Date().toISOString().slice(2, 10).replace(/-/g, "") + "-" + String(Math.floor(Math.random() * 9000) + 1000),
      created: new Date().toISOString(),
      airline: data.r.cr.n, legs: data.legs, paxLabel: data.paxLabel, cabin: data.cabin, k,
      route: `${data.state.o.code} → ${data.state.d.code}`,
      partnerPer: pr.partner, sellPer: pr.sell, pub: pr.pub, customer: "", status: "draft",
      logoHtml: data.logo,
    };
    $("#qCustomer").value = "";
    $("#qSell").value = pr.sell;
    $("#qSell").min = pr.partner;
    paintQuote();
    const m = $("#quoteModal");
    m.hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(() => $("#qCustomer").focus(), 50);
  }

  function paintQuote() {
    const p = profile(), q = current;
    const sellTotal = Math.round(q.sellPer * q.k), partnerTotal = Math.round(q.partnerPer * q.k);
    $("#qBrand").innerHTML = `${p.logo ? `<img src="${p.logo}" alt="">` : `<span class="q-mono">${esc((p.agency || "?").slice(0, 2).toUpperCase())}</span>`}
      <div><b>${esc(p.agency)}</b><small>${[p.phone, p.email, p.website].filter(Boolean).map((x) => `<span dir="ltr">${esc(x)}</span>`).join(" · ")}</small></div>`;
    $("#qRef").textContent = q.ref;
    $("#qDate").textContent = new Date(q.created).toLocaleDateString(I18N.locale, { day: "numeric", month: "long", year: "numeric" });
    $("#qCustName").textContent = $("#qCustomer").value.trim() || T("العميل", "Customer");
    $("#qAirline").innerHTML = `${q.logoHtml}<b>${esc(q.airline)}</b><small>${esc(q.cabin)} · ${esc(q.paxLabel)}</small>`;
    $("#qLegs").innerHTML = q.legs.map((l, i) => `<div class="q-leg"><span class="q-leg__tag">${q.legs.length > 1 ? (i ? T("العودة", "Return") : T("الذهاب", "Outbound")) : T("الذهاب", "Outbound")}<small>${esc(l.date)}</small></span>
      <span class="q-leg__pt"><b dir="ltr">${l.dep}</b><span dir="ltr">${l.from}</span><small>${esc(l.fromCity)}</small></span>
      <span class="q-leg__mid"><small>${esc(l.dur)}</small><i></i><small>${l.via ? T("توقف في ", "Stop in ") + l.via : T("مباشر", "Nonstop")}</small></span>
      <span class="q-leg__pt"><b dir="ltr">${l.arr}${l.plus ? `<sup>+${l.plus}</sup>` : ""}</b><span dir="ltr">${l.to}</span><small>${esc(l.toCity)}</small></span></div>`).join("");
    $("#qTotal").textContent = usd.format(sellTotal);
    $("#qPer").textContent = usd.format(q.sellPer);
    $("#qProfit").textContent = usd.format(sellTotal - partnerTotal);
    $("#qCost").textContent = usd.format(partnerTotal);
    $("#qWarn").hidden = q.sellPer <= q.pub;
  }

  function quoteText(forGreen) {
    const p = profile(), q = current;
    const lines = q.legs.map((l, i) => `${q.legs.length > 1 ? (i ? T("العودة", "Return") : T("الذهاب", "Outbound")) : T("الذهاب", "Outbound")}: ${l.date} · ${l.from} ${l.dep} → ${l.to} ${l.arr}${l.plus ? "(+" + l.plus + ")" : ""} · ${l.via ? T("توقف في ", "stop in ") + l.via : T("مباشر", "nonstop")}`);
    const total = Math.round(q.sellPer * q.k), cost = Math.round(q.partnerPer * q.k);
    if (forGreen) {
      return T(`طلب إصدار تذكرة من شريك — ${p.agency}\nرقم العرض: ${q.ref}\n`, `Ticketing request from partner — ${p.agency}\nQuote: ${q.ref}\n`) +
        `${T("شركة الطيران", "Airline")}: ${q.airline}\n${lines.join("\n")}\n${T("المسافرون", "Travelers")}: ${q.paxLabel} · ${q.cabin}\n` +
        `${T("سعر الشريك", "Partner price")}: ${usd.format(cost)} (${usd.format(q.partnerPer)} ${T("للفرد", "per person")})\n` +
        `${T("العميل", "Customer")}: ${$("#qCustomer").value.trim() || "—"}\n${T("تواصل الشريك", "Partner contact")}: ${p.contact} · ${p.phone} · ${p.email}`;
    }
    return `${p.agency}\n${T("عرض سعر رحلة طيران", "Flight quote")} ${q.ref}\n${T("إلى", "For")}: ${$("#qCustomer").value.trim() || T("العميل", "Customer")}\n\n` +
      `${q.airline}\n${lines.join("\n")}\n${T("المسافرون", "Travelers")}: ${q.paxLabel} · ${q.cabin}\n\n` +
      `${T("السعر الإجمالي", "Total price")}: ${usd.format(total)}\n${T("السعر صالح لمدة 24 ساعة ويخضع للتوفر حتى إصدار التذكرة.", "Price valid for 24 hours, subject to availability until ticketing.")}\n\n` +
      `${p.contact ? p.contact + " · " : ""}${p.phone || ""}${p.email ? " · " + p.email : ""}`;
  }

  function recordQuote(status) {
    const list = quotes();
    const q = current;
    const entry = { ref: q.ref, created: q.created, route: q.route, airline: q.airline, customer: $("#qCustomer").value.trim(), sell: Math.round(q.sellPer * q.k), profit: Math.round((q.sellPer - q.partnerPer) * q.k), status };
    const i = list.findIndex((x) => x.ref === q.ref);
    if (i >= 0) list[i] = Object.assign(list[i], entry); else list.unshift(entry);
    saveQuotes(list.slice(0, 100));
    renderQuotes();
  }

  function renderQuotes() {
    const list = quotes();
    const STATUS = { draft: T("مسودة", "Draft"), sent: T("أُرسل للعميل", "Sent to customer"), ticketing: T("طُلب الإصدار", "Ticketing requested") };
    $("#kpiQuotes").textContent = list.length;
    $("#kpiProfit").textContent = usd.format(list.reduce((s, q) => s + (q.profit || 0), 0));
    $("#kpiTicketing").textContent = list.filter((q) => q.status === "ticketing").length;
    $("#quotesList").innerHTML = list.length
      ? list.map((q) => `<tr><td dir="ltr">${esc(q.ref)}</td><td dir="ltr">${esc(q.route)}</td><td>${esc(q.customer || "—")}</td><td dir="ltr">${usd.format(q.sell)}</td><td dir="ltr" class="pos">${usd.format(q.profit)}</td><td><span class="st st--${q.status}">${STATUS[q.status] || q.status}</span></td></tr>`).join("")
      : `<tr><td colspan="6" class="empty">${T("لا توجد عروض بعد. ابحث عن رحلة واضغط «إنشاء عرض سعر».", "No quotes yet. Search for a flight and press “Create quote”.")}</td></tr>`;
  }

  function closeQuote() { $("#quoteModal").hidden = true; document.body.style.overflow = ""; }

  function initQuote() {
    $$("#quoteModal [data-close]").forEach((b) => b.addEventListener("click", closeQuote));
    $("#quoteModal").addEventListener("keydown", (e) => e.key === "Escape" && closeQuote());
    $("#qCustomer").addEventListener("input", paintQuote);
    $("#qSell").addEventListener("input", () => {
      const v = Math.round(parseFloat($("#qSell").value) || 0);
      current.sellPer = Math.max(current.partnerPer, v);
      paintQuote();
    });
    $("#qPrint").addEventListener("click", () => { recordQuote("draft"); window.print(); });
    $("#qWa").addEventListener("click", () => { recordQuote("sent"); window.open(`https://wa.me/?text=${encodeURIComponent(quoteText(false))}`, "_blank", "noopener"); });
    $("#qMail").addEventListener("click", () => { recordQuote("sent"); location.href = `mailto:?subject=${encodeURIComponent(profile().agency + " — " + current.ref)}&body=${encodeURIComponent(quoteText(false))}`; });
    $("#qCopy").addEventListener("click", () => {
      const txt = quoteText(false);
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast(T("تم نسخ العرض", "Quote copied"))).catch(() => toast(T("تعذّر النسخ", "Couldn't copy")));
      recordQuote("draft");
    });
    $("#qTicket").addEventListener("click", () => {
      recordQuote("ticketing");
      closeQuote();
      if (typeof openWaPicker === "function") openWaPicker(quoteText(true));
    });
  }

  window.GTB2B = { active: false, price, openQuote };

  document.addEventListener("DOMContentLoaded", () => {
    initLogin();
    initProfile();
    initQuote();
    showApp();
  });
})();
