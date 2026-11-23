/* =========================================================
   Green Travel — Partner (B2B) portal
   ---------------------------------------------------------
   Each agent signs in with their own account (Supabase Auth). The database
   only lets an agent read their own account, and partner prices are worked
   out ON THE SERVER (partner_prices / partner_request_ticket), so an agent
   never receives Green Travel's cost or fee.
   The owner can open any agent's portal without a password (b2b.html?as=<id>)
   and, signing in here directly, edit each agent's pricing.

   Pricing (set by Green Travel per partner):
     our cost (net)  = public website fare / (1 + publicMarkup)
     mode "hybrid":  fee = flat (if net < threshold), net × pct (if net ≥ threshold)
     mode "flat":    fee = flatAll on every ticket
     mode "percent": fee = net × pctAll on every ticket
     partner price   = net + fee   — always kept below the public fare
     suggested sell  = partner price × (1 + partner's own markup), capped at the public fare
   ========================================================= */
(() => {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const DEFAULT_PRICING = { mode: "hybrid", flatAll: 20, pctAll: 0.02, publicMarkup: 0.08, flat: 20, threshold: 1000, pct: 0.02 };
  const DB = window.GTDB;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  const KEY_PROFILE = "gt-b2b-profile:owner", KEY_QUOTES = "gt-b2b-quotes:";

  /* ---------- Who is using the portal ---------- */
  // ctx.role "partner": an agent (or the owner viewing one agent: ctx.ownerView); "admin": the owner editing pricing
  let ctx = null;
  const priceCache = new Map(), pending = new Set();
  const account = () => (ctx ? { role: ctx.role, id: ctx.pid, email: ctx.partner ? ctx.partner.email : "owner", creditLimit: ctx.acc ? +ctx.acc.creditLimit : 0 } : null);
  const isAdmin = () => !!ctx && ctx.role === "admin";
  const PARTNERS = () => DB.all("partners");
  const profile = () => {
    if (!ctx) return null;
    if (ctx.role === "partner") { const p = ctx.partner; return { agency: p.agency, contact: p.contact, phone: p.phone, email: p.contactEmail || p.email, website: p.website, logo: p.logo || "", sellMarkup: p.sellMarkup ?? 6 }; }
    return Object.assign({ agency: "Green Travel", contact: (DB.profile || {}).name || "", phone: "+1 (708) 963-2552", email: "info@greentravel.us", website: "www.greentravel.us", logo: "", sellMarkup: 6 }, store.get(KEY_PROFILE, {}));
  };
  let adminTarget = null; // partner id whose pricing the owner is editing/previewing
  const pricingFor = (id) => Object.assign({}, DEFAULT_PRICING, (DB.get("partners", id) || {}).pricing || {});
  const pricing = () => pricingFor(adminTarget);

  async function loadCtx() {
    ctx = null; priceCache.clear(); pending.clear();
    const pr = DB.profile;
    if (!pr || pr.status !== "active") return;
    const as = new URLSearchParams(location.search).get("as");
    if (pr.kind === "partner") ctx = { role: "partner", pid: pr.id, param: null };
    else if (pr.kind === "owner" && as) ctx = { role: "partner", pid: as, param: as, ownerView: true };
    else if (pr.kind === "owner") ctx = { role: "admin" };
    else return;
    if (ctx.role === "partner") {
      ctx.partner = await DB.partnerRow(ctx.pid);
      if (!ctx.partner) { ctx = null; return; }
      await refreshAccount();
      [400, 1250, 3000].forEach((x) => pending.add(x));
      await prepare();
    }
  }
  async function refreshAccount() { if (ctx && ctx.role === "partner") ctx.acc = await DB.partnerAccount(ctx.param); }

  // Partner prices come from the server. price() records any fare it hasn't seen; prepare() prices them in one call.
  async function prepare() {
    if (!ctx || ctx.role !== "partner" || !pending.size) return;
    const pubs = [...pending]; pending.clear();
    try { (await DB.partnerPrices(pubs, ctx.param)).forEach((x) => priceCache.set(Math.round(+x.pub), +x.partner)); } catch (e) { console.warn(e); }
  }
  function price(pub) {
    pub = Math.round(pub);
    const pr = profile();
    let partner, net = null, fee = null;
    if (isAdmin()) {
      const c = pricingFor(adminTarget);
      net = pub / (1 + c.publicMarkup);
      fee = c.mode === "flat" ? c.flatAll : c.mode === "percent" ? net * c.pctAll : net < c.threshold ? c.flat : net * c.pct;
      fee = Math.min(fee, (pub - net) * 0.6);
      partner = Math.round(net + fee);
    } else {
      partner = priceCache.get(pub);
      if (partner == null) { pending.add(pub); partner = pub; }
    }
    const sell = Math.max(partner, Math.min(pub, Math.round(partner * (1 + (pr ? pr.sellMarkup : 6) / 100))));
    return { pub, partner, sell, profit: sell - partner, net: net == null ? null : Math.round(net), fee: fee == null ? null : Math.round(fee) };
  }

  /* ---------- Login ---------- */
  function ownerBar() {
    let bar = $("#b2bOwnerBar");
    const on = !!(ctx && ctx.ownerView);
    if (!on) { if (bar) bar.remove(); return; }
    if (!bar) { bar = document.createElement("div"); bar.id = "b2bOwnerBar"; bar.className = "b2b-owner-bar"; bar.setAttribute("role", "status"); document.body.prepend(bar); }
    bar.innerHTML = `<span>${T("وضع المالك: أنت داخل حساب", "Owner view: you are inside the account of")} <b>${esc(profile().agency)}</b> ${T("بدون كلمة مرور، وترى ما يراه الوكيل فقط.", "without a password and see only what the agent sees.")}</span><a class="btn btn--sm btn--accent" href="office.html#agents">${T("العودة إلى المكتب الخلفي", "Back to the back office")}</a>`;
  }

  function showApp() {
    ownerBar();
    const logged = !!ctx;
    $("#b2bLogin").hidden = logged;
    $("#b2bApp").hidden = !logged;
    $$("[data-b2b-logout]").forEach((b) => (b.hidden = !logged));
    window.GTB2B.active = logged;
    $("#adminForm").hidden = !(logged && isAdmin());
    $("#accountCard").hidden = !(logged && !isAdmin());
    if (logged) { renderProfile(); if (isAdmin()) renderAdmin(); renderRules(); renderQuotes(); if (!isAdmin()) renderAccount(); }
  }

  function initLogin() {
    const form = $("#loginForm");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const st = $("#loginStatus"), btn = form.querySelector("[type=submit]");
      st.className = "form-status err"; st.textContent = ""; btn.disabled = true;
      let r = null;
      try { r = await DB.login($("#lgEmail").value, $("#lgPass").value); } catch (er) { st.textContent = T("تعذّر الاتصال بالخادم. حاول مرة أخرى.", "Could not reach the server. Try again."); btn.disabled = false; return; }
      btn.disabled = false;
      if (r && r.error === "inactive") { st.textContent = T("حسابك غير مفعّل حالياً. تواصل مع جرين ترافيل.", "Your account is not active. Please contact Green Travel."); return; }
      if (!r) { st.textContent = T("البريد الإلكتروني أو كلمة المرور غير صحيحة.", "Incorrect email or password."); return; }
      if (r.kind === "staff" && r.role !== "owner") { await DB.logout(); st.textContent = T("حسابات الموظفين تدخل من المكتب الخلفي.", "Staff accounts sign in through the back office."); return; }
      $("#lgPass").value = "";
      await loadCtx();
      showApp();
      window.scrollTo({ top: 0 });
    });
    $$("[data-b2b-logout]").forEach((b) => b.addEventListener("click", async () => {
      if (ctx && ctx.ownerView) { location.href = "office.html#agents"; return; }
      await DB.logout(); ctx = null;
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
  async function saveProfile(p) {
    if (ctx.role === "partner") {
      try { await DB.updatePartnerProfile({ agency: p.agency, contact: p.contact, phone: p.phone, email: p.email, website: p.website, logo: p.logo, sellMarkup: p.sellMarkup }, ctx.param); ctx.partner = await DB.partnerRow(ctx.pid); }
      catch (e) { toast(T("تعذّر الحفظ", "Could not save") + ": " + e.message); }
    } else store.set(KEY_PROFILE, p);
    renderProfile();
  }

  /* ---------- Pricing rules card ---------- */
  function renderRules() {
    const c = pricing(), admin = isAdmin();
    const pct = (c.pct * 100).toFixed(1).replace(/\.0$/, "") + "%";
    const pctAll = (c.pctAll * 100).toFixed(2).replace(/\.?0+$/, "") + "%";
    // The fee is Green Travel's margin: only the owner sees it. Partners see their price and their saving.
    $("#rulesList").hidden = !admin;
    $(".rule-mode").hidden = !admin;
    $("#rulesList").innerHTML = !admin ? "" : c.mode === "flat"
      ? `<li><b dir="ltr">${usd.format(c.flatAll)}</b><span>${T("رسم ثابت على كل تذكرة مهما كان سعرها", "flat fee on every ticket, whatever the price")}</span></li>`
      : c.mode === "percent"
      ? `<li><b dir="ltr">${pctAll}</b><span>${T("من سعر كل تذكرة", "of every ticket's price")}</span></li>`
      : `<li><b dir="ltr">${usd.format(c.flat)}</b><span>${T("رسم ثابت لكل تذكرة أقل من", "flat fee per ticket under")} <b dir="ltr">${usd.format(c.threshold)}</b></span></li>
         <li><b dir="ltr">${pct}</b><span>${T("للتذاكر من هذا المبلغ فأكثر", "for tickets at or above that amount")}</span></li>`;
    $("#ruleMode").textContent = c.mode === "flat" ? T("سعر ثابت", "Flat rate") : c.mode === "percent" ? T("نسبة مئوية", "Percentage") : T("ثابت + نسبة", "Flat + percentage");
    const head = $("#ruleExamples").closest("table").querySelector("thead tr");
    head.innerHTML = `<th>${T("سعر الموقع", "Website price")}</th><th>${T("سعرك", "Your price")}</th>${admin ? `<th>${T("رسم جرين ترافيل", "Green Travel fee")}</th>` : ""}<th>${T("الفرق لصالحك", "Your saving")}</th>`;
    const ex = [400, 1250, 3000].map((pub) => { const p = price(pub); return `<tr><td dir="ltr">${usd.format(pub)}</td><td dir="ltr">${usd.format(p.partner)}</td>${admin ? `<td dir="ltr">${usd.format(p.fee)}</td>` : ""}<td dir="ltr">${usd.format(p.pub - p.partner)}</td></tr>`; });
    $("#ruleExamples").innerHTML = ex.join("");
  }

  /* ---------- Green Travel admin: pricing per partner ---------- */
  function renderAdmin() {
    const list = PARTNERS();
    if (!adminTarget || !DB.get("partners", adminTarget)) adminTarget = (list[0] || {}).id;
    $("#adPartner").innerHTML = list.length ? list.map((a) => `<option value="${esc(a.id)}" ${a.id === adminTarget ? "selected" : ""}>${esc(a.agency)} · ${esc(a.email)}</option>`).join("") : `<option value="">${T("لا يوجد وكلاء بعد: أضفهم من المكتب الخلفي", "No agents yet: add them in the back office")}</option>`;
    const c = pricingFor(adminTarget);
    $$('input[name="adMode"]').forEach((r) => (r.checked = r.value === c.mode));
    $("#adFlatAll").value = c.flatAll;
    $("#adPctAll").value = +(c.pctAll * 100).toFixed(2);
    $("#adFlat").value = c.flat;
    $("#adThreshold").value = c.threshold;
    $("#adPct").value = +(c.pct * 100).toFixed(2);
    $("#adMarkup").value = +(c.publicMarkup * 100).toFixed(2);
    toggleAdminFields();
  }
  function toggleAdminFields() {
    const mode = ($('input[name="adMode"]:checked') || {}).value || "hybrid";
    $("#adFlatFields").hidden = mode !== "flat";
    $("#adPctFields").hidden = mode !== "percent";
    $("#adHybridFields").hidden = mode !== "hybrid";
  }
  function initAdmin() {
    $("#adPartner").addEventListener("change", (e) => { adminTarget = e.target.value; renderAdmin(); renderRules(); });
    $$('input[name="adMode"]').forEach((r) => r.addEventListener("change", toggleAdminFields));
    $("#adminForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const num = (id, d) => { const v = parseFloat($(id).value); return isFinite(v) && v >= 0 ? v : d; };
      const cfg = {
        mode: ["flat", "percent"].includes(($('input[name="adMode"]:checked') || {}).value) ? $('input[name="adMode"]:checked').value : "hybrid",
        pctAll: num("#adPctAll", DEFAULT_PRICING.pctAll * 100) / 100,
        flatAll: num("#adFlatAll", DEFAULT_PRICING.flatAll),
        flat: num("#adFlat", DEFAULT_PRICING.flat),
        threshold: num("#adThreshold", DEFAULT_PRICING.threshold),
        pct: num("#adPct", DEFAULT_PRICING.pct * 100) / 100,
        publicMarkup: num("#adMarkup", DEFAULT_PRICING.publicMarkup * 100) / 100,
      };
      if (!adminTarget) return;
      try { await DB.update("partners", adminTarget, { pricing: cfg }); } catch (er) { toast(er.message); return; }
      renderRules();
      toast(T("تم حفظ تسعير الشريك", "Partner pricing saved"));
      if (document.body.classList.contains("is-results")) $("#search .search__panel.is-active").requestSubmit();
    });
    $("#adReset").addEventListener("click", async () => { if (!adminTarget) return; try { await DB.update("partners", adminTarget, { pricing: { mode: "hybrid" } }); } catch (er) { toast(er.message); return; } renderAdmin(); renderRules(); toast(T("تمت إعادة التسعير الافتراضي", "Default pricing restored")); });
  }

  /* ---------- Quotes ---------- */
  let current = null;
  const quotesKey = () => KEY_QUOTES + (ctx.role === "partner" ? ctx.pid : "owner");
  const quotes = () => store.get(quotesKey(), []);
  const saveQuotes = (q) => store.set(quotesKey(), q);

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
      cabinKey: data.state.cabin, paxCount: (data.pax.adults || 0) + (data.pax.children || 0) + (data.pax.infants || 0),
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
    if (q.bookingId) entry.bookingId = q.bookingId;
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
      ? list.map((q) => { const bk = q.bookingId && ctx.acc && (ctx.acc.bookings || []).find((b) => b.id === q.bookingId); return `<tr><td dir="ltr">${esc(q.ref)}</td><td dir="ltr">${esc(q.route)}</td><td>${esc(q.customer || "—")}</td><td dir="ltr">${usd.format(q.sell)}</td><td dir="ltr" class="pos">${usd.format(q.profit)}</td><td><span class="st st--${q.status}">${STATUS[q.status] || q.status}</span>${bk ? ` <span class="pill pill--${bk.status}">${BSTATUS()[bk.status] || bk.status}</span>` : ""}</td></tr>`; }).join("")
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
    $("#qTicket").addEventListener("click", async () => {
      const q = current, btn = $("#qTicket");
      if (ctx.role === "partner" && !q.bookingId) {
        btn.disabled = true;
        try {
          const res = await DB.partnerRequest({
            pubPer: q.pub, k: q.k,
            customer: { name: $("#qCustomer").value.trim(), phone: "", email: "" },
            route: q.route, airline: q.airline, cabin: q.cabinKey || "economy",
            depart: (q.legs[0] || {}).iso || "", ret: (q.legs[1] || {}).iso || "", pax: q.paxCount || 1,
            notes: T("طلب إصدار من بوابة الشركاء · عرض ", "Ticketing request from partner portal · quote ") + q.ref,
          }, ctx.param);
          q.bookingId = res.id;
          toast(T(`تم إنشاء الحجز ${res.id} لدى جرين ترافيل`, `Booking ${res.id} created with Green Travel`));
          await refreshAccount();
        } catch (er) { btn.disabled = false; toast(T("تعذّر إرسال الطلب: ", "Could not send the request: ") + er.message); return; }
        btn.disabled = false;
      }
      recordQuote("ticketing");
      renderAccount();
      closeQuote();
      if (typeof openWaPicker === "function") openWaPicker(quoteText(true));
    });
  }

  /* ---------- Partner account with Green Travel (same data as the back office) ---------- */
  const BSTATUS = () => ({ new: T("قيد المراجعة", "In review"), quoted: T("عرض سعر", "Quoted"), confirmed: T("مؤكد", "Confirmed"), ticketed: T("صادرة", "Ticketed"), cancelled: T("ملغي", "Cancelled"), refunded: T("مسترد", "Refunded") });
  function renderAccount() {
    if (!ctx || ctx.role !== "partner" || !ctx.acc) return;
    const a = ctx.acc, lim = +a.creditLimit || 0, bal = +a.balance;
    const over = lim && bal > lim;
    $("#acBalance").textContent = usd.format(bal);
    $("#acBalance").classList.toggle("neg", bal > 0);
    $("#acCharges").textContent = usd.format(+a.charges);
    $("#acPaid").textContent = usd.format(+a.paid);
    $("#acLimit").textContent = usd.format(lim);
    $("#acAvail").textContent = usd.format(Math.max(0, lim - bal));
    $("#acOver").hidden = !over;
    const bks = a.bookings || [], pays = a.payments || [];
    $("#acBookings").innerHTML = bks.length ? bks.map((b) => `<tr><td dir="ltr">${esc(b.id)}</td><td>${new Date(b.created + "T12:00:00").toLocaleDateString(I18N.locale, { day: "numeric", month: "short" })}</td><td dir="ltr">${esc(b.route)}</td><td>${esc(b.customer || "—")}</td><td><span class="pill pill--${b.status}">${BSTATUS()[b.status] || b.status}</span></td><td dir="ltr">${esc(b.pnr || "—")}</td><td dir="ltr">${esc((b.tickets || []).join(", ") || "—")}</td><td dir="ltr">${usd.format(+b.sell)}</td></tr>`).join("")
      : `<tr><td colspan="8" class="empty">${T("لا توجد حجوزات بعد.", "No bookings yet.")}</td></tr>`;
    $("#acPayments").innerHTML = pays.length ? pays.map((p) => `<tr><td>${new Date(p.date + "T12:00:00").toLocaleDateString(I18N.locale, { day: "numeric", month: "short", year: "numeric" })}</td><td dir="ltr">${esc(p.ref || "—")}</td><td dir="ltr" class="pos">${usd.format(+p.amount)}</td></tr>`).join("")
      : `<tr><td colspan="3" class="empty">${T("لا توجد مدفوعات مسجلة.", "No payments recorded.")}</td></tr>`;
  }
  // Keep the agent's account fresh (bookings issued, payments recorded by the team)
  setInterval(async () => { if (ctx && ctx.role === "partner" && !document.hidden) { await refreshAccount().catch(() => {}); renderAccount(); renderQuotes(); } }, 60000);

  window.GTB2B = { active: false, price, prepare, openQuote };

  document.addEventListener("DOMContentLoaded", () => {
    initLogin();
    initProfile();
    initQuote();
    initAdmin();
    DB.ready.then(async () => { await loadCtx().catch((e) => console.warn(e)); showApp(); });
  });
})();
