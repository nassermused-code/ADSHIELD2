/* =========================================================
   Green Travel — Back office (DEMO)
   Staff workspace on the shared store (assets/js/store.js).

   Roles
   - owner : controls everything. Creates staff logins, sets each person's
             permissions, assigns tasks and bookings, can open any staff
             account or any B2B agent portal without a password, and is the
             ONLY account that can see costs and profit (profit stays hidden
             even for the owner until "Show profit" is switched on).
   - staff : sees only what the owner ticked in their permissions.
   B2B agents never enter the back office; each one sees only their own
   account in b2b.html, while their bookings appear here for the team.
   ========================================================= */
(() => {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const DB = window.GTDB;
  const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const money = (n) => `<span dir="ltr" class="num">${usd.format(Math.round(n || 0))}</span>`;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const fmtDate = (iso) => (iso ? new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString(I18N.locale, { day: "numeric", month: "short", year: "numeric" }) : "—");
  const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString(I18N.locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  const VIEWAS = "gt-office-viewas", PROFIT = "gt-office-show-profit";

  /* ---------- Who is signed in ---------- */
  // The real signed-in account comes from the database (DB.profile).
  // sess.asOwner = the owner is looking at the system as one employee (no password needed).
  let sess = null;
  let me = null;
  function refreshMe() {
    const real = DB.profile;
    if (!real || real.kind === "partner" || real.status !== "active") { me = null; sess = null; return; }
    const v = real.kind === "owner" ? ls.get(VIEWAS, null) : null;
    const target = v ? DB.get("staff", v) : null;
    sess = target && target.role !== "owner" ? { id: target.id, asOwner: real.id } : { id: real.id };
    if (!sess.asOwner) ls.del(VIEWAS);
    me = sess.asOwner ? target : DB.get("staff", real.id) || real;
  }
  const isOwner = () => !!me && me.role === "owner";
  const can = (p) => isOwner() || (!!me && (me.perms || []).includes(p));
  const showProfit = () => isOwner() && ls.get(PROFIT, false) === true;
  const viewer = () => (sess && sess.asOwner ? DB.get("staff", sess.asOwner) : me);
  const log = (action, ref) => DB.log(action, ref);
  const errToast = (e) => toast(T("تعذّر الحفظ: ", "Could not save: ") + (e && e.message ? e.message : e));

  /* ---------- Labels ---------- */
  const STATUS = () => ({ new: T("جديد", "New"), quoted: T("عرض سعر", "Quoted"), confirmed: T("مؤكد", "Confirmed"), ticketed: T("صادرة", "Ticketed"), cancelled: T("ملغي", "Cancelled"), refunded: T("مسترد", "Refunded") });
  const SOURCE = () => ({ website: T("الموقع", "Website"), b2b: T("شريك B2B", "B2B partner"), office: T("المكتب", "Office") });
  const METHOD = () => ({ card: T("بطاقة", "Card"), cash: T("نقداً", "Cash"), bank: T("تحويل بنكي", "Bank transfer"), zelle: "Zelle", check: T("شيك", "Check") });
  const EXP = () => ({ rent: T("إيجار", "Rent"), salaries: T("رواتب", "Salaries"), marketing: T("تسويق", "Marketing"), software: T("برامج", "Software"), utilities: T("خدمات", "Utilities"), other: T("أخرى", "Other") });
  const CABIN = () => ({ economy: T("سياحية", "Economy"), premium: T("سياحية ممتازة", "Premium"), business: T("رجال أعمال", "Business"), first: T("أولى", "First") });
  const PRIORITY = () => ({ high: T("عاجلة", "Urgent"), normal: T("عادية", "Normal"), low: T("منخفضة", "Low") });
  // Permissions the owner can give. Costs, profit, supplier payments, expenses, reports and team are owner-only.
  const PERMS = () => [
    ["bookings_all", T("يرى كل الحجوزات", "Sees all bookings"), T("بدونها يرى فقط الحجوزات المسندة إليه", "Without it: only bookings assigned to them")],
    ["bookings_create", T("إنشاء وتعديل الحجوزات", "Create and edit bookings"), T("حجز جديد، بيانات العميل والرحلة وسعر البيع", "New bookings, customer and trip details, sell price")],
    ["bookings_issue", T("إصدار التذاكر", "Issue tickets"), T("إدخال PNR وأرقام التذاكر وتحويل الحالة إلى صادرة", "Enter PNR and ticket numbers, mark ticketed")],
    ["bookings_cancel", T("الإلغاء والاسترداد", "Cancel and refund"), T("تحويل الحالة إلى ملغي أو مسترد", "Mark bookings cancelled or refunded")],
    ["payments", T("تسجيل مدفوعات العملاء", "Record customer payments"), T("المبالغ المقبوضة فقط", "Money received only")],
    ["customers", T("دليل العملاء", "Customer directory"), T("بيانات العملاء وتاريخ حجوزاتهم", "Customer details and booking history")],
    ["agents", T("وكلاء B2B: الأرصدة والدفعات", "B2B agents: balances and payments"), T("كشوف الحساب وتسجيل دفعات الوكلاء", "Statements and agent payments")],
    ["agents_manage", T("فتح حسابات الوكلاء", "Open agent accounts"), T("إنشاء وتعديل دخول الوكلاء (بدون التسعير)", "Create and edit agent logins (not pricing)")],
    ["export", T("تصدير CSV", "Export CSV"), T("تنزيل قائمة الحجوزات", "Download the bookings list")],
    ["corporate", T("سفر الشركات (TMC)", "Corporate travel (TMC)"), T("الشركات والمسافرون والسياسات والموافقات وفواتير الشركات", "Companies, travelers, policies, approvals and company invoices")],
    ["ai_office", T("المساعد الذكي", "AI assistant"), T("يطلب من الموظفين الأذكياء: ردود، خطابات، مراجعات (بدون التكاليف والأرباح، وما يحتاج موافقة يذهب للمالك)", "Asks the AI employees for replies, letters and reviews (no costs or profit; anything needing approval goes to the owner)")],
  ];
  const pill = (st) => `<span class="pill pill--${st}">${STATUS()[st] || st}</span>`;
  const partnerName = (id) => (DB.get("partners", id) || {}).agency || "—";
  const staffName = (id) => (DB.get("staff", id) || {}).name || "—";
  const initials = (n) => { const w = String(n || "?").replace(/\(.*?\)/g, "").trim().split(/\s+/); return /[\u0600-\u06FF]/.test(w[0]) ? w[0][0] : w.slice(0, 2).map((x) => x[0]).join("").toUpperCase(); };
  const avatar = (s, size = "") => `<span class="av ${size ? "av--" + size : ""} ${s && s.role === "owner" ? "av--owner" : ""}" aria-hidden="true">${esc(initials(s && s.name))}</span>`;
  const icon = (id) => `<svg class="i"><use href="#${id}"/></svg>`;

  /* ---------- Toast ---------- */
  let tt;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("is-visible"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("is-visible"), 2800); }

  /* ---------- Navigation ---------- */
  const VIEWS = {
    dashboard: { icon: "i-target", t: () => T("لوحة التحكم", "Dashboard"), r: viewDashboard, ok: () => true },
    assistant: { icon: "i-chat", t: () => T("المساعد الذكي", "AI assistant"), r: viewAssistant, ok: () => !isOwner() && can("ai_office") },
    tasks: { icon: "i-check", t: () => (isOwner() ? T("المهام", "Tasks") : T("مهامي", "My tasks")), r: viewTasks, ok: () => true, badge: () => myOpenTasks().length },
    alerts: { icon: "i-calendar", t: () => T("تنبيهات السفر", "Travel alerts"), r: viewAlerts, ok: () => true, badge: () => upcoming(7).filter(needsReminder).length },
    bookings: { icon: "i-ticket", t: () => T("الحجوزات", "Bookings"), r: viewBookings, ok: () => true, badge: () => visibleBookings().filter((b) => b.status === "new").length },
    customers: { icon: "i-users", t: () => T("العملاء", "Customers"), r: viewCustomers, ok: () => can("customers") },
    payments: { icon: "i-card", t: () => T("المدفوعات", "Payments"), r: viewPayments, ok: () => can("payments") },
    agents: { icon: "i-handshake", t: () => T("وكلاء B2B", "B2B agents"), r: viewAgents, ok: () => can("agents") || can("agents_manage") },
    corporate: { icon: "i-briefcase", t: () => T("الشركات (TMC)", "Companies (TMC)"), r: viewCorporate, ok: () => can("corporate"), group: "corp" },
    trips: { icon: "i-check", t: () => T("طلبات السفر", "Trip requests"), r: viewTrips, ok: () => can("corporate"), group: "corp", badge: () => DB.all("trips").filter((r) => r.status === "approved").length },
    invoices: { icon: "i-card", t: () => T("فواتير الشركات", "Company invoices"), r: viewInvoices, ok: () => can("corporate"), group: "corp" },
    duty: { icon: "i-globe", t: () => T("أين المسافرون الآن", "Where travelers are"), r: viewDuty, ok: () => can("corporate"), group: "corp", badge: () => abroadNow().length },
    corpreports: { icon: "i-list", t: () => T("تقارير الشركات", "Corporate reports"), r: viewCorpReports, ok: () => can("corporate"), group: "corp" },
    expenses: { icon: "i-briefcase", t: () => T("المصروفات", "Expenses"), r: viewExpenses, ok: isOwner, owner: true },
    providers: { icon: "i-globe", t: () => T("مزودو الحجز (API)", "Booking providers (API)"), r: viewProviders, ok: isOwner, owner: true },
    accounting: { icon: "i-briefcase", t: () => T("النظام المحاسبي", "Accounting"), r: viewAccounting, ok: isOwner, owner: true },
    reports: { icon: "i-list", t: () => T("التقارير المالية", "Financial reports"), r: viewReports, ok: isOwner, owner: true },
    team: { icon: "i-shield", t: () => T("الموظفون والصلاحيات", "Team & permissions"), r: viewTeam, ok: isOwner, owner: true },
    activity: { icon: "i-clock", t: () => T("سجل النشاط", "Activity log"), r: viewActivity, ok: isOwner, owner: true },
    settings: { icon: "i-lock", t: () => T("الإعدادات", "Settings"), r: viewSettings, ok: isOwner, owner: true },
  };
  function renderNav() {
    const items = Object.entries(VIEWS).filter(([, v]) => v.ok());
    const main = items.filter(([, v]) => !v.owner && !v.group), own = items.filter(([, v]) => v.owner), corpItems = items.filter(([, v]) => v.group === "corp");
    const link = ([k, v]) => { const n = v.badge ? v.badge() : 0; return `<a href="#${k}">${icon(v.icon)}<span>${v.t()}</span>${n ? `<em class="nav-badge">${n}</em>` : ""}</a>`; };
    $("#ofNav").innerHTML = main.map(link).join("") + (corpItems.length ? `<p class="of-nav__label">${T("سفر الشركات", "Corporate travel")}</p>` + corpItems.map(link).join("") : "") + (own.length ? `<p class="of-nav__label">${T("للمالك فقط", "Owner only")}</p>` + own.map(link).join("") : "")
      + (isOwner() ? `<a href="ai-office.html" class="of-nav__ai">${icon("i-users")}<span>${T("المكتب الإلكتروني (موظفون أذكياء)", "AI office (AI employees)")}</span></a>` : "");
  }

  /* ---------- App shell ---------- */
  function showApp() {
    refreshMe();
    const ok = !!me;
    $("#ofLogin").hidden = ok;
    $("#ofApp").hidden = !ok;
    if (!ok) return;
    $("#ofUser").innerHTML = `${avatar(me)}<div><b>${esc(me.name)}</b><small>${esc(me.title || (isOwner() ? T("المالك", "Owner") : T("موظف", "Staff")))}</small></div>`;
    // Owner viewing a staff account
    const imp = $("#impBanner");
    if (sess.asOwner) {
      imp.hidden = false;
      imp.innerHTML = `${icon("i-eye")}<span>${T("أنت داخل حساب", "You are inside the account of")} <b>${esc(me.name)}</b> ${T("وترى النظام كما يراه بالضبط.", "and see exactly what they see.")}</span><button type="button" class="btn btn--sm btn--accent" id="impBack">${T("العودة إلى حسابي", "Back to my account")}</button>`;
      $("#impBack").addEventListener("click", () => { log(T("خروج من حساب موظف", "Left staff account"), me.name); ls.del(VIEWAS); location.hash = "team"; showApp(); });
    } else imp.hidden = true;
    // Profit switch (owner only)
    const pt = $("#profitToggle");
    pt.hidden = !isOwner();
    if (isOwner()) { const on = showProfit(); pt.classList.toggle("is-on", on); pt.setAttribute("aria-pressed", on); pt.innerHTML = `${icon(on ? "i-eye" : "i-lock")}<span>${on ? T("الأرباح ظاهرة", "Profit visible") : T("الأرباح مخفية", "Profit hidden")}</span>`; }
    $("#demoBanner").hidden = true;
    route();
  }
  function route() {
    if (!me) return;
    let v = location.hash.replace("#", "") || "dashboard";
    if (!VIEWS[v] || !VIEWS[v].ok()) v = "dashboard";
    renderNav();
    $$("#ofNav a").forEach((a) => a.classList.toggle("is-active", a.getAttribute("href") === "#" + v));
    $("#ofTitle").textContent = VIEWS[v].t();
    $("#ofView").innerHTML = "";
    VIEWS[v].r($("#ofView"));
    document.body.classList.remove("nav-open");
  }

  /* ---------- Login ---------- */
  function initLogin() {
    $("#ofLoginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const st = $("#ofLoginStatus"), btn = e.target.querySelector("[type=submit]");
      st.textContent = ""; btn.disabled = true;
      let r = null;
      try { r = await DB.login($("#ofEmail").value, $("#ofPass").value); } catch (er) { st.textContent = T("تعذّر الاتصال بالخادم. حاول مرة أخرى.", "Could not reach the server. Try again."); btn.disabled = false; return; }
      btn.disabled = false;
      if (r && r.error === "mfa") { st.textContent = T("لم تكتمل خطوة التحقق الثانية. حاول مرة أخرى.", "Two-step verification was not completed. Try again."); return; }
      if (r && r.error === "inactive") { st.textContent = T("هذا الحساب موقوف. تواصل مع المدير.", "This account is suspended. Contact the owner."); return; }
      if (!r) { st.textContent = T("اسم المستخدم أو كلمة المرور غير صحيحة.", "Incorrect username or password."); return; }
      if (r.kind !== "staff") { await DB.logout(); st.textContent = T("هذا حساب وكيل B2B: ادخل من بوابة الشركاء.", "This is a B2B agent account: sign in through the partner portal."); return; }
      $("#ofPass").value = "";
      ls.del(VIEWAS);
      log(T("تسجيل دخول", "Signed in"));
      location.hash = "dashboard";
      showApp();
    });
    $("#ofShowPass").addEventListener("click", (e) => { const p = $("#ofPass"); p.type = p.type === "password" ? "text" : "password"; e.currentTarget.setAttribute("aria-pressed", p.type === "text"); });
    $("#ofLogout").addEventListener("click", async () => { log(T("تسجيل خروج", "Signed out")); ls.del(VIEWAS); await DB.logout(); showApp(); });
    $("#profitToggle").addEventListener("click", () => { ls.set(PROFIT, !showProfit()); showApp(); });
  }
  // First run: no owner yet, so the person setting up creates the owner account with their own password
  function showSetup() {
    $("#ofLoginForm").hidden = true;
    const box = document.createElement("form");
    box.className = "b2b-card login-card"; box.id = "ofSetupForm"; box.noValidate = true;
    box.innerHTML = `<h2>${T("إعداد حساب المالك", "Set up the owner account")}</h2>
      <p class="muted">${T("هذه أول مرة يُفتح فيها النظام. أنشئ حساب المالك الذي يتحكم في كل شيء. احفظ كلمة المرور في مكان آمن، لا أحد غيرك يعرفها.", "This is the first time the system is opened. Create the owner account that controls everything. Keep the password safe: nobody else knows it.")}</p>
      <label class="fl"><span>${T("رمز الإعداد (من إعدادات Supabase)", "Setup code (from your Supabase settings)")}</span><input name="setupCode" type="password" dir="ltr" autocomplete="off" required></label>
      <label class="fl"><span>${T("الاسم", "Name")}</span><input name="name" required></label>
      <label class="fl"><span>${T("اسم المستخدم (بالإنجليزية)", "Username (English)")}</span><input name="username" dir="ltr" autocomplete="username" autocapitalize="none" required></label>
      <label class="fl"><span>${T("كلمة المرور (8 أحرف على الأقل)", "Password (8+ characters)")}</span><input name="password" type="password" dir="ltr" autocomplete="new-password" required></label>
      <label class="fl"><span>${T("تأكيد كلمة المرور", "Confirm password")}</span><input name="password2" type="password" dir="ltr" autocomplete="new-password" required></label>
      <button type="submit" class="btn btn--accent btn--block">${T("إنشاء حساب المالك", "Create owner account")}</button>
      <p class="form-status err" role="status" aria-live="polite"></p>`;
    $("#ofLogin").appendChild(box);
    box.addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(box)), st = box.querySelector(".form-status");
      if (d.password !== d.password2) { st.textContent = T("كلمتا المرور غير متطابقتين.", "Passwords do not match."); return; }
      try {
        await DB.admin("bootstrap", { setupCode: d.setupCode, name: d.name, username: d.username, password: d.password, title: T("المالك / المدير العام", "Owner / General manager") });
        const r = await DB.login(d.username, d.password);
        if (!r) throw new Error(T("تم إنشاء الحساب، سجّل الدخول.", "Account created, please sign in."));
        box.remove(); $("#ofLoginForm").hidden = false; location.hash = "team"; showApp();
      } catch (er) { st.textContent = er.message; }
    });
  }

  // Owner opens any staff account without a password
  function enterAs(staffId) {
    const s = DB.get("staff", staffId);
    if (!isOwner() || !s || s.role === "owner") return;
    log(T("دخول إلى حساب موظف", "Opened staff account"), s.name);
    ls.set(VIEWAS, s.id);
    closeModal();
    location.hash = "dashboard";
    showApp();
    window.scrollTo({ top: 0 });
  }
  // Owner opens a B2B agent's portal without a password
  function openPortal(partnerId) {
    const p = DB.get("partners", partnerId);
    if (!isOwner() || !p) return;
    log(T("فتح بوابة وكيل", "Opened agent portal"), p.agency);
    window.open("b2b.html?as=" + encodeURIComponent(p.id), "_blank");
  }

  /* ---------- Shared calculations ---------- */
  const live = (b) => !["cancelled", "refunded"].includes(b.status);
  function bookingMoney(b) {
    const inn = DB.paidIn(b.id), out = DB.paidOut(b.id);
    return { inn, out, due: live(b) && !b.companyId ? Math.max(0, b.sell - inn) : 0, payable: b.status === "ticketed" ? Math.max(0, b.cost - out) : 0, profit: live(b) ? b.sell - b.cost : 0 };
  }
  const visibleBookings = () => (can("bookings_all") ? DB.all("bookings") : DB.all("bookings").filter((b) => b.assignedTo === me.id));
  const allTasks = () => DB.all("tasks");
  const myTasks = () => allTasks().filter((t) => isOwner() ? true : t.assignee === me.id);
  const myOpenTasks = () => allTasks().filter((t) => t.status === "open" && t.assignee === me.id);
  const overdue = (t) => t.status === "open" && t.due && t.due < today();
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
  const kpi = (label, value, sub, tone = "", ic = "") => `<div class="kpi-card ${tone ? "kpi-card--" + tone : ""}">${ic ? `<i class="kpi-ic">${icon(ic)}</i>` : ""}<span>${label}</span><b>${value}</b><small>${sub}</small></div>`;
  const count = (n) => `<span class="num">${n}</span>`;

  /* ---------- Dashboard ---------- */
  function viewDashboard(el) {
    const hello = `<div class="hello"><div><h2>${T("أهلاً", "Welcome")}، ${esc(me.name.replace(/\s*\(.*?\)/g, ""))}</h2><p class="muted">${new Date().toLocaleDateString(I18N.locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p></div></div>`;
    if (isOwner()) return ownerDashboard(el, hello);
    const vb = visibleBookings(), mine = myOpenTasks();
    const fresh = vb.filter((b) => b.status === "new"), toIssue = vb.filter((b) => b.status === "confirmed");
    const due = vb.filter((b) => b.source !== "b2b").reduce((s, b) => s + bookingMoney(b).due, 0);
    el.innerHTML = `${hello}
      <div class="kpi-grid kpi-grid--auto">
        ${kpi(T("مسافرون خلال 7 أيام", "Traveling within 7 days"), count(upcoming(7).length), `${upcoming(7).filter(needsReminder).length} ${T("بدون تذكير", "not reminded")}`, upcoming(7).filter(needsReminder).length ? "warn" : "", "i-calendar")}
        ${kpi(T("مهامي المفتوحة", "My open tasks"), count(mine.length), `${mine.filter(overdue).length} ${T("متأخرة", "overdue")}`, mine.filter(overdue).length ? "bad" : "good", "i-check")}
        ${kpi(T("طلبات جديدة", "New requests"), count(fresh.length), T("بحاجة إلى متابعة", "Need follow-up"), fresh.length ? "warn" : "", "i-zap")}
        ${can("bookings_issue") ? kpi(T("بانتظار الإصدار", "Waiting to be ticketed"), count(toIssue.length), T("حجوزات مؤكدة", "Confirmed bookings"), toIssue.length ? "warn" : "", "i-ticket") : kpi(T("حجوزاتي", "My bookings"), count(vb.length), T("المسندة إليّ", "Assigned to me"), "", "i-ticket")}
        ${can("payments") ? kpi(T("مستحق من العملاء", "Due from customers"), money(due), T("حجوزات لم تُدفع بالكامل", "Bookings not fully paid"), due ? "warn" : "", "i-card") : ""}
      </div>
      <div class="of-grid2">
        <section class="of-card"><header class="of-card__h"><h3>${T("مهامي", "My tasks")}</h3><a href="#tasks" class="link-arrow">${T("الكل", "All")}</a></header>${taskList(mine.slice(0, 6), true)}</section>
        <section class="of-card"><header class="of-card__h"><h3>${T("طلبات جديدة", "New requests")}</h3><a href="#bookings" class="link-arrow">${T("الحجوزات", "Bookings")}</a></header>${bookingTable(fresh.slice(0, 6), true)}</section>
      </div>
      <section class="of-card"><header class="of-card__h"><h3>${T("آخر الحجوزات", "Latest bookings")}</h3></header>${bookingTable(vb.slice(0, 8))}</section>`;
    bindRows(el); bindTasks(el);
  }
  function ownerDashboard(el, hello) {
    const bk = DB.all("bookings"), m = pnl("month");
    const custDue = bk.filter((b) => b.source !== "b2b").reduce((s, b) => s + bookingMoney(b).due, 0);
    const partDue = DB.all("partners").reduce((s, p) => s + Math.max(0, DB.partnerBalance(p.id).balance), 0);
    const payable = bk.reduce((s, b) => s + bookingMoney(b).payable, 0);
    const fresh = bk.filter((b) => b.status === "new");
    const openT = allTasks().filter((t) => t.status === "open");
    el.innerHTML = `${hello}
      <div class="kpi-grid kpi-grid--4">
        ${kpi(T("مسافرون خلال 7 أيام", "Traveling within 7 days"), count(upcoming(7).length), `${upcoming(7).filter(needsReminder).length} ${T("بدون تذكير", "not reminded")}`, upcoming(7).filter(needsReminder).length ? "warn" : "", "i-calendar")}
        ${kpi(T("مبيعات هذا الشهر", "Sales this month"), money(m.revenue), T(`${m.sold.length} تذكرة صادرة`, `${m.sold.length} tickets issued`), "", "i-ticket")}
        ${showProfit() ? kpi(T("إجمالي الربح هذا الشهر", "Gross profit this month"), money(m.gross), m.revenue ? `${((m.gross / m.revenue) * 100).toFixed(1)}% ${T("هامش", "margin")}` : "—", "good", "i-eye")
          : kpi(T("الأرباح", "Profit"), `<span class="masked">••••</span>`, T("مخفية: اضغط «الأرباح مخفية» في الأعلى لإظهارها", "Hidden: use the switch at the top to show"), "", "i-lock")}
        ${kpi(T("مستحق من العملاء", "Due from customers"), money(custDue), T("حجوزات لم تُدفع بالكامل", "Bookings not fully paid"), custDue ? "warn" : "", "i-users")}
        ${kpi(T("مستحق من وكلاء B2B", "Due from B2B agents"), money(partDue), T("أرصدة الوكلاء", "Agent balances"), partDue ? "warn" : "", "i-handshake")}
        ${kpi(T("مستحق للموردين", "Owed to suppliers"), money(payable), T("تذاكر صادرة لم تُسدد تكلفتها", "Ticketed, cost not yet paid"), payable ? "bad" : "", "i-plane")}
        ${kpi(T("طلبات جديدة / مهام مفتوحة", "New requests / open tasks"), `${count(fresh.length)} <small class="sep">/</small> ${count(openT.length)}`, `${openT.filter(overdue).length} ${T("مهام متأخرة", "overdue tasks")}`, openT.filter(overdue).length ? "bad" : "", "i-zap")}
      </div>
      <div class="of-grid2">
        <section class="of-card"><header class="of-card__h"><h3>${showProfit() ? T("المبيعات والأرباح (آخر 6 أشهر)", "Sales and profit (last 6 months)") : T("المبيعات (آخر 6 أشهر)", "Sales (last 6 months)")}</h3></header>${chart()}</section>
        <section class="of-card"><header class="of-card__h"><h3>${T("فريق العمل", "Team")}</h3><a href="#team" class="link-arrow">${T("إدارة", "Manage")}</a></header>${teamMini()}</section>
      </div>
      <div class="of-grid2">
        <section class="of-card"><header class="of-card__h"><h3>${T("آخر الحجوزات", "Latest bookings")}</h3><a href="#bookings" class="link-arrow">${T("كل الحجوزات", "All bookings")}</a></header>${bookingTable(bk.slice(0, 7), true)}</section>
        <section class="of-card"><header class="of-card__h"><h3>${T("أرصدة وكلاء B2B", "B2B agent balances")}</h3><a href="#agents" class="link-arrow">${T("الكل", "All")}</a></header>${partnerBalances()}</section>
      </div>`;
    bindRows(el);
    $$("[data-enter]", el).forEach((b) => b.addEventListener("click", () => enterAs(b.dataset.enter)));
  }
  function teamMini() {
    const staff = DB.all("staff").filter((s) => s.role !== "owner");
    if (!staff.length) return `<p class="muted">${T("لا يوجد موظفون بعد.", "No staff yet.")}</p>`;
    return `<ul class="team-mini">${staff.map((s) => {
      const open = allTasks().filter((t) => t.assignee === s.id && t.status === "open");
      const bks = DB.all("bookings").filter((b) => b.assignedTo === s.id && ["new", "quoted", "confirmed"].includes(b.status)).length;
      return `<li>${avatar(s)}<div><b>${esc(s.name)}</b><small>${open.length} ${T("مهام", "tasks")}${open.filter(overdue).length ? ` · <span class="neg">${open.filter(overdue).length} ${T("متأخرة", "overdue")}</span>` : ""} · ${bks} ${T("حجوزات مفتوحة", "open bookings")}</small></div>
        ${s.status === "active" ? `<button type="button" class="btn btn--ghost btn--sm" data-enter="${s.id}">${icon("i-eye")}${T("دخول", "Open")}</button>` : `<span class="pill pill--cancelled">${T("موقوف", "Suspended")}</span>`}</li>`;
    }).join("")}</ul>`;
  }
  function chart() {
    const prof = showProfit();
    const data = months(6).map(([y, m]) => {
      const sold = DB.all("bookings").filter((b) => { const d = new Date(b.created + "T12:00:00"); return b.status === "ticketed" && d.getFullYear() === y && d.getMonth() === m; });
      return { label: new Date(y, m, 1).toLocaleDateString(I18N.locale, { month: "short" }), rev: sold.reduce((s, b) => s + b.sell, 0), prof: sold.reduce((s, b) => s + b.sell - b.cost, 0) };
    });
    const max = Math.max(1000, ...data.map((d) => d.rev));
    const W = 560, H = 220, pad = 30, bw = (W - pad * 2) / data.length;
    const y = (v) => H - pad - (v / max) * (H - pad * 2);
    const bars = data.map((d, i) => {
      const w = prof ? bw * 0.3 : bw * 0.46, x = pad + i * bw + (bw - (prof ? w * 2 + 4 : w)) / 2;
      return `<g><rect x="${x}" y="${y(d.rev)}" width="${w}" height="${H - pad - y(d.rev)}" rx="4" class="bar-rev"><title>${d.label}: ${usd.format(d.rev)}</title></rect>
        ${prof ? `<rect x="${x + w + 4}" y="${y(d.prof)}" width="${w}" height="${H - pad - y(d.prof)}" rx="4" class="bar-prof"><title>${d.label}: ${usd.format(d.prof)}</title></rect>` : ""}
        <text x="${pad + i * bw + bw / 2}" y="${H - 10}" text-anchor="middle" class="ax">${d.label}</text></g>`;
    }).join("");
    const grid = [0, 0.5, 1].map((f) => `<line x1="${pad}" x2="${W - pad}" y1="${y(max * f)}" y2="${y(max * f)}" class="grid"/><text x="${pad - 6}" y="${y(max * f) + 4}" text-anchor="end" class="ax">${f ? "$" + Math.round((max * f) / 1000) + "k" : "0"}</text>`).join("");
    return `<div class="chart" dir="ltr"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${T("مخطط المبيعات", "Sales chart")}">${grid}${bars}</svg></div>
      <div class="legend"><span><i class="bar-rev"></i>${T("المبيعات", "Sales")}</span>${prof ? `<span><i class="bar-prof"></i>${T("إجمالي الربح", "Gross profit")}</span>` : ""}</div>`;
  }
  function partnerBalances() {
    const ps = DB.all("partners");
    if (!ps.length) return `<p class="muted">${T("لا يوجد وكلاء بعد.", "No agents yet.")}</p>`;
    return `<ul class="bal-list">${ps.map((p) => {
      const b = DB.partnerBalance(p.id), use = p.creditLimit ? Math.min(100, (b.balance / p.creditLimit) * 100) : 0;
      return `<li><div><b>${esc(p.agency)}</b><small>${T("حد الائتمان", "Credit limit")} ${money(p.creditLimit)}</small></div><div class="bal">${money(b.balance)}<span class="meter"><i style="width:${Math.max(0, use)}%" class="${use > 80 ? "hot" : ""}"></i></span></div></li>`;
    }).join("")}</ul>`;
  }

  /* ---------- Tasks ---------- */
  function taskList(list, compact) {
    if (!list.length) return `<p class="muted empty">${T("لا توجد مهام.", "No tasks.")}</p>`;
    return `<ul class="tasks">${list.map((t) => {
      const s = DB.get("staff", t.assignee);
      return `<li class="task ${t.status === "done" ? "is-done" : ""} ${overdue(t) ? "is-late" : ""}">
        <button type="button" class="task__check" data-task-toggle="${t.id}" aria-label="${t.status === "done" ? T("إعادة فتح", "Reopen") : T("تمّت", "Mark done")}" aria-pressed="${t.status === "done"}">${icon("i-check")}</button>
        <div class="task__body"><b>${esc(t.title)}</b>${t.details && !compact ? `<p>${esc(t.details)}</p>` : ""}
          <small>${isOwner() ? `${avatar(s, "xs")}${esc(staffName(t.assignee))} · ` : ""}<span class="prio prio--${t.priority}">${PRIORITY()[t.priority] || ""}</span>${t.due ? ` · ${overdue(t) ? `<span class="neg">${T("متأخرة", "Overdue")} · ` : ""}${fmtDate(t.due)}${overdue(t) ? "</span>" : ""}` : ""}${t.bookingId ? ` · <a href="#" data-open="${esc(t.bookingId)}" dir="ltr">${esc(t.bookingId)}</a>` : ""}${t.status === "done" && t.doneAt ? ` · ${T("أُنجزت", "Done")} ${fmtDate(t.doneAt)}` : ""}</small></div>
        ${isOwner() && !compact ? `<div class="task__act"><button type="button" class="btn btn--ghost btn--sm" data-task-edit="${t.id}">${T("تعديل", "Edit")}</button><button type="button" class="x-btn" data-task-del="${t.id}" aria-label="${T("حذف", "Delete")}">×</button></div>` : ""}
      </li>`;
    }).join("")}</ul>`;
  }
  function bindTasks(el) {
    $$("[data-task-toggle]", el).forEach((b) => b.addEventListener("click", async () => {
      const t = DB.get("tasks", b.dataset.taskToggle);
      if (!t || (!isOwner() && t.assignee !== me.id)) return;
      const done = t.status !== "done";
      b.disabled = true;
      try { await DB.toggleTask(t.id); } catch (e) { b.disabled = false; return errToast(e); }
      log(done ? T("أنجز مهمة", "Completed task") : T("أعاد فتح مهمة", "Reopened task"), t.title);
      toast(done ? T("أحسنت! تمّت المهمة", "Task done") : T("أُعيد فتح المهمة", "Task reopened"));
      route();
    }));
    $$("[data-task-edit]", el).forEach((b) => b.addEventListener("click", () => taskForm(b.dataset.taskEdit)));
    $$("[data-task-del]", el).forEach((b) => b.addEventListener("click", async () => {
      if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "?"; return; }
      try { await DB.remove("tasks", b.dataset.taskDel); } catch (e) { return errToast(e); } route();
    }));
    $$("[data-open]", el).forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); openBooking(a.dataset.open); }));
  }
  let tf = { who: "", st: "open" };
  function viewTasks(el) {
    const staffOpts = DB.all("staff").map((s) => `<option value="${s.id}" ${tf.who === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("");
    el.innerHTML = `
      <div class="of-toolbar">
        <div class="seg">${[["open", T("مفتوحة", "Open")], ["done", T("منجزة", "Done")], ["", T("الكل", "All")]].map(([k, v]) => `<button type="button" data-tst="${k}" class="${tf.st === k ? "is-active" : ""}">${v}</button>`).join("")}</div>
        ${isOwner() ? `<select id="tWho"><option value="">${T("كل الموظفين", "All staff")}</option>${staffOpts}</select><button type="button" class="btn btn--accent btn--sm" id="tNew">+ ${T("مهمة جديدة", "New task")}</button>` : ""}
      </div>
      <section class="of-card" id="tList"></section>`;
    const paint = () => {
      const list = myTasks().filter((t) => (!tf.st || t.status === tf.st) && (!tf.who || t.assignee === tf.who))
        .sort((a, b) => (a.status === b.status ? (a.due || "9").localeCompare(b.due || "9") : a.status === "open" ? -1 : 1));
      $("#tList").innerHTML = taskList(list);
      bindTasks($("#tList"));
    };
    $$("[data-tst]", el).forEach((b) => b.addEventListener("click", () => { tf.st = b.dataset.tst; route(); }));
    if (isOwner()) {
      $("#tWho").addEventListener("change", (e) => { tf.who = e.target.value; paint(); });
      $("#tNew").addEventListener("click", () => taskForm(null));
    }
    paint();
  }
  function taskForm(id, preset = {}) {
    if (!isOwner()) return;
    const t = id ? DB.get("tasks", id) : Object.assign({ title: "", details: "", assignee: (DB.all("staff").find((s) => s.role !== "owner" && s.status === "active") || me).id, due: today(), priority: "normal", bookingId: "" }, preset);
    const staffOpts = Object.fromEntries(DB.all("staff").filter((s) => s.status === "active").map((s) => [s.id, s.name]));
    openModal(id ? T("تعديل مهمة", "Edit task") : T("مهمة جديدة", "New task"), `
      <form id="tkForm" class="dr-form" novalidate>
        <label class="fl fl--wide"><span>${T("المهمة", "Task")}</span><input name="title" value="${esc(t.title)}" required></label>
        ${area("details", T("التفاصيل", "Details"), t.details)}
        <div class="f3">${sel("assignee", T("إسناد إلى", "Assign to"), staffOpts, t.assignee)}${inp("due", T("تاريخ التسليم", "Due date"), t.due, "date")}${sel("priority", T("الأولوية", "Priority"), PRIORITY(), t.priority)}</div>
        ${inp("bookingId", T("رقم الحجز المرتبط (اختياري)", "Linked booking (optional)"), t.bookingId, "text", "ltr")}
        <div class="dr-actions"><button type="submit" class="btn btn--primary">${T("حفظ", "Save")}</button></div></form>`);
    $("#tkForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      if (!d.title.trim()) { toast(T("اكتب المهمة", "Write the task")); return; }
      const data = { title: d.title.trim(), details: d.details.trim(), assignee: d.assignee, due: d.due, priority: d.priority, bookingId: d.bookingId.trim().toUpperCase() };
      try { if (id) await DB.update("tasks", id, data); else await DB.insert("tasks", Object.assign({ status: "open" }, data)); } catch (er) { return errToast(er); }
      log(id ? T("عدّل مهمة", "Edited task") : T("أسند مهمة", "Assigned task"), `${data.title} → ${staffName(data.assignee)}`);
      closeModal(); toast(T("تم حفظ المهمة", "Task saved")); route();
    });
  }

  /* ---------- Bookings ---------- */
  function bookingTable(list, compact) {
    if (!list.length) return `<p class="muted empty">${T("لا توجد حجوزات.", "No bookings.")}</p>`;
    const showAssign = !compact && (isOwner() || can("bookings_all")), prof = showProfit();
    return `<div class="table-wrap"><table class="of-table">
      <thead><tr><th>${T("الحجز", "Booking")}</th><th>${T("التاريخ", "Date")}</th><th>${T("العميل", "Customer")}</th><th>${T("المسار", "Route")}</th>${compact ? "" : `<th>${T("المصدر", "Source")}</th>`}<th>${T("الحالة", "Status")}</th>${showAssign ? `<th>${T("المسؤول", "Handled by")}</th>` : ""}<th>${T("البيع", "Sell")}</th>${prof ? `<th>${T("الربح", "Profit")}</th>` : ""}<th>${T("المتبقي", "Due")}</th></tr></thead>
      <tbody>${list.map((b) => { const m = bookingMoney(b); return `<tr data-booking="${b.id}" tabindex="0">
        <td dir="ltr" class="mono">${b.id}</td><td>${fmtDate(b.created)}</td><td>${esc(b.customer.name || "—")}</td><td dir="ltr">${esc(b.route)}</td>
        ${compact ? "" : `<td>${b.source === "b2b" ? `<span class="tag tag--b2b">${esc(partnerName(b.partnerId))}</span>` : `<span class="tag">${SOURCE()[b.source] || b.source}</span>`}</td>`}
        <td>${pill(b.status)}</td>${showAssign ? `<td>${b.assignedTo ? `<span class="who">${avatar(DB.get("staff", b.assignedTo), "xs")}${esc(staffName(b.assignedTo))}</span>` : `<span class="muted">—</span>`}</td>` : ""}
        <td>${money(b.sell)}</td>${prof ? `<td class="${m.profit > 0 ? "pos" : ""}">${money(m.profit)}</td>` : ""}<td class="${m.due ? "neg" : ""}">${money(m.due)}</td></tr>`; }).join("")}</tbody></table></div>`;
  }
  function bindRows(el) {
    $$("[data-booking]", el).forEach((tr) => {
      tr.addEventListener("click", () => openBooking(tr.dataset.booking));
      tr.addEventListener("keydown", (e) => e.key === "Enter" && openBooking(tr.dataset.booking));
    });
  }
  let bf = { q: "", status: "", source: "", who: "" };
  function viewBookings(el) {
    const assignFilter = isOwner() || can("bookings_all");
    el.innerHTML = `
      ${!can("bookings_all") ? `<p class="hint">${icon("i-lock")}${T("تظهر لك الحجوزات المسندة إليك فقط.", "You see only the bookings assigned to you.")}</p>` : ""}
      <div class="of-toolbar">
        <input type="search" id="bkQ" placeholder="${T("بحث: رقم الحجز، العميل، المسار، PNR", "Search: booking, customer, route, PNR")}" value="${esc(bf.q)}">
        <select id="bkStatus"><option value="">${T("كل الحالات", "All statuses")}</option>${Object.entries(STATUS()).map(([k, v]) => `<option value="${k}" ${bf.status === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <select id="bkSource"><option value="">${T("كل المصادر", "All sources")}</option>${Object.entries(SOURCE()).map(([k, v]) => `<option value="${k}" ${bf.source === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        ${assignFilter ? `<select id="bkWho"><option value="">${T("كل الموظفين", "All staff")}</option><option value="-" ${bf.who === "-" ? "selected" : ""}>${T("غير مسندة", "Unassigned")}</option>${DB.all("staff").map((s) => `<option value="${s.id}" ${bf.who === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>` : ""}
        ${can("bookings_create") ? `<button type="button" class="btn btn--accent btn--sm" id="bkNew">+ ${T("حجز جديد", "New booking")}</button>` : ""}
        ${can("export") ? `<button type="button" class="btn btn--ghost btn--sm" id="bkCsv">CSV</button>` : ""}
      </div>
      <section class="of-card" id="bkList"></section>`;
    const paint = () => {
      const q = bf.q.toLowerCase();
      const list = visibleBookings().filter((b) => (!bf.status || b.status === bf.status) && (!bf.source || b.source === bf.source) &&
        (!bf.who || (bf.who === "-" ? !b.assignedTo : b.assignedTo === bf.who)) &&
        (!q || [b.id, b.customer.name, b.customer.phone, b.route, b.pnr, b.airline, partnerName(b.partnerId)].join(" ").toLowerCase().includes(q)));
      $("#bkList").innerHTML = bookingTable(list);
      bindRows($("#bkList"));
    };
    $("#bkQ").addEventListener("input", (e) => { bf.q = e.target.value; paint(); });
    $("#bkStatus").addEventListener("change", (e) => { bf.status = e.target.value; paint(); });
    $("#bkSource").addEventListener("change", (e) => { bf.source = e.target.value; paint(); });
    if (assignFilter) $("#bkWho").addEventListener("change", (e) => { bf.who = e.target.value; paint(); });
    if ($("#bkNew")) $("#bkNew").addEventListener("click", () => openBooking(null));
    if ($("#bkCsv")) $("#bkCsv").addEventListener("click", exportCsv);
    paint();
  }

  /* ---------- Booking drawer ---------- */
  function openBooking(id, preset) {
    const b = id ? DB.get("bookings", id) : Object.assign({ companyId: "", travelerId: "", costCenterId: "", serviceFee: 0 }, preset || {}, { id: "", created: today(), source: "office", partnerId: null, status: "new", customer: { name: "", phone: "", email: "" }, route: "", airline: "", cabin: "economy", depart: "", ret: "", pax: 1, travelers: [], pnr: "", tickets: [], cost: 0, sell: 0, fee: 0, notes: "", assignedTo: me.id });
    if (!b) { toast(T("الحجز غير موجود", "Booking not found")); return; }
    if (id && !can("bookings_all") && b.assignedTo !== me.id) { toast(T("هذا الحجز غير مسند إليك", "This booking is not assigned to you")); return; }
    closeModal();
    const owner = isOwner(), prof = showProfit();
    const edit = owner || can("bookings_create"), issue = can("bookings_issue"), cancel = can("bookings_cancel");
    const segEdit = edit || issue;
    const allowed = (st) => st === b.status || (["new", "quoted", "confirmed"].includes(st) ? edit || issue : st === "ticketed" ? issue : cancel);
    const m = id ? bookingMoney(b) : { inn: 0, out: 0, due: 0, payable: 0, profit: 0 };
    const pays = id ? DB.all("payments").filter((p) => p.bookingId === id && (owner || p.dir === "in")) : [];
    const partnerOpts = DB.all("partners").map((p) => `<option value="${p.id}" ${b.partnerId === p.id ? "selected" : ""}>${esc(p.agency)}</option>`).join("");
    const ro = (on) => (on ? "" : "readonly");
    const staffOpts = DB.all("staff").filter((s) => s.status === "active" || s.id === b.assignedTo).map((s) => `<option value="${s.id}" ${b.assignedTo === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("");
    $("#drawerBody").innerHTML = `
      <header class="dr-head"><div><span class="mono" dir="ltr">${esc(b.id || T("حجز جديد", "New booking"))}</span><h3>${esc(b.route || T("حجز جديد", "New booking"))}</h3><small>${SOURCE()[b.source] || ""}${b.partnerId ? " · " + esc(partnerName(b.partnerId)) : ""} · ${fmtDate(b.created)}${b.assignedTo ? " · " + T("المسؤول", "Handled by") + ": " + esc(staffName(b.assignedTo)) : ""}</small></div>${id ? pill(b.status) : ""}</header>
      ${id ? `<div class="dr-money">
        <div><span>${T("سعر البيع", "Sell")}</span>${money(b.sell)}</div>
        <div><span>${T("المدفوع", "Paid")}</span>${money(m.inn)}</div>
        <div class="${m.due ? "neg" : ""}"><span>${b.source === "b2b" ? T("مستحق على الوكيل", "Due from agent") : T("مستحق على العميل", "Due from customer")}</span>${money(m.due)}</div>
        ${owner ? `<div><span>${T("التكلفة", "Cost")}</span>${money(b.cost)}</div><div class="${m.payable ? "neg" : ""}"><span>${T("مستحق للمورد", "Owed to supplier")}</span>${money(m.payable)}</div>` : ""}
        ${prof ? `<div class="good"><span>${T("الربح", "Profit")}</span>${money(m.profit)}</div>` : ""}</div>` : ""}
      ${b.provider ? `<div class="prov-box">${icon("i-globe")}<div><b>${T("محجوز لدى", "Held with")} ${esc(PROVIDER_NAMES[b.provider] || b.provider)}</b><small dir="ltr">${T("مرجع المزود", "Provider ref")}: ${esc(b.providerRef)}${b.holdExpires ? ` · ${T("ينتهي الحجز", "Hold expires")} ${fmtTime(b.holdExpires)}` : ""}</small></div>
        <div class="prov-act">${b.status !== "ticketed" && can("bookings_issue") ? `<button type="button" class="btn btn--accent btn--sm" id="prTicket">${T("إصدار التذاكر عبر المزود", "Issue tickets with provider")}</button>` : ""}${!["cancelled", "refunded"].includes(b.status) && can("bookings_cancel") ? `<button type="button" class="btn btn--ghost btn--sm danger" id="prCancel">${T("إلغاء لدى المزود", "Cancel with provider")}</button>` : ""}</div></div>` : ""}
      <form id="bkForm" class="dr-form" novalidate>
        <fieldset><legend>${T("الحالة والمسؤول", "Status & owner")}</legend><div class="f3">
          <label class="fl"><span>${T("الحالة", "Status")}</span><select name="status">${Object.entries(STATUS()).map(([k, t]) => `<option value="${k}" ${k === b.status ? "selected" : ""} ${allowed(k) ? "" : "disabled"}>${t}</option>`).join("")}</select></label>
          <label class="fl"><span>${T("المصدر", "Source")}</span><select name="source" ${owner || !id ? "" : "disabled"}>${Object.entries(SOURCE()).map(([k, t]) => `<option value="${k}" ${k === b.source ? "selected" : ""}>${t}</option>`).join("")}</select></label>
          <label class="fl"><span>${T("وكيل B2B", "B2B agent")}</span><select name="partnerId" ${owner || !id ? "" : "disabled"}><option value="">—</option>${partnerOpts}</select></label>
          ${owner ? `<label class="fl"><span>${T("مسند إلى", "Assigned to")}</span><select name="assignedTo"><option value="">—</option>${staffOpts}</select></label>` : ""}</div></fieldset>
        ${can("corporate") ? `<fieldset class="corp-fs"><legend>${T("سفر الشركات (TMC)", "Corporate travel (TMC)")}</legend><div class="f3">
          <label class="fl"><span>${T("الشركة", "Company")}</span><select name="companyId"><option value="">—</option>${DB.all("companies").map((c) => `<option value="${c.id}" ${b.companyId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
          <label class="fl"><span>${T("المسافر", "Traveler")}</span><select name="travelerId"></select></label>
          <label class="fl"><span>${T("القسم / مركز التكلفة", "Cost center")}</span><select name="costCenterId"></select></label>
          ${inp("serviceFee", T("رسوم الخدمة", "Service fee"), b.serviceFee || 0, "number", "ltr")}</div><div id="polCheck" class="pol-check"></div></fieldset>` : ""}
        <fieldset><legend>${T("العميل", "Customer")}</legend><div class="f3">
          ${inp("cname", T("الاسم", "Name"), b.customer.name, "text", "", ro(edit))}${inp("cphone", T("الهاتف", "Phone"), b.customer.phone, "tel", "ltr", ro(edit))}${inp("cemail", T("البريد", "Email"), b.customer.email, "email", "ltr", ro(edit))}</div></fieldset>
        <fieldset><legend>${T("الرحلة", "Trip")}</legend><div class="f3">
          ${inp("route", T("المسار (مثل ORD → AMM)", "Route (e.g. ORD → AMM)"), b.route, "text", "ltr", ro(edit))}${inp("airline", T("شركة الطيران", "Airline"), b.airline, "text", "", ro(edit))}${sel("cabin", T("الدرجة", "Cabin"), CABIN(), b.cabin)}
          ${inp("depart", T("الذهاب", "Depart"), b.depart, "date", "", ro(edit))}${inp("ret", T("العودة", "Return"), b.ret, "date", "", ro(edit))}${inp("pax", T("عدد المسافرين", "Travelers"), b.pax, "number", "ltr", ro(edit))}</div>
          ${area("travelers", T("أسماء المسافرين (سطر لكل مسافر)", "Traveler names (one per line)"), (b.travelers || []).join("\n"), ro(edit))}</fieldset>
        <fieldset><legend>${T("الإصدار", "Ticketing")}${issue ? "" : ` <small class="muted">· ${T("لا تملك صلاحية الإصدار", "You can't issue tickets")}</small>`}</legend><div class="f3">
          ${inp("pnr", "PNR", b.pnr, "text", "ltr", ro(issue))}${inp("tickets", T("أرقام التذاكر (بنفس ترتيب المسافرين، افصل بفاصلة)", "Ticket numbers (same order as travelers, comma-separated)"), (b.tickets || []).join(", "), "text", "ltr", ro(issue))}${inp("baggage", T("الأمتعة", "Baggage"), b.baggage, "text", "", `${ro(segEdit)} placeholder="${T("مثال: حقيبتان 23 كغ", "e.g. 2 × 23 kg")}"`)}</div>
          <div class="seg-ed"><div class="seg-ed__h"><span>${T("الرحلة", "Flight")}</span><span>${T("من", "From")}</span><span>${T("إلى", "To")}</span><span>${T("التاريخ", "Date")}</span><span>${T("الإقلاع", "Departs")}</span><span>${T("الوصول", "Arrives")}</span><span></span></div>
            <div id="segRows">${segmentsOf(b).map((x) => segRow(x, segEdit)).join("") || segRow({}, segEdit)}</div>
            ${segEdit ? `<button type="button" class="btn btn--ghost btn--sm" id="segAdd">+ ${T("رحلة", "Flight")}</button>` : ""}</div></fieldset>
        <fieldset><legend>${T("المبالغ (USD)", "Amounts (USD)")}</legend><div class="f3">
          ${inp("sell", T("سعر البيع للعميل", "Sell price"), b.sell, "number", "ltr", ro(edit))}
          ${owner ? inp("cost", T("التكلفة (للمورد)", "Cost (to supplier)"), b.cost, "number", "ltr") : ""}
          ${prof ? `<label class="fl"><span>${T("الربح", "Profit")}</span><output id="bkProfit" dir="ltr">${usd.format((b.sell || 0) - (b.cost || 0))}</output></label>` : ""}</div></fieldset>
        ${area("notes", T("ملاحظات داخلية", "Internal notes"), b.notes)}
        <div class="dr-actions">
          <button type="submit" class="btn btn--primary">${T("حفظ", "Save")}</button>
          ${id ? `<button type="button" class="btn btn--ghost" id="bkTicket">${icon("i-ticket")}${T("التذكرة: طباعة / PDF / بريد", "Ticket: print / PDF / email")}</button><button type="button" class="btn btn--ghost" id="bkInvoice">${T("فاتورة", "Invoice")}</button>` : ""}
          ${id && owner ? `<button type="button" class="btn btn--ghost" id="bkTask">+ ${T("مهمة على هذا الحجز", "Task for this booking")}</button><button type="button" class="btn btn--ghost danger" id="bkDelete">${T("حذف", "Delete")}</button>` : ""}
        </div>
      </form>
      ${id ? `<section class="dr-pays"><header class="of-card__h"><h4>${T("المدفوعات على هذا الحجز", "Payments on this booking")}</h4></header>
        ${payTable(pays, true)}
        ${can("payments") ? `<form id="payForm" class="pay-form" novalidate>
          ${owner ? sel("dir", T("النوع", "Type"), { in: b.source === "b2b" ? T("مقبوض من الوكيل", "Received from agent") : T("مقبوض من العميل", "Received from customer"), out: T("مدفوع للمورد", "Paid to supplier"), refund: T("استرداد للعميل", "Refund to customer") }, "in") : `<input type="hidden" name="dir" value="in">`}
          ${inp("amount", T("المبلغ", "Amount"), m.due || "", "number", "ltr")}${sel("method", T("الطريقة", "Method"), METHOD(), "card")}${inp("date", T("التاريخ", "Date"), today(), "date")}${inp("ref", T("مرجع", "Reference"), "", "text", "ltr")}
          <button type="submit" class="btn btn--accent btn--sm">+ ${T("تسجيل دفعة", "Record payment")}</button>
        </form>` : ""}</section>` : ""}`;
    const f = $("#bkForm");
    // Corporate: travelers and cost centers follow the chosen company; the travel policy is checked live
    if (f.companyId) {
      const fill = (keep) => {
        const cid = f.companyId.value;
        f.travelerId.innerHTML = `<option value="">—</option>` + DB.all("travelers").filter((t) => t.companyId === cid).map((t) => `<option value="${t.id}" ${(keep ? b.travelerId : "") === t.id ? "selected" : ""}>${esc(t.firstName)} ${esc(t.lastName)}</option>`).join("");
        f.costCenterId.innerHTML = `<option value="">—</option>` + DB.all("costCenters").filter((x) => x.companyId === cid).map((x) => `<option value="${x.id}" ${(keep ? b.costCenterId : "") === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("");
      };
      const pol = () => {
        const cid = f.companyId.value;
        if (!cid) { $("#polCheck").innerHTML = ""; return; }
        const v = checkPolicy(cid, { intl: true, cabin: f.cabin.value, fare: +f.sell.value || 0, depart: f.depart.value });
        $("#polCheck").innerHTML = v.length ? v.map((x) => `<span class="tag tag--out">${esc(VIOL(x))}</span>`).join(" ") : `<span class="tag tag--in">${T("ضمن سياسة الشركة", "Within company policy")}</span>`;
      };
      fill(true); pol();
      f.companyId.addEventListener("change", () => { fill(false); const c = DB.get("companies", f.companyId.value); if (c && !id) f.serviceFee.value = c.serviceFee; pol(); });
      f.travelerId.addEventListener("change", () => { const t = DB.get("travelers", f.travelerId.value); if (!t) return; if (!f.cname.value) f.cname.value = `${t.firstName} ${t.lastName}`; if (!f.cphone.value) f.cphone.value = t.phone || ""; if (!f.cemail.value) f.cemail.value = t.email || ""; if (!f.travelers.value.trim()) f.travelers.value = `${t.firstName} ${t.lastName}`.toUpperCase(); if (t.costCenterId && !f.costCenterId.value) f.costCenterId.value = t.costCenterId; });
      ["cabin", "sell", "depart"].forEach((k) => f[k].addEventListener("change", pol));
    }
    const bindSeg = () => $$("[data-rmseg]").forEach((x) => (x.onclick = () => { if ($$("#segRows [data-seg]").length > 1) x.parentElement.parentNode.removeChild(x.parentElement); }));
    if ($("#segAdd")) $("#segAdd").addEventListener("click", () => { const last = $$("#segRows [data-seg]").pop(); const prev = last ? { from: last.querySelector("[name=to]").value, date: last.querySelector("[name=date]").value } : {}; $("#segRows").insertAdjacentHTML("beforeend", segRow(prev, true)); bindSeg(); });
    bindSeg();
    if (prof) { const upd = () => ($("#bkProfit").textContent = usd.format((+f.sell.value || 0) - (+f.cost.value || 0))); f.sell.addEventListener("input", upd); f.cost.addEventListener("input", upd); }
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      const data = {
        status: d.status, source: d.source || b.source, partnerId: (d.partnerId ?? b.partnerId) || null,
        customer: { name: d.cname.trim(), phone: d.cphone.trim(), email: d.cemail.trim() },
        route: d.route.trim(), airline: d.airline.trim(), cabin: d.cabin, depart: d.depart, ret: d.ret, pax: Math.max(1, +d.pax || 1),
        travelers: d.travelers.split("\n").map((s) => s.trim()).filter(Boolean), pnr: d.pnr.trim().toUpperCase(),
        tickets: d.tickets.split(",").map((s) => s.trim()).filter(Boolean), sell: +d.sell || 0, notes: d.notes,
      };
      if (can("corporate") && f.companyId) Object.assign(data, { companyId: d.companyId || "", travelerId: d.travelerId || "", costCenterId: d.costCenterId || "", serviceFee: d.companyId ? Math.max(0, +d.serviceFee || 0) : 0 });
      if (segEdit) {
        data.baggage = (d.baggage || "").trim();
        data.segments = $$("#segRows [data-seg]").map((r) => Object.fromEntries($$("input", r).map((i) => [i.name, ["from", "to", "flight"].includes(i.name) ? i.value.trim().toUpperCase() : i.value]))).filter((x) => x.from && x.to);
      }
      if (owner) { data.cost = +d.cost || 0; data.assignedTo = d.assignedTo || ""; }
      if (!allowed(data.status)) { toast(T("لا تملك صلاحية هذه الحالة", "You can't set this status")); return; }
      if (data.source === "b2b" && !data.partnerId) { toast(T("اختر وكيل B2B لهذا الحجز", "Choose the B2B agent for this booking")); return; }
      if (data.status === "ticketed" && !data.pnr) { toast(T("أدخل رقم PNR قبل تحويل الحالة إلى صادرة", "Enter the PNR before marking it ticketed")); return; }
      const cost = owner ? data.cost : b.cost;
      data.fee = data.source === "b2b" ? data.sell - cost : 0;
      const sb = f.querySelector("[type=submit]"); sb.disabled = true;
      try {
      if (id) {
        await DB.update("bookings", id, data);
        log(data.status !== b.status ? `${T("غيّر حالة الحجز إلى", "Changed booking status to")} ${STATUS()[data.status]}` : T("عدّل حجزاً", "Edited booking"), id);
      } else {
        const nb = await DB.addBooking(Object.assign({ cost: 0, assignedTo: me.id }, data));
        id = nb.id;
        log(T("أنشأ حجزاً", "Created booking"), id);
      }
      } catch (er) { sb.disabled = false; return errToast(er); }
      toast(T("تم الحفظ", "Saved"));
      openBooking(id);
      route();
    });
    if (id) {
      $("#bkInvoice").addEventListener("click", () => printInvoice(id));
      $("#bkTicket").addEventListener("click", () => openTicket(id));
      const provAct = (btnId, action, okMsg) => { const btn = $(btnId); if (!btn) return; btn.addEventListener("click", async () => {
        if (btn.dataset.confirm !== "1") { btn.dataset.confirm = "1"; btn.textContent = T("اضغط مرة أخرى للتأكيد", "Press again to confirm"); return; }
        btn.disabled = true;
        try { const r = await DB.flightsApi(action, { bookingId: id }); if (!r || !r.ok) throw new Error((r && (r.detail || r.error)) || "error"); await DB.reload(); toast(okMsg); openBooking(id); route(); }
        catch (er) { btn.disabled = false; toast(/not_supported/.test(er.message) ? T("هذا المزود لا يدعم ذلك عبر الـ API بعد: نفّذها من نظام الحجز ثم أدخل الأرقام هنا.", "This provider doesn't support that through the API yet: do it in the booking system, then enter the numbers here.") : T("تعذّر التنفيذ لدى المزود: ", "Provider error: ") + er.message); }
      }); };
      provAct("#prTicket", "ticket", T("تم إصدار التذاكر", "Tickets issued"));
      provAct("#prCancel", "cancel", T("تم الإلغاء لدى المزود", "Cancelled with the provider"));
      const del = $("#bkDelete");
      if (del) del.addEventListener("click", async () => {
        if (del.dataset.confirm !== "1") { del.dataset.confirm = "1"; del.textContent = T("اضغط مرة أخرى للتأكيد", "Press again to confirm"); return; }
        try { await DB.remove("bookings", id); } catch (er) { return errToast(er); } log(T("حذف حجزاً", "Deleted booking"), id); closeDrawer(); route(); toast(T("تم حذف الحجز", "Booking deleted"));
      });
      if ($("#bkTask")) $("#bkTask").addEventListener("click", () => { closeDrawer(); taskForm(null, { bookingId: id, assignee: b.assignedTo || undefined, title: `${T("متابعة الحجز", "Follow up booking")} ${id}` }); });
      const pf = $("#payForm");
      if (pf) pf.addEventListener("submit", async (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.target));
        const amount = +d.amount;
        if (!(amount > 0)) { toast(T("أدخل مبلغاً صحيحاً", "Enter a valid amount")); return; }
        const dir = owner ? d.dir : "in";
        try { await DB.insert("payments", { date: d.date || today(), dir, amount, method: d.method, bookingId: id, partnerId: dir === "in" ? b.partnerId : null, ref: d.ref, note: "" }); } catch (er) { return errToast(er); }
        log(dir === "in" ? T("سجّل دفعة مقبوضة", "Recorded payment received") : T("سجّل دفعة للمورد", "Recorded supplier payment"), `${id} · ${usd.format(amount)}`);
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
  const segRow = (x, on) => `<div class="seg-row" data-seg><input name="flight" dir="ltr" placeholder="RJ 264" value="${esc(x.flight || "")}" ${on ? "" : "readonly"}><input name="from" dir="ltr" maxlength="3" placeholder="ORD" value="${esc(x.from || "")}" ${on ? "" : "readonly"}><input name="to" dir="ltr" maxlength="3" placeholder="AMM" value="${esc(x.to || "")}" ${on ? "" : "readonly"}><input name="date" type="date" value="${esc(x.date || "")}" ${on ? "" : "readonly"}><input name="dep" type="time" value="${esc(x.dep || "")}" ${on ? "" : "readonly"}><input name="arr" type="time" value="${esc(x.arr || "")}" ${on ? "" : "readonly"}>${on ? `<button type="button" class="x-btn" data-rmseg aria-label="${T("حذف", "Remove")}">×</button>` : "<span></span>"}</div>`;
  const inp = (n, l, v, type = "text", dir = "", extra = "") => `<label class="fl"><span>${l}</span><input name="${n}" type="${type}" ${dir ? `dir="${dir}"` : ""} value="${esc(v ?? "")}" ${type === "number" ? 'min="0" step="any"' : ""} ${extra}></label>`;
  const sel = (n, l, opts, v) => `<label class="fl"><span>${l}</span><select name="${n}">${Object.entries(opts).map(([k, t]) => `<option value="${k}" ${k === v ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
  const area = (n, l, v, extra = "") => `<label class="fl fl--wide"><span>${l}</span><textarea name="${n}" rows="2" ${extra}>${esc(v ?? "")}</textarea></label>`;

  /* ---------- Customers ---------- */
  function customers() {
    const map = new Map();
    visibleBookings().filter((b) => b.source !== "b2b").forEach((b) => {
      const c = b.customer || {};
      const key = (c.phone || c.email || c.name || "").replace(/\s/g, "").toLowerCase();
      if (!key) return;
      const r = map.get(key) || { name: c.name, phone: c.phone, email: c.email, n: 0, sales: 0, due: 0, last: "", ids: [] };
      r.name = r.name || c.name; r.phone = r.phone || c.phone; r.email = r.email || c.email;
      r.n++; if (live(b)) r.sales += b.sell; r.due += bookingMoney(b).due; if (b.created > r.last) r.last = b.created; r.ids.push(b.id);
      map.set(key, r);
    });
    return [...map.values()].sort((a, b) => b.last.localeCompare(a.last));
  }
  let cq = "";
  function viewCustomers(el) {
    el.innerHTML = `<div class="of-toolbar"><input type="search" id="cuQ" placeholder="${T("بحث بالاسم أو الهاتف أو البريد", "Search by name, phone or email")}" value="${esc(cq)}"></div><section class="of-card" id="cuList"></section>`;
    const paint = () => {
      const q = cq.toLowerCase(), list = customers().filter((c) => !q || [c.name, c.phone, c.email].join(" ").toLowerCase().includes(q));
      $("#cuList").innerHTML = list.length ? `<div class="table-wrap"><table class="of-table"><thead><tr><th>${T("العميل", "Customer")}</th><th>${T("الهاتف", "Phone")}</th><th>${T("البريد", "Email")}</th><th>${T("الحجوزات", "Bookings")}</th><th>${T("المشتريات", "Purchases")}</th><th>${T("آخر حجز", "Last booking")}</th><th>${T("المتبقي", "Due")}</th></tr></thead>
        <tbody>${list.map((c, i) => `<tr data-cust="${i}" tabindex="0"><td><span class="who">${avatar({ name: c.name }, "xs")}<b>${esc(c.name || "—")}</b></span></td><td dir="ltr">${esc(c.phone || "—")}</td><td dir="ltr">${esc(c.email || "—")}</td><td class="num">${c.n}</td><td>${money(c.sales)}</td><td>${fmtDate(c.last)}</td><td class="${c.due ? "neg" : ""}">${money(c.due)}</td></tr>`).join("")}</tbody></table></div>`
        : `<p class="muted empty">${T("لا يوجد عملاء بعد.", "No customers yet.")}</p>`;
      $$("[data-cust]", $("#cuList")).forEach((tr) => tr.addEventListener("click", () => {
        customerFile(list[+tr.dataset.cust]);
      }));
    };
    $("#cuQ").addEventListener("input", (e) => { cq = e.target.value; paint(); });
    paint();
  }

  /* ---------- Payments ---------- */
  function payTable(list, compact) {
    if (!list.length) return `<p class="muted empty">${T("لا توجد مدفوعات.", "No payments.")}</p>`;
    const owner = isOwner();
    return `<div class="table-wrap"><table class="of-table">
      <thead><tr><th>${T("التاريخ", "Date")}</th><th>${T("النوع", "Type")}</th>${compact ? "" : `<th>${T("الحجز", "Booking")}</th><th>${T("الطرف", "Party")}</th>`}<th>${T("الطريقة", "Method")}</th><th>${T("مرجع", "Ref")}</th><th>${T("المبلغ", "Amount")}</th>${owner ? "<th></th>" : ""}</tr></thead>
      <tbody>${list.map((p) => `<tr><td>${fmtDate(p.date)}</td><td>${p.dir === "in" ? `<span class="tag tag--in">${T("مقبوض", "In")}</span>` : p.dir === "refund" ? `<span class="tag tag--out">${T("مسترد", "Refund")}</span>` : `<span class="tag tag--out">${T("مدفوع", "Out")}</span>`}</td>
        ${compact ? "" : `<td dir="ltr" class="mono">${p.bookingId ? `<a href="#" data-open="${p.bookingId}">${p.bookingId}</a>` : "—"}</td><td>${p.partnerId ? esc(partnerName(p.partnerId)) : p.dir === "out" ? T("مورد", "Supplier") : T("عميل", "Customer")}</td>`}
        <td>${METHOD()[p.method] || p.method}</td><td dir="ltr">${esc(p.ref || "")}</td><td class="${p.dir === "in" ? "pos" : "neg"}">${p.dir === "in" ? "+" : "−"}${money(p.amount)}</td>
        ${owner ? `<td><button type="button" class="x-btn" data-del-pay="${p.id}" aria-label="${T("حذف", "Delete")}">×</button></td>` : ""}</tr>`).join("")}</tbody></table></div>`;
  }
  function bindPayDelete(el, after) {
    $$("[data-del-pay]", el).forEach((b) => b.addEventListener("click", async () => {
      if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "?"; b.title = T("اضغط مرة أخرى للحذف", "Press again to delete"); return; }
      try { await DB.remove("payments", b.dataset.delPay); } catch (er) { return errToast(er); } log(T("حذف دفعة", "Deleted payment"), b.dataset.delPay); toast(T("تم حذف الدفعة", "Payment deleted")); after();
    }));
  }
  function viewPayments(el) {
    const owner = isOwner();
    const vis = new Set(visibleBookings().map((b) => b.id));
    const all = DB.all("payments").filter((p) => owner || (p.dir === "in" && ((p.bookingId && vis.has(p.bookingId)) || (!p.bookingId && can("agents")))))
      .slice().sort((a, b) => b.date.localeCompare(a.date));
    const inn = all.filter((p) => p.dir === "in").reduce((s, p) => s + p.amount, 0), out = all.filter((p) => p.dir === "out").reduce((s, p) => s + p.amount, 0);
    const monthIn = all.filter((p) => p.dir === "in" && inPeriod(p.date, "month")).reduce((s, p) => s + p.amount, 0);
    const exp = DB.all("expenses").reduce((s, x) => s + x.amount, 0);
    el.innerHTML = `
      <div class="kpi-grid kpi-grid--3">
        ${kpi(T("المقبوض هذا الشهر", "Received this month"), money(monthIn), T("من العملاء والوكلاء", "From customers and agents"), "good", "i-card")}
        ${owner ? kpi(T("إجمالي المدفوع للموردين", "Total paid to suppliers"), money(out), T("شركات الطيران والموردون", "Airlines and suppliers"), "", "i-plane") + kpi(T("صافي النقد", "Net cash"), money(inn - out - exp), T("بعد المصروفات", "After expenses"), inn - out - exp >= 0 ? "good" : "bad", "i-briefcase")
          : kpi(T("إجمالي المقبوض", "Total received"), money(inn), T("على الحجوزات التي تراها", "On the bookings you can see"), "", "i-list")}
      </div>
      ${can("agents") ? `<div class="of-toolbar"><button type="button" class="btn btn--accent btn--sm" id="payAgent">+ ${T("دفعة من وكيل B2B", "Payment from B2B agent")}</button></div>` : ""}
      <section class="of-card">${payTable(all, false)}</section>`;
    $$("[data-open]", el).forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); openBooking(a.dataset.open); }));
    bindPayDelete(el, route);
    if ($("#payAgent")) $("#payAgent").addEventListener("click", () => agentPaymentForm());
  }

  /* ---------- Expenses (owner) ---------- */
  function viewExpenses(el) {
    const list = DB.all("expenses").slice().sort((a, b) => b.date.localeCompare(a.date));
    el.innerHTML = `
      <section class="of-card"><header class="of-card__h"><h3>${T("إضافة مصروف", "Add expense")}</h3></header>
        <form id="expForm" class="pay-form" novalidate>
          ${sel("category", T("الفئة", "Category"), EXP(), "rent")}${sel("method", T("طريقة الدفع", "Paid by"), METHOD(), "bank")}${inp("amount", T("المبلغ", "Amount"), "", "number", "ltr")}${inp("date", T("التاريخ", "Date"), today(), "date")}${inp("note", T("ملاحظة", "Note"), "")}
          <button type="submit" class="btn btn--accent btn--sm">+ ${T("إضافة", "Add")}</button></form></section>
      <section class="of-card">${list.length ? `<div class="table-wrap"><table class="of-table"><thead><tr><th>${T("التاريخ", "Date")}</th><th>${T("الفئة", "Category")}</th><th>${T("ملاحظة", "Note")}</th><th>${T("المبلغ", "Amount")}</th><th></th></tr></thead>
        <tbody>${list.map((x) => `<tr><td>${fmtDate(x.date)}</td><td>${EXP()[x.category] || x.category}</td><td>${esc(x.note)}</td><td class="neg">−${money(x.amount)}</td><td><button type="button" class="x-btn" data-del-exp="${x.id}" aria-label="${T("حذف", "Delete")}">×</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="muted empty">${T("لا توجد مصروفات.", "No expenses.")}</p>`}</section>`;
    $("#expForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      if (!(+d.amount > 0)) { toast(T("أدخل مبلغاً صحيحاً", "Enter a valid amount")); return; }
      try { await DB.insert("expenses", { date: d.date || today(), category: d.category, method: d.method, amount: +d.amount, note: d.note }); } catch (er) { return errToast(er); }
      toast(T("تمت الإضافة", "Added")); route();
    });
    $$("[data-del-exp]", el).forEach((b) => b.addEventListener("click", async () => {
      if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "?"; return; }
      try { await DB.remove("expenses", b.dataset.delExp); } catch (er) { return errToast(er); } route();
    }));
  }

  /* ---------- B2B agents ---------- */
  const DEF_PRICING = { mode: "hybrid", flatAll: 20, pctAll: 0.02, flat: 20, threshold: 1000, pct: 0.02, publicMarkup: 0.08 };
  const pricingText = (p) => {
    const c = Object.assign({}, DEF_PRICING, p.pricing || {});
    return c.mode === "flat" ? `${T("ثابت", "Flat")} ${usd.format(c.flatAll)}` : c.mode === "percent" ? `${T("نسبة", "Percent")} ${+(c.pctAll * 100).toFixed(2)}%` : `${usd.format(c.flat)} / ${+(c.pct * 100).toFixed(2)}% ≥ ${usd.format(c.threshold)}`;
  };
  const agentStatus = (s) => `<span class="pill pill--${s === "active" ? "ticketed" : s === "pending" ? "new" : "cancelled"}">${s === "active" ? T("نشط", "Active") : s === "pending" ? T("قيد الموافقة", "Pending") : T("موقوف", "Suspended")}</span>`;
  function viewAgents(el) {
    const ps = DB.all("partners"), owner = isOwner(), manage = can("agents_manage"), money_ = can("agents");
    el.innerHTML = `
      <p class="hint">${icon("i-shield")}${T("كل وكيل يدخل إلى بوابته الخاصة ويرى حجوزاته ورصيده فقط، ولا يرى أي وكيل آخر أو عملاء الشركة.", "Each agent signs in to their own portal and sees only their own bookings and balance, never other agents or the company's customers.")}</p>
      <div class="of-toolbar">${manage ? `<button type="button" class="btn btn--accent btn--sm" id="agNew">+ ${T("وكيل جديد", "New agent")}</button>` : ""}
        ${money_ ? `<button type="button" class="btn btn--ghost btn--sm" id="agPay">+ ${T("دفعة من وكيل", "Agent payment")}</button>` : ""}</div>
      <section class="of-card"><div class="table-wrap"><table class="of-table">
        <thead><tr><th>${T("الوكالة", "Agency")}</th><th>${T("الحالة", "Status")}</th>${owner ? `<th>${T("التسعير", "Pricing")}</th>` : ""}<th>${T("الحجوزات", "Bookings")}</th>${money_ ? `<th>${T("المبيعات", "Sales")}</th><th>${T("المدفوع", "Paid")}</th><th>${T("الرصيد المستحق", "Balance due")}</th><th>${T("حد الائتمان", "Credit limit")}</th>` : ""}<th></th></tr></thead>
        <tbody>${ps.map((p) => { const b = DB.partnerBalance(p.id); const n = DB.all("bookings").filter((x) => x.partnerId === p.id).length; return `<tr>
          <td><span class="who">${avatar({ name: p.agency }, "xs")}<span><b>${esc(p.agency)}</b><br><small class="muted" dir="ltr">${esc(p.email)}</small></span></span></td>
          <td>${agentStatus(p.status)}</td>${owner ? `<td dir="ltr">${pricingText(p)}</td>` : ""}<td class="num">${n}</td>
          ${money_ ? `<td>${money(b.charges)}</td><td>${money(b.paid)}</td><td class="${b.balance > 0 ? "neg" : ""}">${money(b.balance)}${p.creditLimit && b.balance > p.creditLimit ? ` <span class="tag tag--out">${T("تجاوز الحد", "Over limit")}</span>` : ""}</td><td>${money(p.creditLimit)}</td>` : ""}
          <td class="row-actions">${money_ ? `<button type="button" class="btn btn--ghost btn--sm" data-statement="${p.id}">${T("كشف حساب", "Statement")}</button>` : ""}${manage ? `<button type="button" class="btn btn--ghost btn--sm" data-edit-agent="${p.id}">${T("تعديل", "Edit")}</button>` : ""}${owner ? `<button type="button" class="btn btn--ghost btn--sm" data-portal="${p.id}">${icon("i-eye")}${T("فتح بوابته", "Open portal")}</button>` : ""}</td></tr>`; }).join("")}</tbody>
      </table></div></section>`;
    if ($("#agNew")) $("#agNew").addEventListener("click", () => agentForm(null));
    if ($("#agPay")) $("#agPay").addEventListener("click", () => agentPaymentForm());
    $$("[data-statement]", el).forEach((b) => b.addEventListener("click", () => statement(b.dataset.statement)));
    $$("[data-edit-agent]", el).forEach((b) => b.addEventListener("click", () => agentForm(b.dataset.editAgent)));
    $$("[data-portal]", el).forEach((b) => b.addEventListener("click", () => openPortal(b.dataset.portal)));
  }

  function agentForm(id) {
    if (!can("agents_manage")) return;
    const owner = isOwner();
    const p = id ? Object.assign({ password: "" }, DB.get("partners", id)) : { email: "", password: genPass(), agency: "", contact: "", phone: "", contactEmail: "", website: "", sellMarkup: 6, status: "active", creditLimit: 3000, pricing: { mode: "hybrid" } };
    const c = Object.assign({}, DEF_PRICING, p.pricing || {});
    openModal(id ? T("تعديل وكيل", "Edit agent") : T("وكيل B2B جديد", "New B2B agent"), `
      <form id="agForm" class="dr-form" novalidate>
        <fieldset><legend>${T("بيانات الوكالة", "Agency details")}</legend><div class="f3">
          ${inp("agency", T("اسم الوكالة", "Agency name"), p.agency)}${inp("contact", T("اسم المسؤول", "Contact person"), p.contact)}${inp("phone", T("الهاتف", "Phone"), p.phone, "tel", "ltr")}</div></fieldset>
        <fieldset><legend>${T("الدخول إلى بوابة الشركاء", "Partner portal login")}</legend><div class="f3">
          ${inp("email", T("البريد (اسم الدخول)", "Email (login)"), p.email, "email", "ltr")}
          <label class="fl"><span>${T("كلمة المرور", "Password")}</span><span class="pw-row"><input name="password" type="text" dir="ltr" value="${esc(p.password)}" placeholder="${id ? T("اتركها فارغة للإبقاء عليها", "Leave empty to keep") : ""}" autocomplete="off"><button type="button" class="btn btn--ghost btn--sm" data-gen>${T("توليد", "Generate")}</button></span></label>
          ${sel("status", T("الحالة", "Status"), { active: T("نشط", "Active"), pending: T("قيد الموافقة", "Pending"), suspended: T("موقوف", "Suspended") }, p.status)}</div></fieldset>
        ${owner ? `<fieldset><legend>${T("التسعير والائتمان (يراه المالك فقط)", "Pricing & credit (owner only)")}</legend><div class="f3">
          ${sel("mode", T("نظام التسعير", "Pricing model"), { flat: T("سعر ثابت", "Flat rate"), percent: T("نسبة مئوية", "Percentage"), hybrid: T("ثابت + نسبة", "Flat + percentage") }, c.mode)}
          ${inp("flatAll", T("الرسم الثابت (سعر ثابت)", "Flat fee (flat mode)"), c.flatAll, "number", "ltr")}${inp("pctAll", T("النسبة % (نسبة مئوية)", "Percent % (percentage mode)"), +(c.pctAll * 100).toFixed(2), "number", "ltr")}
          ${inp("flat", T("الرسم الثابت (مختلط)", "Flat fee (hybrid)"), c.flat, "number", "ltr")}${inp("threshold", T("حد التحويل (مختلط)", "Threshold (hybrid)"), c.threshold, "number", "ltr")}${inp("pct", T("النسبة % (مختلط)", "Percent % (hybrid)"), +(c.pct * 100).toFixed(2), "number", "ltr")}
          ${inp("creditLimit", T("حد الائتمان (USD)", "Credit limit (USD)"), p.creditLimit, "number", "ltr")}${inp("publicMarkup", T("هامش موقعنا %", "Our website markup %"), +(c.publicMarkup * 100).toFixed(2), "number", "ltr")}</div></fieldset>` : ""}
        <div class="dr-actions"><button type="submit" class="btn btn--primary">${T("حفظ", "Save")}</button></div>
      </form>`);
    $("[data-gen]").addEventListener("click", () => ($("#agForm").password.value = genPass()));
    $("#agForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      const email = d.email.trim().toLowerCase();
      if (!d.agency.trim() || !email || (!id && d.password.length < 8) || (d.password && d.password.length < 8)) { toast(T("اسم الوكالة والبريد وكلمة مرور من 8 أحرف على الأقل مطلوبة", "Agency name, email and a password of 8+ characters are required")); return; }
      const payload = { id, agency: d.agency.trim(), contact: d.contact.trim(), phone: d.phone.trim(), email, password: d.password || undefined, status: d.status };
      if (owner) Object.assign(payload, { creditLimit: +d.creditLimit || 0, pricing: { mode: d.mode, flatAll: +d.flatAll || 0, pctAll: (+d.pctAll || 0) / 100, flat: +d.flat || 0, threshold: +d.threshold || 0, pct: (+d.pct || 0) / 100, publicMarkup: (+d.publicMarkup || 0) / 100 } });
      const btn = e.target.querySelector("[type=submit]"); btn.disabled = true;
      try { await DB.admin("save_partner", payload); } catch (er) { btn.disabled = false; return errToast(er); }
      closeModal(); toast(T("تم حفظ الوكيل", "Agent saved")); route();
    });
  }
  function genPass() { const c = "abcdefghjkmnpqrstuvwxyz23456789"; let s = ""; for (let i = 0; i < 8; i++) s += c[Math.floor(Math.random() * c.length)]; return s + Math.floor(Math.random() * 90 + 10); }

  function agentPaymentForm(partnerId) {
    const opts = Object.fromEntries(DB.all("partners").map((p) => [p.id, p.agency]));
    openModal(T("دفعة من وكيل B2B", "Payment from B2B agent"), `
      <form id="apForm" class="dr-form" novalidate><div class="f3">
        ${sel("partnerId", T("الوكيل", "Agent"), opts, partnerId || Object.keys(opts)[0])}${inp("amount", T("المبلغ", "Amount"), "", "number", "ltr")}${sel("method", T("الطريقة", "Method"), METHOD(), "bank")}
        ${inp("date", T("التاريخ", "Date"), today(), "date")}${inp("ref", T("مرجع", "Reference"), "", "text", "ltr")}</div>
        <p class="muted">${T("تُخصم الدفعة من رصيد الوكيل الإجمالي (حساب جارٍ).", "The payment is applied to the agent's overall balance (running account).")}</p>
        <div class="dr-actions"><button type="submit" class="btn btn--primary">${T("تسجيل الدفعة", "Record payment")}</button></div></form>`);
    $("#apForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      if (!(+d.amount > 0)) { toast(T("أدخل مبلغاً صحيحاً", "Enter a valid amount")); return; }
      try { await DB.insert("payments", { date: d.date || today(), dir: "in", amount: +d.amount, method: d.method, bookingId: null, partnerId: d.partnerId, ref: d.ref, note: T("دفعة على الحساب", "Payment on account") }); } catch (er) { return errToast(er); }
      log(T("سجّل دفعة من وكيل", "Recorded agent payment"), `${partnerName(d.partnerId)} · ${usd.format(+d.amount)}`);
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

  /* ---------- Reports (owner, profit switch on) ---------- */
  let period = "3m";
  function viewReports(el) {
    if (!showProfit()) {
      el.innerHTML = `<section class="of-card locked">${icon("i-lock")}<h3>${T("التقارير المالية مخفية", "Financial reports are hidden")}</h3><p class="muted">${T("الأرباح والتكاليف لا تظهر لأي موظف أو وكيل أبداً. وتبقى مخفية على شاشتك أيضاً حتى تختار إظهارها.", "Profit and costs are never shown to staff or agents. They stay hidden on your screen too until you choose to show them.")}</p><button type="button" class="btn btn--primary" id="rpShow">${icon("i-eye")}${T("إظهار الأرباح", "Show profit")}</button></section>`;
      $("#rpShow").addEventListener("click", () => { ls.set(PROFIT, true); showApp(); });
      return;
    }
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
      <div class="of-grid2">${gTable(T("حسب الموظف", "By staff member"), group((b) => staffName(b.assignedTo)))}${gTable(T("حسب شركة الطيران", "By airline"), group((b) => b.airline || "—"))}</div>
      ${gTable(T("حسب الوجهة", "By route"), group((b) => b.route || "—"))}`;
    $$("[data-period]", el).forEach((b) => b.addEventListener("click", () => { period = b.dataset.period; route(); }));
    $("#rpPrint").addEventListener("click", () => printHtml(`<div class="statement">${$("#pnlCard").outerHTML}</div>`));
    $("#rpCsv").addEventListener("click", exportCsv);
  }

  function exportCsv() {
    const owner = isOwner(), prof = showProfit();
    const head = ["id", "created", "source", "agent", "status", "handled_by", "customer", "phone", "route", "airline", "pnr", "tickets", "sell", "paid_in", "due"].concat(owner ? ["cost", "paid_out"] : [], prof ? ["profit"] : []);
    const rows = visibleBookings().map((b) => { const m = bookingMoney(b); return [b.id, b.created, b.source, b.partnerId ? partnerName(b.partnerId) : "", b.status, b.assignedTo ? staffName(b.assignedTo) : "", b.customer.name, b.customer.phone, b.route, b.airline, b.pnr, (b.tickets || []).join(" "), b.sell, m.inn, m.due].concat(owner ? [b.cost, m.out] : [], prof ? [m.profit] : []); });
    const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `green-travel-bookings-${today()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    toast(T("تم تجهيز ملف CSV", "CSV file prepared"));
  }

  /* ---------- Team & permissions (owner) ---------- */
  function viewTeam(el) {
    const staff = DB.all("staff");
    el.innerHTML = `
      <p class="hint">${icon("i-lock")}${T("أنت المتحكم: تعطي كل موظف اسم مستخدم وكلمة مرور خاصة به وتختار ما يراه وما يفعله. التكاليف والأرباح والمصروفات والتقارير لا تظهر لأي موظف أبداً.", "You are in control: give each employee their own username and password and choose what they see and do. Costs, profit, expenses and reports are never shown to any employee.")}</p>
      <div class="of-toolbar"><button type="button" class="btn btn--accent btn--sm" id="stNew">+ ${T("موظف جديد", "New employee")}</button></div>
      <div class="team-grid">${staff.map((s) => {
        const open = allTasks().filter((t) => t.assignee === s.id && t.status === "open");
        const bks = DB.all("bookings").filter((b) => b.assignedTo === s.id);
        const perms = s.role === "owner" ? `<span class="chip chip--owner">${T("كل الصلاحيات", "Full access")}</span>` : (s.perms || []).length ? PERMS().filter(([k]) => s.perms.includes(k)).map(([, l]) => `<span class="chip">${l}</span>`).join("") : `<span class="muted">${T("بدون صلاحيات إضافية", "No extra permissions")}</span>`;
        return `<article class="staff-card ${s.status !== "active" ? "is-off" : ""}">
          <header>${avatar(s, "lg")}<div><h3>${esc(s.name)}</h3><p>${esc(s.title || "")}</p></div>${s.role === "owner" ? `<span class="pill pill--confirmed">${T("المالك", "Owner")}</span>` : s.status === "active" ? `<span class="pill pill--ticketed">${T("نشط", "Active")}</span>` : `<span class="pill pill--cancelled">${T("موقوف", "Suspended")}</span>`}</header>
          <dl><div><dt>${T("اسم المستخدم", "Username")}</dt><dd dir="ltr" class="mono">${esc(s.username || "—")}</dd></div><div><dt>${T("آخر دخول", "Last sign-in")}</dt><dd>${fmtTime(s.lastLogin)}</dd></div>
            <div><dt>${T("مهام مفتوحة", "Open tasks")}</dt><dd class="num">${open.length}${open.filter(overdue).length ? ` <span class="neg">(${open.filter(overdue).length} ${T("متأخرة", "late")})</span>` : ""}</dd></div><div><dt>${T("حجوزات مسندة", "Assigned bookings")}</dt><dd class="num">${bks.length}</dd></div></dl>
          <div class="chips">${perms}</div>
          <footer><button type="button" class="btn btn--ghost btn--sm" data-edit-staff="${s.id}">${T("تعديل وصلاحيات", "Edit & permissions")}</button>
            ${s.role !== "owner" ? `<button type="button" class="btn btn--ghost btn--sm" data-task-for="${s.id}">+ ${T("مهمة", "Task")}</button>${s.status === "active" ? `<button type="button" class="btn btn--primary btn--sm" data-enter="${s.id}">${icon("i-eye")}${T("دخول إلى حسابه", "Open account")}</button>` : ""}` : ""}</footer>
        </article>`;
      }).join("")}</div>`;
    $("#stNew").addEventListener("click", () => staffForm(null));
    $$("[data-edit-staff]", el).forEach((b) => b.addEventListener("click", () => staffForm(b.dataset.editStaff)));
    $$("[data-enter]", el).forEach((b) => b.addEventListener("click", () => enterAs(b.dataset.enter)));
    $$("[data-task-for]", el).forEach((b) => b.addEventListener("click", () => taskForm(null, { assignee: b.dataset.taskFor })));
  }
  function staffForm(id) {
    if (!isOwner()) return;
    const s = id ? Object.assign({ password: "" }, DB.get("staff", id)) : { name: "", title: "", phone: "", email: "", username: "", password: genPass(), role: "staff", perms: ["bookings_create", "payments", "customers"], status: "active" };
    const isOwn = s.role === "owner";
    openModal(id ? T("تعديل موظف", "Edit employee") : T("موظف جديد", "New employee"), `
      <form id="sfForm" class="dr-form" novalidate>
        <fieldset><legend>${T("البيانات", "Details")}</legend><div class="f3">
          ${inp("name", T("الاسم", "Name"), s.name)}${inp("title", T("الوظيفة", "Job title"), s.title)}${inp("phone", T("الهاتف", "Phone"), s.phone, "tel", "ltr")}</div></fieldset>
        <fieldset><legend>${T("بيانات الدخول", "Login")}</legend><div class="f3">
          ${inp("username", T("اسم المستخدم", "Username"), s.username, "text", "ltr", 'autocomplete="off"')}
          <label class="fl"><span>${T("كلمة المرور", "Password")}</span><span class="pw-row"><input name="password" type="text" dir="ltr" value="${esc(s.password)}" placeholder="${id ? T("اتركها فارغة للإبقاء عليها", "Leave empty to keep") : ""}" autocomplete="off"><button type="button" class="btn btn--ghost btn--sm" data-gen>${T("توليد", "Generate")}</button></span></label>
          ${inp("email", T("البريد (اختياري)", "Email (optional)"), s.email, "email", "ltr")}
          ${isOwn ? "" : sel("status", T("الحالة", "Status"), { active: T("نشط: يستطيع الدخول", "Active: can sign in"), suspended: T("موقوف: لا يستطيع الدخول", "Suspended: cannot sign in") }, s.status)}</div></fieldset>
        ${isOwn ? `<p class="hint">${icon("i-shield")}${T("حساب المالك يملك كل الصلاحيات دائماً.", "The owner account always has full access.")}</p>` : `<fieldset><legend>${T("الصلاحيات: ماذا يستطيع أن يرى ويفعل", "Permissions: what they can see and do")}</legend>
          <div class="perm-grid">${PERMS().map(([k, l, h]) => `<label class="perm"><input type="checkbox" name="perm" value="${k}" ${(s.perms || []).includes(k) ? "checked" : ""}><span><b>${l}</b><small>${h}</small></span></label>`).join("")}</div>
          <p class="hint hint--lock">${icon("i-lock")}${T("للمالك فقط ولا يمكن منحها: التكاليف، الأرباح، المدفوع للموردين، المصروفات، التقارير المالية، الموظفون، سجل النشاط، تسعير الوكلاء.", "Owner only, cannot be granted: costs, profit, supplier payments, expenses, financial reports, team, activity log, agent pricing.")}</p></fieldset>`}
        <div class="dr-actions"><button type="submit" class="btn btn--primary">${T("حفظ", "Save")}</button>
          ${id && !isOwn ? `<button type="button" class="btn btn--ghost" id="sfMfa" title="${T("إذا فقد الموظف جواله: يربط تطبيقاً جديداً عند دخوله القادم", "If the employee lost their phone: they link a new app at their next sign-in")}">🔐 ${T("إعادة ضبط التحقق بخطوتين", "Reset two-step verification")}</button>` : ""}
          ${id && !isOwn ? `<button type="button" class="btn btn--ghost danger" id="sfDel">${T("حذف الموظف", "Delete employee")}</button>` : ""}</div>
      </form>`, true);
    const f = $("#sfForm");
    $("[data-gen]", f).addEventListener("click", () => (f.password.value = genPass()));
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(f), d = Object.fromEntries(fd);
      const username = d.username.trim().toLowerCase();
      if (!d.name.trim() || !/^[a-z0-9._-]{3,}$/.test(username)) { toast(T("أدخل الاسم واسم مستخدم بالإنجليزية (3 أحرف على الأقل)", "Enter a name and an English username (3+ characters)")); return; }
      if ((!id && d.password.length < 8) || (d.password && d.password.length < 8)) { toast(T("كلمة المرور 8 أحرف على الأقل", "Password must be 8+ characters")); return; }
      const payload = { id, name: d.name.trim(), title: d.title.trim(), phone: d.phone.trim(), username, email: d.email.trim().toLowerCase(), password: d.password || undefined };
      if (!isOwn) Object.assign(payload, { status: d.status, perms: fd.getAll("perm") });
      const btn = f.querySelector("[type=submit]"); btn.disabled = true;
      try { await DB.admin("save_staff", payload); } catch (er) { btn.disabled = false; return errToast(er); }
      closeModal(); toast(T("تم حفظ الموظف", "Employee saved")); showApp();
    });
    const mfa = $("#sfMfa");
    if (mfa) mfa.addEventListener("click", async () => {
      if (mfa.dataset.confirm !== "1") { mfa.dataset.confirm = "1"; mfa.textContent = T("اضغط مرة أخرى للتأكيد", "Press again to confirm"); return; }
      mfa.disabled = true;
      try { await DB.admin("reset_mfa", { id }); } catch (er) { mfa.disabled = false; return errToast(er); }
      toast(T("تمت إعادة الضبط: سيربط الموظف تطبيقاً جديداً عند دخوله القادم", "Reset done: the employee links a new app at their next sign-in"));
      mfa.textContent = "✓";
    });
    const del = $("#sfDel");
    if (del) del.addEventListener("click", async () => {
      if (del.dataset.confirm !== "1") { del.dataset.confirm = "1"; del.textContent = T("اضغط مرة أخرى للتأكيد", "Press again to confirm"); return; }
      try { await DB.admin("delete_staff", { id }); } catch (er) { return errToast(er); }
      closeModal(); toast(T("تم حذف الموظف", "Employee deleted")); route();
    });
  }

  /* ---------- Activity log (owner) ---------- */
  // Entries written by the server are in English; show them in the page language
  const ACTIONS = () => ({ "Added employee": T("أضاف موظفاً", "Added employee"), "Edited employee / permissions": T("عدّل بيانات/صلاحيات موظف", "Edited employee / permissions"), "Deleted employee": T("حذف موظفاً", "Deleted employee"),
    "Opened agent account": T("فتح حساب وكيل", "Opened agent account"), "Edited agent account": T("عدّل حساب وكيل", "Edited agent account"), "Owner account created": T("أنشأ حساب المالك", "Owner account created"), "B2B ticket request": T("طلب إصدار من وكيل B2B", "B2B ticket request") });
  const whoName = (id) => (DB.get("staff", id) || {}).name || (DB.get("partners", id) ? `${partnerName(id)} (B2B)` : "—");
  function viewActivity(el) {
    const list = DB.all("log");
    el.innerHTML = `<section class="of-card">${list.length ? `<div class="table-wrap"><table class="of-table"><thead><tr><th>${T("الوقت", "Time")}</th><th>${T("الموظف", "Employee")}</th><th>${T("العملية", "Action")}</th><th>${T("التفاصيل", "Details")}</th></tr></thead>
      <tbody>${list.slice(0, 200).map((l) => `<tr><td>${fmtTime(l.at)}</td><td><span class="who">${avatar(DB.get("staff", l.who) || { name: whoName(l.who) }, "xs")}${esc(whoName(l.who))}</span></td><td>${esc(ACTIONS()[l.action] || l.action)}</td><td dir="auto">${esc(l.ref)}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="muted empty">${T("لا يوجد نشاط مسجّل بعد. سيظهر هنا كل دخول وكل تعديل يقوم به الموظفون.", "No activity yet. Every sign-in and change made by staff will appear here.")}</p>`}</section>`;
  }

  /* ---------- AI assistant (staff with "ai_office") ----------
     Staff ask the AI employees for help with their work. The server keeps costs,
     profit and expenses out of these requests, and anything that needs approval
     (emails, money, booking changes) waits for the owner. */
  let aiTimer = null;
  async function aiCall(action, payload = {}) {
    const { data, error } = await DB.client.functions.invoke("ai-office", { body: Object.assign({ action }, payload) });
    if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch (e) {} throw new Error(m); }
    if (data && data.error) throw new Error(data.error);
    return data;
  }
  function viewAssistant(el) {
    clearInterval(aiTimer);
    const AI_ST = { queued: T("في الانتظار", "Queued"), running: T("يعمل الآن", "Working"), waiting: T("بانتظار الأقسام", "Waiting on departments"), done: T("منجز", "Done"), failed: T("تعذّر", "Failed"), cancelled: T("أُلغي", "Cancelled") };
    el.innerHTML = `
      <section class="of-card"><header class="of-card__h"><h3>${T("اطلب من الموظفين الأذكياء", "Ask the AI employees")}</h3></header>
        <p class="muted">${T("مثال: اكتب رداً على عميل يطلب تغيير موعد رحلته، أو راجع بيانات الحجز رقم ...، أو جهّز رسالة تذكير للمسافرين غداً. الرسائل والمبالغ وتعديل الحجوزات تحتاج موافقة المالك.", "For example: write a reply to a customer who wants to change a flight, check booking ..., or prepare a reminder for tomorrow's travelers. Emails, money and booking changes need the owner's approval.")}</p>
        <form id="aiForm" class="dr-form" novalidate>
          <label class="fl fl--wide"><span>${T("إلى", "To")}</span><select name="employee" id="aiTo"><option>…</option></select></label>
          <label class="fl fl--wide"><span>${T("الطلب", "Request")}</span><textarea name="request" rows="4" required></textarea></label>
          <button class="btn btn--accent btn--sm" type="submit">${T("أرسل", "Send")}</button>
        </form></section>
      <section class="of-card"><header class="of-card__h"><h3>${T("طلباتي", "My requests")}</h3></header><div id="aiList"><p class="muted">…</p></div></section>`;
    const paint = async () => {
      if (!document.body.contains(el) || location.hash.replace("#", "") !== "assistant") { clearInterval(aiTimer); return; }
      let r;
      try { r = await aiCall("my_jobs"); } catch (e) { $("#aiList").innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
      const open = $("#aiList details[open]") ? $("#aiList details[open]").dataset.id : "";
      $("#aiList").innerHTML = r.jobs.length ? r.jobs.map((j) => `<details class="ai-job" data-id="${j.id}" ${j.id === open ? "open" : ""}><summary><b>${esc(j.title)}</b> <span class="pill pill--${j.status === "done" ? "ticketed" : j.status === "failed" ? "cancelled" : "new"}">${AI_ST[j.status] || j.status}</span> <small class="muted">${fmtTime(j.created_at)}</small></summary>
        ${j.result ? `<div class="ai-result" dir="auto">${esc(j.result)}</div>` : j.error ? `<p class="muted">${esc(j.error)}</p>` : `<p class="muted">${T("يعمل عليه… تتحدث هذه الصفحة تلقائياً.", "In progress… this page updates by itself.")}</p>`}
        ${(j.documents || []).map((d) => `<details class="ai-doc"><summary>📄 ${esc(d.title)}</summary><div class="ai-result" dir="auto">${esc(d.body)}</div><button type="button" class="btn btn--ghost btn--sm" data-ai-copy="${d.id}">${T("نسخ", "Copy")}</button></details>`).join("")}</details>`).join("")
        : `<p class="muted empty">${T("لا توجد طلبات بعد.", "No requests yet.")}</p>`;
      $$("[data-ai-copy]", el).forEach((b) => b.addEventListener("click", () => { const d = r.jobs.flatMap((j) => j.documents || []).find((x) => x.id === b.dataset.aiCopy); navigator.clipboard.writeText(d.body).then(() => toast(T("نُسخ", "Copied"))); }));
    };
    aiCall("staff_list").then((r) => { $("#aiTo").innerHTML = r.staff.map((x) => `<option value="${x.code}">${esc(x.name)} — ${esc(x.title)}</option>`).join(""); $("#aiTo").value = "customer_service"; }).catch((e) => toast(e.message));
    $("#aiForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target, text = f.request.value.trim();
      if (text.length < 3) return toast(T("اكتب الطلب", "Write the request"));
      f.querySelector("button").disabled = true;
      try {
        const { id } = await aiCall("create", { employee: f.employee.value, request: text });
        f.request.value = ""; toast(T("أُرسل الطلب", "Request sent"));
        paint();
        aiCall("run", { id }).catch(() => {}).finally(paint); // starts at once; the background worker finishes it in any case
      } catch (er) { toast(er.message); }
      f.querySelector("button").disabled = false;
    });
    paint();
    aiTimer = setInterval(paint, 8000);
  }

  /* ---------- Settings (owner) ---------- */
  function viewSettings(el) {
    el.innerHTML = `
      <section class="of-card"><header class="of-card__h"><h3>${T("خصوصية الأرباح", "Profit privacy")}</h3></header>
        <p class="muted">${T("الأرباح والتكاليف لا تظهر لأي موظف ولا لأي وكيل B2B في أي شاشة أو ملف تصدير. على حسابك أنت تبقى مخفية افتراضياً، ويمكنك إظهارها مؤقتاً من الزر أعلى الصفحة.", "Profit and costs are never shown to staff or B2B agents on any screen or export. On your own account they stay hidden by default; you can show them from the switch at the top.")}</p></section>
      <section class="of-card"><header class="of-card__h"><h3>${T("الحماية والبيانات", "Security and data")}</h3></header>
        <p class="muted">${T("كل البيانات محفوظة في قاعدة بيانات آمنة على الإنترنت (Supabase)، ويراها كل الموظفين من أي جهاز حسب صلاحياتهم. القاعدة نفسها تمنع أي موظف من قراءة التكاليف والأرباح، وتمنع كل وكيل من رؤية أي حساب غير حسابه. لتغيير كلمة مرورك افتح «الموظفون والصلاحيات» ثم «تعديل» على حسابك.", "All data is kept in a secure online database (Supabase) that staff reach from any device, limited by their permissions. The database itself stops staff from reading costs and profit, and stops each agent from seeing any account but their own. To change your password open Team & permissions, then Edit on your own card.")}</p></section>`;
  }

  /* =========================================================
     Ticket document (e-ticket / itinerary): print, PDF, email, WhatsApp
     ========================================================= */
  const segmentsOf = (b) => {
    if (b.segments && b.segments.length) return b.segments;
    const [a, z] = String(b.route || "").split("→").map((x) => x.trim());
    const out = [];
    if (a || z) out.push({ flight: "", from: a || "", to: z || "", date: b.depart || "", dep: "", arr: "" });
    if (b.ret) out.push({ flight: "", from: z || "", to: a || "", date: b.ret, dep: "", arr: "" });
    return out;
  };
  const digits = (p) => String(p || "").replace(/[^\d]/g, "").replace(/^(\d{10})$/, "1$1");
  const L = (ar, en) => `<span class="bi"><b>${ar}</b><small>${en}</small></span>`;
  function ticketDocHtml(b) {
    const segs = segmentsOf(b), pax = (b.travelers || []).length ? b.travelers : [b.customer.name || "—"];
    const m = bookingMoney(b);
    return `<div class="statement ticket-doc" id="ticketDoc">
      <header class="st-head"><img src="assets/img/logo.png" alt="" width="52" height="52"><div><b>Green Travel · جرين ترافيل</b><small>World Services dba Green Travel · info@greentravel.us · greentravel.us</small><small dir="ltr">${COMPANY_PHONES.join(" · ")}</small></div>
        <div class="st-meta"><b>${b.status === "ticketed" ? "E-TICKET RECEIPT" : "ITINERARY"}</b><span>${b.status === "ticketed" ? "إيصال التذكرة الإلكترونية" : "خط سير الرحلة"}</span><span dir="ltr">${fmtDate(today())}</span></div></header>
      <div class="tk-ids">
        <div>${L("رقم الحجز", "Booking ref (PNR)")}<strong dir="ltr" class="mono">${esc(b.pnr || "—")}</strong></div>
        <div>${L("شركة الطيران", "Airline")}<strong>${esc(b.airline || "—")}</strong></div>
        <div>${L("الدرجة", "Cabin")}<strong>${esc(CABIN()[b.cabin] || b.cabin || "—")}</strong></div>
        <div>${L("المرجع", "Reference")}<strong dir="ltr" class="mono">${esc(b.id)}</strong></div>
      </div>
      <h4 class="tk-h">${L("المسافرون", "Passengers")}</h4>
      <table class="of-table"><thead><tr><th>#</th><th>${T("الاسم", "Name")} / Name</th><th>${T("رقم التذكرة", "Ticket number")} / E-ticket</th></tr></thead>
        <tbody>${pax.map((n, i) => `<tr><td>${i + 1}</td><td><b>${esc(n)}</b></td><td dir="ltr" class="mono">${esc((b.tickets || [])[i] || (b.tickets || [])[0] || "—")}</td></tr>`).join("")}</tbody></table>
      <h4 class="tk-h">${L("الرحلات", "Flights")}</h4>
      <table class="of-table"><thead><tr><th>${T("الرحلة", "Flight")} / Flight</th><th>${T("من", "From")} → ${T("إلى", "To")}</th><th>${T("التاريخ", "Date")} / Date</th><th>${T("الإقلاع", "Departs")}</th><th>${T("الوصول", "Arrives")}</th></tr></thead>
        <tbody>${segs.map((s) => `<tr><td dir="ltr" class="mono">${esc(s.flight || "—")}</td><td dir="ltr"><b>${esc(s.from)}</b> → <b>${esc(s.to)}</b>${s.via ? ` <small>via ${esc(s.via)}</small>` : ""}</td><td>${fmtDate(s.date)}</td><td dir="ltr" class="mono">${esc(s.dep || "—")}</td><td dir="ltr" class="mono">${esc(s.arr || "—")}${s.arrDate && s.arrDate !== s.date ? ` <small>${fmtDate(s.arrDate)}</small>` : ""}</td></tr>`).join("")}</tbody></table>
      <div class="tk-foot">
        <div>${L("الأمتعة", "Baggage")}<span>${esc(b.baggage || T("حسب شروط شركة الطيران", "As per airline fare rules"))}</span></div>
        <div>${L("المبلغ", "Amount")}<span><b dir="ltr">${usd.format(b.sell)}</b> · ${T("المدفوع", "Paid")} <span dir="ltr">${usd.format(m.inn)}</span>${m.due ? ` · ${T("المتبقي", "Due")} <span dir="ltr">${usd.format(m.due)}</span>` : ""}</span></div>
      </div>
      <ul class="tk-notes">
        <li>${T("احضر إلى المطار قبل 3 ساعات للرحلات الدولية وساعتين للداخلية.", "Arrive 3 hours early for international flights and 2 hours for domestic.")} <small>Arrive 3h before international / 2h before domestic flights.</small></li>
        <li>${T("تأكد من صلاحية جواز السفر (6 أشهر على الأقل) والتأشيرة إن لزمت.", "Make sure your passport is valid for 6+ months and you hold any required visa.")} <small>Passport valid 6+ months; visa if required.</small></li>
        <li>${T("الأوقات بالتوقيت المحلي، والحجز يخضع لشروط شركة الطيران.", "Times are local; the booking is subject to the airline's fare rules.")} <small>Local times. Subject to the airline's fare rules.</small></li>
      </ul>
    </div>`;
  }
  // Loads html2pdf only when someone saves a PDF
  let pdfLib = null;
  function loadPdfLib() {
    if (window.html2pdf) return Promise.resolve();
    if (!pdfLib) pdfLib = new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    return pdfLib;
  }
  async function savePdf(el, filename) {
    try {
      await loadPdfLib();
      await window.html2pdf().set({ margin: 8, filename, image: { type: "jpeg", quality: 0.96 }, html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" }, jsPDF: { unit: "mm", format: "a4", orientation: "portrait" } }).from(el).save();
      return true;
    } catch (e) { toast(T("تعذّر إنشاء PDF، استخدم «طباعة» ثم «حفظ كـ PDF».", "Couldn't create the PDF; use Print, then Save as PDF.")); return false; }
  }
  const COMPANY_PHONES = ["+1 (708) 963-2552", "+1 (708) 940-2929", "+1 (331) 213-3768", "+1 (708) 953-2244"];
  const ticketTextFull = (b) => {
    const segs = segmentsOf(b), pax = (b.travelers || []).length ? b.travelers : [b.customer.name || ""];
    const lines = [
      `✈️ ${T("جرين ترافيل — تفاصيل رحلتك", "Green Travel — your trip details")}`,
      `${T("رقم الحجز", "Booking ref")} (PNR): ${b.pnr || "—"} · ${T("المرجع", "Ref")}: ${b.id}`,
      `${T("شركة الطيران", "Airline")}: ${b.airline || "—"} · ${CABIN()[b.cabin] || ""}`,
      "",
      `${T("الرحلات", "Flights")}:`,
      ...segs.map((s, i) => `${i + 1}) ${s.flight || ""} ${s.from} → ${s.to}\n   ${fmtDate(s.date)}${s.dep ? ` · ${T("إقلاع", "dep")} ${s.dep}` : ""}${s.arr ? ` · ${T("وصول", "arr")} ${s.arr}` : ""}`),
      "",
      `${T("المسافرون", "Travelers")}:`,
      ...pax.map((n, i) => `• ${n}${(b.tickets || [])[i] ? ` — ${T("تذكرة", "ticket")} ${b.tickets[i]}` : ""}`),
      b.baggage ? `${T("الأمتعة", "Baggage")}: ${b.baggage}` : "",
      "",
      b.status === "ticketed" ? T("بعد الإصدار: التعديل والإلغاء حسب شروط شركة الطيران ورسومها.", "After ticketing: changes and cancellations follow the airline's rules and fees.") : T("قبل الإصدار يمكن الإلغاء أو التعديل دون رسوم.", "Before ticketing you can cancel or change free of charge."),
      T("احضر للمطار قبل 3 ساعات للرحلات الدولية.", "Arrive 3 hours early for international flights."),
      "",
      `Green Travel · ${COMPANY_PHONES.join(" / ")}`,
      `info@greentravel.us · greentravel.us/#manage`,
    ];
    return lines.filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n");
  };
  const ticketText = (b) => {
    const segs = segmentsOf(b);
    return `${T("جرين ترافيل — تفاصيل رحلتك", "Green Travel — your trip details")}\nPNR: ${b.pnr || "—"} · ${b.airline || ""}\n` +
      segs.map((s) => `${s.flight || ""} ${s.from} → ${s.to} · ${fmtDate(s.date)}${s.dep ? " · " + s.dep : ""}`).join("\n") +
      `\n${T("المسافرون", "Travelers")}: ${(b.travelers || [b.customer.name]).join(", ")}${(b.tickets || []).length ? `\n${T("التذاكر", "Tickets")}: ${b.tickets.join(", ")}` : ""}\n+1 (708) 963-2552 · info@greentravel.us`;
  };
  function openTicket(id) {
    const b = DB.get("bookings", id);
    if (!b) return;
    closeDrawer();
    openModal(T("التذكرة وخط سير الرحلة", "Ticket and itinerary") + " · " + b.id, `
      <div class="tk-actions">
        <button type="button" class="btn btn--primary btn--sm" id="tkPrint">${icon("i-list")}${T("طباعة", "Print")}</button>
        <button type="button" class="btn btn--ghost btn--sm" id="tkPdf">${icon("i-ticket")}${T("حفظ PDF على الكمبيوتر", "Save PDF to computer")}</button>
        <span class="tk-mail"><input type="email" id="tkTo" dir="ltr" placeholder="${T("بريد العميل", "Customer email")}" value="${esc(b.customer.email || "")}"><button type="button" class="btn btn--accent btn--sm" id="tkEmail">${icon("i-mail")}${T("إرسال بالبريد", "Email")}</button></span>
      </div>
      <div class="tk-actions tk-share">
        <button type="button" class="btn btn--accent btn--sm" id="tkShare">${icon("i-ticket")}${T("إرسال PDF (واتساب / رسائل)", "Send PDF (WhatsApp / Messages)")}</button>
        <a class="btn btn--ghost btn--sm" target="_blank" rel="noopener" href="https://wa.me/${digits(b.customer.phone)}?text=${encodeURIComponent(ticketTextFull(b))}">${icon("i-whatsapp")}${T("واتساب: التفاصيل كاملة", "WhatsApp: full details")}</a>
        <a class="btn btn--ghost btn--sm" href="sms:${esc(b.customer.phone || "")}?&body=${encodeURIComponent(ticketTextFull(b))}">${icon("i-chat")}${T("رسالة نصية SMS", "Text message (SMS)")}</a>
        <button type="button" class="btn btn--ghost btn--sm" id="tkCopy">${T("نسخ التفاصيل", "Copy details")}</button>
      </div>
      ${b.reminders && b.reminders.ticket ? `<p class="hint">${icon("i-check")}${T("أُرسلت التذكرة بالبريد في", "Ticket emailed on")} ${fmtTime(b.reminders.ticket)}</p>` : ""}
      ${ticketDocHtml(b)}`, true);
    $("#tkPrint").addEventListener("click", () => { printHtml(ticketDocHtml(b)); log(T("طبع تذكرة", "Printed ticket"), b.id); });
    $("#tkCopy").addEventListener("click", () => (navigator.clipboard ? navigator.clipboard.writeText(ticketTextFull(b)) : Promise.reject()).then(() => toast(T("تم النسخ", "Copied"))).catch(() => toast(T("تعذّر النسخ", "Couldn't copy"))));
    // The PDF goes straight to WhatsApp / Messages / Mail through the phone's or computer's share sheet; otherwise it is saved and WhatsApp opens
    $("#tkShare").addEventListener("click", async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      const name = `GreenTravel-${b.pnr || b.id}.pdf`;
      try {
        await loadPdfLib();
        const blob = await window.html2pdf().set({ margin: 8, filename: name, image: { type: "jpeg", quality: 0.96 }, html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" }, jsPDF: { unit: "mm", format: "a4" } }).from($("#ticketDoc")).outputPdf("blob");
        const file = new File([blob], name, { type: "application/pdf" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: name, text: ticketTextFull(b) });
          log(T("أرسل التذكرة PDF", "Shared ticket PDF"), b.id);
        } else {
          const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
          toast(T("حُفظ ملف PDF: أرفقه في محادثة واتساب التي ستُفتح الآن.", "PDF saved: attach it in the WhatsApp chat that opens now."));
          if (b.customer.phone) window.open(`https://wa.me/${digits(b.customer.phone)}?text=${encodeURIComponent(ticketTextFull(b))}`, "_blank", "noopener");
        }
      } catch (er) { if (er && er.name !== "AbortError") toast(T("تعذّر تجهيز الملف، استخدم «حفظ PDF».", "Couldn't prepare the file; use Save PDF.")); }
      btn.disabled = false;
    });
    $("#tkPdf").addEventListener("click", async (e) => { const btn = e.currentTarget; btn.disabled = true; if (await savePdf($("#ticketDoc"), `GreenTravel-${b.pnr || b.id}.pdf`)) log(T("حفظ تذكرة PDF", "Saved ticket PDF"), b.id); btn.disabled = false; });
    $("#tkEmail").addEventListener("click", async (e) => {
      const to = $("#tkTo").value.trim(), btn = e.currentTarget;
      if (!/^\S+@\S+\.\S+$/.test(to)) { toast(T("أدخل بريد العميل", "Enter the customer's email")); return; }
      btn.disabled = true;
      try { await DB.sendEmail("ticket", b.id, to); toast(T("أُرسلت التذكرة إلى ", "Ticket sent to ") + to); }
      catch (er) {
        if (/not_configured/.test(er.message)) {
          // Email service not set up yet: save the PDF and open the email app with the details
          toast(T("خدمة البريد غير مفعّلة بعد: سيُحفظ PDF وتُفتح رسالة لترفقه بها.", "Email service not set up yet: the PDF will be saved and an email opened to attach it."));
          await savePdf($("#ticketDoc"), `GreenTravel-${b.pnr || b.id}.pdf`);
          location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent("Green Travel — " + (b.pnr ? "PNR " + b.pnr : b.id))}&body=${encodeURIComponent(ticketText(b))}`;
        } else errToast(er);
      }
      btn.disabled = false;
    });
  }

  /* =========================================================
     Travel alerts: departures in the next 7 days + reminders
     ========================================================= */
  const daysUntil = (iso) => Math.round((new Date(iso + "T12:00:00") - new Date(today() + "T12:00:00")) / 864e5);
  const upcoming = (days = 7) => visibleBookings().filter((b) => ["confirmed", "ticketed"].includes(b.status) && b.depart && daysUntil(b.depart) >= 0 && daysUntil(b.depart) <= days).sort((a, b) => a.depart.localeCompare(b.depart));
  const needsReminder = (b) => !(b.reminders && (b.reminders.week || b.reminders.manual_week));
  const reminderText = (b) => {
    const d = daysUntil(b.depart), segs = segmentsOf(b), s = segs[0] || {};
    return `${T("مرحباً", "Hello")} ${b.customer.name || ""}،\n${d <= 1 ? T("نذكّرك بأن رحلتك غداً", "A reminder that your flight is tomorrow") : T(`نذكّرك بأن رحلتك بعد ${d} أيام`, `A reminder that your trip is in ${d} days`)}:\n` +
      `${s.flight || b.airline || ""} ${s.from || ""} → ${s.to || ""} · ${fmtDate(b.depart)}${s.dep ? " · " + s.dep : ""}\nPNR: ${b.pnr || "—"}\n` +
      T("تأكد من جواز السفر والتأشيرة، واحضر للمطار قبل 3 ساعات. رحلة سعيدة!\nجرين ترافيل +1 (708) 963-2552", "Please check your passport and visa and arrive 3 hours early. Have a great trip!\nGreen Travel +1 (708) 963-2552");
  };
  let alertDays = 7;
  function viewAlerts(el) {
    const list = upcoming(alertDays);
    const rets = visibleBookings().filter((b) => ["confirmed", "ticketed"].includes(b.status) && b.ret && daysUntil(b.ret) >= 0 && daysUntil(b.ret) <= alertDays);
    el.innerHTML = `
      <p class="hint">${icon("i-clock")}${T("يرسل النظام تلقائياً كل صباح تذكيراً بالبريد للمسافرين قبل أسبوع من السفر، وتذكيراً آخر قبل يوم واحد (يتطلب تفعيل خدمة البريد). ويمكنك إرسال التذكير يدوياً بالبريد أو واتساب من هنا.", "Every morning the system automatically emails travelers one week before departure and again the day before (requires the email service). You can also send a reminder manually by email or WhatsApp here.")}</p>
      <div class="of-toolbar"><div class="seg">${[7, 14, 30].map((d) => `<button type="button" data-days="${d}" class="${alertDays === d ? "is-active" : ""}">${T(`${d} يوماً`, `${d} days`)}</button>`).join("")}</div>
        <button type="button" class="btn btn--ghost btn--sm" id="alPrint">${T("طباعة", "Print")}</button><button type="button" class="btn btn--ghost btn--sm" id="alCsv">Excel / CSV</button></div>
      <section class="of-card"><header class="of-card__h"><h3>${T("مسافرون قريباً", "Departing soon")} (${list.length})</h3></header><div id="alTable">${alertTable(list)}</div></section>
      ${rets.length ? `<section class="of-card"><header class="of-card__h"><h3>${T("عودة قريبة", "Returning soon")} (${rets.length})</h3></header>${alertTable(rets, true)}</section>` : ""}`;
    $$("[data-days]", el).forEach((b) => b.addEventListener("click", () => { alertDays = +b.dataset.days; route(); }));
    bindAlertActions(el);
    const rows = () => list.map((b) => [b.id, b.customer.name, b.customer.phone, b.customer.email, b.route, b.airline, b.pnr, b.depart, daysUntil(b.depart), b.reminders && b.reminders.week ? "sent" : "", b.reminders && b.reminders.day ? "sent" : ""]);
    const head = ["booking", "customer", "phone", "email", "route", "airline", "pnr", "depart", "days_left", "week_reminder", "day_reminder"];
    $("#alCsv").addEventListener("click", () => downloadCsv(`travel-alerts-${today()}`, head, rows()));
    $("#alPrint").addEventListener("click", () => printHtml(docWrap(T("المسافرون خلال الأيام القادمة", "Upcoming travelers"), simpleTable(head, rows()))));
  }
  function alertTable(list, isReturn) {
    if (!list.length) return `<p class="muted empty">${T("لا يوجد مسافرون في هذه الفترة.", "No travelers in this period.")}</p>`;
    return `<div class="table-wrap"><table class="of-table"><thead><tr><th>${T("الحجز", "Booking")}</th><th>${T("العميل", "Customer")}</th><th>${T("المسار", "Route")}</th><th>${isReturn ? T("العودة", "Return") : T("السفر", "Departs")}</th><th>${T("بعد", "In")}</th><th>${T("التذكير", "Reminder")}</th><th></th></tr></thead>
      <tbody>${list.map((b) => { const d = daysUntil(isReturn ? b.ret : b.depart), r = b.reminders || {}; return `<tr class="${d <= 1 ? "row-hot" : ""}">
        <td dir="ltr" class="mono"><a href="#" data-open="${b.id}">${b.id}</a></td><td><b>${esc(b.customer.name || "—")}</b><br><small class="muted" dir="ltr">${esc(b.customer.phone || "")}${b.customer.email ? " · " + esc(b.customer.email) : ""}</small></td>
        <td dir="ltr">${esc(b.route)}<br><small class="muted">${esc(b.airline || "")}${b.pnr ? " · " + esc(b.pnr) : ""}</small></td><td>${fmtDate(isReturn ? b.ret : b.depart)}</td>
        <td><span class="pill ${d <= 1 ? "pill--cancelled" : d <= 3 ? "pill--new" : "pill--confirmed"}">${d === 0 ? T("اليوم", "Today") : d === 1 ? T("غداً", "Tomorrow") : T(`${d} أيام`, `${d} days`)}</span></td>
        <td>${r.week ? `<span class="tag tag--in">${T("أسبوع ✓", "Week ✓")}</span>` : ""} ${r.day ? `<span class="tag tag--in">${T("يوم ✓", "Day ✓")}</span>` : ""} ${!r.week && !r.day ? `<span class="tag">${T("لم يُرسل", "Not sent")}</span>` : ""}</td>
        <td class="row-actions"><button type="button" class="btn btn--ghost btn--sm" data-remind="${b.id}" data-kind="${d <= 1 ? "day" : "week"}">${icon("i-mail")}${T("تذكير بالبريد", "Email")}</button>
          ${b.customer.phone ? `<a class="btn btn--ghost btn--sm" target="_blank" rel="noopener" href="https://wa.me/${digits(b.customer.phone)}?text=${encodeURIComponent(reminderText(b))}">${icon("i-whatsapp")}WhatsApp</a>` : ""}
          <button type="button" class="btn btn--ghost btn--sm" data-ticket="${b.id}">${icon("i-ticket")}${T("التذكرة", "Ticket")}</button></td></tr>`; }).join("")}</tbody></table></div>`;
  }
  function bindAlertActions(el) {
    $$("[data-open]", el).forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); openBooking(a.dataset.open); }));
    $$("[data-ticket]", el).forEach((b) => b.addEventListener("click", () => openTicket(b.dataset.ticket)));
    $$("[data-remind]", el).forEach((btn) => btn.addEventListener("click", async () => {
      const b = DB.get("bookings", btn.dataset.remind);
      if (!b.customer.email) { toast(T("لا يوجد بريد لهذا العميل: استخدم واتساب أو أضف البريد في الحجز.", "No email for this customer: use WhatsApp or add the email to the booking.")); return; }
      btn.disabled = true;
      try { await DB.sendEmail(btn.dataset.kind, b.id); toast(T("أُرسل التذكير إلى ", "Reminder sent to ") + b.customer.email); route(); }
      catch (er) { btn.disabled = false; if (/not_configured/.test(er.message)) toast(T("خدمة البريد غير مفعّلة بعد. استخدم واتساب الآن، وفعّل البريد من الإعدادات.", "The email service isn't set up yet. Use WhatsApp for now and set up email in Settings.")); else errToast(er); }
    }));
  }

  /* =========================================================
     Customer file: all bookings, tickets, payments, printable
     ========================================================= */
  function customerFile(c) {
    const bks = c.ids.map((x) => DB.get("bookings", x)).filter(Boolean).sort((a, b) => b.created.localeCompare(a.created));
    const pays = DB.all("payments").filter((p) => c.ids.includes(p.bookingId) && p.dir !== "out");
    const html = () => `<div class="statement" id="custDoc">
      <header class="st-head"><img src="assets/img/logo.png" alt="" width="48" height="48"><div><b>Green Travel</b><small>World Services dba Green Travel · info@greentravel.us</small></div>
        <div class="st-meta"><b>${T("ملف العميل", "Customer file")}</b><span>${esc(c.name || "")}</span><span>${fmtDate(today())}</span></div></header>
      <div class="inv-parties"><div><small>${T("العميل", "Customer")}</small><b>${esc(c.name || "—")}</b></div><div><small>${T("التواصل", "Contact")}</small><b dir="ltr">${esc([c.phone, c.email].filter(Boolean).join(" · ") || "—")}</b></div></div>
      <div class="kpi-grid kpi-grid--3">${kpi(T("الحجوزات", "Bookings"), count(c.n), T("آخر حجز", "Last") + " " + fmtDate(c.last))}${kpi(T("المشتريات", "Purchases"), money(c.sales), "")}${kpi(T("المتبقي", "Balance due"), money(c.due), "", c.due ? "warn" : "good")}</div>
      <h4 class="tk-h">${T("الحجوزات والتذاكر", "Bookings and tickets")}</h4>
      <table class="of-table"><thead><tr><th>${T("الحجز", "Booking")}</th><th>${T("المسار", "Route")}</th><th>${T("السفر", "Travel")}</th><th>PNR</th><th>${T("التذاكر", "Tickets")}</th><th>${T("المسافرون", "Travelers")}</th><th>${T("الحالة", "Status")}</th><th>${T("المبلغ", "Amount")}</th><th class="no-print"></th></tr></thead>
        <tbody>${bks.map((b) => `<tr><td dir="ltr" class="mono">${b.id}</td><td dir="ltr">${esc(b.route)}<br><small>${esc(b.airline)}</small></td><td>${fmtDate(b.depart)}${b.ret ? "<br>" + fmtDate(b.ret) : ""}</td><td dir="ltr" class="mono">${esc(b.pnr || "—")}</td><td dir="ltr" class="mono">${esc((b.tickets || []).join(", ") || "—")}</td><td>${esc((b.travelers || []).join("، ") || "—")}</td><td>${pill(b.status)}</td><td>${money(b.sell)}</td><td class="no-print"><button type="button" class="btn btn--ghost btn--sm" data-ticket="${b.id}">${icon("i-ticket")}${T("التذكرة", "Ticket")}</button></td></tr>`).join("")}</tbody></table>
      <h4 class="tk-h">${T("المدفوعات", "Payments")}</h4>
      ${pays.length ? `<table class="of-table"><thead><tr><th>${T("التاريخ", "Date")}</th><th>${T("الحجز", "Booking")}</th><th>${T("الطريقة", "Method")}</th><th>${T("المبلغ", "Amount")}</th></tr></thead><tbody>${pays.map((p) => `<tr><td>${fmtDate(p.date)}</td><td dir="ltr" class="mono">${p.bookingId}</td><td>${METHOD()[p.method] || p.method}</td><td class="${p.dir === "in" ? "pos" : "neg"}">${p.dir === "in" ? "+" : "−"}${money(p.amount)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">${T("لا توجد مدفوعات.", "No payments.")}</p>`}
    </div>`;
    openModal(T("ملف العميل", "Customer file") + " · " + (c.name || ""), `<div class="tk-actions"><button type="button" class="btn btn--primary btn--sm" id="cfPrint">${T("طباعة الملف", "Print file")}</button><button type="button" class="btn btn--ghost btn--sm" id="cfPdf">${T("حفظ PDF", "Save PDF")}</button><button type="button" class="btn btn--ghost btn--sm" id="cfCsv">Excel / CSV</button>${c.phone ? `<a class="btn btn--ghost btn--sm" href="tel:${esc(c.phone)}">${icon("i-phone")}${esc(c.phone)}</a>` : ""}</div>${html()}`, true);
    $$("[data-ticket]", $("#ofModalBody")).forEach((b) => b.addEventListener("click", () => openTicket(b.dataset.ticket)));
    $("#cfPrint").addEventListener("click", () => printHtml(html()));
    $("#cfPdf").addEventListener("click", () => savePdf($("#custDoc"), `GreenTravel-${(c.name || "customer").replace(/\s+/g, "-")}.pdf`));
    $("#cfCsv").addEventListener("click", () => downloadCsv(`customer-${(c.name || "file").replace(/\s+/g, "-")}`, ["booking", "created", "route", "airline", "depart", "return", "pnr", "tickets", "travelers", "status", "amount", "paid", "due"],
      bks.map((b) => { const m = bookingMoney(b); return [b.id, b.created, b.route, b.airline, b.depart, b.ret, b.pnr, (b.tickets || []).join(" "), (b.travelers || []).join("; "), b.status, b.sell, m.inn, m.due]; })));
  }

  /* =========================================================
     Export helpers: CSV (opens in Excel), Excel workbook, print
     ========================================================= */
  function downloadBlob(content, type, filename) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  }
  function downloadCsv(name, head, rows) {
    const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    downloadBlob("﻿" + csv, "text/csv;charset=utf-8", `${name}.csv`);
    toast(T("تم تنزيل الملف", "File downloaded"));
  }
  // Excel workbook (SpreadsheetML 2003): several sheets in one file, opens directly in Excel
  function downloadExcel(name, sheets) {
    const x = (v) => String(v ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
    const cell = (v) => (typeof v === "number" && isFinite(v) ? `<Cell><Data ss:Type="Number">${v}</Data></Cell>` : `<Cell><Data ss:Type="String">${x(v)}</Data></Cell>`);
    const body = sheets.map(([title, head, rows]) => `<Worksheet ss:Name="${x(title).slice(0, 31)}"><Table><Row>${head.map((h) => `<Cell ss:StyleID="h"><Data ss:Type="String">${x(h)}</Data></Cell>`).join("")}</Row>${rows.map((r) => `<Row>${r.map(cell).join("")}</Row>`).join("")}</Table></Worksheet>`).join("");
    const xml = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#E6F2E8" ss:Pattern="Solid"/></Style></Styles>${body}</Workbook>`;
    downloadBlob(xml, "application/vnd.ms-excel", `${name}.xls`);
    toast(T("تم تنزيل ملف Excel", "Excel file downloaded"));
  }
  const simpleTable = (head, rows) => `<table class="of-table"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${typeof v === "number" ? usd.format(v).replace("$", "") : esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const docWrap = (title, inner, sub = "") => `<div class="statement"><header class="st-head"><img src="assets/img/logo.png" alt="" width="48" height="48"><div><b>Green Travel</b><small>World Services dba Green Travel · info@greentravel.us</small></div>
    <div class="st-meta"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}<span>${fmtDate(today())}</span></div></header>${inner}</div>`;

  /* =========================================================
     Accounting (owner only): double-entry journal built from the
     bookings, payments and expenses, plus manual entries
     ========================================================= */
  const COA = () => [
    ["1010", T("الصندوق (نقداً)", "Cash on hand"), "asset"],
    ["1020", T("البنك (تحويل، شيك، Zelle)", "Bank (transfer, check, Zelle)"), "asset"],
    ["1030", T("مقبوضات البطاقات", "Card receipts"), "asset"],
    ["1100", T("ذمم العملاء", "Receivable: customers"), "asset"],
    ["1110", T("ذمم وكلاء B2B", "Receivable: B2B agents"), "asset"],
    ["1120", T("ذمم الشركات (TMC)", "Receivable: corporate clients"), "asset"],
    ["1200", T("أصول أخرى", "Other assets"), "asset"],
    ["2010", T("ذمم الموردين (شركات الطيران)", "Payable: airlines / suppliers"), "liability"],
    ["2020", T("قروض والتزامات أخرى", "Loans and other liabilities"), "liability"],
    ["3010", T("رأس المال", "Owner's capital"), "equity"],
    ["3020", T("مسحوبات المالك", "Owner's drawings"), "equity"],
    ["3030", T("أرباح محتجزة (افتتاحية)", "Retained earnings (opening)"), "equity"],
    ["4010", T("مبيعات التذاكر", "Ticket sales"), "revenue"],
    ["4020", T("إيرادات أخرى", "Other income"), "revenue"],
    ["4030", T("رسوم خدمة الشركات", "Corporate service fees"), "revenue"],
    ["5010", T("تكلفة التذاكر", "Cost of tickets"), "expense"],
    ["6010", T("إيجار", "Rent"), "expense"], ["6020", T("رواتب", "Salaries"), "expense"], ["6030", T("تسويق", "Marketing"), "expense"],
    ["6040", T("برامج", "Software"), "expense"], ["6050", T("خدمات", "Utilities"), "expense"], ["6090", T("مصروفات أخرى", "Other expenses"), "expense"],
  ];
  const ACC = () => Object.fromEntries(COA().map(([c, n, t]) => [c, { code: c, name: n, type: t }]));
  const accName = (c) => (ACC()[c] ? `${c} · ${ACC()[c].name}` : c);
  const CASH_ACC = { cash: "1010", bank: "1020", zelle: "1020", check: "1020", card: "1030" };
  const EXP_ACC = { rent: "6010", salaries: "6020", marketing: "6030", software: "6040", utilities: "6050", other: "6090" };
  const debitNormal = (c) => ["asset", "expense"].includes((ACC()[c] || {}).type);
  const r2 = (n) => Math.round(n * 100) / 100;

  function buildJournal() {
    const out = [], bk = DB.all("bookings");
    const bById = Object.fromEntries(bk.map((b) => [b.id, b]));
    bk.filter((b) => b.status === "ticketed").forEach((b) => {
      const date = b.ticketedAt || b.created, ar = b.partnerId ? "1110" : b.companyId ? "1120" : "1100", party = b.partnerId ? partnerName(b.partnerId) : b.companyId ? coName(b.companyId) : b.customer.name || "";
      const fee = b.companyId ? +b.serviceFee || 0 : 0;
      out.push({ date, ref: b.id, src: "sale", memo: `${T("بيع تذاكر", "Ticket sale")} ${b.id} · ${b.route} · ${party}`, lines: [{ account: ar, debit: b.sell + fee, credit: 0, party }, { account: "4010", debit: 0, credit: b.sell }, ...(fee ? [{ account: "4030", debit: 0, credit: fee }] : [])] });
      if (b.cost > 0) out.push({ date, ref: b.id, src: "cost", memo: `${T("تكلفة تذاكر", "Ticket cost")} ${b.id} · ${b.airline}`, lines: [{ account: "5010", debit: b.cost, credit: 0 }, { account: "2010", debit: 0, credit: b.cost, party: b.airline }] });
    });
    DB.all("payments").forEach((p) => {
      const b = p.bookingId ? bById[p.bookingId] : null, cash = CASH_ACC[p.method] || "1020";
      const agent = p.partnerId || (b && b.partnerId), co = p.companyId || (b && b.companyId);
      const ar = agent ? "1110" : co ? "1120" : "1100", party = agent ? partnerName(agent) : co ? coName(co) : b ? b.customer.name : "";
      if (p.dir === "in") out.push({ date: p.date, ref: p.bookingId || p.ref || "", src: "receipt", memo: `${T("مقبوض", "Receipt")} ${METHOD()[p.method] || p.method} · ${party}${p.ref ? " · " + p.ref : ""}`, lines: [{ account: cash, debit: p.amount, credit: 0 }, { account: ar, debit: 0, credit: p.amount, party }] });
      else if (p.dir === "refund") out.push({ date: p.date, ref: p.bookingId || "", src: "refund", memo: `${T("استرداد للعميل", "Customer refund")} · ${party}`, lines: [{ account: ar, debit: p.amount, credit: 0, party }, { account: cash, debit: 0, credit: p.amount }] });
      else out.push({ date: p.date, ref: p.bookingId || p.ref || "", src: "supplier", memo: `${T("دفع للمورد", "Supplier payment")} · ${b ? b.airline : ""}${p.ref ? " · " + p.ref : ""}`, lines: [{ account: "2010", debit: p.amount, credit: 0, party: b ? b.airline : "" }, { account: cash, debit: 0, credit: p.amount }] });
    });
    DB.all("expenses").forEach((x) => out.push({ date: x.date, ref: "", src: "expense", memo: `${EXP()[x.category] || x.category}${x.note ? " · " + x.note : ""}`, lines: [{ account: EXP_ACC[x.category] || "6090", debit: x.amount, credit: 0 }, { account: CASH_ACC[x.method] || "1020", debit: 0, credit: x.amount }] }));
    DB.all("journal").forEach((j) => out.push({ date: j.date, ref: "JE", src: "manual", id: j.id, memo: j.memo || T("قيد يدوي", "Manual entry"), lines: j.lines }));
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }
  function balances(entries) {
    const bal = {};
    entries.forEach((e) => e.lines.forEach((l) => { const a = (bal[l.account] = bal[l.account] || { dr: 0, cr: 0 }); a.dr += +l.debit || 0; a.cr += +l.credit || 0; }));
    return bal;
  }
  const net = (b, c) => (b ? (debitNormal(c) ? b.dr - b.cr : b.cr - b.dr) : 0);

  let ac = { tab: "income", from: new Date().getFullYear() + "-01-01", to: today(), acct: "1020" };
  const AC_TABS = () => [["income", T("قائمة الدخل", "Income statement")], ["balance", T("الميزانية العمومية", "Balance sheet")], ["trial", T("ميزان المراجعة", "Trial balance")],
    ["journal", T("دفتر اليومية", "General journal")], ["ledger", T("دفتر الأستاذ", "General ledger")], ["aging", T("أعمار الديون", "Receivables aging")], ["payables", T("مستحقات الموردين", "Payables")], ["manual", T("القيود اليدوية", "Manual entries")]];
  function viewAccounting(el) {
    if (!showProfit()) {
      el.innerHTML = `<section class="of-card locked">${icon("i-lock")}<h3>${T("النظام المحاسبي مخفي", "Accounting is hidden")}</h3><p class="muted">${T("المحاسبة تكشف الأرباح والتكاليف، لذلك لا تظهر لأي موظف، وتبقى مخفية على شاشتك حتى تختار إظهارها.", "Accounting reveals profit and costs, so no employee ever sees it, and it stays hidden on your screen until you choose to show it.")}</p><button type="button" class="btn btn--primary" id="rpShow">${icon("i-eye")}${T("إظهار", "Show")}</button></section>`;
      $("#rpShow").addEventListener("click", () => { ls.set(PROFIT, true); showApp(); });
      return;
    }
    const all = buildJournal(), inP = all.filter((e) => e.date >= ac.from && e.date <= ac.to), upTo = all.filter((e) => e.date <= ac.to);
    const tab = AC_TABS().find((t) => t[0] === ac.tab) || AC_TABS()[0];
    const R = REPORT[tab[0]]({ all, inP, upTo });
    el.innerHTML = `
      <div class="ac-tabs" role="tablist">${AC_TABS().map(([k, v]) => `<button type="button" role="tab" data-actab="${k}" class="${k === tab[0] ? "is-active" : ""}" aria-selected="${k === tab[0]}">${v}</button>`).join("")}</div>
      <div class="of-toolbar ac-bar">
        <label class="ac-date"><span>${T("من", "From")}</span><input type="date" id="acFrom" value="${ac.from}"></label>
        <label class="ac-date"><span>${T("إلى", "To")}</span><input type="date" id="acTo" value="${ac.to}"></label>
        <div class="seg">${[["m", T("هذا الشهر", "This month")], ["q", T("آخر 3 أشهر", "Last 3 months")], ["y", T("هذه السنة", "This year")], ["a", T("الكل", "All")]].map(([k, v]) => `<button type="button" data-quick="${k}">${v}</button>`).join("")}</div>
        <span class="spacer"></span>
        <button type="button" class="btn btn--ghost btn--sm" id="acPrint">${icon("i-list")}${T("طباعة / PDF", "Print / PDF")}</button>
        <button type="button" class="btn btn--ghost btn--sm" id="acCsv">CSV</button>
        <button type="button" class="btn btn--accent btn--sm" id="acXls">${T("Excel: كل التقارير", "Excel: all reports")}</button>
      </div>
      <section class="of-card" id="acCard"><header class="of-card__h"><h3>${tab[1]}</h3><small class="muted">${R.sub || ""}</small></header>${R.html}</section>`;
    $$("[data-actab]", el).forEach((b) => b.addEventListener("click", () => { ac.tab = b.dataset.actab; route(); }));
    $("#acFrom").addEventListener("change", (e) => { ac.from = e.target.value || ac.from; route(); });
    $("#acTo").addEventListener("change", (e) => { ac.to = e.target.value || ac.to; route(); });
    $$("[data-quick]", el).forEach((b) => b.addEventListener("click", () => {
      const d = new Date(), y = d.getFullYear();
      ac.to = today();
      ac.from = b.dataset.quick === "m" ? today().slice(0, 8) + "01" : b.dataset.quick === "q" ? (d.setMonth(d.getMonth() - 3), d.toISOString().slice(0, 10)) : b.dataset.quick === "y" ? y + "-01-01" : "2000-01-01";
      route();
    }));
    $("#acPrint").addEventListener("click", () => printHtml(docWrap(tab[1], R.html.replace(/class="no-print[^"]*"/g, 'hidden'), R.sub || "")));
    $("#acCsv").addEventListener("click", () => downloadCsv(`${tab[0]}-${ac.from}-${ac.to}`, R.head, R.rows));
    $("#acXls").addEventListener("click", () => {
      const ctx = { all, inP, upTo };
      const sheets = AC_TABS().filter(([k]) => k !== "manual").map(([k, v]) => { const r = REPORT[k](ctx); return [v, r.head, r.rows]; });
      const bk = DB.all("bookings").map((b) => { const m = bookingMoney(b); return [b.id, b.created, b.ticketedAt, b.source, b.partnerId ? partnerName(b.partnerId) : "", b.status, b.customer.name, b.customer.phone, b.route, b.airline, b.pnr, (b.tickets || []).join(" "), b.sell, b.cost, b.sell - b.cost, m.inn, m.due]; });
      sheets.push([T("الحجوزات", "Bookings"), ["id", "created", "ticketed", "source", "agent", "status", "customer", "phone", "route", "airline", "pnr", "tickets", "sell", "cost", "profit", "paid", "due"], bk]);
      sheets.push([T("المدفوعات", "Payments"), ["date", "type", "amount", "method", "booking", "agent", "ref", "note"], DB.all("payments").map((p) => [p.date, p.dir, p.amount, p.method, p.bookingId || "", p.partnerId ? partnerName(p.partnerId) : "", p.ref, p.note])]);
      sheets.push([T("المصروفات", "Expenses"), ["date", "category", "method", "amount", "note"], DB.all("expenses").map((x) => [x.date, x.category, x.method, x.amount, x.note])]);
      downloadExcel(`GreenTravel-accounts-${ac.from}-${ac.to}`, sheets);
      log(T("صدّر الحسابات إلى Excel", "Exported accounts to Excel"), `${ac.from} → ${ac.to}`);
    });
    if (R.bind) R.bind(el);
  }
  const amt = (n) => (n ? money(n) : `<span class="muted">—</span>`);
  const REPORT = {
    income({ inP }) {
      const b = balances(inP), rev = COA().filter((a) => a[2] === "revenue" && (a[0] === "4010" || net(b[a[0]], a[0]))), exp = COA().filter((a) => a[2] === "expense" && (a[0] === "5010" || net(b[a[0]], a[0])));
      const tr = rev.reduce((s, [c]) => s + net(b[c], c), 0), cogs = net(b["5010"], "5010"), opex = exp.filter(([c]) => c !== "5010").reduce((s, [c]) => s + net(b[c], c), 0);
      const rows = [...rev.map(([c, n]) => [c, n, r2(net(b[c], c))]), ["", T("إجمالي الإيرادات", "Total revenue"), r2(tr)], ["5010", ACC()["5010"].name, r2(cogs)], ["", T("مجمل الربح", "Gross profit"), r2(tr - cogs)],
        ...exp.filter(([c]) => c !== "5010").map(([c, n]) => [c, n, r2(net(b[c], c))]), ["", T("إجمالي المصروفات التشغيلية", "Total operating expenses"), r2(opex)], ["", T("صافي الربح", "Net profit"), r2(tr - cogs - opex)]];
      return { sub: `${fmtDate(ac.from)} – ${fmtDate(ac.to)}`, head: ["account", "name", "amount"], rows,
        html: `<table class="pnl">${rev.map(([c, n]) => `<tr><td>${n}</td><td>${money(net(b[c], c))}</td></tr>`).join("")}<tr class="sub"><td>${T("إجمالي الإيرادات", "Total revenue")}</td><td>${money(tr)}</td></tr>
          <tr><td>${ACC()["5010"].name}</td><td class="neg">−${money(cogs)}</td></tr><tr class="sub"><td>${T("مجمل الربح", "Gross profit")}</td><td>${money(tr - cogs)}</td></tr>
          ${exp.filter(([c]) => c !== "5010").map(([c, n]) => `<tr><td>${n}</td><td class="neg">−${money(net(b[c], c))}</td></tr>`).join("")}<tr class="sub"><td>${T("إجمالي المصروفات التشغيلية", "Total operating expenses")}</td><td class="neg">−${money(opex)}</td></tr>
          <tr class="total ${tr - cogs - opex >= 0 ? "pos" : "neg"}"><td>${T("صافي الربح", "Net profit")}</td><td>${money(tr - cogs - opex)}</td></tr></table>` };
    },
    balance({ upTo }) {
      const b = balances(upTo), sec = (t) => COA().filter((a) => a[2] === t).map(([c, n]) => [c, n, net(b[c], c)]).filter((r) => r[2] || ["1010", "1020", "1100", "1110", "2010", "3010"].includes(r[0]));
      const profit = COA().filter((a) => a[2] === "revenue").reduce((s, [c]) => s + net(b[c], c), 0) - COA().filter((a) => a[2] === "expense").reduce((s, [c]) => s + net(b[c], c), 0);
      const A = sec("asset"), Li = sec("liability"), E = sec("equity");
      const ta = A.reduce((s, r) => s + r[2], 0), tl = Li.reduce((s, r) => s + r[2], 0), te = E.reduce((s, r) => s + r[2], 0) + profit;
      const block = (title, rows, total, extra = "") => `<tr class="sec"><td colspan="2">${title}</td></tr>${rows.map(([c, n, v]) => `<tr><td>${c} · ${n}</td><td>${money(v)}</td></tr>`).join("")}${extra}<tr class="sub"><td>${T("الإجمالي", "Total")}</td><td>${money(total)}</td></tr>`;
      const ok = Math.abs(ta - (tl + te)) < 0.5;
      return { sub: T("كما في ", "As of ") + fmtDate(ac.to), head: ["section", "account", "name", "amount"],
        rows: [...A.map((r) => ["asset", ...r]), ["asset", "", "Total assets", r2(ta)], ...Li.map((r) => ["liability", ...r]), ["liability", "", "Total liabilities", r2(tl)], ...E.map((r) => ["equity", ...r]), ["equity", "", "Profit to date", r2(profit)], ["equity", "", "Total equity", r2(te)]],
        html: `<div class="of-grid2 bs"><table class="pnl">${block(T("الأصول", "Assets"), A, ta)}</table>
          <table class="pnl">${block(T("الالتزامات", "Liabilities"), Li, tl)}${block(T("حقوق الملكية", "Equity"), E, te, `<tr><td>${T("أرباح الفترة حتى تاريخه", "Profit to date")}</td><td>${money(profit)}</td></tr>`)}<tr class="total"><td>${T("الالتزامات + حقوق الملكية", "Liabilities + equity")}</td><td>${money(tl + te)}</td></tr></table></div>
          <p class="hint ${ok ? "" : "hint--lock"}">${icon(ok ? "i-check" : "i-lock")}${ok ? T("الميزانية متوازنة: الأصول = الالتزامات + حقوق الملكية.", "The balance sheet balances: assets = liabilities + equity.") : T("الميزانية غير متوازنة، راجع القيود اليدوية.", "The balance sheet does not balance; check the manual entries.")}</p>` };
    },
    trial({ upTo }) {
      const b = balances(upTo);
      const rows = COA().map(([c, n]) => { const x = b[c] || { dr: 0, cr: 0 }, d = x.dr - x.cr; return [c, n, r2(d > 0 ? d : 0), r2(d < 0 ? -d : 0)]; }).filter((r) => r[2] || r[3]);
      const td = rows.reduce((s, r) => s + r[2], 0), tc = rows.reduce((s, r) => s + r[3], 0);
      return { sub: T("كما في ", "As of ") + fmtDate(ac.to), head: ["account", "name", "debit", "credit"], rows: [...rows, ["", "Total", r2(td), r2(tc)]],
        html: `<div class="table-wrap"><table class="of-table"><thead><tr><th>${T("الحساب", "Account")}</th><th>${T("مدين", "Debit")}</th><th>${T("دائن", "Credit")}</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${r[0]} · ${r[1]}</td><td>${amt(r[2])}</td><td>${amt(r[3])}</td></tr>`).join("") || `<tr><td colspan="3" class="muted empty">${T("لا توجد قيود بعد.", "No entries yet.")}</td></tr>`}</tbody>
          <tfoot><tr><td>${T("الإجمالي", "Total")} ${Math.abs(td - tc) < 0.5 ? "✓" : "⚠"}</td><td>${money(td)}</td><td>${money(tc)}</td></tr></tfoot></table></div>` };
    },
    journal({ inP }) {
      const rows = [];
      inP.forEach((e) => e.lines.forEach((l) => rows.push([e.date, e.ref, e.memo, l.account, (ACC()[l.account] || {}).name || "", r2(+l.debit || 0), r2(+l.credit || 0)])));
      return { sub: `${inP.length} ${T("قيد", "entries")} · ${fmtDate(ac.from)} – ${fmtDate(ac.to)}`, head: ["date", "ref", "memo", "account", "name", "debit", "credit"], rows,
        html: inP.length ? `<div class="table-wrap"><table class="of-table jr"><thead><tr><th>${T("التاريخ", "Date")}</th><th>${T("البيان", "Description")}</th><th>${T("الحساب", "Account")}</th><th>${T("مدين", "Debit")}</th><th>${T("دائن", "Credit")}</th></tr></thead>
          <tbody>${inP.slice().reverse().slice(0, 400).map((e) => e.lines.map((l, i) => `<tr class="${i ? "jr-line" : "jr-first"}"><td>${i ? "" : fmtDate(e.date)}</td><td>${i ? "" : `${esc(e.memo)}${e.ref ? ` <small class="mono muted" dir="ltr">${esc(e.ref)}</small>` : ""}`}</td><td class="${+l.credit ? "jr-cr" : ""}">${esc(accName(l.account))}${l.party ? ` <small class="muted">· ${esc(l.party)}</small>` : ""}</td><td>${amt(+l.debit)}</td><td>${amt(+l.credit)}</td></tr>`).join("")).join("")}</tbody></table></div>`
          : `<p class="muted empty">${T("لا توجد قيود في هذه الفترة.", "No entries in this period.")}</p>` };
    },
    ledger({ all }) {
      const c = ac.acct, before = all.filter((e) => e.date < ac.from), inP = all.filter((e) => e.date >= ac.from && e.date <= ac.to);
      let bal = net(balances(before)[c], c);
      const opening = bal, rows = [];
      inP.forEach((e) => e.lines.filter((l) => l.account === c).forEach((l) => { const d = +l.debit || 0, cr = +l.credit || 0; bal += debitNormal(c) ? d - cr : cr - d; rows.push([e.date, e.ref, e.memo + (l.party ? " · " + l.party : ""), r2(d), r2(cr), r2(bal)]); }));
      return { sub: accName(c), head: ["date", "ref", "memo", "debit", "credit", "balance"], rows: [["", "", "Opening balance", "", "", r2(opening)], ...rows],
        html: `<div class="of-toolbar"><select id="acAcct">${COA().map(([k, n]) => `<option value="${k}" ${k === c ? "selected" : ""}>${k} · ${n}</option>`).join("")}</select></div>
          <div class="table-wrap"><table class="of-table"><thead><tr><th>${T("التاريخ", "Date")}</th><th>${T("البيان", "Description")}</th><th>${T("مدين", "Debit")}</th><th>${T("دائن", "Credit")}</th><th>${T("الرصيد", "Balance")}</th></tr></thead>
          <tbody><tr class="sub"><td>${fmtDate(ac.from)}</td><td>${T("رصيد أول المدة", "Opening balance")}</td><td></td><td></td><td>${money(opening)}</td></tr>${rows.map((r) => `<tr><td>${fmtDate(r[0])}</td><td>${esc(r[2])}${r[1] ? ` <small class="mono muted" dir="ltr">${esc(r[1])}</small>` : ""}</td><td>${amt(r[3])}</td><td>${amt(r[4])}</td><td>${money(r[5])}</td></tr>`).join("")}</tbody>
          <tfoot><tr><td colspan="4">${T("رصيد آخر المدة", "Closing balance")}</td><td>${money(bal)}</td></tr></tfoot></table></div>`,
        bind: (el) => $("#acAcct", el).addEventListener("change", (e) => { ac.acct = e.target.value; route(); }) };
    },
    aging() {
      // First in, first out: payments settle the oldest tickets first; what's left is aged from the ticketing date
      const parties = {};
      const party = (b) => (b.partnerId ? `A:${b.partnerId}` : `C:${(b.customer.phone || b.customer.email || b.customer.name || "").replace(/\s/g, "").toLowerCase()}`);
      DB.all("bookings").filter((b) => b.status === "ticketed" && (b.ticketedAt || b.created) <= ac.to).forEach((b) => {
        const k = party(b); (parties[k] = parties[k] || { name: b.partnerId ? partnerName(b.partnerId) + " (B2B)" : b.customer.name || "—", phone: b.partnerId ? "" : b.customer.phone, ch: [], cr: 0 }).ch.push({ date: b.ticketedAt || b.created, amt: b.sell, id: b.id });
      });
      DB.all("payments").filter((p) => p.date <= ac.to && (p.dir === "in" || p.dir === "refund")).forEach((p) => {
        const b = p.bookingId && DB.get("bookings", p.bookingId), k = p.partnerId && !b ? `A:${p.partnerId}` : b ? party(b) : null;
        if (!k) return;
        (parties[k] = parties[k] || { name: p.partnerId ? partnerName(p.partnerId) + " (B2B)" : "—", phone: "", ch: [], cr: 0 }).cr += p.dir === "in" ? p.amount : -p.amount;
      });
      const rows = Object.values(parties).map((p) => {
        let credit = p.cr; const buckets = [0, 0, 0, 0];
        p.ch.sort((a, b) => a.date.localeCompare(b.date)).forEach((c) => { const use = Math.min(Math.max(credit, 0), c.amt); credit -= use; const open = c.amt - use; if (open > 0.5) { const d = daysUntil(ac.to) - daysUntil(c.date); buckets[d <= 30 ? 0 : d <= 60 ? 1 : d <= 90 ? 2 : 3] += open; } });
        const total = buckets.reduce((s, x) => s + x, 0) - Math.max(credit, 0);
        return [p.name, p.phone, ...buckets.map(r2), r2(Math.max(credit, 0)), r2(total)];
      }).filter((r) => Math.abs(r[7]) > 0.5 || r[6] > 0.5).sort((a, b) => b[7] - a[7]);
      const tot = [2, 3, 4, 5, 6, 7].map((i) => rows.reduce((s, r) => s + r[i], 0));
      return { sub: T("كما في ", "As of ") + fmtDate(ac.to), head: ["party", "phone", "0-30", "31-60", "61-90", "90+", "credit", "balance"], rows,
        html: rows.length ? `<div class="table-wrap"><table class="of-table"><thead><tr><th>${T("العميل / الوكيل", "Customer / agent")}</th><th>0–30</th><th>31–60</th><th>61–90</th><th>+90</th><th>${T("رصيد دائن", "Credit")}</th><th>${T("الرصيد", "Balance")}</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td><b>${esc(r[0])}</b>${r[1] ? `<br><small class="muted" dir="ltr">${esc(r[1])}</small>` : ""}</td><td>${amt(r[2])}</td><td>${amt(r[3])}</td><td class="${r[4] ? "neg" : ""}">${amt(r[4])}</td><td class="${r[5] ? "neg" : ""}">${amt(r[5])}</td><td>${amt(r[6])}</td><td><b>${money(r[7])}</b></td></tr>`).join("")}</tbody>
          <tfoot><tr><td>${T("الإجمالي", "Total")}</td>${tot.map((t) => `<td>${money(t)}</td>`).join("")}</tr></tfoot></table></div>` : `<p class="muted empty">${T("لا توجد ديون مستحقة.", "Nothing outstanding.")}</p>` };
    },
    payables() {
      const g = {};
      DB.all("bookings").filter((b) => b.status === "ticketed" && (b.ticketedAt || b.created) <= ac.to).forEach((b) => {
        const paid = DB.all("payments").filter((p) => p.bookingId === b.id && p.dir === "out" && p.date <= ac.to).reduce((s, p) => s + p.amount, 0), open = b.cost - paid;
        if (open <= 0.5) return;
        const k = b.airline || "—", d = daysUntil(ac.to) - daysUntil(b.ticketedAt || b.created);
        const r = (g[k] = g[k] || [k, 0, 0, 0, 0, 0]); r[d <= 30 ? 1 : d <= 60 ? 2 : d <= 90 ? 3 : 4] += open; r[5] += open;
      });
      const rows = Object.values(g).map((r) => r.map((v, i) => (i ? r2(v) : v))).sort((a, b) => b[5] - a[5]);
      return { sub: T("كما في ", "As of ") + fmtDate(ac.to), head: ["supplier", "0-30", "31-60", "61-90", "90+", "total"], rows,
        html: rows.length ? `<div class="table-wrap"><table class="of-table"><thead><tr><th>${T("المورد / شركة الطيران", "Supplier / airline")}</th><th>0–30</th><th>31–60</th><th>61–90</th><th>+90</th><th>${T("الإجمالي", "Total")}</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td><b>${esc(r[0])}</b></td><td>${amt(r[1])}</td><td>${amt(r[2])}</td><td>${amt(r[3])}</td><td>${amt(r[4])}</td><td><b>${money(r[5])}</b></td></tr>`).join("")}</tbody></table></div>` : `<p class="muted empty">${T("لا توجد مستحقات للموردين.", "Nothing owed to suppliers.")}</p>` };
    },
    manual() {
      const list = DB.all("journal");
      const opts = COA().map(([k, n]) => `<option value="${k}">${k} · ${n}</option>`).join("");
      const line = () => `<div class="je-line"><select name="acc">${opts}</select><input name="dr" type="number" min="0" step="0.01" dir="ltr" placeholder="${T("مدين", "Debit")}"><input name="cr" type="number" min="0" step="0.01" dir="ltr" placeholder="${T("دائن", "Credit")}"><button type="button" class="x-btn" data-rmline aria-label="${T("حذف", "Remove")}">×</button></div>`;
      return { head: ["date", "memo", "account", "debit", "credit"], rows: list.flatMap((j) => j.lines.map((l) => [j.date, j.memo, l.account, l.debit, l.credit])),
        html: `<p class="hint">${icon("i-list")}${T("استخدم القيود اليدوية للأرصدة الافتتاحية ورأس المال والقروض والتسويات. كل الحجوزات والمدفوعات والمصروفات تُقيَّد تلقائياً.", "Use manual entries for opening balances, capital, loans and adjustments. Bookings, payments and expenses are recorded automatically.")}</p>
          <form id="jeForm" class="dr-form" novalidate><div class="f3">${inp("date", T("التاريخ", "Date"), today(), "date")}<label class="fl fl--wide"><span>${T("البيان", "Description")}</span><input name="memo" placeholder="${T("مثال: رأس مال افتتاحي", "e.g. Opening capital")}"></label></div>
            <div id="jeLines">${line()}${line()}</div>
            <div class="je-foot"><button type="button" class="btn btn--ghost btn--sm" id="jeAdd">+ ${T("سطر", "Line")}</button><span id="jeSum" class="muted"></span><button type="submit" class="btn btn--primary btn--sm">${T("حفظ القيد", "Save entry")}</button></div></form>
          ${list.length ? `<div class="table-wrap"><table class="of-table"><thead><tr><th>${T("التاريخ", "Date")}</th><th>${T("البيان", "Description")}</th><th>${T("الحساب", "Account")}</th><th>${T("مدين", "Debit")}</th><th>${T("دائن", "Credit")}</th><th></th></tr></thead>
            <tbody>${list.map((j) => j.lines.map((l, i) => `<tr><td>${i ? "" : fmtDate(j.date)}</td><td>${i ? "" : esc(j.memo)}</td><td>${esc(accName(l.account))}</td><td>${amt(l.debit)}</td><td>${amt(l.credit)}</td><td>${i ? "" : `<button type="button" class="x-btn" data-del-je="${j.id}" aria-label="${T("حذف", "Delete")}">×</button>`}</td></tr>`).join("")).join("")}</tbody></table></div>` : ""}`,
        bind(el) {
          const f = $("#jeForm", el);
          const sum = () => { let d = 0, c = 0; $$(".je-line", f).forEach((r) => { d += +r.querySelector("[name=dr]").value || 0; c += +r.querySelector("[name=cr]").value || 0; }); $("#jeSum").innerHTML = `${T("مدين", "Debit")} ${usd.format(d)} · ${T("دائن", "Credit")} ${usd.format(c)} ${Math.abs(d - c) < 0.005 && d > 0 ? "✓" : `<b class="neg">${T("غير متوازن", "Not balanced")}</b>`}`; return [d, c]; };
          const bindLines = () => { $$("[data-rmline]", f).forEach((b) => (b.onclick = () => { if ($$(".je-line", f).length > 2) { b.parentElement.remove(); sum(); } })); $$(".je-line input", f).forEach((i) => (i.oninput = sum)); };
          $("#jeAdd").addEventListener("click", () => { $("#jeLines").insertAdjacentHTML("beforeend", line()); bindLines(); });
          bindLines(); sum();
          f.addEventListener("submit", async (e) => {
            e.preventDefault();
            const [d, c] = sum();
            if (!(d > 0) || Math.abs(d - c) > 0.005) { toast(T("القيد يجب أن يكون متوازناً (المدين = الدائن)", "The entry must balance (debits = credits)")); return; }
            const lines = $$(".je-line", f).map((r) => ({ account: r.querySelector("[name=acc]").value, debit: +r.querySelector("[name=dr]").value || 0, credit: +r.querySelector("[name=cr]").value || 0 })).filter((l) => l.debit || l.credit);
            try { await DB.insert("journal", { date: f.date.value || today(), memo: f.memo.value.trim(), lines }); } catch (er) { return errToast(er); }
            log(T("أضاف قيداً يدوياً", "Added manual entry"), f.memo.value.trim()); toast(T("تم حفظ القيد", "Entry saved")); route();
          });
          $$("[data-del-je]", el).forEach((b) => b.addEventListener("click", async () => {
            if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "?"; return; }
            try { await DB.remove("journal", b.dataset.delJe); } catch (er) { return errToast(er); } route();
          }));
        } };
    },
  };

  /* =========================================================
     Booking providers (owner): Travelport, Amadeus, Duffel... all at once
     ========================================================= */
  const PROVIDER_NAMES = { travelport: "Travelport (Universal API)", amadeus: "Amadeus", duffel: "Duffel" };
  async function viewProviders(el) {
    el.innerHTML = `<p class="muted">${T("جارٍ التحميل…", "Loading…")}</p>`;
    let list = [];
    let pay = { configured: false, secrets: [] };
    try { const r = await DB.flightsApi("providers", {}); list = r.providers || []; pay = r.payments || pay; } catch (e) { el.innerHTML = `<p class="hint hint--lock">${esc(e.message)}</p>`; return; }
    const on = list.filter((p) => p.enabled && p.configured);
    el.innerHTML = `
      <p class="hint">${icon("i-globe")}${T("يمكن ربط أكثر من شركة في الوقت نفسه. عند البحث يسأل الموقع كل المزودين المفعّلين معاً، ويدمج النتائج ويرتبها بالسعر، وإن جاءت الرحلة نفسها من مزودين يعرض الأرخص (أو صاحب الأولوية). الحجز وإنشاء رقم الحجز يتمان داخل موقعك، والإصدار من هنا.", "Several companies can be connected at once. Each search asks every enabled provider together, merges the results and sorts them by price; when the same flight comes from two providers the cheaper one (or the preferred one) is shown. Booking and the PNR happen on your website; ticketing from here.")}</p>
      <section class="of-card prov-pay"><header class="of-card__h"><h3>${T("الحجز الذاتي الكامل: الدفع أونلاين والإصدار التلقائي", "Full self-service: online payment and automatic ticketing")}</h3>${pay.configured ? `<span class="pill pill--ticketed">${T("الدفع أونلاين يعمل", "Online payment live")}</span>` : `<span class="pill pill--new">${T("بانتظار إعداد Stripe", "Waiting for Stripe setup")}</span>`}</header>
        <p class="muted">${T("العميل يبحث ويختار ويحجز ويدفع داخل موقعك، ثم تُصدر التذكرة تلقائياً عبر المزود وتصله بالبريد، دون تدخل أي موظف. إن تعذّر الإصدار التلقائي تُنشأ مهمة عاجلة للفريق.", "The customer searches, books and pays on your website; the ticket is then issued automatically with the provider and emailed, with no staff involved. If automatic ticketing fails, an urgent task is created for the team.")}</p>
        ${pay.configured ? "" : `<p class="hint hint--lock">${icon("i-lock")}<span>${T("أنشئ حساب Stripe، ثم أضف في Supabase ← Edge Functions ← Secrets:", "Create a Stripe account, then add in Supabase → Edge Functions → Secrets:")} <code dir="ltr">${(pay.secrets || []).join(", ")}</code>. ${T("وأضف في Stripe ← Webhooks عنواناً يستقبل الحدث checkout.session.completed:", "And in Stripe → Webhooks add an endpoint for checkout.session.completed:")} <code dir="ltr">https://qlhtjnhuhkaapzufxvzd.supabase.co/functions/v1/flights</code></span></p>`}</section>
      <div class="kpi-grid kpi-grid--3">${kpi(T("مزودون يعملون الآن", "Providers live now"), count(on.length), on.length ? on.map((p) => PROVIDER_NAMES[p.code] || p.code).join("، ") : T("الموقع يعرض أسعاراً تقديرية حالياً", "The website shows estimated fares for now"), on.length ? "good" : "warn", "i-globe")}</div>
      <div class="prov-grid">${list.map((p) => `<article class="of-card prov">
        <header class="of-card__h"><h3>${esc(p.name)}</h3>${p.configured ? `<span class="pill pill--ticketed">${T("البيانات مضافة", "Credentials set")}</span>` : `<span class="pill pill--new">${T("بانتظار البيانات", "Waiting for credentials")}</span>`}</header>
        <p class="muted">${esc(p.notes)}</p>
        <div class="chips">${[[p.canSearch, T("بحث وأسعار", "Search & fares")], [p.canBook, T("حجز ورقم PNR", "Booking & PNR")], [p.canTicket, T("إصدار التذاكر", "Ticketing")], [p.canCancel, T("إلغاء", "Cancel")]].map(([ok, l]) => `<span class="chip ${ok ? "" : "chip--off"}">${ok ? "✓" : "—"} ${l}</span>`).join("")}</div>
        ${p.configured ? "" : `<p class="hint hint--lock">${icon("i-lock")}<span>${T("أضف هذه الأسرار في Supabase ← Edge Functions ← Secrets:", "Add these secrets in Supabase → Edge Functions → Secrets:")} <code dir="ltr">${p.secrets.join(", ")}</code></span></p>`}
        <form class="prov-form" data-prov="${p.code}">
          <label class="perm"><input type="checkbox" name="enabled" ${p.enabled ? "checked" : ""}><span><b>${T("مفعّل في البحث", "Enabled in search")}</b><small>${p.configured ? "" : T("لن يعمل قبل إضافة البيانات", "Won't run until credentials are added")}</small></span></label>
          <label class="perm"><input type="checkbox" name="auto_ticket" ${p.autoTicket ? "checked" : ""} ${p.canTicket ? "" : "disabled"}><span><b>${T("إصدار تلقائي بعد الدفع", "Auto-issue after payment")}</b><small>${p.canTicket ? T("التذكرة تُصدر وتُرسل للعميل فور الدفع", "Ticket issued and emailed right after payment") : T("هذا المزود لا يدعم الإصدار عبر الـ API بعد", "This provider can't issue through the API yet")}</small></span></label>
          <div class="f3">${sel("mode", T("البيئة", "Environment"), { test: T("تجريبي (Test)", "Test"), live: T("فعلي (Live)", "Live") }, p.mode)}${inp("priority", T("الأولوية (1 = الأعلى)", "Priority (1 = first)"), p.priority, "number", "ltr")}${inp("markup_pct", T("هامشك على السعر %", "Your markup %"), p.markup_pct, "number", "ltr")}</div>
          <button type="submit" class="btn btn--primary btn--sm">${T("حفظ", "Save")}</button>
        </form></article>`).join("")}</div>
      <section class="of-card"><header class="of-card__h"><h3>${T("إضافة شركة أخرى", "Adding another company")}</h3></header>
        <p class="muted">${T("أي شركة أخرى (Sabre، واجهة NDC لشركة طيران، موحّد تذاكر…) تُضاف بمحوّل صغير في ملف الخادم supabase/functions/flights/providers.ts بنفس الشكل، ثم تظهر هنا تلقائياً بعد إضافة سطر لها في جدول booking_providers.", "Any other company (Sabre, an airline NDC API, a consolidator…) is added as a small adapter in supabase/functions/flights/providers.ts, then appears here after a row is added to the booking_providers table.")}</p></section>`;
    $$(".prov-form", el).forEach((f) => f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      const row = { enabled: !!f.enabled.checked, auto_ticket: !!f.auto_ticket.checked, mode: d.mode, priority: Math.max(1, +d.priority || 10), markup_pct: Math.max(0, Math.min(100, +d.markup_pct || 0)), updated_at: new Date().toISOString() };
      const { error } = await DB.client.from("booking_providers").update(row).eq("code", f.dataset.prov);
      if (error) return errToast(error);
      log(T("عدّل إعدادات مزود حجز", "Edited booking provider"), f.dataset.prov);
      toast(T("تم الحفظ", "Saved")); route();
    }));
  }

  /* =========================================================
     TMC — corporate travel management (permission "corporate")
     Companies · travelers · cost centers · travel policy · approvals ·
     company portal users · monthly invoices · reports · duty of care
     ========================================================= */
  const ROLE = () => ({ coordinator: T("منسق السفر", "Travel coordinator"), approver: T("مدير موافقات", "Approver"), traveler: T("مسافر", "Traveler") });
  const TRIP_ST = () => ({ pending: T("بانتظار الموافقة", "Awaiting approval"), approved: T("موافق عليه", "Approved"), rejected: T("مرفوض", "Rejected"), booked: T("تم الحجز", "Booked"), cancelled: T("ملغي", "Cancelled") });
  const tripPill = (s) => `<span class="pill pill--${{ pending: "new", approved: "confirmed", rejected: "cancelled", booked: "ticketed", cancelled: "cancelled" }[s] || "new"}">${TRIP_ST()[s] || s}</span>`;
  const coName = (id) => (DB.get("companies", id) || {}).name || "—";
  const tvName = (id) => { const t = DB.get("travelers", id); return t ? `${t.firstName} ${t.lastName}` : "—"; };
  const ccName = (id) => (DB.get("costCenters", id) || {}).name || "—";
  const policyOf = (cid) => DB.get("policies", cid) || null;
  const VIOL = (v) => ({ cabin: T(`الدرجة أعلى من المسموح (${CABIN()[v.allowed] || v.allowed})`, `Cabin above policy (${CABIN()[v.allowed] || v.allowed})`), fare: T(`السعر أعلى من السقف (${usd.format(v.max)})`, `Fare above cap (${usd.format(v.max)})`), advance: T(`حجز قبل أقل من ${v.days} أيام`, `Booked less than ${v.days} days ahead`) }[v.code] || v.code);
  const rank = (c) => ({ economy: 1, premium: 2, business: 3, first: 4 }[c] || 1);
  // Same rules as the server's check_policy()
  function checkPolicy(cid, { intl = true, cabin = "economy", hours = 0, fare = 0, depart = "" }) {
    const p = policyOf(cid); if (!p) return [];
    let allowed = intl ? p.cabinIntl : p.cabinDomestic;
    if (p.businessOverHours > 0 && hours >= p.businessOverHours && rank(allowed) < 3) allowed = "business";
    const v = [];
    if (rank(cabin) > rank(allowed)) v.push({ code: "cabin", allowed });
    const max = intl ? +p.maxFareIntl : +p.maxFareDomestic;
    if (fare > max) v.push({ code: "fare", max });
    if (depart && daysUntil(depart) < p.advanceDays) v.push({ code: "advance", days: p.advanceDays });
    return v;
  }
  const corpBookings = (cid) => DB.all("bookings").filter((b) => b.companyId && (!cid || b.companyId === cid));
  const invoicedIds = () => new Set(DB.all("invoices").filter((i) => i.status !== "void").flatMap((i) => (i.lines || []).map((l) => l.booking)));
  const invPaid = (inv) => DB.all("payments").filter((p) => p.invoiceId === inv.id && p.dir === "in").reduce((s, p) => s + p.amount, 0);
  const abroadNow = () => corpBookings().filter((b) => b.status === "ticketed" && b.depart && b.depart <= today() && (b.ret ? b.ret >= today() : daysUntil(b.depart) > -3));

  let corp = { sel: "", tab: "profile" };
  function viewCorporate(el) {
    if (corp.sel && DB.get("companies", corp.sel)) return companyPage(el, DB.get("companies", corp.sel));
    corp.sel = "";
    const cos = DB.all("companies"), trips = DB.all("trips");
    const unpaid = DB.all("invoices").filter((i) => i.status === "issued");
    el.innerHTML = `
      <div class="kpi-grid kpi-grid--4">
        ${kpi(T("الشركات العميلة", "Client companies"), count(cos.filter((c) => c.status === "active").length), `${DB.all("travelers").length} ${T("مسافر", "travelers")}`, "", "i-briefcase")}
        ${kpi(T("بانتظار الموافقة", "Awaiting approval"), count(trips.filter((t) => t.status === "pending").length), `${trips.filter((t) => t.status === "approved").length} ${T("موافق عليها بانتظار الحجز", "approved, to book")}`, trips.some((t) => t.status === "approved") ? "warn" : "", "i-check")}
        ${kpi(T("فواتير غير مدفوعة", "Unpaid invoices"), money(unpaid.reduce((s, i) => s + (+i.total - invPaid(i)), 0)), `${unpaid.filter((i) => i.due < today()).length} ${T("متأخرة", "overdue")}`, unpaid.some((i) => i.due < today()) ? "bad" : "", "i-card")}
        ${kpi(T("مسافرون الآن", "Traveling now"), count(abroadNow().length), T("متابعة السلامة", "Duty of care"), "", "i-globe")}
      </div>
      <div class="of-toolbar"><button type="button" class="btn btn--accent btn--sm" id="coNew">+ ${T("شركة جديدة", "New company")}</button>
        <a class="btn btn--ghost btn--sm" href="#trips">${T("طلبات السفر", "Trip requests")}</a><a class="btn btn--ghost btn--sm" href="#invoices">${T("فواتير الشركات", "Company invoices")}</a><a class="btn btn--ghost btn--sm" href="#duty">${T("أين المسافرون الآن", "Where travelers are")}</a><a class="btn btn--ghost btn--sm" href="#corpreports">${T("تقارير الشركات", "Corporate reports")}</a></div>
      <section class="of-card">${cos.length ? `<div class="table-wrap"><table class="of-table"><thead><tr><th>${T("الشركة", "Company")}</th><th>${T("المسافرون", "Travelers")}</th><th>${T("طلبات معلقة", "Pending")}</th><th>${T("حجوزات", "Bookings")}</th><th>${T("المبيعات", "Sales")}</th><th>${T("غير مدفوع", "Unpaid")}</th><th>${T("حد الائتمان", "Credit")}</th><th>${T("الحالة", "Status")}</th></tr></thead>
        <tbody>${cos.map((c) => { const bk = corpBookings(c.id).filter((b) => b.status === "ticketed"); const due = DB.all("invoices").filter((i) => i.companyId === c.id && i.status === "issued").reduce((s, i) => s + (+i.total - invPaid(i)), 0);
          return `<tr data-co="${c.id}" tabindex="0" class="row-link"><td><span class="who">${avatar({ name: c.name }, "xs")}<b>${esc(c.name)}</b></span></td><td class="num">${DB.all("travelers").filter((t) => t.companyId === c.id).length}</td><td class="num">${DB.all("trips").filter((t) => t.companyId === c.id && t.status === "pending").length}</td><td class="num">${bk.length}</td><td>${money(bk.reduce((s, b) => s + b.sell + b.serviceFee, 0))}</td><td class="${due ? "neg" : ""}">${money(due)}</td><td>${money(c.creditLimit)}</td><td><span class="pill pill--${c.status === "active" ? "ticketed" : "cancelled"}">${c.status === "active" ? T("نشطة", "Active") : T("موقوفة", "Suspended")}</span></td></tr>`; }).join("")}</tbody></table></div>`
        : `<div class="locked">${icon("i-briefcase")}<h3>${T("لا توجد شركات بعد", "No companies yet")}</h3><p class="muted">${T("أضف أول شركة عميلة، ثم موظفيها وسياسة السفر وحسابات بوابتها.", "Add your first client company, then its travelers, travel policy and portal accounts.")}</p></div>`}</section>`;
    $("#coNew").addEventListener("click", () => companyForm(null));
    $$("[data-co]", el).forEach((r) => r.addEventListener("click", () => { corp.sel = r.dataset.co; corp.tab = "profile"; route(); }));
  }

  function companyForm(c) {
    c = c || { name: "", legalName: "", taxId: "", address: "", phone: "", email: "", billingEmail: "", creditLimit: 10000, paymentTerms: 30, serviceFee: 25, status: "active", notes: "" };
    openModal(c.id ? T("بيانات الشركة", "Company details") : T("شركة جديدة", "New company"), `<form id="coForm" class="dr-form" novalidate>
      <div class="f3">${inp("name", T("اسم الشركة", "Company name"), c.name)}${inp("legal_name", T("الاسم القانوني", "Legal name"), c.legalName)}${inp("tax_id", T("الرقم الضريبي (EIN)", "Tax ID (EIN)"), c.taxId, "text", "ltr")}
        ${inp("phone", T("الهاتف", "Phone"), c.phone, "tel", "ltr")}${inp("email", T("البريد", "Email"), c.email, "email", "ltr")}${inp("billing_email", T("بريد الفواتير", "Billing email"), c.billingEmail, "email", "ltr")}
        ${inp("credit_limit", T("حد الائتمان (USD)", "Credit limit (USD)"), c.creditLimit, "number", "ltr")}${inp("payment_terms", T("مدة السداد (أيام)", "Payment terms (days)"), c.paymentTerms, "number", "ltr")}${inp("service_fee", T("رسوم الخدمة لكل تذكرة", "Service fee per ticket"), c.serviceFee, "number", "ltr")}
        ${sel("status", T("الحالة", "Status"), { active: T("نشطة", "Active"), suspended: T("موقوفة", "Suspended") }, c.status)}</div>
      ${area("address", T("العنوان", "Address"), c.address)}${area("notes", T("ملاحظات العقد", "Contract notes"), c.notes)}
      <div class="dr-actions"><button type="submit" class="btn btn--primary">${T("حفظ", "Save")}</button></div></form>`, true);
    $("#coForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      if (!d.name.trim()) return toast(T("اكتب اسم الشركة", "Enter the company name"));
      const row = { name: d.name.trim(), legal_name: d.legal_name, tax_id: d.tax_id, phone: d.phone, email: d.email, billing_email: d.billing_email, credit_limit: +d.credit_limit || 0, payment_terms: Math.max(0, +d.payment_terms || 0), service_fee: Math.max(0, +d.service_fee || 0), status: d.status, address: d.address, notes: d.notes };
      try {
        if (c.id) await DB.saveRow("companies", Object.assign({ id: c.id }, row));
        else { const n = await DB.saveRow("companies", row); await DB.upsertRow("travel_policies", { company_id: n.id }); corp.sel = n.id; corp.tab = "policy"; }
      } catch (er) { return errToast(er); }
      log(c.id ? T("عدّل بيانات شركة", "Edited company") : T("أضاف شركة عميلة", "Added client company"), row.name);
      closeModal(); toast(T("تم الحفظ", "Saved")); route();
    });
  }

  function companyPage(el, c) {
    const TABS = [["profile", T("الملف", "Profile")], ["travelers", T("المسافرون", "Travelers")], ["policy", T("سياسة السفر", "Travel policy")], ["costcenters", T("الأقسام ومراكز التكلفة", "Cost centers")],
      ["users", T("حسابات البوابة", "Portal accounts")], ["trips", T("طلبات السفر", "Trip requests")], ["bookings", T("الحجوزات", "Bookings")], ["invoices", T("الفواتير", "Invoices")]];
    el.innerHTML = `<div class="co-head"><button type="button" class="btn btn--ghost btn--sm" id="coBack">→ ${T("كل الشركات", "All companies")}</button><h2>${esc(c.name)}</h2>${c.status !== "active" ? `<span class="pill pill--cancelled">${T("موقوفة", "Suspended")}</span>` : ""}</div>
      <div class="ac-tabs">${TABS.map(([k, v]) => `<button type="button" data-cotab="${k}" class="${k === corp.tab ? "is-active" : ""}">${v}</button>`).join("")}</div>
      <div id="coBody"></div>`;
    $("#coBack").addEventListener("click", () => { corp.sel = ""; route(); });
    $$("[data-cotab]", el).forEach((b) => b.addEventListener("click", () => { corp.tab = b.dataset.cotab; route(); }));
    const body = $("#coBody");
    ({ profile: coProfile, travelers: coTravelers, policy: coPolicy, costcenters: coCostCenters, users: coUsers, trips: coTrips, bookings: coBookings, invoices: coInvoices }[corp.tab] || coProfile)(body, c);
  }
  function coProfile(el, c) {
    const bk = corpBookings(c.id).filter((b) => b.status === "ticketed");
    const due = DB.all("invoices").filter((i) => i.companyId === c.id && i.status === "issued").reduce((s, i) => s + (+i.total - invPaid(i)), 0);
    const uninv = corpBookings(c.id).filter((b) => b.status === "ticketed" && !invoicedIds().has(b.id)).reduce((s, b) => s + b.sell + b.serviceFee, 0);
    el.innerHTML = `<div class="kpi-grid kpi-grid--4">${kpi(T("مبيعات هذه السنة", "Sales this year"), money(bk.filter((b) => (b.ticketedAt || b.created).slice(0, 4) === today().slice(0, 4)).reduce((s, b) => s + b.sell + b.serviceFee, 0)), `${bk.length} ${T("تذكرة", "tickets")}`, "", "i-ticket")}
      ${kpi(T("غير مدفوع", "Unpaid"), money(due), T("فواتير صادرة", "Issued invoices"), due ? "warn" : "", "i-card")}${kpi(T("لم يُفوتر بعد", "Not invoiced yet"), money(uninv), T("تذاكر صادرة", "Ticketed"), "", "i-list")}
      ${kpi(T("الائتمان المتاح", "Credit available"), money(Math.max(0, c.creditLimit - due - uninv)), `${T("من", "of")} ${usd.format(c.creditLimit)}`, c.creditLimit - due - uninv < 0 ? "bad" : "good", "i-shield")}</div>
      <section class="of-card"><header class="of-card__h"><h3>${T("بيانات الشركة", "Company details")}</h3><button type="button" class="btn btn--ghost btn--sm" id="coEdit">${T("تعديل", "Edit")}</button></header>
        <dl class="co-dl">${[[T("الاسم القانوني", "Legal name"), c.legalName], [T("الرقم الضريبي", "Tax ID"), c.taxId], [T("الهاتف", "Phone"), c.phone], [T("البريد", "Email"), c.email], [T("بريد الفواتير", "Billing email"), c.billingEmail], [T("مدة السداد", "Payment terms"), `${c.paymentTerms} ${T("يوماً", "days")}`], [T("رسوم الخدمة", "Service fee"), usd.format(c.serviceFee) + " / " + T("تذكرة", "ticket")], [T("العنوان", "Address"), c.address], [T("ملاحظات العقد", "Contract notes"), c.notes]].map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v || "—")}</dd></div>`).join("")}</dl></section>`;
    $("#coEdit").addEventListener("click", () => companyForm(c));
  }
  function coTravelers(el, c) {
    const list = DB.all("travelers").filter((t) => t.companyId === c.id);
    const soon = (d) => d && daysUntil(d) < 180;
    el.innerHTML = `<div class="of-toolbar"><button type="button" class="btn btn--accent btn--sm" id="tvNew">+ ${T("مسافر جديد", "New traveler")}</button><button type="button" class="btn btn--ghost btn--sm" id="tvCsv">Excel / CSV</button></div>
      <section class="of-card">${list.length ? `<div class="table-wrap"><table class="of-table"><thead><tr><th>${T("الاسم", "Name")}</th><th>${T("الوظيفة", "Title")}</th><th>${T("القسم", "Cost center")}</th><th>${T("الجواز", "Passport")}</th><th>${T("التواصل", "Contact")}</th><th>${T("المدير المعتمد", "Approver")}</th><th></th></tr></thead>
        <tbody>${list.map((t) => `<tr><td><b>${esc(t.firstName)} ${esc(t.lastName)}</b>${t.vip ? ` <span class="tag tag--b2b">VIP</span>` : ""}${t.status !== "active" ? ` <span class="tag">${T("غير نشط", "Inactive")}</span>` : ""}</td><td>${esc(t.jobTitle)}</td><td>${esc(ccName(t.costCenterId))}</td>
          <td dir="ltr" class="${soon(t.passportExpiry) ? "neg" : ""}">${esc(t.passportNo || "—")}${t.passportExpiry ? ` · ${fmtDate(t.passportExpiry)}` : ""}${soon(t.passportExpiry) ? ` ⚠` : ""}</td><td dir="ltr"><small>${esc([t.email, t.phone].filter(Boolean).join(" · "))}</small></td><td>${esc(t.approverId ? tvName(t.approverId) : "—")}</td>
          <td class="row-actions"><button type="button" class="btn btn--ghost btn--sm" data-tv="${t.id}">${T("تعديل", "Edit")}</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="muted empty">${T("لا يوجد مسافرون بعد.", "No travelers yet.")}</p>`}</section>`;
    $("#tvNew").addEventListener("click", () => travelerForm(c, null));
    $$("[data-tv]", el).forEach((b) => b.addEventListener("click", () => travelerForm(c, DB.get("travelers", b.dataset.tv))));
    $("#tvCsv").addEventListener("click", () => downloadCsv(`travelers-${c.name}`, ["first", "last", "title", "cost_center", "email", "phone", "dob", "nationality", "passport", "passport_expiry", "seat", "meal", "vip"], list.map((t) => [t.firstName, t.lastName, t.jobTitle, ccName(t.costCenterId), t.email, t.phone, t.dob, t.nationality, t.passportNo, t.passportExpiry, t.seatPref, t.mealPref, t.vip ? "yes" : ""])));
  }
  function travelerForm(c, t) {
    t = t || { firstName: "", lastName: "", jobTitle: "", email: "", phone: "", dob: "", gender: "", nationality: "", passportNo: "", passportCountry: "", passportExpiry: "", seatPref: "", mealPref: "", costCenterId: "", approverId: "", vip: false, status: "active", notes: "", ff: [] };
    const ccs = Object.fromEntries([["", "—"], ...DB.all("costCenters").filter((x) => x.companyId === c.id).map((x) => [x.id, x.name])]);
    const apps = Object.fromEntries([["", "—"], ...DB.all("travelers").filter((x) => x.companyId === c.id && x.id !== t.id).map((x) => [x.id, `${x.firstName} ${x.lastName}`])]);
    openModal(t.id ? `${t.firstName} ${t.lastName}` : T("مسافر جديد", "New traveler"), `<form id="tvForm" class="dr-form" novalidate>
      <fieldset><legend>${T("البيانات (كما في الجواز)", "Details (as on passport)")}</legend><div class="f3">${inp("first_name", T("الاسم الأول", "First name"), t.firstName, "text", "ltr")}${inp("last_name", T("اسم العائلة", "Last name"), t.lastName, "text", "ltr")}${inp("job_title", T("الوظيفة", "Job title"), t.jobTitle)}
        ${inp("dob", T("تاريخ الميلاد", "Date of birth"), t.dob, "date")}${sel("gender", T("الجنس", "Gender"), { "": "—", m: T("ذكر", "Male"), f: T("أنثى", "Female") }, t.gender)}${inp("nationality", T("الجنسية", "Nationality"), t.nationality)}
        ${inp("email", T("البريد", "Email"), t.email, "email", "ltr")}${inp("phone", T("الهاتف", "Phone"), t.phone, "tel", "ltr")}${sel("status", T("الحالة", "Status"), { active: T("نشط", "Active"), inactive: T("غير نشط", "Inactive") }, t.status)}</div></fieldset>
      <fieldset><legend>${T("الجواز", "Passport")}</legend><div class="f3">${inp("passport_no", T("رقم الجواز", "Passport number"), t.passportNo, "text", "ltr")}${inp("passport_country", T("بلد الإصدار", "Issuing country"), t.passportCountry)}${inp("passport_expiry", T("تاريخ الانتهاء", "Expiry"), t.passportExpiry, "date")}</div></fieldset>
      <fieldset><legend>${T("التفضيلات والموافقة", "Preferences & approval")}</legend><div class="f3">${sel("seat_pref", T("المقعد", "Seat"), { "": "—", window: T("نافذة", "Window"), aisle: T("ممر", "Aisle") }, t.seatPref)}${sel("meal_pref", T("الوجبة", "Meal"), { "": "—", MOML: T("حلال", "Halal (MOML)"), VGML: T("نباتية", "Vegetarian"), DBML: T("سكري", "Diabetic"), CHML: T("أطفال", "Child") }, t.mealPref)}
        ${inp("ff", T("برامج الولاء (مثل RJ:12345, TK:678)", "Frequent flyer (e.g. RJ:12345, TK:678)"), (t.ff || []).map((f) => `${f.airline}:${f.number}`).join(", "), "text", "ltr")}
        ${sel("cost_center_id", T("القسم / مركز التكلفة", "Cost center"), ccs, t.costCenterId || "")}${sel("approver_id", T("المدير الذي يوافق على سفره", "Approver"), apps, t.approverId || "")}
        <label class="perm"><input type="checkbox" name="vip" ${t.vip ? "checked" : ""}><span><b>VIP</b><small>${T("عناية خاصة", "Special care")}</small></span></label></div></fieldset>
      ${area("notes", T("ملاحظات", "Notes"), t.notes)}
      <div class="dr-actions"><button type="submit" class="btn btn--primary">${T("حفظ", "Save")}</button>${t.id ? `<button type="button" class="btn btn--ghost danger" id="tvDel">${T("حذف", "Delete")}</button>` : ""}</div></form>`, true);
    const f = $("#tvForm");
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      if (!d.first_name.trim() || !d.last_name.trim()) return toast(T("الاسم الأول واسم العائلة مطلوبان", "First and last name are required"));
      const ff = d.ff.split(",").map((x) => x.trim()).filter(Boolean).map((x) => { const [a, ...n] = x.split(":"); return { airline: a.trim().toUpperCase(), number: n.join(":").trim() }; });
      const row = { company_id: c.id, first_name: d.first_name.trim(), last_name: d.last_name.trim(), job_title: d.job_title, email: d.email, phone: d.phone, dob: d.dob || null, gender: d.gender, nationality: d.nationality, passport_no: d.passport_no, passport_country: d.passport_country, passport_expiry: d.passport_expiry || null,
        seat_pref: d.seat_pref, meal_pref: d.meal_pref, ff, cost_center_id: d.cost_center_id || null, approver_id: d.approver_id || null, vip: !!f.vip.checked, status: d.status, notes: d.notes };
      try { await DB.saveRow("travelers", t.id ? Object.assign({ id: t.id }, row) : row); } catch (er) { return errToast(er); }
      closeModal(); toast(T("تم الحفظ", "Saved")); route();
    });
    if ($("#tvDel")) $("#tvDel").addEventListener("click", async (e) => { const b = e.currentTarget; if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = T("اضغط مرة أخرى للتأكيد", "Press again to confirm"); return; } try { await DB.deleteRow("travelers", t.id); } catch (er) { return errToast(er); } closeModal(); route(); });
  }
  function coPolicy(el, c) {
    const p = policyOf(c.id) || { cabinDomestic: "economy", cabinIntl: "economy", businessOverHours: 8, maxFareDomestic: 800, maxFareIntl: 2500, advanceDays: 7, requireApproval: "out_of_policy", notes: "" };
    el.innerHTML = `<section class="of-card"><header class="of-card__h"><h3>${T("سياسة السفر", "Travel policy")}</h3></header>
      <p class="hint">${icon("i-shield")}${T("تُطبَّق السياسة تلقائياً على كل طلب سفر من بوابة الشركة وعلى الحجوزات في المكتب: أي مخالفة تظهر بوضوح وتحتاج سبباً وموافقة المدير.", "The policy is applied automatically to every trip request from the company portal and to bookings in the back office: any violation is flagged and needs a reason and the manager's approval.")}</p>
      <form id="poForm" class="dr-form" novalidate><div class="f3">
        ${sel("cabin_domestic", T("الدرجة المسموحة: داخلي", "Allowed cabin: domestic"), CABIN(), p.cabinDomestic)}${sel("cabin_intl", T("الدرجة المسموحة: دولي", "Allowed cabin: international"), CABIN(), p.cabinIntl)}
        ${inp("business_over_hours", T("رجال أعمال للرحلات من (ساعات) · 0 = أبداً", "Business allowed from (hours) · 0 = never"), p.businessOverHours, "number", "ltr")}
        ${inp("max_fare_domestic", T("سقف السعر: داخلي (USD)", "Fare cap: domestic (USD)"), p.maxFareDomestic, "number", "ltr")}${inp("max_fare_intl", T("سقف السعر: دولي (USD)", "Fare cap: international (USD)"), p.maxFareIntl, "number", "ltr")}
        ${inp("advance_days", T("الحجز المسبق (أيام على الأقل)", "Book at least (days ahead)"), p.advanceDays, "number", "ltr")}
        ${sel("require_approval", T("متى تلزم موافقة المدير؟", "When is approval needed?"), { always: T("لكل رحلة", "Every trip"), out_of_policy: T("فقط عند مخالفة السياسة", "Only when out of policy"), never: T("لا تلزم", "Never") }, p.requireApproval)}</div>
        ${area("notes", T("ملاحظات السياسة (فنادق، سيارات، بدلات…)", "Policy notes (hotels, cars, per diem…)"), p.notes)}
        <div class="dr-actions"><button type="submit" class="btn btn--primary">${T("حفظ السياسة", "Save policy")}</button></div></form></section>`;
    $("#poForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      try { await DB.upsertRow("travel_policies", { company_id: c.id, cabin_domestic: d.cabin_domestic, cabin_intl: d.cabin_intl, business_over_hours: Math.max(0, +d.business_over_hours || 0), max_fare_domestic: +d.max_fare_domestic || 0, max_fare_intl: +d.max_fare_intl || 0, advance_days: Math.max(0, +d.advance_days || 0), require_approval: d.require_approval, notes: d.notes }); } catch (er) { return errToast(er); }
      log(T("عدّل سياسة سفر", "Edited travel policy"), c.name); toast(T("تم حفظ السياسة", "Policy saved")); route();
    });
  }
  function coCostCenters(el, c) {
    const list = DB.all("costCenters").filter((x) => x.companyId === c.id);
    const year = today().slice(0, 4);
    el.innerHTML = `<section class="of-card"><header class="of-card__h"><h3>${T("الأقسام ومراكز التكلفة", "Departments & cost centers")}</h3></header>
      <form id="ccForm" class="pay-form" novalidate>${inp("code", T("الرمز", "Code"), "", "text", "ltr")}${inp("name", T("الاسم", "Name"), "")}${inp("budget", T("الميزانية السنوية", "Annual budget"), "", "number", "ltr")}<button type="submit" class="btn btn--accent btn--sm">+ ${T("إضافة", "Add")}</button></form>
      ${list.length ? `<div class="table-wrap"><table class="of-table"><thead><tr><th>${T("الرمز", "Code")}</th><th>${T("القسم", "Name")}</th><th>${T("الميزانية", "Budget")}</th><th>${T("المصروف هذه السنة", "Spent this year")}</th><th>${T("المتبقي", "Left")}</th><th></th></tr></thead>
        <tbody>${list.map((x) => { const spent = corpBookings(c.id).filter((b) => b.costCenterId === x.id && b.status === "ticketed" && (b.ticketedAt || b.created).startsWith(year)).reduce((s, b) => s + b.sell + b.serviceFee, 0); const left = +x.budget - spent;
          return `<tr><td dir="ltr" class="mono">${esc(x.code)}</td><td><b>${esc(x.name)}</b></td><td>${money(x.budget)}</td><td>${money(spent)}</td><td class="${x.budget && left < 0 ? "neg" : ""}">${x.budget ? money(left) : "—"}</td><td><button type="button" class="x-btn" data-delcc="${x.id}" aria-label="${T("حذف", "Delete")}">×</button></td></tr>`; }).join("")}</tbody></table></div>` : `<p class="muted empty">${T("لا توجد أقسام بعد.", "No cost centers yet.")}</p>`}</section>`;
    $("#ccForm").addEventListener("submit", async (e) => {
      e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
      if (!d.name.trim()) return toast(T("اكتب اسم القسم", "Enter a name"));
      try { await DB.saveRow("cost_centers", { company_id: c.id, code: d.code.trim(), name: d.name.trim(), budget: +d.budget || 0 }); } catch (er) { return errToast(er); } route();
    });
    $$("[data-delcc]", el).forEach((b) => b.addEventListener("click", async () => { if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "?"; return; } try { await DB.deleteRow("cost_centers", b.dataset.delcc); } catch (er) { return errToast(er); } route(); }));
  }
  function coUsers(el, c) {
    const list = DB.all("companyUsers").filter((u) => u.companyId === c.id);
    el.innerHTML = `<p class="hint">${icon("i-users")}${T("حسابات تدخل إلى «بوابة الشركات» (corporate.html): المنسق يدير المسافرين ويطلب الرحلات ويرى الفواتير، المدير يوافق أو يرفض، والمسافر يطلب رحلاته ويرى تذاكره. كل شركة ترى بياناتها فقط.", "Accounts for the Company portal (corporate.html): the coordinator manages travelers, requests trips and sees invoices; the approver approves or rejects; the traveler requests their own trips and sees their tickets. Each company sees only its own data.")}</p>
      <div class="of-toolbar"><button type="button" class="btn btn--accent btn--sm" id="cuNew">+ ${T("حساب جديد", "New account")}</button></div>
      <section class="of-card">${list.length ? `<div class="table-wrap"><table class="of-table"><thead><tr><th>${T("الاسم", "Name")}</th><th>${T("البريد (اسم الدخول)", "Email (login)")}</th><th>${T("الدور", "Role")}</th><th>${T("ملف المسافر", "Traveler profile")}</th><th></th></tr></thead>
        <tbody>${list.map((u) => `<tr><td><b>${esc(u.name)}</b></td><td dir="ltr">${esc(u.email)}</td><td>${ROLE()[u.role]}</td><td>${esc(u.travelerId ? tvName(u.travelerId) : "—")}</td><td class="row-actions"><button type="button" class="btn btn--ghost btn--sm" data-cu="${u.id}">${T("تعديل", "Edit")}</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="muted empty">${T("لا توجد حسابات بعد.", "No accounts yet.")}</p>`}</section>`;
    $("#cuNew").addEventListener("click", () => companyUserForm(c, null));
    $$("[data-cu]", el).forEach((b) => b.addEventListener("click", () => companyUserForm(c, DB.get("companyUsers", b.dataset.cu))));
  }
  function companyUserForm(c, u) {
    u = u || { name: "", email: "", role: "coordinator", travelerId: "" };
    const tvs = Object.fromEntries([["", "—"], ...DB.all("travelers").filter((t) => t.companyId === c.id).map((t) => [t.id, `${t.firstName} ${t.lastName}`])]);
    openModal(u.id ? T("تعديل حساب البوابة", "Edit portal account") : T("حساب بوابة جديد", "New portal account"), `<form id="cuForm" class="dr-form" novalidate><div class="f3">
      ${inp("name", T("الاسم", "Name"), u.name)}${inp("email", T("البريد (اسم الدخول)", "Email (login)"), u.email, "email", "ltr")}
      <label class="fl"><span>${T("كلمة المرور", "Password")}</span><span class="pw-row"><input name="password" type="text" dir="ltr" value="${u.id ? "" : genPass()}" placeholder="${u.id ? T("اتركها فارغة للإبقاء عليها", "Leave empty to keep") : ""}" autocomplete="off"><button type="button" class="btn btn--ghost btn--sm" data-gen>${T("توليد", "Generate")}</button></span></label>
      ${sel("role", T("الدور", "Role"), ROLE(), u.role)}${sel("traveler_id", T("ملف المسافر المرتبط", "Linked traveler profile"), tvs, u.travelerId || "")}${sel("status", T("الحالة", "Status"), { active: T("نشط", "Active"), suspended: T("موقوف", "Suspended") }, "active")}</div>
      <div class="dr-actions"><button type="submit" class="btn btn--primary">${T("حفظ", "Save")}</button>${u.id ? `<button type="button" class="btn btn--ghost danger" id="cuDel">${T("حذف الحساب", "Delete account")}</button>` : ""}</div></form>`, true);
    const f = $("#cuForm");
    $("[data-gen]", f).addEventListener("click", () => (f.password.value = genPass()));
    f.addEventListener("submit", async (e) => {
      e.preventDefault(); const d = Object.fromEntries(new FormData(f));
      if ((!u.id && d.password.length < 8) || (d.password && d.password.length < 8)) return toast(T("كلمة المرور 8 أحرف على الأقل", "Password must be 8+ characters"));
      try { await DB.admin("save_company_user", { id: u.id, companyId: c.id, name: d.name, email: d.email, password: d.password || undefined, role: d.role, travelerId: d.traveler_id || null, status: d.status }); } catch (er) { return errToast(er); }
      closeModal(); toast(T("تم الحفظ. أرسل بيانات الدخول للشركة.", "Saved. Send the login details to the company.")); route();
    });
    if ($("#cuDel")) $("#cuDel").addEventListener("click", async (e) => { const b = e.currentTarget; if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = T("اضغط مرة أخرى للتأكيد", "Press again to confirm"); return; } try { await DB.admin("delete_company_user", { id: u.id }); } catch (er) { return errToast(er); } closeModal(); route(); });
  }
  function tripTable(list) {
    if (!list.length) return `<p class="muted empty">${T("لا توجد طلبات.", "No requests.")}</p>`;
    return `<div class="table-wrap"><table class="of-table"><thead><tr><th>${T("الطلب", "Request")}</th><th>${T("الشركة / المسافر", "Company / traveler")}</th><th>${T("الرحلة", "Trip")}</th><th>${T("الدرجة / السعر", "Cabin / fare")}</th><th>${T("السياسة", "Policy")}</th><th>${T("الحالة", "Status")}</th><th></th></tr></thead>
      <tbody>${list.map((r) => `<tr><td dir="ltr" class="mono">${r.id}<br><small class="muted">${fmtDate(r.createdAt)}</small></td><td><b>${esc(coName(r.companyId))}</b><br><small>${esc(tvName(r.travelerId))} · ${esc(ccName(r.costCenterId))}</small></td>
        <td dir="ltr">${esc(r.origin)} → ${esc(r.destination)}<br><small>${fmtDate(r.depart)}${r.ret ? " – " + fmtDate(r.ret) : ""}</small>${r.purpose ? `<br><small class="muted" dir="auto">${esc(r.purpose)}</small>` : ""}</td>
        <td>${CABIN()[r.cabin] || r.cabin}<br><small>${money(r.estFare)}</small></td>
        <td>${(r.violations || []).length ? (r.violations || []).map((v) => `<span class="tag tag--out">${esc(VIOL(v))}</span>`).join(" ") + (r.oopReason ? `<br><small class="muted">${T("السبب", "Reason")}: ${esc(r.oopReason)}</small>` : "") : `<span class="tag tag--in">${T("ضمن السياسة", "In policy")}</span>`}</td>
        <td>${tripPill(r.status)}${r.decisionNote ? `<br><small class="muted">${esc(r.decisionNote)}</small>` : ""}</td>
        <td class="row-actions">${r.status === "approved" ? `<button type="button" class="btn btn--accent btn--sm" data-tripbook="${r.id}">${T("احجز الآن", "Book now")}</button>` : ""}${r.bookingId ? `<button type="button" class="btn btn--ghost btn--sm" data-open="${r.bookingId}">${r.bookingId}</button>` : ""}${["pending", "approved"].includes(r.status) ? `<button type="button" class="btn btn--ghost btn--sm danger" data-tripcancel="${r.id}">${T("إلغاء", "Cancel")}</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
  }
  function bindTrips(el) {
    $$("[data-open]", el).forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); openBooking(a.dataset.open); }));
    $$("[data-tripcancel]", el).forEach((b) => b.addEventListener("click", async () => { if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = T("تأكيد؟", "Sure?"); return; } try { await DB.saveRow("trip_requests", { id: b.dataset.tripcancel, status: "cancelled" }); } catch (er) { return errToast(er); } route(); }));
    // An approved request becomes a booking linked to the company, traveler and cost center, with the company's service fee
    $$("[data-tripbook]", el).forEach((b) => b.addEventListener("click", async () => {
      const r = DB.get("trips", b.dataset.tripbook), t = DB.get("travelers", r.travelerId) || {}, c = DB.get("companies", r.companyId) || {};
      b.disabled = true;
      try {
        const nb = await DB.addBooking({ source: "office", status: "new", companyId: r.companyId, travelerId: r.travelerId || "", costCenterId: r.costCenterId || "", tripId: r.id, serviceFee: +c.serviceFee || 0,
          customer: { name: `${t.firstName || ""} ${t.lastName || ""}`.trim(), phone: t.phone || "", email: t.email || "" }, route: `${r.origin} → ${r.destination}`, cabin: r.cabin, depart: r.depart || "", ret: r.ret || "", pax: 1,
          travelers: [`${t.firstName || ""} ${t.lastName || ""}`.trim().toUpperCase()], sell: +r.estFare || 0, notes: `${T("طلب سفر", "Trip request")} ${r.id}${r.purpose ? " · " + r.purpose : ""}${t.mealPref ? " · Meal " + t.mealPref : ""}${t.seatPref ? " · Seat " + t.seatPref : ""}${(t.ff || []).length ? " · FF " + t.ff.map((f) => f.airline + f.number).join(" ") : ""}` });
        await DB.saveRow("trip_requests", { id: r.id, status: "booked", booking_id: nb.id });
        log(T("حجز طلب سفر شركة", "Booked corporate trip"), `${r.id} → ${nb.id}`);
        openBooking(nb.id);
      } catch (er) { b.disabled = false; errToast(er); }
    }));
  }
  function coTrips(el, c) { el.innerHTML = `<section class="of-card">${tripTable(DB.all("trips").filter((r) => r.companyId === c.id))}</section>`; bindTrips(el); }
  let tf2 = "open";
  function viewTrips(el) {
    const list = DB.all("trips").filter((r) => tf2 === "all" || (tf2 === "open" ? ["pending", "approved"].includes(r.status) : r.status === tf2));
    el.innerHTML = `<div class="of-toolbar"><div class="seg">${[["open", T("المفتوحة", "Open")], ["pending", T("بانتظار الموافقة", "Awaiting approval")], ["approved", T("جاهزة للحجز", "Ready to book")], ["booked", T("محجوزة", "Booked")], ["all", T("الكل", "All")]].map(([k, v]) => `<button type="button" data-tf="${k}" class="${tf2 === k ? "is-active" : ""}">${v}</button>`).join("")}</div></div>
      <p class="hint">${icon("i-check")}${T("الطلبات تصل من بوابة الشركات. الموافقة من مدير الشركة نفسها؛ بعدها اضغط «احجز الآن» لإنشاء الحجز مرتبطاً بالشركة والمسافر والقسم.", "Requests come from the company portal. Approval is given by the company's own manager; then press Book now to create the booking linked to the company, traveler and cost center.")}</p>
      <section class="of-card">${tripTable(list)}</section>`;
    $$("[data-tf]", el).forEach((b) => b.addEventListener("click", () => { tf2 = b.dataset.tf; route(); }));
    bindTrips(el);
  }
  function coBookings(el, c) {
    el.innerHTML = `<div class="of-toolbar"><button type="button" class="btn btn--accent btn--sm" id="cbNew">+ ${T("حجز للشركة", "Booking for this company")}</button></div><section class="of-card" id="cbList"></section>`;
    $("#cbList").innerHTML = bookingTable(corpBookings(c.id));
    bindRows($("#cbList"));
    $("#cbNew").addEventListener("click", () => openBooking(null, { companyId: c.id, serviceFee: c.serviceFee }));
  }
  function coInvoices(el, c) { invoicesView(el, c.id); }
  function viewInvoices(el) { invoicesView(el, ""); }
  function invoicesView(el, cid) {
    const list = DB.all("invoices").filter((i) => !cid || i.companyId === cid);
    const first = today().slice(0, 8) + "01", d0 = new Date(); d0.setDate(0);
    const prevFrom = new Date(d0.getFullYear(), d0.getMonth(), 1).toISOString().slice(0, 10), prevTo = d0.toISOString().slice(0, 10);
    const coOpts = Object.fromEntries(DB.all("companies").map((c) => [c.id, c.name]));
    el.innerHTML = `<section class="of-card"><header class="of-card__h"><h3>${T("إصدار فاتورة مجمّعة", "Issue a consolidated invoice")}</h3></header>
      <p class="muted">${T("تجمع الفاتورة كل التذاكر الصادرة للشركة في الفترة ولم تُفوتر من قبل، مع رسوم الخدمة.", "The invoice collects every ticket issued for the company in the period that hasn't been invoiced yet, plus service fees.")}</p>
      <form id="ivForm" class="pay-form" novalidate>${cid ? `<input type="hidden" name="company" value="${cid}">` : sel("company", T("الشركة", "Company"), coOpts, Object.keys(coOpts)[0])}${inp("from", T("من", "From"), prevFrom, "date")}${inp("to", T("إلى", "To"), prevTo, "date")}<button type="submit" class="btn btn--accent btn--sm">${T("إصدار الفاتورة", "Issue invoice")}</button></form>
      <small class="muted">${T("الفترة الافتراضية: الشهر الماضي. لهذا الشهر استخدم", "Default period: last month. For this month use")} ${fmtDate(first)} – ${fmtDate(today())}.</small></section>
      <section class="of-card">${list.length ? `<div class="table-wrap"><table class="of-table"><thead><tr><th>${T("الفاتورة", "Invoice")}</th><th>${T("الشركة", "Company")}</th><th>${T("الفترة", "Period")}</th><th>${T("الاستحقاق", "Due")}</th><th>${T("الإجمالي", "Total")}</th><th>${T("المدفوع", "Paid")}</th><th>${T("الحالة", "Status")}</th><th></th></tr></thead>
        <tbody>${list.map((i) => { const paid = invPaid(i), late = i.status === "issued" && i.due < today(); return `<tr><td dir="ltr" class="mono">${i.id}</td><td>${esc(coName(i.companyId))}</td><td>${fmtDate(i.periodFrom)} – ${fmtDate(i.periodTo)}</td><td class="${late ? "neg" : ""}">${fmtDate(i.due)}${late ? ` · ${T("متأخرة", "overdue")}` : ""}</td><td>${money(i.total)}</td><td>${money(paid)}</td>
          <td><span class="pill pill--${i.status === "paid" ? "ticketed" : i.status === "void" ? "cancelled" : late ? "cancelled" : "new"}">${{ issued: T("مستحقة", "Due"), paid: T("مدفوعة", "Paid"), void: T("ملغاة", "Void") }[i.status]}</span></td>
          <td class="row-actions"><button type="button" class="btn btn--ghost btn--sm" data-ivprint="${i.id}">${T("طباعة / PDF", "Print / PDF")}</button><button type="button" class="btn btn--ghost btn--sm" data-ivxls="${i.id}">Excel</button>${i.status === "issued" ? `<button type="button" class="btn btn--accent btn--sm" data-ivpay="${i.id}">${T("تسجيل دفعة", "Record payment")}</button><button type="button" class="btn btn--ghost btn--sm danger" data-ivvoid="${i.id}">${T("إلغاء", "Void")}</button>` : ""}</td></tr>`; }).join("")}</tbody></table></div>` : `<p class="muted empty">${T("لا توجد فواتير بعد.", "No invoices yet.")}</p>`}</section>`;
    $("#ivForm").addEventListener("submit", async (e) => {
      e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
      try { const id = await DB.rpc("generate_company_invoice", { p_company: d.company, p_from: d.from, p_to: d.to }); await DB.reload(); toast(T("صدرت الفاتورة ", "Invoice issued ") + id); route(); }
      catch (er) { toast(/No uninvoiced/.test(er.message) ? T("لا توجد تذاكر غير مفوترة في هذه الفترة.", "No uninvoiced tickets in this period.") : er.message); }
    });
    $$("[data-ivprint]", el).forEach((b) => b.addEventListener("click", () => printHtml(invoiceHtml(DB.get("invoices", b.dataset.ivprint)))));
    $$("[data-ivxls]", el).forEach((b) => b.addEventListener("click", () => { const i = DB.get("invoices", b.dataset.ivxls); downloadExcel(i.id, [[i.id, ["date", "booking", "traveler", "route", "airline", "pnr", "tickets", "cost_center", "fare", "service_fee", "total"], (i.lines || []).map((l) => [l.date, l.booking, l.traveler, l.route, l.airline, l.pnr, l.tickets, l.costCenter, +l.fare, +l.fee, +l.fare + +l.fee])]]); }));
    $$("[data-ivpay]", el).forEach((b) => b.addEventListener("click", () => { const i = DB.get("invoices", b.dataset.ivpay);
      openModal(T("دفعة على الفاتورة", "Invoice payment") + " " + i.id, `<form id="ipForm" class="dr-form" novalidate><div class="f3">${inp("amount", T("المبلغ", "Amount"), Math.max(0, +i.total - invPaid(i)), "number", "ltr")}${sel("method", T("الطريقة", "Method"), METHOD(), "bank")}${inp("date", T("التاريخ", "Date"), today(), "date")}${inp("ref", T("مرجع", "Reference"), "", "text", "ltr")}</div><div class="dr-actions"><button type="submit" class="btn btn--primary">${T("تسجيل", "Record")}</button></div></form>`);
      $("#ipForm").addEventListener("submit", async (e) => {
        e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); const amount = +d.amount;
        if (!(amount > 0)) return toast(T("أدخل مبلغاً صحيحاً", "Enter a valid amount"));
        try {
          await DB.insert("payments", { date: d.date || today(), dir: "in", amount, method: d.method, companyId: i.companyId, invoiceId: i.id, ref: d.ref, note: T("دفعة فاتورة", "Invoice payment") + " " + i.id });
          if (invPaid(i) + 0.5 >= +i.total) await DB.saveRow("company_invoices", { id: i.id, status: "paid" });
        } catch (er) { return errToast(er); }
        closeModal(); toast(T("تم تسجيل الدفعة", "Payment recorded")); route();
      }); }));
    $$("[data-ivvoid]", el).forEach((b) => b.addEventListener("click", async () => { if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = T("تأكيد؟", "Sure?"); return; } try { await DB.saveRow("company_invoices", { id: b.dataset.ivvoid, status: "void" }); } catch (er) { return errToast(er); } route(); }));
  }
  function invoiceHtml(i) {
    const c = DB.get("companies", i.companyId) || {};
    return `<div class="statement invoice"><header class="st-head"><img src="assets/img/logo.png" alt="" width="52" height="52"><div><b>Green Travel · جرين ترافيل</b><small>World Services dba Green Travel · info@greentravel.us</small><small dir="ltr">${COMPANY_PHONES.join(" · ")}</small></div>
        <div class="st-meta"><b>${T("فاتورة مجمّعة", "Consolidated invoice")}</b><span dir="ltr">${esc(i.id)}</span><span>${fmtDate(i.issued)}</span></div></header>
      <div class="inv-parties"><div><small>${T("إلى", "Bill to")}</small><b>${esc(c.legalName || c.name || "")}</b><small>${esc(c.address || "")}${c.taxId ? ` · EIN ${esc(c.taxId)}` : ""}</small></div><div><small>${T("الفترة · الاستحقاق", "Period · due")}</small><b>${fmtDate(i.periodFrom)} – ${fmtDate(i.periodTo)}</b><small>${T("تستحق في", "Due")} ${fmtDate(i.due)}</small></div></div>
      <table class="of-table"><thead><tr><th>${T("التاريخ", "Date")}</th><th>${T("المسافر", "Traveler")}</th><th>${T("الرحلة", "Trip")}</th><th>PNR / ${T("التذكرة", "Ticket")}</th><th>${T("القسم", "Cost center")}</th><th>${T("السعر", "Fare")}</th><th>${T("رسوم", "Fee")}</th></tr></thead>
        <tbody>${(i.lines || []).map((l) => `<tr><td>${fmtDate(l.date)}</td><td>${esc(l.traveler)}</td><td dir="ltr">${esc(l.route)}<br><small>${esc(l.airline)}</small></td><td dir="ltr" class="mono">${esc(l.pnr)}<br><small>${esc(l.tickets)}</small></td><td>${esc(l.costCenter)}</td><td>${money(l.fare)}</td><td>${money(l.fee)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td colspan="5">${T("أسعار التذاكر", "Fares")}</td><td colspan="2">${money(i.subtotal)}</td></tr><tr><td colspan="5">${T("رسوم الخدمة", "Service fees")}</td><td colspan="2">${money(i.fees)}</td></tr><tr><td colspan="5"><b>${T("الإجمالي المستحق", "Total due")}</b></td><td colspan="2"><b>${money(i.total)}</b></td></tr></tfoot></table>
      <p class="muted">${T("طرق الدفع: تحويل بنكي، Zelle، شيك باسم World Services dba Green Travel. شكراً لثقتكم.", "Payment: bank transfer, Zelle or check to World Services dba Green Travel. Thank you for your business.")}</p></div>`;
  }

  /* ---------- Duty of care: where are the travelers right now ---------- */
  let APT = null;
  async function airports() { if (APT) return APT; const rows = await (await fetch("assets/data/airports.json")).json(); APT = Object.fromEntries(rows.map((r) => [r[0], { lat: r[4], lon: r[5], city: r[2] }])); return APT; }
  async function viewDuty(el) {
    el.innerHTML = `<p class="muted">${T("جارٍ التحميل…", "Loading…")}</p>`;
    let A = {};
    try { A = await airports(); } catch (e) {}
    const where = (b) => { const segs = segmentsOf(b); const now = today(); const past = segs.filter((s) => s.date && s.date <= now); const s = past[past.length - 1] || segs[0] || {}; return s.to || ""; };
    const now = abroadNow().map((b) => ({ b, at: where(b) }));
    const soon = corpBookings().filter((b) => b.status === "ticketed" && b.depart && daysUntil(b.depart) > 0 && daysUntil(b.depart) <= 7);
    const W = 1000, H = 500, px = (lon) => ((lon + 180) / 360) * W, py = (lat) => ((90 - lat) / 180) * H;
    const dots = now.map(({ b, at }) => A[at] ? `<g><circle cx="${px(A[at].lon)}" cy="${py(A[at].lat)}" r="9" class="dot-now"><title>${esc(tvName(b.travelerId) || b.customer.name)} · ${at}</title></circle><text x="${px(A[at].lon) + 12}" y="${py(A[at].lat) + 4}" class="dot-l">${esc(at)}</text></g>` : "").join("");
    const grid = [...Array(7)].map((_, i) => `<line x1="0" x2="${W}" y1="${(H / 6) * i}" y2="${(H / 6) * i}" class="grid"/>`).join("") + [...Array(13)].map((_, i) => `<line y1="0" y2="${H}" x1="${(W / 12) * i}" x2="${(W / 12) * i}" class="grid"/>`).join("");
    const bases = Object.keys(A).length ? ["ORD", "JFK", "LAX", "LHR", "DXB", "AMM", "CAI", "BEY", "IST", "DOH", "JED", "BGW", "CDG", "SIN", "GRU", "JNB", "SYD", "DEL", "NRT"].filter((k) => A[k]).map((k) => `<circle cx="${px(A[k].lon)}" cy="${py(A[k].lat)}" r="2.5" class="dot-base"/>`).join("") : "";
    const row = (b, at) => `<tr><td><b>${esc(tvName(b.travelerId) || b.customer.name)}</b><br><small>${esc(coName(b.companyId))}</small></td><td dir="ltr"><b>${esc(at || "—")}</b> ${A[at] ? `<small>${esc(A[at].city)}</small>` : ""}</td><td dir="ltr">${esc(b.route)}<br><small>${esc(b.airline)} · ${esc(b.pnr)}</small></td><td>${fmtDate(b.depart)}${b.ret ? " – " + fmtDate(b.ret) : ""}</td><td dir="ltr"><small>${esc((DB.get("travelers", b.travelerId) || {}).phone || b.customer.phone || "")}</small></td><td><button type="button" class="btn btn--ghost btn--sm" data-open="${b.id}">${b.id}</button></td></tr>`;
    el.innerHTML = `<div class="kpi-grid kpi-grid--3">${kpi(T("مسافرون الآن", "Traveling now"), count(now.length), T("بين الذهاب والعودة", "Between departure and return"), "", "i-globe")}${kpi(T("يسافرون خلال 7 أيام", "Departing within 7 days"), count(soon.length), "", "", "i-calendar")}${kpi(T("في دول مختلفة", "In different places"), count(new Set(now.map((x) => x.at)).size), "", "", "i-pin")}</div>
      <section class="of-card"><header class="of-card__h"><h3>${T("خريطة المسافرين الآن", "Travelers right now")}</h3><button type="button" class="btn btn--ghost btn--sm" id="dcCsv">Excel / CSV</button></header>
        <div class="duty-map" dir="ltr"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${T("خريطة أماكن المسافرين", "Map of traveler locations")}">${grid}${bases}${dots}</svg></div>
        ${now.length ? `<div class="table-wrap"><table class="of-table"><thead><tr><th>${T("المسافر", "Traveler")}</th><th>${T("المكان الآن", "Now in")}</th><th>${T("الرحلة", "Trip")}</th><th>${T("التواريخ", "Dates")}</th><th>${T("الهاتف", "Phone")}</th><th></th></tr></thead><tbody>${now.map(({ b, at }) => row(b, at)).join("")}</tbody></table></div>` : `<p class="muted empty">${T("لا يوجد مسافرون من الشركات حالياً.", "No corporate travelers away right now.")}</p>`}</section>
      ${soon.length ? `<section class="of-card"><header class="of-card__h"><h3>${T("يسافرون خلال 7 أيام", "Departing within 7 days")}</h3></header><div class="table-wrap"><table class="of-table"><tbody>${soon.map((b) => row(b, b.route.split("→")[1] ? b.route.split("→")[1].trim() : "")).join("")}</tbody></table></div></section>` : ""}`;
    $$("[data-open]", el).forEach((a) => a.addEventListener("click", () => openBooking(a.dataset.open)));
    $("#dcCsv").addEventListener("click", () => downloadCsv(`duty-of-care-${today()}`, ["traveler", "company", "now_in", "route", "airline", "pnr", "depart", "return", "phone"], now.map(({ b, at }) => [tvName(b.travelerId) || b.customer.name, coName(b.companyId), at, b.route, b.airline, b.pnr, b.depart, b.ret, (DB.get("travelers", b.travelerId) || {}).phone || b.customer.phone])));
  }

  /* ---------- Corporate reports ---------- */
  let cr = { from: today().slice(0, 4) + "-01-01", to: today(), co: "" };
  function viewCorpReports(el) {
    const bk = corpBookings(cr.co).filter((b) => b.status === "ticketed" && (b.ticketedAt || b.created) >= cr.from && (b.ticketedAt || b.created) <= cr.to);
    const trips = DB.all("trips").filter((r) => (!cr.co || r.companyId === cr.co) && r.createdAt.slice(0, 10) >= cr.from && r.createdAt.slice(0, 10) <= cr.to && r.status !== "cancelled");
    const inPol = trips.filter((r) => !(r.violations || []).length);
    const savings = inPol.reduce((s, r) => { const p = policyOf(r.companyId); return s + (p ? Math.max(0, (r.international ? +p.maxFareIntl : +p.maxFareDomestic) - +r.estFare) : 0); }, 0);
    const unused = corpBookings(cr.co).filter((b) => b.status === "cancelled" && (b.tickets || []).length);
    const spend = bk.reduce((s, b) => s + b.sell + b.serviceFee, 0);
    const group = (key) => { const g = {}; bk.forEach((b) => { const k = key(b) || "—"; g[k] = g[k] || [0, 0]; g[k][0]++; g[k][1] += b.sell + b.serviceFee; }); return Object.entries(g).sort((a, b) => b[1][1] - a[1][1]); };
    const block = (title, rows) => `<section class="of-card"><header class="of-card__h"><h3>${title}</h3></header>${rows.length ? `<table class="of-table"><thead><tr><th></th><th>${T("تذاكر", "Tickets")}</th><th>${T("الإنفاق", "Spend")}</th><th>%</th></tr></thead><tbody>${rows.map(([k, [n, v]]) => `<tr><td>${esc(k)}</td><td class="num">${n}</td><td>${money(v)}</td><td class="num">${spend ? Math.round((v / spend) * 100) : 0}%</td></tr>`).join("")}</tbody></table>` : `<p class="muted empty">${T("لا توجد بيانات.", "No data.")}</p>`}</section>`;
    const sets = [[T("حسب الشركة", "By company"), group((b) => coName(b.companyId))], [T("حسب القسم", "By cost center"), group((b) => `${coName(b.companyId)} · ${ccName(b.costCenterId)}`)], [T("حسب المسافر", "By traveler"), group((b) => tvName(b.travelerId) || b.customer.name)], [T("حسب شركة الطيران", "By airline"), group((b) => b.airline)], [T("حسب الوجهة", "By route"), group((b) => b.route)]];
    el.innerHTML = `<div class="of-toolbar ac-bar">${sel("co", T("الشركة", "Company"), Object.fromEntries([["", T("كل الشركات", "All companies")], ...DB.all("companies").map((c) => [c.id, c.name])]), cr.co).replace('class="fl"', 'class="fl fl--inline"')}
        <label class="ac-date"><span>${T("من", "From")}</span><input type="date" id="crFrom" value="${cr.from}"></label><label class="ac-date"><span>${T("إلى", "To")}</span><input type="date" id="crTo" value="${cr.to}"></label><span class="spacer"></span>
        <button type="button" class="btn btn--ghost btn--sm" id="crPrint">${T("طباعة / PDF", "Print / PDF")}</button><button type="button" class="btn btn--accent btn--sm" id="crXls">Excel</button></div>
      <div class="kpi-grid kpi-grid--4">${kpi(T("إجمالي الإنفاق", "Total spend"), money(spend), `${bk.length} ${T("تذكرة", "tickets")} · ${T("متوسط", "avg")} ${usd.format(bk.length ? spend / bk.length : 0)}`, "", "i-card")}
        ${kpi(T("الالتزام بالسياسة", "Policy compliance"), `<span class="num">${trips.length ? Math.round((inPol.length / trips.length) * 100) : 100}%</span>`, `${trips.length - inPol.length} ${T("طلبات خارج السياسة", "out of policy")}`, trips.length && inPol.length / trips.length < 0.8 ? "warn" : "good", "i-shield")}
        ${kpi(T("التوفير مقابل سقف السياسة", "Savings vs policy cap"), money(savings), T("في الطلبات الملتزمة", "On in-policy requests"), "good", "i-tag")}
        ${kpi(T("تذاكر غير مستخدمة", "Unused tickets"), count(unused.length), money(unused.reduce((s, b) => s + b.sell, 0)) + " " + T("قيمة قابلة للاستخدام", "reusable value"), unused.length ? "warn" : "", "i-ticket")}</div>
      <div id="crBody"><div class="of-grid2">${block(sets[0][0], sets[0][1])}${block(sets[1][0], sets[1][1])}</div><div class="of-grid2">${block(sets[2][0], sets[2][1])}${block(sets[3][0], sets[3][1])}</div>
      ${unused.length ? `<section class="of-card"><header class="of-card__h"><h3>${T("تذاكر غير مستخدمة (رصيد لدى شركات الطيران)", "Unused tickets (credit with airlines)")}</h3></header><table class="of-table"><thead><tr><th>${T("المسافر", "Traveler")}</th><th>${T("الشركة", "Company")}</th><th>${T("التذكرة", "Ticket")}</th><th>${T("الطيران", "Airline")}</th><th>${T("القيمة", "Value")}</th></tr></thead><tbody>${unused.map((b) => `<tr><td>${esc(tvName(b.travelerId) || b.customer.name)}</td><td>${esc(coName(b.companyId))}</td><td dir="ltr" class="mono">${esc(b.tickets.join(", "))}</td><td>${esc(b.airline)}</td><td>${money(b.sell)}</td></tr>`).join("")}</tbody></table></section>` : ""}</div>`;
    $("[name=co]", el).addEventListener("change", (e) => { cr.co = e.target.value; route(); });
    $("#crFrom").addEventListener("change", (e) => { cr.from = e.target.value || cr.from; route(); });
    $("#crTo").addEventListener("change", (e) => { cr.to = e.target.value || cr.to; route(); });
    $("#crPrint").addEventListener("click", () => printHtml(docWrap(T("تقرير سفر الشركات", "Corporate travel report"), $("#crBody").innerHTML, `${cr.co ? coName(cr.co) + " · " : ""}${fmtDate(cr.from)} – ${fmtDate(cr.to)}`)));
    $("#crXls").addEventListener("click", () => downloadExcel(`corporate-report-${cr.from}-${cr.to}`, [
      ...sets.map(([t, rows]) => [t, ["name", "tickets", "spend"], rows.map(([k, [n, v]]) => [k, n, Math.round(v)])]),
      [T("التذاكر", "Tickets"), ["date", "booking", "company", "traveler", "cost_center", "route", "airline", "pnr", "fare", "fee"], bk.map((b) => [b.ticketedAt || b.created, b.id, coName(b.companyId), tvName(b.travelerId), ccName(b.costCenterId), b.route, b.airline, b.pnr, b.sell, b.serviceFee])],
      [T("طلبات السفر", "Trip requests"), ["id", "company", "traveler", "route", "depart", "cabin", "fare", "in_policy", "reason", "status"], trips.map((r) => [r.id, coName(r.companyId), tvName(r.travelerId), `${r.origin}-${r.destination}`, r.depart, r.cabin, +r.estFare, (r.violations || []).length ? "no" : "yes", r.oopReason, r.status])],
    ]));
  }

  /* ---------- Generic modal ---------- */
  function openModal(title, html, wide) {
    $("#ofModalTitle").textContent = title;
    $("#ofModalBody").innerHTML = html;
    $("#ofModal .modal__dialog").classList.toggle("modal__dialog--wide", !!wide);
    $("#ofModal").hidden = false;
    setTimeout(() => { const f = $("#ofModalBody input:not([type=hidden]), #ofModalBody select, #ofModalBody button"); f && f.focus(); }, 30);
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
    let knownIds = null;
    const notifyNew = () => {
      if (!me) { knownIds = null; return; }
      const list = visibleBookings();
      if (knownIds) list.filter((b) => !knownIds.has(b.id)).forEach((b) => {
        const msg = `${T("حجز جديد", "New booking")} ${b.id} · ${b.route} · ${SOURCE()[b.source] || ""}${b.customer.name ? " · " + b.customer.name : ""}`;
        toast(msg);
        try { if ("Notification" in window && Notification.permission === "granted") new Notification("Green Travel", { body: msg, icon: "assets/img/logo.png" }); } catch (e) {}
      });
      knownIds = new Set(list.map((b) => b.id));
    };
    document.addEventListener("click", () => { try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch (e) {} }, { once: true });
    DB.onChange(() => { notifyNew(); if (!me || !$("#drawer").hidden || !$("#ofModal").hidden) return; refreshMe(); if (me) route(); else showApp(); });
    document.body.classList.add("is-loading");
    DB.ready.then(async () => {
      document.body.classList.remove("is-loading");
      showApp();
      notifyNew(); // remember what exists now, so only bookings arriving later are announced
      if (!me) { try { if (!(await DB.hasOwner())) showSetup(); } catch (e) {} }
    });
  });
})();
