/* =========================================================
   Green Travel — Company portal (TMC)
   For client companies: the travel coordinator, approvers and travelers.
   Each company sees only its own data, through server functions that
   never return Green Travel's costs or other companies' records:
     company_portal() · company_trip_request() · company_decide() · company_save_traveler()
   The travel policy is checked here for guidance and again on the server.
   ========================================================= */
(() => {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const DB = window.GTDB;
  const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const money = (n) => `<span dir="ltr">${usd.format(Math.round(+n || 0))}</span>`;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const fmtDate = (iso) => (iso ? new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString(I18N.locale, { day: "numeric", month: "short", year: "numeric" }) : "—");
  const days = (iso) => Math.round((new Date(iso + "T12:00:00") - new Date(today() + "T12:00:00")) / 864e5);
  const CABIN = () => ({ economy: T("سياحية", "Economy"), premium: T("سياحية ممتازة", "Premium economy"), business: T("رجال أعمال", "Business"), first: T("أولى", "First") });
  const ROLE = () => ({ coordinator: T("منسق السفر", "Travel coordinator"), approver: T("مدير موافقات", "Approver"), traveler: T("مسافر", "Traveler") });
  const TST = () => ({ pending: T("بانتظار الموافقة", "Awaiting approval"), approved: T("موافق عليه، جارٍ الحجز", "Approved, being booked"), rejected: T("مرفوض", "Rejected"), booked: T("تم الحجز", "Booked"), cancelled: T("ملغي", "Cancelled") });
  const BST = () => ({ new: T("قيد التجهيز", "In progress"), quoted: T("عرض سعر", "Quoted"), confirmed: T("محجوز", "Booked"), ticketed: T("صادرة", "Ticketed"), cancelled: T("ملغي", "Cancelled"), refunded: T("مسترد", "Refunded") });
  const tpill = (s) => `<span class="pill pill--${{ pending: "new", approved: "confirmed", rejected: "cancelled", booked: "ticketed", cancelled: "cancelled" }[s]}">${TST()[s] || s}</span>`;
  let P = null, view = "home";
  const isCoord = () => P && P.me.role === "coordinator", canApprove = () => P && ["coordinator", "approver"].includes(P.me.role);
  const tv = (id) => (P.travelers.find((t) => t.id === id) || {});
  const tvName = (id) => { const t = tv(id); return t.firstName ? `${t.firstName} ${t.lastName}` : "—"; };
  const ccName = (id) => (P.costCenters.find((c) => c.id === id) || {}).name || "—";
  let tt;
  const toast = (m) => { const t = $("#toast"); t.textContent = m; t.classList.add("is-visible"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("is-visible"), 3200); };

  // Same rules as the server (for live guidance while filling the form)
  const rank = (c) => ({ economy: 1, premium: 2, business: 3, first: 4 }[c] || 1);
  function check({ intl, cabin, hours, fare, depart }) {
    const p = P.policy; if (!p) return [];
    let allowed = intl ? p.cabin_intl : p.cabin_domestic;
    if (p.business_over_hours > 0 && hours >= p.business_over_hours && rank(allowed) < 3) allowed = "business";
    const v = [];
    if (rank(cabin) > rank(allowed)) v.push(T(`الدرجة المسموحة: ${CABIN()[allowed]}`, `Allowed cabin: ${CABIN()[allowed]}`));
    const max = intl ? +p.max_fare_intl : +p.max_fare_domestic;
    if (fare > max) v.push(T(`السعر أعلى من السقف ${usd.format(max)}`, `Fare above the ${usd.format(max)} cap`));
    if (depart && days(depart) < p.advance_days) v.push(T(`يجب الحجز قبل ${p.advance_days} أيام على الأقل`, `Book at least ${p.advance_days} days ahead`));
    return v;
  }

  async function load() { P = await DB.rpc("company_portal"); }
  async function boot() {
    await DB.ready;
    const pr = DB.profile;
    if (pr && pr.kind === "company") { try { await load(); } catch (e) { P = null; } }
    show();
  }
  function show() {
    $("#cpLogin").hidden = !!P; $("#cpApp").hidden = !P;
    if (!P) return;
    $("#cpCompany").textContent = P.company.name;
    $("#cpUser").innerHTML = `<b>${esc(P.me.name)}</b><small>${ROLE()[P.me.role]}</small>`;
    const NAV = [["home", T("الرئيسية", "Home")], ["request", T("طلب سفر جديد", "New trip request")], ...(canApprove() ? [["approvals", T("الموافقات", "Approvals")]] : []), ["trips", T("رحلاتي وحجوزاتي", "Trips & bookings")], ...(isCoord() ? [["travelers", T("المسافرون", "Travelers")], ["invoices", T("الفواتير", "Invoices")]] : [])];
    const pend = P.trips.filter((t) => t.status === "pending").length;
    $("#cpNav").innerHTML = NAV.map(([k, v]) => `<a href="#${k}" class="${view === k ? "is-active" : ""}"><span>${v}</span>${k === "approvals" && pend ? `<em class="nav-badge">${pend}</em>` : ""}</a>`).join("");
    $("#cpTitle").textContent = (NAV.find(([k]) => k === view) || NAV[0])[1];
    const r = { home, request, approvals, trips, travelers, invoices }[view] || home;
    r($("#cpView"));
    document.body.classList.remove("nav-open");
  }
  const kpi = (l, v, s = "", tone = "") => `<div class="kpi-card ${tone ? "kpi-card--" + tone : ""}"><span>${l}</span><b>${v}</b><small>${s}</small></div>`;

  function home(el) {
    const up = P.bookings.filter((b) => ["confirmed", "ticketed"].includes(b.status) && b.depart && days(b.depart) >= 0).sort((a, b) => a.depart.localeCompare(b.depart));
    const now = P.bookings.filter((b) => b.status === "ticketed" && b.depart && b.depart <= today() && (!b.ret || b.ret >= today()));
    const pend = P.trips.filter((t) => t.status === "pending");
    const exp = P.travelers.filter((t) => t.passportExpiry && days(t.passportExpiry) < 180);
    el.innerHTML = `<div class="kpi-grid kpi-grid--4">${kpi(T("رحلات قادمة", "Upcoming trips"), up.length)}${kpi(T("مسافرون الآن", "Traveling now"), now.length)}${kpi(T("بانتظار الموافقة", "Awaiting approval"), pend.length, "", pend.length ? "warn" : "")}
      ${isCoord() ? kpi(T("الرصيد المستحق", "Balance due"), money(P.balance), `${T("مدة السداد", "Terms")} ${P.company.paymentTerms} ${T("يوماً", "days")}`, +P.balance ? "warn" : "good") : kpi(T("طلباتي", "My requests"), P.trips.length)}</div>
      <div class="of-toolbar"><a href="#request" class="btn btn--accent">+ ${T("طلب سفر جديد", "New trip request")}</a></div>
      ${exp.length && isCoord() ? `<p class="hint hint--lock">⚠ ${T("جوازات تنتهي خلال 6 أشهر:", "Passports expiring within 6 months:")} ${exp.map((t) => `<b>${esc(t.firstName)} ${esc(t.lastName)}</b> (${fmtDate(t.passportExpiry)})`).join("، ")}</p>` : ""}
      <section class="of-card"><header class="of-card__h"><h3>${T("الرحلات القادمة", "Upcoming trips")}</h3></header>${bookingsTable(up.slice(0, 8))}</section>
      ${P.policy ? `<section class="of-card"><header class="of-card__h"><h3>${T("سياسة السفر لشركتكم", "Your travel policy")}</h3></header><ul class="pol-list">
        <li>${T("الدرجة الداخلية", "Domestic cabin")}: <b>${CABIN()[P.policy.cabin_domestic]}</b> · ${T("الدولية", "international")}: <b>${CABIN()[P.policy.cabin_intl]}</b>${P.policy.business_over_hours > 0 ? ` · ${T("رجال أعمال للرحلات من", "business from")} ${P.policy.business_over_hours} ${T("ساعات", "hours")}` : ""}</li>
        <li>${T("سقف السعر", "Fare cap")}: ${money(P.policy.max_fare_domestic)} ${T("داخلي", "domestic")} · ${money(P.policy.max_fare_intl)} ${T("دولي", "international")}</li>
        <li>${T("الحجز قبل السفر بـ", "Book at least")} ${P.policy.advance_days} ${T("أيام على الأقل", "days ahead")} · ${T("الموافقة", "Approval")}: ${{ always: T("لكل رحلة", "every trip"), out_of_policy: T("عند مخالفة السياسة فقط", "only when out of policy"), never: T("غير مطلوبة", "not needed") }[P.policy.require_approval]}</li>
        ${P.policy.notes ? `<li>${esc(P.policy.notes)}</li>` : ""}</ul></section>` : ""}`;
  }
  function bookingsTable(list) {
    if (!list.length) return `<p class="muted empty">${T("لا توجد حجوزات.", "No bookings.")}</p>`;
    return `<div class="table-wrap"><table class="of-table"><thead><tr><th>${T("المسافر", "Traveler")}</th><th>${T("الرحلة", "Trip")}</th><th>${T("التواريخ", "Dates")}</th><th>PNR</th><th>${T("الحالة", "Status")}</th><th>${T("المبلغ", "Amount")}</th><th></th></tr></thead>
      <tbody>${list.map((b) => `<tr><td>${esc((b.travelers || []).join(", ") || tvName(b.travelerId))}<br><small class="muted">${esc(ccName(b.costCenterId))}</small></td><td dir="ltr">${esc(b.route)}<br><small>${esc(b.airline || "")}</small></td><td>${fmtDate(b.depart)}${b.ret ? " – " + fmtDate(b.ret) : ""}</td>
        <td dir="ltr" class="mono">${esc(b.pnr || "—")}</td><td><span class="pill pill--${b.status}">${BST()[b.status] || b.status}</span></td><td>${money(+b.sell + +b.serviceFee)}</td><td>${b.status === "ticketed" || b.pnr ? `<button type="button" class="btn btn--ghost btn--sm" data-print="${b.id}">${T("طباعة التذكرة", "Print ticket")}</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
  }
  function bindPrint(el) {
    $$("[data-print]", el).forEach((x) => x.addEventListener("click", () => {
      const b = P.bookings.find((y) => y.id === x.dataset.print);
      const segs = (b.segments || []).length ? b.segments : [{ from: b.route.split("→")[0], to: b.route.split("→")[1], date: b.depart }];
      const w = window.open("", "_blank"); if (!w) return;
      w.document.write(`<!doctype html><html dir="${document.documentElement.dir}"><head><meta charset="utf-8"><title>${esc(b.pnr || b.id)}</title><style>body{font-family:Arial,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;color:#10231a}header{display:flex;gap:12px;align-items:center;border-bottom:2px solid #0b3d1f;padding-bottom:10px}img{width:56px}table{width:100%;border-collapse:collapse;margin-top:12px}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:start}small{color:#5b6b60}</style></head><body>
        <header><img src="${location.origin}/assets/img/logo.png" alt=""><div><b>Green Travel · جرين ترافيل</b><br><small>info@greentravel.us · +1 (708) 963-2552 · +1 (708) 940-2929 · +1 (331) 213-3768 · +1 (708) 953-2244</small></div></header>
        <h2>PNR ${esc(b.pnr || "—")} <small>${esc(P.company.name)}</small></h2><p>${esc(b.airline || "")} · ${CABIN()[b.cabin] || ""}${b.baggage ? " · " + esc(b.baggage) : ""}</p>
        <table><tr><th>${T("الرحلة", "Flight")}</th><th>${T("من → إلى", "From → To")}</th><th>${T("التاريخ", "Date")}</th><th>${T("الوقت", "Time")}</th></tr>${segs.map((s) => `<tr><td>${esc(s.flight || "")}</td><td>${esc(s.from)} → ${esc(s.to)}</td><td>${fmtDate(s.date)}</td><td>${esc(s.dep || "")}${s.arr ? " → " + esc(s.arr) : ""}</td></tr>`).join("")}</table>
        <table><tr><th>${T("المسافر", "Traveler")}</th><th>${T("التذكرة", "Ticket")}</th></tr>${(b.travelers || []).map((n, i) => `<tr><td>${esc(n)}</td><td>${esc((b.tickets || [])[i] || "—")}</td></tr>`).join("")}</table>
        <script>window.onload=()=>setTimeout(()=>print(),300)<\/script></body></html>`);
      w.document.close();
    }));
  }

  function request(el) {
    const mine = P.me.role === "traveler";
    const tvs = mine ? P.travelers.filter((t) => t.id === P.me.travelerId) : P.travelers.filter((t) => t.status === "active");
    if (!tvs.length) { el.innerHTML = `<p class="hint hint--lock">${mine ? T("حسابك غير مرتبط بملف مسافر. تواصل مع منسق السفر في شركتك.", "Your account isn't linked to a traveler profile. Contact your travel coordinator.") : T("أضف المسافرين أولاً من قسم «المسافرون».", "Add travelers first in the Travelers section.")}</p>`; return; }
    el.innerHTML = `<section class="of-card"><form id="rqForm" class="dr-form" novalidate>
      <fieldset><legend>${T("المسافر والغرض", "Traveler & purpose")}</legend><div class="f3">
        <label class="fl"><span>${T("المسافر", "Traveler")}</span><select name="travelerId">${tvs.map((t) => `<option value="${t.id}">${esc(t.firstName)} ${esc(t.lastName)}</option>`).join("")}</select></label>
        <label class="fl"><span>${T("القسم / مركز التكلفة", "Cost center")}</span><select name="costCenterId"><option value="">—</option>${P.costCenters.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label>
        <label class="fl"><span>${T("غرض الرحلة", "Purpose")}</span><input name="purpose" placeholder="${T("مثال: اجتماع عميل في دبي", "e.g. client meeting in Dubai")}"></label></div></fieldset>
      <fieldset><legend>${T("الرحلة", "Trip")}</legend><div class="f3">
        <label class="fl"><span>${T("من (رمز المطار)", "From (airport code)")}</span><input name="origin" dir="ltr" maxlength="3" placeholder="ORD" required></label>
        <label class="fl"><span>${T("إلى (رمز المطار)", "To (airport code)")}</span><input name="destination" dir="ltr" maxlength="3" placeholder="DXB" required></label>
        <label class="fl"><span>${T("نوع الرحلة", "Type")}</span><select name="international"><option value="true">${T("دولية", "International")}</option><option value="false">${T("داخلية", "Domestic")}</option></select></label>
        <label class="fl"><span>${T("الذهاب", "Depart")}</span><input name="depart" type="date" min="${today()}" required></label>
        <label class="fl"><span>${T("العودة", "Return")}</span><input name="ret" type="date" min="${today()}"></label>
        <label class="fl"><span>${T("الدرجة", "Cabin")}</span><select name="cabin">${Object.entries(CABIN()).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
        <label class="fl"><span>${T("مدة الطيران التقريبية (ساعات)", "Approx. flight time (hours)")}</span><input name="hours" type="number" min="0" step="0.5" dir="ltr" value="0"></label>
        <label class="fl"><span>${T("السعر التقديري (USD)", "Estimated fare (USD)")}</span><input name="estFare" type="number" min="0" dir="ltr" value="0"></label></div>
        <label class="fl fl--wide"><span>${T("ملاحظات (أوقات مفضلة، فندق، سيارة…)", "Notes (preferred times, hotel, car…)")}</span><textarea name="notes" rows="2"></textarea></label></fieldset>
      <div id="rqPol" class="rq-pol"></div>
      <label class="fl fl--wide" id="rqWhy" hidden><span>${T("سبب الخروج عن السياسة (مطلوب)", "Reason for going outside the policy (required)")}</span><textarea name="oopReason" rows="2"></textarea></label>
      <div class="dr-actions"><button type="submit" class="btn btn--accent">${T("إرسال الطلب", "Send request")}</button></div>
      <p class="form-status err" id="rqStatus" role="status" aria-live="polite"></p></form></section>`;
    const f = $("#rqForm");
    const pol = () => {
      const v = check({ intl: f.international.value === "true", cabin: f.cabin.value, hours: +f.hours.value || 0, fare: +f.estFare.value || 0, depart: f.depart.value });
      $("#rqPol").innerHTML = v.length ? `<p class="hint hint--lock">⚠ ${T("خارج سياسة السفر:", "Outside the travel policy:")} ${v.map(esc).join(" · ")}</p>` : `<p class="hint">✓ ${T("ضمن سياسة السفر", "Within the travel policy")}</p>`;
      $("#rqWhy").hidden = !v.length;
    };
    f.addEventListener("input", pol); f.addEventListener("change", pol); pol();
    f.travelerId.addEventListener("change", () => { const t = tv(f.travelerId.value); if (t.costCenterId) f.costCenterId.value = t.costCenterId; });
    f.travelerId.dispatchEvent(new Event("change"));
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      if (!/^[A-Za-z]{3}$/.test(d.origin) || !/^[A-Za-z]{3}$/.test(d.destination) || !d.depart) { $("#rqStatus").textContent = T("أدخل رمزي المطارين (3 أحرف) وتاريخ الذهاب.", "Enter both airport codes (3 letters) and the departure date."); return; }
      const btn = f.querySelector("[type=submit]"); btn.disabled = true;
      try {
        const r = await DB.rpc("company_trip_request", { p: Object.assign({}, d, { international: d.international === "true", hours: +d.hours || 0, estFare: +d.estFare || 0 }) });
        await load();
        toast(r.status === "approved" ? T(`أُرسل الطلب ${r.id} إلى جرين ترافيل للحجز.`, `Request ${r.id} sent to Green Travel for booking.`) : T(`أُرسل الطلب ${r.id} إلى المدير للموافقة.`, `Request ${r.id} sent to your manager for approval.`));
        location.hash = "trips";
      } catch (er) { $("#rqStatus").textContent = er.message; }
      btn.disabled = false;
    });
  }

  function tripRows(list, actions) {
    if (!list.length) return `<p class="muted empty">${T("لا توجد طلبات.", "No requests.")}</p>`;
    return `<div class="table-wrap"><table class="of-table"><thead><tr><th>${T("الطلب", "Request")}</th><th>${T("المسافر", "Traveler")}</th><th>${T("الرحلة", "Trip")}</th><th>${T("الدرجة / السعر", "Cabin / fare")}</th><th>${T("السياسة", "Policy")}</th><th>${T("الحالة", "Status")}</th>${actions ? "<th></th>" : ""}</tr></thead>
      <tbody>${list.map((r) => `<tr><td dir="ltr" class="mono">${r.id}<br><small class="muted">${fmtDate(r.created_at)}</small></td><td>${esc(tvName(r.traveler_id))}<br><small class="muted">${esc(r.purpose || "")}</small></td><td dir="ltr">${esc(r.origin)} → ${esc(r.destination)}<br><small>${fmtDate(r.depart)}${r.ret ? " – " + fmtDate(r.ret) : ""}</small></td>
        <td>${CABIN()[r.cabin] || r.cabin}<br><small>${money(r.est_fare)}</small></td><td>${(r.violations || []).length ? `<span class="tag tag--out">${T("خارج السياسة", "Out of policy")}</span>${r.oop_reason ? `<br><small>${esc(r.oop_reason)}</small>` : ""}` : `<span class="tag tag--in">${T("ضمن السياسة", "In policy")}</span>`}</td>
        <td>${tpill(r.status)}${r.decision_note ? `<br><small class="muted">${esc(r.decision_note)}</small>` : ""}</td>
        ${actions ? `<td class="row-actions">${r.status === "pending" ? `<input class="note-in" data-note="${r.id}" placeholder="${T("ملاحظة (اختياري)", "Note (optional)")}"><button type="button" class="btn btn--accent btn--sm" data-ok="${r.id}">${T("موافقة", "Approve")}</button><button type="button" class="btn btn--ghost btn--sm danger" data-no="${r.id}">${T("رفض", "Reject")}</button>` : ""}</td>` : ""}</tr>`).join("")}</tbody></table></div>`;
  }
  function approvals(el) {
    if (!canApprove()) return home(el);
    el.innerHTML = `<section class="of-card"><header class="of-card__h"><h3>${T("بانتظار موافقتك", "Waiting for your approval")}</h3></header>${tripRows(P.trips.filter((t) => t.status === "pending"), true)}</section>
      <section class="of-card"><header class="of-card__h"><h3>${T("قرارات سابقة", "Earlier decisions")}</h3></header>${tripRows(P.trips.filter((t) => ["approved", "rejected", "booked"].includes(t.status)).slice(0, 20))}</section>`;
    const act = (ok) => async (e) => {
      const id = e.currentTarget.dataset[ok ? "ok" : "no"], note = ($(`[data-note="${id}"]`) || {}).value || "";
      e.currentTarget.disabled = true;
      try { await DB.rpc("company_decide", { p_trip: id, p_approve: ok, p_note: note }); await load(); toast(ok ? T("تمت الموافقة، وأُرسل الطلب لجرين ترافيل للحجز.", "Approved and sent to Green Travel for booking.") : T("تم رفض الطلب.", "Request rejected.")); show(); }
      catch (er) { toast(er.message); }
    };
    $$("[data-ok]", el).forEach((b) => b.addEventListener("click", act(true)));
    $$("[data-no]", el).forEach((b) => b.addEventListener("click", act(false)));
  }
  function trips(el) {
    el.innerHTML = `<section class="of-card"><header class="of-card__h"><h3>${T("طلبات السفر", "Trip requests")}</h3></header>${tripRows(P.trips)}</section>
      <section class="of-card"><header class="of-card__h"><h3>${T("الحجوزات والتذاكر", "Bookings & tickets")}</h3></header>${bookingsTable(P.bookings)}</section>`;
    bindPrint(el);
  }
  function travelers(el) {
    if (!isCoord()) return home(el);
    el.innerHTML = `<div class="of-toolbar"><button type="button" class="btn btn--accent btn--sm" id="tvNew">+ ${T("مسافر جديد", "New traveler")}</button></div>
      <section class="of-card"><div class="table-wrap"><table class="of-table"><thead><tr><th>${T("الاسم", "Name")}</th><th>${T("الوظيفة", "Title")}</th><th>${T("القسم", "Cost center")}</th><th>${T("الجواز", "Passport")}</th><th>${T("المدير المعتمد", "Approver")}</th><th></th></tr></thead>
        <tbody>${P.travelers.map((t) => `<tr><td><b>${esc(t.firstName)} ${esc(t.lastName)}</b>${t.status !== "active" ? ` <span class="tag">${T("غير نشط", "Inactive")}</span>` : ""}</td><td>${esc(t.jobTitle)}</td><td>${esc(ccName(t.costCenterId))}</td><td dir="ltr" class="${t.passportExpiry && days(t.passportExpiry) < 180 ? "neg" : ""}">${esc(t.passportNo || "—")}${t.passportExpiry ? " · " + fmtDate(t.passportExpiry) : ""}</td><td>${esc(t.approverId ? tvName(t.approverId) : "—")}</td><td><button type="button" class="btn btn--ghost btn--sm" data-tv="${t.id}">${T("تعديل", "Edit")}</button></td></tr>`).join("") || `<tr><td colspan="6" class="muted empty">${T("لا يوجد مسافرون بعد.", "No travelers yet.")}</td></tr>`}</tbody></table></div></section>`;
    $("#tvNew").addEventListener("click", () => tvForm({}));
    $$("[data-tv]", el).forEach((b) => b.addEventListener("click", () => tvForm(tv(b.dataset.tv))));
  }
  function tvForm(t) {
    const m = $("#cpModal"), body = $("#cpModalBody");
    $("#cpModalTitle").textContent = t.id ? `${t.firstName} ${t.lastName}` : T("مسافر جديد", "New traveler");
    const fld = (n, l, v, type = "text", dir = "") => `<label class="fl"><span>${l}</span><input name="${n}" type="${type}" ${dir ? `dir="${dir}"` : ""} value="${esc(v || "")}"></label>`;
    const opt = (n, l, o, v) => `<label class="fl"><span>${l}</span><select name="${n}">${Object.entries(o).map(([k, x]) => `<option value="${k}" ${k === (v || "") ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></label>`;
    body.innerHTML = `<form id="tvF" class="dr-form" novalidate><div class="f3">${fld("firstName", T("الاسم الأول (كما في الجواز)", "First name (as on passport)"), t.firstName, "text", "ltr")}${fld("lastName", T("اسم العائلة", "Last name"), t.lastName, "text", "ltr")}${fld("jobTitle", T("الوظيفة", "Job title"), t.jobTitle)}
      ${fld("email", T("البريد", "Email"), t.email, "email", "ltr")}${fld("phone", T("الهاتف", "Phone"), t.phone, "tel", "ltr")}${fld("dob", T("تاريخ الميلاد", "Date of birth"), t.dob, "date")}
      ${opt("gender", T("الجنس", "Gender"), { "": "—", m: T("ذكر", "Male"), f: T("أنثى", "Female") }, t.gender)}${fld("nationality", T("الجنسية", "Nationality"), t.nationality)}${fld("passportNo", T("رقم الجواز", "Passport number"), t.passportNo, "text", "ltr")}
      ${fld("passportExpiry", T("انتهاء الجواز", "Passport expiry"), t.passportExpiry, "date")}${opt("seatPref", T("المقعد", "Seat"), { "": "—", window: T("نافذة", "Window"), aisle: T("ممر", "Aisle") }, t.seatPref)}${opt("mealPref", T("الوجبة", "Meal"), { "": "—", MOML: T("حلال", "Halal"), VGML: T("نباتية", "Vegetarian"), DBML: T("سكري", "Diabetic") }, t.mealPref)}
      ${opt("costCenterId", T("القسم", "Cost center"), Object.fromEntries([["", "—"], ...P.costCenters.map((c) => [c.id, c.name])]), t.costCenterId)}${opt("approverId", T("المدير المعتمد", "Approver"), Object.fromEntries([["", "—"], ...P.travelers.filter((x) => x.id !== t.id).map((x) => [x.id, `${x.firstName} ${x.lastName}`])]), t.approverId)}
      ${opt("status", T("الحالة", "Status"), { active: T("نشط", "Active"), inactive: T("غير نشط", "Inactive") }, t.status || "active")}</div>
      <div class="dr-actions"><button type="submit" class="btn btn--primary">${T("حفظ", "Save")}</button></div><p class="form-status err" id="tvS"></p></form>`;
    m.hidden = false;
    $("#tvF").addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      try { await DB.rpc("company_save_traveler", { p: Object.assign({ id: t.id || "", ff: t.ff || [] }, d) }); await load(); m.hidden = true; toast(T("تم الحفظ", "Saved")); show(); }
      catch (er) { $("#tvS").textContent = er.message; }
    });
  }
  function invoices(el) {
    if (!isCoord()) return home(el);
    el.innerHTML = `<div class="kpi-grid kpi-grid--3">${kpi(T("الرصيد المستحق", "Balance due"), money(P.balance), "", +P.balance ? "warn" : "good")}${kpi(T("حد الائتمان", "Credit limit"), money(P.company.creditLimit))}${kpi(T("مدة السداد", "Payment terms"), `${P.company.paymentTerms} ${T("يوماً", "days")}`)}</div>
      <section class="of-card">${P.invoices.length ? `<div class="table-wrap"><table class="of-table"><thead><tr><th>${T("الفاتورة", "Invoice")}</th><th>${T("الفترة", "Period")}</th><th>${T("الاستحقاق", "Due")}</th><th>${T("الإجمالي", "Total")}</th><th>${T("الحالة", "Status")}</th><th></th></tr></thead>
        <tbody>${P.invoices.map((i) => `<tr><td dir="ltr" class="mono">${i.id}</td><td>${fmtDate(i.period_from)} – ${fmtDate(i.period_to)}</td><td class="${i.status === "issued" && i.due < today() ? "neg" : ""}">${fmtDate(i.due)}</td><td>${money(i.total)}</td><td><span class="pill pill--${i.status === "paid" ? "ticketed" : "new"}">${i.status === "paid" ? T("مدفوعة", "Paid") : T("مستحقة", "Due")}</span></td><td><button type="button" class="btn btn--ghost btn--sm" data-inv="${i.id}">${T("طباعة / PDF", "Print / PDF")}</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="muted empty">${T("لا توجد فواتير بعد.", "No invoices yet.")}</p>`}</section>`;
    $$("[data-inv]", el).forEach((b) => b.addEventListener("click", () => {
      const i = P.invoices.find((x) => x.id === b.dataset.inv), w = window.open("", "_blank"); if (!w) return;
      w.document.write(`<!doctype html><html dir="${document.documentElement.dir}"><head><meta charset="utf-8"><title>${i.id}</title><style>body{font-family:Arial,sans-serif;max-width:900px;margin:24px auto;padding:0 16px}header{display:flex;gap:12px;align-items:center;border-bottom:2px solid #0b3d1f;padding-bottom:10px}img{width:56px}table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:start}tfoot td{font-weight:bold}small{color:#5b6b60}</style></head><body>
        <header><img src="${location.origin}/assets/img/logo.png" alt=""><div><b>Green Travel · جرين ترافيل</b><br><small>World Services dba Green Travel · info@greentravel.us · +1 (708) 963-2552</small></div></header>
        <h2>${T("فاتورة", "Invoice")} ${i.id} <small>${esc(P.company.name)}</small></h2><p>${fmtDate(i.period_from)} – ${fmtDate(i.period_to)} · ${T("تستحق", "Due")} ${fmtDate(i.due)}</p>
        <table><tr><th>${T("التاريخ", "Date")}</th><th>${T("المسافر", "Traveler")}</th><th>${T("الرحلة", "Trip")}</th><th>PNR</th><th>${T("القسم", "Cost center")}</th><th>${T("السعر", "Fare")}</th><th>${T("رسوم", "Fee")}</th></tr>
        ${(i.lines || []).map((l) => `<tr><td>${fmtDate(l.date)}</td><td>${esc(l.traveler)}</td><td>${esc(l.route)}</td><td>${esc(l.pnr)}</td><td>${esc(l.costCenter)}</td><td>${usd.format(l.fare)}</td><td>${usd.format(l.fee)}</td></tr>`).join("")}
        <tfoot><tr><td colspan="5">${T("الإجمالي", "Total")}</td><td colspan="2">${usd.format(i.total)}</td></tr></tfoot></table><script>window.onload=()=>setTimeout(()=>print(),300)<\/script></body></html>`);
      w.document.close();
    }));
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("#cpLoginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const st = $("#cpLoginStatus"), btn = e.target.querySelector("[type=submit]"); st.textContent = ""; btn.disabled = true;
      let r = null;
      try { r = await DB.login($("#cpEmail").value, $("#cpPass").value); } catch (er) { st.textContent = T("تعذّر الاتصال بالخادم.", "Could not reach the server."); btn.disabled = false; return; }
      btn.disabled = false;
      if (r && r.error === "inactive") { st.textContent = T("هذا الحساب موقوف. تواصل مع جرين ترافيل.", "This account is suspended. Contact Green Travel."); return; }
      if (!r) { st.textContent = T("البريد أو كلمة المرور غير صحيحة.", "Incorrect email or password."); return; }
      if (r.kind !== "company") { await DB.logout(); st.textContent = T("هذه البوابة لحسابات الشركات فقط.", "This portal is for company accounts only."); return; }
      try { await load(); } catch (er) { st.textContent = er.message; return; }
      view = "home"; location.hash = "home"; show();
    });
    $("#cpLogout").addEventListener("click", async () => { await DB.logout(); P = null; show(); });
    $("#navToggle").addEventListener("click", () => document.body.classList.toggle("nav-open"));
    $$("#cpModal [data-close]").forEach((b) => b.addEventListener("click", () => ($("#cpModal").hidden = true)));
    window.addEventListener("hashchange", () => { view = location.hash.slice(1) || "home"; if (P) show(); });
    view = location.hash.slice(1) || "home";
    // Keep the portal fresh while it is open
    setInterval(async () => { if (P && !document.hidden && $("#cpModal").hidden && view !== "request") { try { await load(); show(); } catch (e) {} } }, 60000);
    boot();
  });
})();
