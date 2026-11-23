/* =========================================================
   Green Travel — Back office (DEMO)
   Staff workspace on the shared store (assets/js/store.js):
   dashboard · bookings · payments · expenses · B2B agents · reports · settings
   Roles: admin (everything) · agent (dashboard, bookings, payments, agents)
   ========================================================= */
(() => {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const DB = window.GTDB;
  const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const money = (n) => `<span dir="ltr" class="num">${usd.format(Math.round(n || 0))}</span>`;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const fmtDate = (iso) => (iso ? new Date(iso + "T12:00:00").toLocaleDateString(I18N.locale, { day: "numeric", month: "short", year: "numeric" }) : "—");
  const SESSION = "gt-office-session";
  let me = null;
  try { me = JSON.parse(localStorage.getItem(SESSION) || "null"); } catch (e) {}

  /* ---------- Labels ---------- */
  const STATUS = () => ({ new: T("جديد", "New"), quoted: T("عرض سعر", "Quoted"), confirmed: T("مؤكد", "Confirmed"), ticketed: T("صادرة", "Ticketed"), cancelled: T("ملغي", "Cancelled"), refunded: T("مسترد", "Refunded") });
  const SOURCE = () => ({ website: T("الموقع", "Website"), b2b: T("شريك B2B", "B2B partner"), office: T("المكتب", "Office") });
  const METHOD = () => ({ card: T("بطاقة", "Card"), cash: T("نقداً", "Cash"), bank: T("تحويل بنكي", "Bank transfer"), zelle: "Zelle", check: T("شيك", "Check") });
  const EXP = () => ({ rent: T("إيجار", "Rent"), salaries: T("رواتب", "Salaries"), marketing: T("تسويق", "Marketing"), software: T("برامج", "Software"), utilities: T("خدمات", "Utilities"), other: T("أخرى", "Other") });
  const CABIN = () => ({ economy: T("سياحية", "Economy"), premium: T("سياحية ممتازة", "Premium"), business: T("رجال أعمال", "Business"), first: T("أولى", "First") });
  const pill = (st) => `<span class="pill pill--${st}">${STATUS()[st] || st}</span>`;
  const partnerName = (id) => (DB.get("partners", id) || {}).agency || "—";
  const isAdmin = () => me && me.role === "admin";

  /* ---------- Toast ---------- */
  let tt;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("is-visible"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("is-visible"), 2800); }

  /* ---------- Login ---------- */
  function showApp() {
    const ok = !!me;
    $("#ofLogin").hidden = ok;
    $("#ofApp").hidden = !ok;
    if (!ok) return;
    $("#ofUser").innerHTML = `<b>${esc(me.name)}</b><small>${me.role === "admin" ? T("مدير", "Admin") : T("وكيل سفر", "Travel agent")}</small>`;
    $$("[data-admin-only]").forEach((el) => (el.hidden = !isAdmin()));
    $("#demoBanner").hidden = !DB.hasDemo();
    route();
  }
  function initLogin() {
    $("#ofLoginForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const r = DB.login($("#ofEmail").value, $("#ofPass").value);
      if (!r || r.kind !== "staff") { $("#ofLoginStatus").textContent = T("بيانات الدخول غير صحيحة، أو هذا الحساب ليس حساب موظف.", "Incorrect login, or this is not a staff account."); return; }
      me = r;
      try { localStorage.setItem(SESSION, JSON.stringify(me)); } catch (er) {}
      $("#ofLoginStatus").textContent = "";
      if (!location.hash) location.hash = "dashboard";
      showApp();
    });
    $$("[data-fill]").forEach((b) => b.addEventListener("click", () => {
      const [em, pw] = b.dataset.fill.split("|");
      $("#ofEmail").value = em; $("#ofPass").value = pw;
    }));
    $("#ofLogout").addEventListener("click", () => { me = null; try { localStorage.removeItem(SESSION); } catch (e) {} showApp(); });
  }

  /* ---------- Router ---------- */
  const VIEWS = {
    dashboard: { t: () => T("لوحة التحكم", "Dashboard"), r: viewDashboard },
    bookings: { t: () => T("الحجوزات", "Bookings"), r: viewBookings },
    payments: { t: () => T("المدفوعات", "Payments"), r: viewPayments },
    agents: { t: () => T("وكلاء B2B", "B2B agents"), r: viewAgents },
    expenses: { t: () => T("المصروفات", "Expenses"), r: viewExpenses, admin: true },
    reports: { t: () => T("التقارير المالية", "Financial reports"), r: viewReports, admin: true },
    settings: { t: () => T("الإعدادات", "Settings"), r: viewSettings, admin: true },
  };
  function route() {
    if (!me) return;
    let v = location.hash.replace("#", "") || "dashboard";
    if (!VIEWS[v] || (VIEWS[v].admin && !isAdmin())) v = "dashboard";
    $$(".of-nav a").forEach((a) => a.classList.toggle("is-active", a.getAttribute("href") === "#" + v));
    $("#ofTitle").textContent = VIEWS[v].t();
    $("#ofView").innerHTML = "";
    VIEWS[v].r($("#ofView"));
    document.body.classList.remove("nav-open");
  }

  /* ---------- Shared calculations ---------- */
  const live = (b) => !["cancelled", "refunded"].includes(b.status);
  function bookingMoney(b) {
    const inn = DB.paidIn(b.id), out = DB.paidOut(b.id);
    return { inn, out, due: live(b) ? Math.max(0, b.sell - inn) : 0, payable: b.status === "ticketed" ? Math.max(0, b.cost - out) : 0, profit: live(b) ? b.sell - b.cost : 0 };
  }
  function inPeriod(dateIso, period) {
    if (period === "all") return true;
    const d = new Date(dateIso + "T12:00:00"), now = new Date();
    if (period === "month") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    if (period === "3m") { const s = new Date(); s.setMonth(s.getMonth() - 3); return d >= s; }
    if (period === "year") return d.getFullYear() === now.getFullYear();
    return true;
  }
  function pnl(period) {
    const sold = DB.all("bookings").filter((b) => b.status === "ticketed" && inPeriod(b.created, period));
    const revenue = sold.reduce((s, b) => s + b.sell, 0), cost = sold.reduce((s, b) => s + b.cost, 0);
    const exp = DB.all("expenses").filter((x) => inPeriod(x.date, period));
    const expenses = exp.reduce((s, x) => s + x.amount, 0);
    return { sold, revenue, cost, gross: revenue - cost, exp, expenses, net: revenue - cost - expenses };
  }
  function months(n) {
    const out = [], d = new Date();
    d.setDate(1);
    for (let i = n - 1; i >= 0; i--) { const m = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push([m.getFullYear(), m.getMonth()]); }
    return out;
  }

  /* ---------- Dashboard ---------- */
  function viewDashboard(el) {
    const bk = DB.all("bookings");
    const m = pnl("month");
    const custDue = bk.filter((b) => b.source !== "b2b").reduce((s, b) => s + bookingMoney(b).due, 0);
    const partDue = DB.all("partners").reduce((s, p) => s + Math.max(0, DB.partnerBalance(p.id).balance), 0);
    const payable = bk.reduce((s, b) => s + bookingMoney(b).payable, 0);
    const fresh = bk.filter((b) => b.status === "new");
    el.innerHTML = `
      <div class="kpi-grid">
        ${kpi(T("مبيعات هذا الشهر", "Sales this month"), money(m.revenue), T(`${m.sold.length} تذكرة صادرة`, `${m.sold.length} tickets issued`))}
        ${kpi(T("إجمالي الربح هذا الشهر", "Gross profit this month"), money(m.gross), m.revenue ? `${((m.gross / m.revenue) * 100).toFixed(1)}% ${T("هامش", "margin")}` : "—", "good")}
        ${kpi(T("مستحق من العملاء", "Due from customers"), money(custDue), T("حجوزات لم تُدفع بالكامل", "Bookings not fully paid"), custDue ? "warn" : "")}
        ${kpi(T("مستحق من وكلاء B2B", "Due from B2B agents"), money(partDue), T("أرصدة الوكلاء", "Agent balances"), partDue ? "warn" : "")}
        ${kpi(T("مستحق للموردين", "Owed to suppliers"), money(payable), T("تذاكر صادرة لم تُسدد تكلفتها", "Ticketed, cost not yet paid"), payable ? "bad" : "")}
        ${kpi(T("طلبات جديدة", "New requests"), `<span class="num">${fresh.length}</span>`, T("بحاجة إلى متابعة", "Need follow-up"), fresh.length ? "warn" : "")}
      </div>
      <div class="of-grid2">
        <section class="of-card"><header class="of-card__h"><h3>${T("المبيعات والأرباح (آخر 6 أشهر)", "Sales and profit (last 6 months)")}</h3></header>${chart()}</section>
        <section class="of-card"><header class="of-card__h"><h3>${T("أرصدة وكلاء B2B", "B2B agent balances")}</h3><a href="#agents" class="link-arrow">${T("الكل", "All")}</a></header>${partnerBalances()}</section>
      </div>
      <section class="of-card"><header class="of-card__h"><h3>${T("آخر الحجوزات", "Latest bookings")}</h3><a href="#bookings" class="link-arrow">${T("كل الحجوزات", "All bookings")}</a></header>${bookingTable(bk.slice(0, 6))}</section>`;
    bindRows(el);
  }
  const kpi = (label, value, sub, tone = "") => `<div class="kpi-card ${tone ? "kpi-card--" + tone : ""}"><span>${label}</span><b>${value}</b><small>${sub}</small></div>`;

  function chart() {
    const ms = months(6);
    const data = ms.map(([y, m]) => {
      const sold = DB.all("bookings").filter((b) => { const d = new Date(b.created + "T12:00:00"); return b.status === "ticketed" && d.getFullYear() === y && d.getMonth() === m; });
      const rev = sold.reduce((s, b) => s + b.sell, 0), prof = sold.reduce((s, b) => s + b.sell - b.cost, 0);
      return { label: new Date(y, m, 1).toLocaleDateString(I18N.locale, { month: "short" }), rev, prof };
    });
    const max = Math.max(1000, ...data.map((d) => d.rev));
    const W = 560, H = 220, pad = 30, bw = (W - pad * 2) / data.length;
    const y = (v) => H - pad - (v / max) * (H - pad * 2);
    const bars = data.map((d, i) => {
      const x = pad + i * bw + bw * 0.18, w = bw * 0.3;
      return `<g><rect x="${x}" y="${y(d.rev)}" width="${w}" height="${H - pad - y(d.rev)}" rx="4" class="bar-rev"><title>${d.label}: ${usd.format(d.rev)}</title></rect>
        <rect x="${x + w + 4}" y="${y(d.prof)}" width="${w}" height="${H - pad - y(d.prof)}" rx="4" class="bar-prof"><title>${d.label}: ${usd.format(d.prof)}</title></rect>
        <text x="${x + w}" y="${H - 10}" text-anchor="middle" class="ax">${d.label}</text></g>`;
    }).join("");
    const grid = [0, 0.5, 1].map((f) => `<line x1="${pad}" x2="${W - pad}" y1="${y(max * f)}" y2="${y(max * f)}" class="grid"/><text x="${pad - 6}" y="${y(max * f) + 4}" text-anchor="end" class="ax">${f ? "$" + Math.round((max * f) / 1000) + "k" : "0"}</text>`).join("");
    return `<div class="chart" dir="ltr"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${T("مخطط المبيعات والأرباح", "Sales and profit chart")}">${grid}${bars}</svg></div>
      <div class="legend"><span><i class="bar-rev"></i>${T("المبيعات", "Sales")}</span><span><i class="bar-prof"></i>${T("إجمالي الربح", "Gross profit")}</span></div>`;
  }
  function partnerBalances() {
    const ps = DB.all("partners");
    if (!ps.length) return `<p class="muted">${T("لا يوجد وكلاء بعد.", "No agents yet.")}</p>`;
    return `<ul class="bal-list">${ps.map((p) => {
      const b = DB.partnerBalance(p.id), use = p.creditLimit ? Math.min(100, (b.balance / p.creditLimit) * 100) : 0;
      return `<li><div><b>${esc(p.agency)}</b><small>${T("حد الائتمان", "Credit limit")} ${money(p.creditLimit)}</small></div><div class="bal">${money(b.balance)}<span class="meter"><i style="width:${Math.max(0, use)}%" class="${use > 80 ? "hot" : ""}"></i></span></div></li>`;
    }).join("")}</ul>`;
  }

  /* ---------- Bookings ---------- */
  function bookingTable(list) {
    if (!list.length) return `<p class="muted empty">${T("لا توجد حجوزات.", "No bookings.")}</p>`;
    return `<div class="table-wrap"><table class="of-table">
      <thead><tr><th>${T("الحجز", "Booking")}</th><th>${T("التاريخ", "Date")}</th><th>${T("العميل", "Customer")}</th><th>${T("المسار", "Route")}</th><th>${T("المصدر", "Source")}</th><th>${T("الحالة", "Status")}</th><th>${T("البيع", "Sell")}</th><th>${T("الربح", "Profit")}</th><th>${T("المتبقي", "Due")}</th></tr></thead>
      <tbody>${list.map((b) => { const m = bookingMoney(b); return `<tr data-booking="${b.id}" tabindex="0">
        <td dir="ltr" class="mono">${b.id}</td><td>${fmtDate(b.created)}</td><td>${esc(b.customer.name || "—")}</td><td dir="ltr">${esc(b.route)}</td>
        <td>${b.source === "b2b" ? `<span class="tag tag--b2b">${esc(partnerName(b.partnerId))}</span>` : `<span class="tag">${SOURCE()[b.source] || b.source}</span>`}</td>
        <td>${pill(b.status)}</td><td>${money(b.sell)}</td><td class="${m.profit > 0 ? "pos" : ""}">${money(m.profit)}</td><td class="${m.due ? "neg" : ""}">${money(m.due)}</td></tr>`; }).join("")}</tbody></table></div>`;
  }
  function bindRows(el) {
    $$("[data-booking]", el).forEach((tr) => {
      tr.addEventListener("click", () => openBooking(tr.dataset.booking));
      tr.addEventListener("keydown", (e) => e.key === "Enter" && openBooking(tr.dataset.booking));
    });
  }
  let bf = { q: "", status: "", source: "" };
  function viewBookings(el) {
    el.innerHTML = `
      <div class="of-toolbar">
        <input type="search" id="bkQ" placeholder="${T("بحث: رقم الحجز، العميل، المسار، PNR", "Search: booking, customer, route, PNR")}" value="${esc(bf.q)}">
        <select id="bkStatus"><option value="">${T("كل الحالات", "All statuses")}</option>${Object.entries(STATUS()).map(([k, v]) => `<option value="${k}" ${bf.status === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <select id="bkSource"><option value="">${T("كل المصادر", "All sources")}</option>${Object.entries(SOURCE()).map(([k, v]) => `<option value="${k}" ${bf.source === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <button type="button" class="btn btn--accent btn--sm" id="bkNew">+ ${T("حجز جديد", "New booking")}</button>
        <button type="button" class="btn btn--ghost btn--sm" id="bkCsv">CSV</button>
      </div>
      <section class="of-card" id="bkList"></section>`;
    const paint = () => {
      const q = bf.q.toLowerCase();
      const list = DB.all("bookings").filter((b) => (!bf.status || b.status === bf.status) && (!bf.source || b.source === bf.source) &&
        (!q || [b.id, b.customer.name, b.route, b.pnr, b.airline, partnerName(b.partnerId)].join(" ").toLowerCase().includes(q)));
      $("#bkList").innerHTML = bookingTable(list);
      bindRows($("#bkList"));
    };
    $("#bkQ").addEventListener("input", (e) => { bf.q = e.target.value; paint(); });
    $("#bkStatus").addEventListener("change", (e) => { bf.status = e.target.value; paint(); });
    $("#bkSource").addEventListener("change", (e) => { bf.source = e.target.value; paint(); });
    $("#bkNew").addEventListener("click", () => openBooking(null));
    $("#bkCsv").addEventListener("click", exportCsv);
    paint();
  }

  /* ---------- Booking drawer ---------- */
  function openBooking(id) {
    const b = id ? DB.get("bookings", id) : { id: "", created: today(), source: "office", partnerId: null, status: "new", customer: { name: "", phone: "", email: "" }, route: "", airline: "", cabin: "economy", depart: "", ret: "", pax: 1, travelers: [], pnr: "", tickets: [], cost: 0, sell: 0, fee: 0, notes: "" };
    const m = id ? bookingMoney(b) : { inn: 0, out: 0, due: 0, payable: 0, profit: 0 };
    const pays = id ? DB.all("payments").filter((p) => p.bookingId === id) : [];
    const partnerOpts = DB.all("partners").map((p) => `<option value="${p.id}" ${b.partnerId === p.id ? "selected" : ""}>${esc(p.agency)}</option>`).join("");
    $("#drawerBody").innerHTML = `
      <header class="dr-head"><div><span class="mono" dir="ltr">${esc(b.id || T("حجز جديد", "New booking"))}</span><h3>${esc(b.route || T("حجز جديد", "New booking"))}</h3><small>${SOURCE()[b.source] || ""}${b.partnerId ? " · " + esc(partnerName(b.partnerId)) : ""} · ${fmtDate(b.created)}</small></div>${id ? pill(b.status) : ""}</header>
      ${id ? `<div class="dr-money">
        <div><span>${T("سعر البيع", "Sell")}</span>${money(b.sell)}</div><div><span>${T("التكلفة", "Cost")}</span>${money(b.cost)}</div>
        <div><span>${T("الربح", "Profit")}</span>${money(m.profit)}</div><div class="${m.due ? "neg" : ""}"><span>${b.source === "b2b" ? T("مستحق على الوكيل", "Due from agent") : T("مستحق على العميل", "Due from customer")}</span>${money(m.due)}</div>
        <div class="${m.payable ? "neg" : ""}"><span>${T("مستحق للمورد", "Owed to supplier")}</span>${money(m.payable)}</div></div>` : ""}
      <form id="bkForm" class="dr-form" novalidate>
        <fieldset><legend>${T("الحالة والمصدر", "Status & source")}</legend><div class="f3">
          ${sel("status", T("الحالة", "Status"), STATUS(), b.status)}
          ${sel("source", T("المصدر", "Source"), SOURCE(), b.source)}
          <label class="fl"><span>${T("وكيل B2B", "B2B agent")}</span><select name="partnerId"><option value="">—</option>${partnerOpts}</select></label></div></fieldset>
        <fieldset><legend>${T("العميل", "Customer")}</legend><div class="f3">
          ${inp("cname", T("الاسم", "Name"), b.customer.name)}${inp("cphone", T("الهاتف", "Phone"), b.customer.phone, "tel", "ltr")}${inp("cemail", T("البريد", "Email"), b.customer.email, "email", "ltr")}</div></fieldset>
        <fieldset><legend>${T("الرحلة", "Trip")}</legend><div class="f3">
          ${inp("route", T("المسار (مثل ORD → AMM)", "Route (e.g. ORD → AMM)"), b.route, "text", "ltr")}${inp("airline", T("شركة الطيران", "Airline"), b.airline)}${sel("cabin", T("الدرجة", "Cabin"), CABIN(), b.cabin)}
          ${inp("depart", T("الذهاب", "Depart"), b.depart, "date")}${inp("ret", T("العودة", "Return"), b.ret, "date")}${inp("pax", T("عدد المسافرين", "Travelers"), b.pax, "number", "ltr")}</div>
          ${area("travelers", T("أسماء المسافرين (سطر لكل مسافر)", "Traveler names (one per line)"), (b.travelers || []).join("\n"))}</fieldset>
        <fieldset><legend>${T("الإصدار", "Ticketing")}</legend><div class="f3">
          ${inp("pnr", "PNR", b.pnr, "text", "ltr")}${inp("tickets", T("أرقام التذاكر (افصل بفاصلة)", "Ticket numbers (comma-separated)"), (b.tickets || []).join(", "), "text", "ltr")}</div></fieldset>
        <fieldset><legend>${T("المبالغ (USD)", "Amounts (USD)")}</legend><div class="f3">
          ${inp("cost", T("التكلفة (للمورد)", "Cost (to supplier)"), b.cost, "number", "ltr")}${inp("sell", T("سعر البيع", "Sell price"), b.sell, "number", "ltr")}
          <label class="fl"><span>${T("الربح", "Profit")}</span><output id="bkProfit" dir="ltr">${usd.format((b.sell || 0) - (b.cost || 0))}</output></label></div></fieldset>
        ${area("notes", T("ملاحظات داخلية", "Internal notes"), b.notes)}
        <div class="dr-actions">
          <button type="submit" class="btn btn--primary">${T("حفظ", "Save")}</button>
          ${id ? `<button type="button" class="btn btn--ghost" id="bkInvoice">${T("فاتورة", "Invoice")}</button>` : ""}
          ${id && isAdmin() ? `<button type="button" class="btn btn--ghost danger" id="bkDelete">${T("حذف", "Delete")}</button>` : ""}
        </div>
      </form>
      ${id ? `<section class="dr-pays"><header class="of-card__h"><h4>${T("المدفوعات على هذا الحجز", "Payments on this booking")}</h4></header>
        ${payTable(pays, true)}
        <form id="payForm" class="pay-form" novalidate>
          ${sel("dir", T("النوع", "Type"), { in: b.source === "b2b" ? T("مقبوض من الوكيل", "Received from agent") : T("مقبوض من العميل", "Received from customer"), out: T("مدفوع للمورد", "Paid to supplier") }, "in")}
          ${inp("amount", T("المبلغ", "Amount"), m.due || "", "number", "ltr")}${sel("method", T("الطريقة", "Method"), METHOD(), "card")}${inp("date", T("التاريخ", "Date"), today(), "date")}${inp("ref", T("مرجع", "Reference"), "", "text", "ltr")}
          <button type="submit" class="btn btn--accent btn--sm">+ ${T("تسجيل دفعة", "Record payment")}</button>
        </form></section>` : ""}`;
    const f = $("#bkForm");
    const upd = () => ($("#bkProfit").textContent = usd.format((+f.sell.value || 0) - (+f.cost.value || 0)));
    f.sell.addEventListener("input", upd); f.cost.addEventListener("input", upd);
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      const data = {
        status: d.status, source: d.source, partnerId: d.partnerId || null,
        customer: { name: d.cname.trim(), phone: d.cphone.trim(), email: d.cemail.trim() },
        route: d.route.trim(), airline: d.airline.trim(), cabin: d.cabin, depart: d.depart, ret: d.ret, pax: Math.max(1, +d.pax || 1),
        travelers: d.travelers.split("\n").map((s) => s.trim()).filter(Boolean), pnr: d.pnr.trim().toUpperCase(),
        tickets: d.tickets.split(",").map((s) => s.trim()).filter(Boolean), cost: +d.cost || 0, sell: +d.sell || 0, notes: d.notes,
      };
      if (data.source === "b2b" && !data.partnerId) { toast(T("اختر وكيل B2B لهذا الحجز", "Choose the B2B agent for this booking")); return; }
      if (data.status === "ticketed" && !data.pnr) { toast(T("أدخل رقم PNR قبل تحويل الحالة إلى صادرة", "Enter the PNR before marking it ticketed")); return; }
      data.fee = data.source === "b2b" ? data.sell - data.cost : 0;
      if (id) DB.update("bookings", id, data); else { const nb = DB.addBooking(Object.assign(data, { created: today(), assignedTo: me.email })); id = nb.id; }
      toast(T("تم الحفظ", "Saved"));
      openBooking(id);
      route();
    });
    if (id) {
      $("#bkInvoice").addEventListener("click", () => printInvoice(id));
      const del = $("#bkDelete");
      if (del) del.addEventListener("click", () => {
        if (del.dataset.confirm !== "1") { del.dataset.confirm = "1"; del.textContent = T("اضغط مرة أخرى للتأكيد", "Press again to confirm"); return; }
        DB.all("payments").filter((p) => p.bookingId === id).forEach((p) => DB.remove("payments", p.id));
        DB.remove("bookings", id); closeDrawer(); route(); toast(T("تم حذف الحجز", "Booking deleted"));
      });
      $("#payForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.target));
        const amount = +d.amount;
        if (!(amount > 0)) { toast(T("أدخل مبلغاً صحيحاً", "Enter a valid amount")); return; }
        DB.insert("payments", { date: d.date || today(), dir: d.dir, amount, method: d.method, bookingId: id, partnerId: d.dir === "in" ? b.partnerId : null, ref: d.ref, note: "" }, "PAY");
        toast(T("تم تسجيل الدفعة", "Payment recorded"));
        openBooking(id); route();
      });
      bindPayDelete($("#drawerBody"), () => { openBooking(id); route(); });
    }
    $("#drawer").hidden = false;
    document.body.classList.add("drawer-open");
    setTimeout(() => $("#drawer .dr-close").focus(), 30);
  }
  function closeDrawer() { $("#drawer").hidden = true; document.body.classList.remove("drawer-open"); }
  const inp = (n, l, v, type = "text", dir = "") => `<label class="fl"><span>${l}</span><input name="${n}" type="${type}" ${dir ? `dir="${dir}"` : ""} value="${esc(v ?? "")}" ${type === "number" ? 'min="0" step="any"' : ""}></label>`;
  const sel = (n, l, opts, v) => `<label class="fl"><span>${l}</span><select name="${n}">${Object.entries(opts).map(([k, t]) => `<option value="${k}" ${k === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>`;
  const area = (n, l, v) => `<label class="fl fl--wide"><span>${l}</span><textarea name="${n}" rows="2">${esc(v ?? "")}</textarea></label>`;

  /* ---------- Payments ---------- */
  function payTable(list, compact) {
    if (!list.length) return `<p class="muted empty">${T("لا توجد مدفوعات.", "No payments.")}</p>`;
    return `<div class="table-wrap"><table class="of-table">
      <thead><tr><th>${T("التاريخ", "Date")}</th><th>${T("النوع", "Type")}</th>${compact ? "" : `<th>${T("الحجز", "Booking")}</th><th>${T("الطرف", "Party")}</th>`}<th>${T("الطريقة", "Method")}</th><th>${T("مرجع", "Ref")}</th><th>${T("المبلغ", "Amount")}</th>${isAdmin() ? "<th></th>" : ""}</tr></thead>
      <tbody>${list.map((p) => `<tr><td>${fmtDate(p.date)}</td><td>${p.dir === "in" ? `<span class="tag tag--in">${T("مقبوض", "In")}</span>` : `<span class="tag tag--out">${T("مدفوع", "Out")}</span>`}</td>
        ${compact ? "" : `<td dir="ltr" class="mono">${p.bookingId ? `<a href="#" data-open="${p.bookingId}">${p.bookingId}</a>` : "—"}</td><td>${p.partnerId ? esc(partnerName(p.partnerId)) : p.dir === "out" ? T("مورد", "Supplier") : T("عميل", "Customer")}</td>`}
        <td>${METHOD()[p.method] || p.method}</td><td dir="ltr">${esc(p.ref || "")}</td><td class="${p.dir === "in" ? "pos" : "neg"}">${p.dir === "in" ? "+" : "−"}${money(p.amount)}</td>
        ${isAdmin() ? `<td><button type="button" class="x-btn" data-del-pay="${p.id}" aria-label="${T("حذف", "Delete")}">×</button></td>` : ""}</tr>`).join("")}</tbody></table></div>`;
  }
  function bindPayDelete(el, after) {
    $$("[data-del-pay]", el).forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "?"; b.title = T("اضغط مرة أخرى للحذف", "Press again to delete"); return; }
      DB.remove("payments", b.dataset.delPay); toast(T("تم حذف الدفعة", "Payment deleted")); after();
    }));
  }
  function viewPayments(el) {
    const all = DB.all("payments").slice().sort((a, b) => b.date.localeCompare(a.date));
    const inn = all.filter((p) => p.dir === "in").reduce((s, p) => s + p.amount, 0), out = all.filter((p) => p.dir === "out").reduce((s, p) => s + p.amount, 0);
    const exp = DB.all("expenses").reduce((s, x) => s + x.amount, 0);
    el.innerHTML = `
      <div class="kpi-grid kpi-grid--3">
        ${kpi(T("إجمالي المقبوضات", "Total received"), money(inn), T("من العملاء والوكلاء", "From customers and agents"), "good")}
        ${kpi(T("إجمالي المدفوع للموردين", "Total paid to suppliers"), money(out), T("شركات الطيران والموردون", "Airlines and suppliers"))}
        ${kpi(T("صافي النقد", "Net cash"), money(inn - out - exp), T("بعد المصروفات", "After expenses"), inn - out - exp >= 0 ? "good" : "bad")}
      </div>
      <div class="of-toolbar"><button type="button" class="btn btn--accent btn--sm" id="payAgent">+ ${T("دفعة من وكيل B2B", "Payment from B2B agent")}</button></div>
      <section class="of-card">${payTable(all, false)}</section>`;
    $$("[data-open]", el).forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); openBooking(a.dataset.open); }));
    bindPayDelete(el, route);
    $("#payAgent").addEventListener("click", () => agentPaymentForm());
  }

  /* ---------- Expenses (admin) ---------- */
  function viewExpenses(el) {
    const list = DB.all("expenses").slice().sort((a, b) => b.date.localeCompare(a.date));
    el.innerHTML = `
      <section class="of-card"><header class="of-card__h"><h3>${T("إضافة مصروف", "Add expense")}</h3></header>
        <form id="expForm" class="pay-form" novalidate>
          ${sel("category", T("الفئة", "Category"), EXP(), "rent")}${inp("amount", T("المبلغ", "Amount"), "", "number", "ltr")}${inp("date", T("التاريخ", "Date"), today(), "date")}${inp("note", T("ملاحظة", "Note"), "")}
          <button type="submit" class="btn btn--accent btn--sm">+ ${T("إضافة", "Add")}</button></form></section>
      <section class="of-card">${list.length ? `<div class="table-wrap"><table class="of-table"><thead><tr><th>${T("التاريخ", "Date")}</th><th>${T("الفئة", "Category")}</th><th>${T("ملاحظة", "Note")}</th><th>${T("المبلغ", "Amount")}</th><th></th></tr></thead>
        <tbody>${list.map((x) => `<tr><td>${fmtDate(x.date)}</td><td>${EXP()[x.category] || x.category}</td><td>${esc(x.note)}</td><td class="neg">−${money(x.amount)}</td><td><button type="button" class="x-btn" data-del-exp="${x.id}" aria-label="${T("حذف", "Delete")}">×</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="muted empty">${T("لا توجد مصروفات.", "No expenses.")}</p>`}</section>`;
    $("#expForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      if (!(+d.amount > 0)) { toast(T("أدخل مبلغاً صحيحاً", "Enter a valid amount")); return; }
      DB.insert("expenses", { date: d.date || today(), category: d.category, amount: +d.amount, note: d.note }, "EXP");
      toast(T("تمت الإضافة", "Added")); route();
    });
    $$("[data-del-exp]", el).forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "?"; return; }
      DB.remove("expenses", b.dataset.delExp); route();
    }));
  }

  /* ---------- B2B agents ---------- */
  const pricingText = (p) => {
    const c = Object.assign({ mode: "hybrid", flatAll: 20, pctAll: 0.02, flat: 20, threshold: 1000, pct: 0.02 }, p.pricing || {});
    return c.mode === "flat" ? `${T("ثابت", "Flat")} ${usd.format(c.flatAll)}` : c.mode === "percent" ? `${T("نسبة", "Percent")} ${+(c.pctAll * 100).toFixed(2)}%` : `${usd.format(c.flat)} / ${+(c.pct * 100).toFixed(2)}% ≥ ${usd.format(c.threshold)}`;
  };
  function viewAgents(el) {
    const ps = DB.all("partners");
    el.innerHTML = `
      <div class="of-toolbar">${isAdmin() ? `<button type="button" class="btn btn--accent btn--sm" id="agNew">+ ${T("وكيل جديد", "New agent")}</button>` : ""}
        <button type="button" class="btn btn--ghost btn--sm" id="agPay">+ ${T("دفعة من وكيل", "Agent payment")}</button></div>
      <section class="of-card"><div class="table-wrap"><table class="of-table">
        <thead><tr><th>${T("الوكالة", "Agency")}</th><th>${T("الحالة", "Status")}</th><th>${T("التسعير", "Pricing")}</th><th>${T("الحجوزات", "Bookings")}</th><th>${T("المبيعات", "Sales")}</th><th>${T("المدفوع", "Paid")}</th><th>${T("الرصيد المستحق", "Balance due")}</th><th>${T("حد الائتمان", "Credit limit")}</th><th></th></tr></thead>
        <tbody>${ps.map((p) => { const b = DB.partnerBalance(p.id); const n = DB.all("bookings").filter((x) => x.partnerId === p.id).length; return `<tr>
          <td><b>${esc(p.agency)}</b><br><small class="muted" dir="ltr">${esc(p.email)}</small></td>
          <td><span class="pill pill--${p.status === "active" ? "ticketed" : "cancelled"}">${p.status === "active" ? T("نشط", "Active") : p.status === "pending" ? T("قيد الموافقة", "Pending") : T("موقوف", "Suspended")}</span></td>
          <td dir="ltr">${pricingText(p)}</td><td class="num">${n}</td><td>${money(b.charges)}</td><td>${money(b.paid)}</td>
          <td class="${b.balance > 0 ? "neg" : ""}">${money(b.balance)}${p.creditLimit && b.balance > p.creditLimit ? ` <span class="tag tag--out">${T("تجاوز الحد", "Over limit")}</span>` : ""}</td><td>${money(p.creditLimit)}</td>
          <td class="row-actions"><button type="button" class="btn btn--ghost btn--sm" data-statement="${p.id}">${T("كشف حساب", "Statement")}</button>${isAdmin() ? `<button type="button" class="btn btn--ghost btn--sm" data-edit-agent="${p.id}">${T("تعديل", "Edit")}</button>` : ""}</td></tr>`; }).join("")}</tbody>
      </table></div></section>`;
    if (isAdmin()) $("#agNew").addEventListener("click", () => agentForm(null));
    $("#agPay").addEventListener("click", () => agentPaymentForm());
    $$("[data-statement]", el).forEach((b) => b.addEventListener("click", () => statement(b.dataset.statement)));
    $$("[data-edit-agent]", el).forEach((b) => b.addEventListener("click", () => agentForm(b.dataset.editAgent)));
  }

  function agentForm(id) {
    const p = id ? DB.get("partners", id) : { email: "", password: "", agency: "", contact: "", phone: "", contactEmail: "", website: "", sellMarkup: 6, status: "active", creditLimit: 3000, pricing: { mode: "hybrid" } };
    const c = Object.assign({ mode: "hybrid", flatAll: 20, pctAll: 0.02, flat: 20, threshold: 1000, pct: 0.02, publicMarkup: 0.08 }, p.pricing || {});
    openModal(id ? T("تعديل وكيل", "Edit agent") : T("وكيل B2B جديد", "New B2B agent"), `
      <form id="agForm" class="dr-form" novalidate>
        <fieldset><legend>${T("بيانات الوكالة", "Agency details")}</legend><div class="f3">
          ${inp("agency", T("اسم الوكالة", "Agency name"), p.agency)}${inp("contact", T("اسم المسؤول", "Contact person"), p.contact)}${inp("phone", T("الهاتف", "Phone"), p.phone, "tel", "ltr")}</div></fieldset>
        <fieldset><legend>${T("الدخول إلى بوابة الشركاء", "Partner portal login")}</legend><div class="f3">
          ${inp("email", T("البريد (اسم الدخول)", "Email (login)"), p.email, "email", "ltr")}${inp("password", T("كلمة المرور", "Password"), p.password, "text", "ltr")}
          ${sel("status", T("الحالة", "Status"), { active: T("نشط", "Active"), pending: T("قيد الموافقة", "Pending"), suspended: T("موقوف", "Suspended") }, p.status)}</div></fieldset>
        <fieldset><legend>${T("التسعير والائتمان", "Pricing & credit")}</legend><div class="f3">
          ${sel("mode", T("نظام التسعير", "Pricing model"), { flat: T("سعر ثابت", "Flat rate"), percent: T("نسبة مئوية", "Percentage"), hybrid: T("ثابت + نسبة", "Flat + percentage") }, c.mode)}
          ${inp("flatAll", T("الرسم الثابت (سعر ثابت)", "Flat fee (flat mode)"), c.flatAll, "number", "ltr")}${inp("pctAll", T("النسبة % (نسبة مئوية)", "Percent % (percentage mode)"), +(c.pctAll * 100).toFixed(2), "number", "ltr")}
          ${inp("flat", T("الرسم الثابت (مختلط)", "Flat fee (hybrid)"), c.flat, "number", "ltr")}${inp("threshold", T("حد التحويل (مختلط)", "Threshold (hybrid)"), c.threshold, "number", "ltr")}${inp("pct", T("النسبة % (مختلط)", "Percent % (hybrid)"), +(c.pct * 100).toFixed(2), "number", "ltr")}
          ${inp("creditLimit", T("حد الائتمان (USD)", "Credit limit (USD)"), p.creditLimit, "number", "ltr")}${inp("publicMarkup", T("هامش موقعنا %", "Our website markup %"), +(c.publicMarkup * 100).toFixed(2), "number", "ltr")}</div></fieldset>
        <div class="dr-actions"><button type="submit" class="btn btn--primary">${T("حفظ", "Save")}</button></div>
      </form>`);
    $("#agForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      const email = d.email.trim().toLowerCase();
      if (!d.agency.trim() || !email || !d.password) { toast(T("اسم الوكالة والبريد وكلمة المرور مطلوبة", "Agency name, email and password are required")); return; }
      if (DB.all("partners").some((x) => x.email === email && x.id !== id) || DB.all("staff").some((s) => s.email === email)) { toast(T("هذا البريد مستخدم بالفعل", "This email is already in use")); return; }
      const data = {
        agency: d.agency.trim(), contact: d.contact.trim(), phone: d.phone.trim(), email, password: d.password, status: d.status, creditLimit: +d.creditLimit || 0,
        pricing: { mode: d.mode, flatAll: +d.flatAll || 0, pctAll: (+d.pctAll || 0) / 100, flat: +d.flat || 0, threshold: +d.threshold || 0, pct: (+d.pct || 0) / 100, publicMarkup: (+d.publicMarkup || 0) / 100 },
      };
      if (id) DB.update("partners", id, data);
      else DB.insert("partners", Object.assign({ contactEmail: email, website: "", logo: "", sellMarkup: 6, created: today() }, data), "P");
      try { localStorage.removeItem("gt-b2b-pricing:" + email); } catch (er) {}
      closeModal(); toast(T("تم حفظ الوكيل", "Agent saved")); route();
    });
  }

  function agentPaymentForm(partnerId) {
    const opts = Object.fromEntries(DB.all("partners").map((p) => [p.id, p.agency]));
    openModal(T("دفعة من وكيل B2B", "Payment from B2B agent"), `
      <form id="apForm" class="dr-form" novalidate><div class="f3">
        ${sel("partnerId", T("الوكيل", "Agent"), opts, partnerId || Object.keys(opts)[0])}${inp("amount", T("المبلغ", "Amount"), "", "number", "ltr")}${sel("method", T("الطريقة", "Method"), METHOD(), "bank")}
        ${inp("date", T("التاريخ", "Date"), today(), "date")}${inp("ref", T("مرجع", "Reference"), "", "text", "ltr")}</div>
        <p class="muted">${T("تُخصم الدفعة من رصيد الوكيل الإجمالي (حساب جارٍ).", "The payment is applied to the agent's overall balance (running account).")}</p>
        <div class="dr-actions"><button type="submit" class="btn btn--primary">${T("تسجيل الدفعة", "Record payment")}</button></div></form>`);
    $("#apForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      if (!(+d.amount > 0)) { toast(T("أدخل مبلغاً صحيحاً", "Enter a valid amount")); return; }
      DB.insert("payments", { date: d.date || today(), dir: "in", amount: +d.amount, method: d.method, bookingId: null, partnerId: d.partnerId, ref: d.ref, note: T("دفعة على الحساب", "Payment on account") }, "PAY");
      closeModal(); toast(T("تم تسجيل الدفعة", "Payment recorded")); route();
    });
  }

  // Running account statement for one partner (charges = their confirmed/ticketed bookings, credits = payments)
  function statementRows(partnerId) {
    const rows = [];
    DB.all("bookings").filter((b) => b.partnerId === partnerId && ["confirmed", "ticketed"].includes(b.status)).forEach((b) =>
      rows.push({ date: b.created, desc: `${b.id} · ${b.route} · ${b.customer.name || ""}${b.pnr ? " · PNR " + b.pnr : ""}`, debit: b.sell, credit: 0 }));
    DB.all("payments").filter((p) => p.partnerId === partnerId && p.dir === "in").forEach((p) =>
      rows.push({ date: p.date, desc: `${T("دفعة", "Payment")} · ${METHOD()[p.method] || p.method}${p.ref ? " · " + p.ref : ""}${p.bookingId ? " · " + p.bookingId : ""}`, debit: 0, credit: p.amount }));
    rows.sort((a, b) => a.date.localeCompare(b.date));
    let bal = 0;
    rows.forEach((r) => { bal += r.debit - r.credit; r.balance = bal; });
    return rows;
  }
  function statementHtml(partnerId) {
    const p = DB.get("partners", partnerId), rows = statementRows(partnerId), b = DB.partnerBalance(partnerId);
    return `<div class="statement">
      <header class="st-head"><img src="assets/img/logo.png" alt="" width="48" height="48"><div><b>Green Travel</b><small>World Services dba Green Travel · info@greentravel.us</small></div>
        <div class="st-meta"><b>${T("كشف حساب", "Account statement")}</b><span>${esc(p.agency)}</span><span>${fmtDate(today())}</span></div></header>
      <div class="table-wrap"><table class="of-table"><thead><tr><th>${T("التاريخ", "Date")}</th><th>${T("البيان", "Description")}</th><th>${T("مدين", "Debit")}</th><th>${T("دائن", "Credit")}</th><th>${T("الرصيد", "Balance")}</th></tr></thead>
      <tbody>${rows.length ? rows.map((r) => `<tr><td>${fmtDate(r.date)}</td><td>${esc(r.desc)}</td><td>${r.debit ? money(r.debit) : ""}</td><td>${r.credit ? money(r.credit) : ""}</td><td>${money(r.balance)}</td></tr>`).join("") : `<tr><td colspan="5" class="muted empty">${T("لا توجد حركات.", "No transactions.")}</td></tr>`}</tbody>
      <tfoot><tr><td colspan="2">${T("الرصيد المستحق", "Balance due")}</td><td>${money(b.charges)}</td><td>${money(b.paid)}</td><td><b>${money(b.balance)}</b></td></tr></tfoot></table></div></div>`;
  }
  function statement(partnerId) {
    openModal(T("كشف حساب الوكيل", "Agent statement"), statementHtml(partnerId) + `<div class="dr-actions"><button type="button" class="btn btn--primary" id="stPrint">${T("طباعة / PDF", "Print / PDF")}</button><button type="button" class="btn btn--ghost" id="stPay">+ ${T("تسجيل دفعة", "Record payment")}</button></div>`, true);
    $("#stPrint").addEventListener("click", () => printHtml(statementHtml(partnerId)));
    $("#stPay").addEventListener("click", () => agentPaymentForm(partnerId));
  }

  /* ---------- Invoice ---------- */
  function printInvoice(id) {
    const b = DB.get("bookings", id), m = bookingMoney(b);
    const p = b.partnerId ? DB.get("partners", b.partnerId) : null;
    const billTo = p ? `${esc(p.agency)}<br><small>${esc(p.contact || "")} · <span dir="ltr">${esc(p.phone || "")}</span></small>` : `${esc(b.customer.name)}<br><small dir="ltr">${esc([b.customer.phone, b.customer.email].filter(Boolean).join(" · "))}</small>`;
    printHtml(`<div class="statement invoice">
      <header class="st-head"><img src="assets/img/logo.png" alt="" width="48" height="48"><div><b>Green Travel</b><small>World Services dba Green Travel · +1 (708) 963-2552 · info@greentravel.us</small></div>
        <div class="st-meta"><b>${T("فاتورة", "Invoice")}</b><span dir="ltr">INV-${esc(b.id)}</span><span>${fmtDate(today())}</span></div></header>
      <div class="inv-parties"><div><small>${T("إلى", "Bill to")}</small><b>${billTo}</b></div><div><small>${T("الحجز", "Booking")}</small><b dir="ltr">${esc(b.id)}${b.pnr ? " · PNR " + esc(b.pnr) : ""}</b></div></div>
      <table class="of-table"><thead><tr><th>${T("البيان", "Description")}</th><th>${T("المسافرون", "Travelers")}</th><th>${T("المبلغ", "Amount")}</th></tr></thead>
        <tbody><tr><td>${T("تذاكر طيران", "Air tickets")} · ${esc(b.airline)} · <span dir="ltr">${esc(b.route)}</span><br><small>${fmtDate(b.depart)}${b.ret ? " – " + fmtDate(b.ret) : ""} · ${CABIN()[b.cabin] || ""}${(b.tickets || []).length ? " · " + T("تذاكر", "Tickets") + ": " + esc(b.tickets.join(", ")) : ""}</small></td><td>${esc((b.travelers || []).join(", ") || b.pax)}</td><td>${money(b.sell)}</td></tr></tbody>
        <tfoot><tr><td colspan="2">${T("الإجمالي", "Total")}</td><td><b>${money(b.sell)}</b></td></tr><tr><td colspan="2">${T("المدفوع", "Paid")}</td><td>${money(m.inn)}</td></tr><tr><td colspan="2">${T("المتبقي", "Balance due")}</td><td><b>${money(Math.max(0, b.sell - m.inn))}</b></td></tr></tfoot></table>
      <p class="muted">${T("شكراً لتعاملكم مع Green Travel. جميع الحجوزات تخضع لشروط شركة الطيران.", "Thank you for choosing Green Travel. All bookings are subject to the airline's fare rules.")}</p></div>`);
  }
  function printHtml(html) {
    $("#printArea").innerHTML = html;
    window.print();
  }

  /* ---------- Reports (admin) ---------- */
  let period = "3m";
  function viewReports(el) {
    const r = pnl(period);
    const PER = { month: T("هذا الشهر", "This month"), "3m": T("آخر 3 أشهر", "Last 3 months"), year: T("هذه السنة", "This year"), all: T("كل الفترات", "All time") };
    const group = (key) => {
      const g = {};
      r.sold.forEach((b) => { const k = key(b); g[k] = g[k] || { n: 0, rev: 0, prof: 0 }; g[k].n++; g[k].rev += b.sell; g[k].prof += b.sell - b.cost; });
      return Object.entries(g).sort((a, b) => b[1].rev - a[1].rev);
    };
    const gTable = (title, rows) => `<section class="of-card"><header class="of-card__h"><h3>${title}</h3></header>${rows.length ? `<div class="table-wrap"><table class="of-table"><thead><tr><th></th><th>${T("تذاكر", "Tickets")}</th><th>${T("المبيعات", "Sales")}</th><th>${T("الربح", "Profit")}</th><th>${T("الهامش", "Margin")}</th></tr></thead><tbody>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v.n}</td><td>${money(v.rev)}</td><td class="pos">${money(v.prof)}</td><td class="num" dir="ltr">${v.rev ? ((v.prof / v.rev) * 100).toFixed(1) : 0}%</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted empty">${T("لا توجد بيانات.", "No data.")}</p>`}</section>`;
    const expBy = {};
    r.exp.forEach((x) => (expBy[x.category] = (expBy[x.category] || 0) + x.amount));
    el.innerHTML = `
      <div class="of-toolbar"><div class="seg">${Object.entries(PER).map(([k, v]) => `<button type="button" data-period="${k}" class="${k === period ? "is-active" : ""}">${v}</button>`).join("")}</div>
        <button type="button" class="btn btn--ghost btn--sm" id="rpPrint">${T("طباعة / PDF", "Print / PDF")}</button><button type="button" class="btn btn--ghost btn--sm" id="rpCsv">CSV</button></div>
      <div class="of-grid2">
        <section class="of-card" id="pnlCard"><header class="of-card__h"><h3>${T("قائمة الأرباح والخسائر", "Profit & loss")} · ${PER[period]}</h3></header>
          <table class="pnl">
            <tr><td>${T("المبيعات (تذاكر صادرة)", "Sales (tickets issued)")}</td><td>${money(r.revenue)}</td></tr>
            <tr><td>${T("تكلفة المبيعات", "Cost of sales")}</td><td class="neg">−${money(r.cost)}</td></tr>
            <tr class="sub"><td>${T("إجمالي الربح", "Gross profit")}</td><td>${money(r.gross)}</td></tr>
            ${Object.entries(expBy).map(([k, v]) => `<tr><td>${EXP()[k] || k}</td><td class="neg">−${money(v)}</td></tr>`).join("")}
            <tr class="sub"><td>${T("إجمالي المصروفات", "Total expenses")}</td><td class="neg">−${money(r.expenses)}</td></tr>
            <tr class="total ${r.net >= 0 ? "pos" : "neg"}"><td>${T("صافي الربح", "Net profit")}</td><td>${money(r.net)}</td></tr>
          </table></section>
        ${gTable(T("حسب المصدر", "By source"), group((b) => (b.source === "b2b" ? partnerName(b.partnerId) : SOURCE()[b.source])))}
      </div>
      <div class="of-grid2">${gTable(T("حسب شركة الطيران", "By airline"), group((b) => b.airline || "—"))}${gTable(T("حسب الوجهة", "By route"), group((b) => b.route || "—"))}</div>`;
    $$("[data-period]", el).forEach((b) => b.addEventListener("click", () => { period = b.dataset.period; route(); }));
    $("#rpPrint").addEventListener("click", () => printHtml(`<div class="statement">${$("#pnlCard").outerHTML}</div>`));
    $("#rpCsv").addEventListener("click", exportCsv);
  }

  function exportCsv() {
    const head = ["id", "created", "source", "agent", "status", "customer", "route", "airline", "pnr", "tickets", "cost", "sell", "profit", "paid_in", "paid_out", "due"];
    const rows = DB.all("bookings").map((b) => { const m = bookingMoney(b); return [b.id, b.created, b.source, b.partnerId ? partnerName(b.partnerId) : "", b.status, b.customer.name, b.route, b.airline, b.pnr, (b.tickets || []).join(" "), b.cost, b.sell, m.profit, m.inn, m.out, m.due]; });
    const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `green-travel-bookings-${today()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    toast(T("تم تجهيز ملف CSV", "CSV file prepared"));
  }

  /* ---------- Settings (admin) ---------- */
  function viewSettings(el) {
    el.innerHTML = `
      <section class="of-card"><header class="of-card__h"><h3>${T("الموظفون", "Staff")}</h3></header>
        <div class="table-wrap"><table class="of-table"><thead><tr><th>${T("الاسم", "Name")}</th><th>${T("البريد", "Email")}</th><th>${T("الصلاحية", "Role")}</th></tr></thead>
        <tbody>${DB.all("staff").map((s) => `<tr><td>${esc(s.name)}</td><td dir="ltr">${esc(s.email)}</td><td>${s.role === "admin" ? T("مدير: كل الصلاحيات", "Admin: full access") : T("وكيل سفر: الحجوزات والمدفوعات والوكلاء", "Travel agent: bookings, payments, agents")}</td></tr>`).join("")}</tbody></table></div></section>
      <section class="of-card"><header class="of-card__h"><h3>${T("البيانات التجريبية", "Demo data")}</h3></header>
        <p class="muted">${T("النظام يعمل الآن بنسخة تجريبية تحفظ البيانات في هذا المتصفح فقط. احذف البيانات التجريبية قبل إدخال حجوزات حقيقية، أو أعد تحميلها لعرض النظام.", "The system runs as a demo that stores data in this browser only. Remove the sample data before entering real bookings, or reload it to show the system.")}</p>
        <div class="dr-actions"><button type="button" class="btn btn--ghost" id="stClear">${T("حذف البيانات التجريبية", "Remove sample data")}</button><button type="button" class="btn btn--ghost" id="stReset">${T("إعادة تحميل البيانات التجريبية", "Reload sample data")}</button></div></section>`;
    const twice = (btn, fn) => btn.addEventListener("click", () => { if (btn.dataset.confirm !== "1") { btn.dataset.confirm = "1"; btn.textContent = T("اضغط مرة أخرى للتأكيد", "Press again to confirm"); return; } fn(); });
    twice($("#stClear"), () => { DB.clearDemo(); toast(T("تم حذف البيانات التجريبية", "Sample data removed")); showApp(); });
    twice($("#stReset"), () => { DB.reset(); toast(T("تمت إعادة تحميل البيانات التجريبية", "Sample data reloaded")); showApp(); });
  }

  /* ---------- Generic modal ---------- */
  function openModal(title, html, wide) {
    $("#ofModalTitle").textContent = title;
    $("#ofModalBody").innerHTML = html;
    $("#ofModal .modal__dialog").classList.toggle("modal__dialog--wide", !!wide);
    $("#ofModal").hidden = false;
    setTimeout(() => { const f = $("#ofModalBody input, #ofModalBody select, #ofModalBody button"); f && f.focus(); }, 30);
  }
  function closeModal() { $("#ofModal").hidden = true; }

  /* ---------- Boot ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    initLogin();
    $$("#drawer [data-close]").forEach((b) => b.addEventListener("click", closeDrawer));
    $$("#ofModal [data-close]").forEach((b) => b.addEventListener("click", closeModal));
    document.addEventListener("keydown", (e) => { if (e.key !== "Escape") return; if (!$("#ofModal").hidden) closeModal(); else if (!$("#drawer").hidden) closeDrawer(); });
    $("#navToggle").addEventListener("click", () => document.body.classList.toggle("nav-open"));
    window.addEventListener("hashchange", route);
    DB.onChange(() => { if (me && $("#drawer").hidden && $("#ofModal").hidden) route(); });
    showApp();
  });
})();
