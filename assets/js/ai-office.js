/* =========================================================
   Green Travel — AI office (ai-office.html)
   ---------------------------------------------------------
   The owner gives a request to the general manager (or straight to one
   department). The work runs on the server (Supabase function "ai-office");
   this page drives it: it asks the server to continue each job until it is
   done, runs the departments' assignments when the manager delegates, and
   shows the progress, reports, documents and the actions that wait for
   the owner's approval.
   ========================================================= */
(() => {
  const DB = window.GTDB;
  const sb = DB.client;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Arabic / English: T() and I18N come from i18n.js (English by default, Arabic when chosen)
  const T = window.T || ((ar) => ar);
  const EN = !!(window.I18N && window.I18N.en);
  const LOC = EN ? "en-US" : "ar-EG";
  const fmt = (iso) => { if (!iso) return ""; const d = new Date(iso); return d.toLocaleString(LOC, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };
  const time = (iso) => (iso ? new Date(iso).toLocaleTimeString(LOC, { hour: "2-digit", minute: "2-digit" }) : "");
  const toast = (msg) => { const t = $("#toast"); t.textContent = msg; t.classList.add("is-visible"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("is-visible"), 3500); };

  const COLORS = { gm: "#0f4227", secretary: "#b5487a", accountant: "#2459c7", legal: "#6b4bc4", operations: "#d97a00", customer_service: "#0e8f8f", marketing: "#d4463c", hr: "#5a7a1f", auditor: "#7a3e1d", innovation: "#b8860b" };
  const STATUS = { queued: T("في الانتظار", "Queued"), running: T("يعمل الآن", "Working"), waiting: T("بانتظار الأقسام", "Waiting on departments"), done: T("منجز", "Done"), failed: T("تعذّر", "Failed"), cancelled: T("أُلغي", "Cancelled") };
  const KIND = { letter: T("خطاب", "Letter"), contract: T("عقد", "Contract"), report: T("تقرير", "Report"), memo: T("مذكرة", "Memo"), email: T("بريد", "Email"), policy: T("سياسة", "Policy"), offer: T("عرض", "Offer"), invoice: T("فاتورة", "Invoice"), minutes: T("محضر", "Minutes"), other: T("مستند", "Document") };
  const ACT = { send_email: T("إرسال بريد", "Send email"), record_expense: T("تسجيل مصروف", "Record expense"), journal_entry: T("قيد يومية", "Journal entry"), update_booking: T("تعديل حجز", "Change booking"), update_instructions: T("تحسين طريقة العمل", "Improve own instructions") };
  // Default names and titles shown in English (names the owner changed stay as they are)
  const NAME_EN = { "خالد": "Khalid", "سارة": "Sara", "عمر": "Omar", "ليلى": "Layla", "يوسف": "Youssef", "نور": "Noor", "ريم": "Reem", "فهد": "Fahd", "منصور": "Mansour", "سامي": "Sami" };
  const TITLE_EN = { "المدير العام": "General Manager", "السكرتارية والاستقبال": "Secretary & Front Office", "المحاسب": "Accountant", "الشؤون القانونية": "Legal Affairs", "العمليات والحجوزات": "Operations & Reservations", "خدمة العملاء": "Customer Service", "المبيعات والتسويق": "Sales & Marketing", "الموارد البشرية": "Human Resources", "المدقق الداخلي": "Internal Auditor", "مدير التطوير والابتكار": "Development & Innovation Manager" };
  const nm = (x) => (EN && NAME_EN[x]) || x;
  const ttl = (x) => (EN && TITLE_EN[x]) || x;
  // Progress steps come from the server in Arabic: translate the known ones
  const STEP_EN = [
    ["استلم الطلب من", "Request received from"], ["استلم الطلب", "Request received"], ["أنهى العمل وسلّم التقرير", "Finished and delivered the report"], ["انقطع الرد لطوله", "The reply was cut off (too long)"],
    ["وصلت تقارير الأقسام، يتابع المدير العمل", "Department reports arrived; the manager continues"], ["بدأ تلقائياً حسب الجدول", "Started automatically by the schedule"], ["بدأ يدوياً من الجدول", "Started manually from the schedule"],
    ["بدأ تلقائياً من المراقبة الدائمة", "Started automatically by 24/7 monitoring"], ["بدأ من فكرة اعتمدها المالك", "Started from an idea the owner approved"], ["تعليمات إضافية:", "Follow-up instructions:"], ["توقف: تجاوز الحد الأقصى للخطوات", "Stopped: too many steps"],
    ["اعتذر الموظف عن تنفيذ هذا الطلب", "The employee declined this request"], ["أسند إلى", "Assigned to"], ["اطّلع على الوضع العام للشركة", "Reviewed the company overview"], ["بحث في الحجوزات", "Searched bookings"], ["فتح ملف حجز", "Opened a booking"],
    ["راجع قائمة العملاء", "Reviewed the customer list"], ["راجع قائمة الموظفين", "Reviewed the staff list"], ["راجع المهام", "Reviewed tasks"], ["حفظ ملاحظة في الذاكرة", "Saved a note to memory"], ["راجع ذاكرة المكتب", "Checked the office memory"],
    ["أنشأ مهمة للفريق", "Created a task for the team"], ["حفظ مستنداً", "Saved a document"], ["جهّز بريداً (بانتظار موافقتك)", "Prepared an email (waiting for your approval)"], ["أعدّ تقريراً مالياً", "Prepared a financial report"],
    ["راجع الذمم والمستحقات", "Reviewed receivables"], ["راجع المدفوعات", "Reviewed payments"], ["راجع المصروفات", "Reviewed expenses"], ["سجّل مصروفاً (بانتظار موافقتك)", "Recorded an expense (waiting for your approval)"],
    ["جهّز قيد يومية (بانتظار موافقتك)", "Prepared a journal entry (waiting for your approval)"], ["فحص الامتثال", "Compliance check"], ["راجع الشركات العميلة", "Reviewed corporate clients"], ["راجع الرحلات القادمة", "Reviewed upcoming departures"],
    ["جهّز تعديل حجز (بانتظار موافقتك)", "Prepared a booking change (waiting for your approval)"], ["حلّل المبيعات", "Analysed sales"], ["راجع عبء العمل", "Reviewed workload"], ["دقّق في عمل الفريق", "Audited the team's work"],
    ["اقترح فكرة (بانتظار قرارك)", "Proposed an idea (waiting for your decision)"], ["راجع الأفكار", "Reviewed ideas"], ["اقترح تحسين طريقة عمله (بانتظار موافقتك)", "Proposed improving its own instructions (waiting for your approval)"],
  ];
  const stepText = (t) => { if (!EN) return t; for (const [a, b] of STEP_EN) if (t.startsWith(a)) return b + t.slice(a.length); return t; };
  const IDEAS = [
    ["gm", T("أعطني تقريراً شاملاً عن وضع الشركة هذا الشهر: المبيعات والأرباح والمستحقات والحجوزات التي تحتاج متابعة، مع توصياتك.", "Give me a full report on the company this month: sales, profit, receivables and bookings that need follow-up, with your recommendations.")],
    ["operations", T("راجع الحجوزات الجديدة والرحلات القادمة خلال 7 أيام، ووزّع ما لم يُسند على الموظفين، وأنشئ مهام المتابعة.", "Review new bookings and departures in the next 7 days, assign the unassigned ones to staff, and create follow-up tasks.")],
    ["accountant", T("جهّز قائمة المستحقات غير المحصّلة من العملاء والوكلاء والشركات، وصِغ رسالة تذكير مهذبة لكل جهة.", "List the money not yet collected from customers, agents and companies, and write a polite reminder for each.")],
    ["legal", T("اكتب عقد وكالة B2B بين جرين ترافيل ووكيل سفر فرعي: العمولة، حد الائتمان، السداد، الإلغاء، والمسؤوليات.", "Write a B2B agency agreement between Green Travel and a sub-agent: commission, credit limit, payment, cancellation and responsibilities.")],
    ["marketing", T("جهّز حملة تسويقية لعروض العمرة القادمة: 5 منشورات للسوشيال ميديا ونص رسالة لعملائنا السابقين.", "Prepare a campaign for the coming Umrah offers: 5 social media posts and a message to our past customers.")],
    ["hr", T("اكتب وصفاً وظيفياً وإعلان توظيف لموظف حجوزات طيران يتحدث العربية والإنجليزية في شيكاغو.", "Write a job description and job ad for an Arabic- and English-speaking flight reservations agent in Chicago.")],
    ["secretary", T("اكتب خطاباً رسمياً لشركة طيران نطلب فيه اتفاقية أسعار خاصة للمجموعات، وأنشئ مهمة متابعة بعد أسبوع.", "Write a formal letter to an airline asking for a special group fare agreement, and create a follow-up task in a week.")],
    ["customer_service", T("اكتب ردوداً جاهزة لأكثر 8 أسئلة يطرحها العملاء (الأمتعة، الإلغاء، تغيير الموعد، التأشيرة…).", "Write ready replies to the 8 questions customers ask most (baggage, cancellation, date changes, visas…).")],
    ["auditor", T("دقّق في عمل الفريق خلال آخر 7 أيام: الحجوزات والتذاكر والمدفوعات والمهام، وأعطني تقييماً لكل موظف.", "Audit the team's work over the last 7 days: bookings, tickets, payments and tasks, and give me a rating for each staff member.")],
    ["innovation", T("ادرس أرقام الشركة واقترح أفضل 5 أفكار لمضاعفة المبيعات هذا العام، لكل فكرة تجربة صغيرة وطريقة قياس.", "Study the company's numbers and propose the 5 best ideas to double sales this year, each with a small test and a way to measure it.")],
  ];

  const SOURCE = { staff: T("طلب موظف", "Staff request"), schedule: T("مجدول", "Scheduled"), watch: T("تلقائي 24/7", "Automatic 24/7") };
  const state = { staff: [], jobs: [], actions: [], docs: [], memory: [], schedules: [], settings: null, people: [], ideas: [], goals: [], progress: [], cfg: null, view: "office", filter: "all", panel: null };
  const driving = new Set();
  const staffBy = (code) => { const s = state.staff.find((x) => x.code === code); return s ? { ...s, name: nm(s.name), title: ttl(s.title) } : { code, name: code, title: "" }; };
  const av = (code, busy) => { const s = staffBy(code); return `<span class="aio-av${busy ? " is-busy" : ""}" style="--c:${COLORS[code] || "#14713a"}">${esc((s.name || "?").trim().charAt(0))}</span>`; };
  const badge = (st) => `<span class="aio-badge ${st}">${STATUS[st] || st}</span>`;

  /* ---------------- Markdown (safe: everything is escaped first) ---------------- */
  function md(src) {
    const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>").replace(/`([^`]+)`/g, "<code>$1</code>");
    const lines = String(src || "").replace(/\r/g, "").split("\n");
    let out = "", i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (/^\s*$/.test(l)) { i++; continue; }
      let m;
      if ((m = l.match(/^(#{1,4})\s+(.*)/))) { out += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; i++; continue; }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { out += "<hr>"; i++; continue; }
      if (/^\s*\|/.test(l)) {
        const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
        const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        const body = rows.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r));
        out += "<table>" + body.map((r, k) => `<tr>${cells(r).map((c) => (k === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join("")}</tr>`).join("") + "</table>";
        continue;
      }
      if (/^\s*[-*•]\s+/.test(l)) { out += "<ul>"; while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) out += `<li>${inline(lines[i++].replace(/^\s*[-*•]\s+/, ""))}</li>`; out += "</ul>"; continue; }
      if (/^\s*\d+[.)]\s+/.test(l)) { out += "<ol>"; while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) out += `<li>${inline(lines[i++].replace(/^\s*\d+[.)]\s+/, ""))}</li>`; out += "</ol>"; continue; }
      if (/^\s*>/.test(l)) { let q = ""; while (i < lines.length && /^\s*>/.test(lines[i])) q += inline(lines[i++].replace(/^\s*>\s?/, "")) + "<br>"; out += `<blockquote>${q}</blockquote>`; continue; }
      let p = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*[-*•]\s|\s*\d+[.)]\s|\s*\||\s*>)/.test(lines[i])) p.push(inline(lines[i++]));
      if (!p.length) p.push(inline(lines[i++]));
      out += `<p>${p.join("<br>")}</p>`;
    }
    return out;
  }

  /* ---------------- Server ---------------- */
  async function call(action, payload = {}) {
    const { data, error } = await sb.functions.invoke("ai-office", { body: Object.assign({ action }, payload) });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); msg = j.error || msg; } catch (e) {}
      throw new Error(msg);
    }
    if (data && data.error) throw new Error(data.error);
    return data;
  }
  async function load() {
    const [st, jb, ac, dc, mm, sc, se, pp, idq, gq] = await Promise.all([
      sb.from("ai_staff").select("*").order("sort"),
      sb.from("ai_jobs").select("id,parent_id,employee,title,request,status,steps,result,error,usage,created_at,updated_at,done_at,source,requested_by,feedback").order("created_at", { ascending: false }).limit(300),
      sb.from("ai_actions").select("*").order("created_at", { ascending: false }).limit(300),
      sb.from("ai_documents").select("*").order("created_at", { ascending: false }).limit(300),
      sb.from("ai_memory").select("*").order("created_at", { ascending: false }),
      sb.from("ai_schedules").select("*").order("created_at"),
      sb.from("ai_settings").select("*").eq("id", 1).maybeSingle(),
      sb.from("profiles").select("id,name,username").in("kind", ["owner", "staff"]),
      sb.from("ai_ideas").select("*").order("created_at", { ascending: false }).limit(200),
      sb.from("ai_goals").select("*").order("created_at"),
    ]);
    const e = st.error || jb.error || ac.error || dc.error || mm.error || sc.error;
    if (e) throw new Error(e.message);
    state.staff = st.data; state.jobs = jb.data; state.actions = ac.data; state.docs = dc.data; state.memory = mm.data; state.schedules = sc.data; state.settings = se.data; state.people = pp.data || []; state.ideas = idq.data || []; state.goals = gq.data || [];
    if (state.goals.some((g) => g.enabled) && state.cfg) call("goals").then((r) => { state.progress = r.goals || []; if (["office", "team"].includes(state.view)) render(); }).catch(() => {});
    render();
  }
  let reloadT = null;
  const reloadSoon = (ms = 400) => { clearTimeout(reloadT); reloadT = setTimeout(() => load().catch((e) => console.error(e)), ms); };

  // Keep a job moving until it is finished. Departments' assignments run in parallel.
  async function drive(id) {
    if (driving.has(id)) return;
    driving.add(id);
    try {
      for (let guard = 0; guard < 60; guard++) {
        let r;
        try { r = await call("run", { id }); }
        catch (e) { toast(e.message); reloadSoon(); return; }
        reloadSoon(200);
        if (r.status === "waiting") {
          const kids = r.children || state.jobs.filter((j) => j.parent_id === id && !["done", "failed", "cancelled"].includes(j.status)).map((j) => j.id);
          await Promise.all(kids.map((k) => drive(k)));
          continue;
        }
        if (r.busy) { await new Promise((ok) => setTimeout(ok, 6000)); continue; }
        if (r.status === "queued" || r.status === "running") { if (r.error) await new Promise((ok) => setTimeout(ok, 8000)); continue; }
        if (r.status === "done") { const j = state.jobs.find((x) => x.id === id); if (j && !j.parent_id) toast(`${T("أنجز", "Finished by")} ${staffBy(j.employee).name}: ${j.title}`); }
        return;
      }
    } finally { driving.delete(id); reloadSoon(); }
  }
  // After opening the page, continue any top-level job left unfinished
  function resumeOpen() {
    if (!state.cfg?.configured) return;
    state.jobs.filter((j) => !j.parent_id && ["queued", "waiting", "running"].includes(j.status)).forEach((j) => {
      if (j.status === "running" && Date.now() - Date.parse(j.updated_at) < 175000) return; // another tab is on it
      drive(j.id);
    });
  }

  async function newJob(employee, request) {
    if (!state.cfg?.configured) { toast(T("فعّل مفتاح Anthropic أولاً (الفريق والإعدادات)", "Add the Anthropic key first (Team & settings)")); location.hash = "#team"; return; }
    // In English, ask for the report in English too
    const { id } = await call("create", { employee, request: EN ? `${request}\n\n(Please write your report in English.)` : request });
    toast(`${staffBy(employee).name}: ${T("استلم الطلب", "request received")}`);
    await load();
    openJob(id);
    drive(id);
  }

  /* ---------------- Views ---------------- */
  const topJobs = () => state.jobs.filter((j) => !j.parent_id);
  const active = (j) => ["queued", "running", "waiting"].includes(j.status);
  const pending = () => state.actions.filter((a) => a.status === "pending");

  function render(force) {
    $("#tJobs").textContent = topJobs().filter(active).length || "";
    $("#tAppr").textContent = pending().length || "";
    $("#tIdeas").textContent = state.ideas.filter((i) => i.status === "proposed").length || "";
    $$("#aioTabs a").forEach((a) => a.classList.toggle("is-active", a.getAttribute("href") === "#" + state.view));
    const activeTab = $("#aioTabs a.is-active");
    if (activeTab && activeTab.scrollIntoView) activeTab.scrollIntoView({ block: "nearest", inline: "nearest" });
    const st = $("#aioStatus");
    if (state.cfg) { st.className = "aio-status " + (state.cfg.configured ? "ok" : "bad"); st.textContent = state.cfg.configured ? T("الموظفون متصلون", "Employees connected") : T("غير مفعّل", "Not set up"); }
    const v = { office: viewOffice, jobs: viewJobs, approvals: viewApprovals, ideas: viewIdeas, docs: viewDocs, schedule: viewSchedule, team: viewTeam }[state.view] || viewOffice;
    // Keep what the owner is typing when the page refreshes itself
    const typing = (document.activeElement && $("#aioView").contains(document.activeElement) && /TEXTAREA|INPUT|SELECT/.test(document.activeElement.tagName)) || $("#aioView [data-dirty]");
    if (force || !typing) $("#aioView").innerHTML = v();
    if (state.panel) state.panel();
  }

  function viewOffice() {
    const busy = (code) => state.jobs.filter((j) => j.employee === code && active(j)).length;
    const opts = state.staff.filter((s) => s.enabled).map((x) => staffBy(x.code)).map((s) => `<option value="${s.code}">${esc(s.name)} — ${esc(s.title)}</option>`).join("");
    const done = state.jobs.filter((j) => j.status === "done").length;
    return `
      ${state.cfg && !state.cfg.configured ? setupNote() : ""}
      <form class="aio-cmd" id="cmdForm">
        <h1>${T("ماذا تريد أن ينجز فريقك اليوم؟", "What should your team get done today?")}</h1>
        <p>${T("اكتب طلبك كما تكلّم مديرك العام: هو يوزّع العمل على الأقسام، ويرجع إليك بالنتيجة. أو أرسله مباشرة إلى قسم معيّن.", "Write your request as you would to your general manager: they split the work across the departments and come back with the result. Or send it straight to one department.")}</p>
        <textarea id="cmdText" placeholder="${T("مثال: راجع حسابات الشهر، وأرسل تذكيراً لكل من عليه مبلغ، وجهّز لي تقريراً مختصراً.", "Example: review this month's accounts, send a reminder to everyone who owes us, and give me a short report.")}" required></textarea>
        <div class="aio-cmd__row">
          <label class="sr-only" for="cmdTo">${T("إلى", "To")}</label>
          <select id="cmdTo">${opts}</select>
          <button class="btn btn--accent" type="submit">${T("أرسل الطلب", "Send request")}</button>
        </div>
        <div class="aio-chips">${IDEAS.map(([c, t], k) => `<button type="button" class="aio-chip" data-idea="${k}">${esc(staffBy(c).title)}: ${esc(t.slice(0, 70))}…</button>`).join("")}</div>
      </form>
      <div class="aio-kpis">
        <div class="aio-kpi"><strong>${topJobs().filter(active).length}</strong><span>${T("طلبات قيد التنفيذ", "Requests in progress")}</span></div>
        <div class="aio-kpi ${pending().length ? "warn" : ""}"><strong>${pending().length}</strong><span>${T("إجراءات بانتظار موافقتك", "Actions waiting for your approval")}</span></div>
        <div class="aio-kpi"><strong>${done}</strong><span>${T("مهام منجزة", "Jobs done")}</span></div>
        <div class="aio-kpi"><strong>${state.docs.length}</strong><span>${T("مستندات جاهزة", "Documents ready")}</span></div>
      </div>
      ${goalsBlock()}
      <h2 class="aio-h">${T("فريق العمل", "Your team")} <small>${T("اضغط على موظف لتكليفه مباشرة", "Tap an employee to give them a task")}</small></h2>
      <div class="aio-staff">${state.staff.map((x) => { const s = staffBy(x.code), n = busy(s.code); return `
        <button type="button" class="aio-card aio-emp${s.enabled ? "" : " is-off"}" data-emp="${s.code}">${av(s.code, n)}
          <span><b>${esc(s.name)}</b><span>${esc(s.title)}</span><i class="${n ? "busy" : ""}">${!s.enabled ? T("متوقف", "Off") : n ? T(`يعمل على ${n} ${n === 1 ? "مهمة" : "مهام"}`, `Working on ${n} ${n === 1 ? "job" : "jobs"}`) : T("متاح", "Available")}</i></span></button>`; }).join("")}</div>
      <h2 class="aio-h">${T("آخر الأعمال", "Latest work")}</h2>
      ${jobList(topJobs().slice(0, 6))}`;
  }

  function setupNote() {
    return `<div class="aio-note" style="margin-bottom:16px">${T(`<b>خطوة واحدة لتشغيل الموظفين:</b> أضف مفتاح Anthropic في Supabase ← Edge Functions ← Secrets باسم <code>ANTHROPIC_API_KEY</code>.
      أنشئ المفتاح من console.anthropic.com ← API Keys. لا تكتب المفتاح هنا ولا ترسله لأحد. بعد إضافته حدّث الصفحة.`, `<b>One step to switch the employees on:</b> add your Anthropic key in Supabase → Edge Functions → Secrets as <code>ANTHROPIC_API_KEY</code>.
      Create the key at console.anthropic.com → API Keys. Do not type the key here or send it to anyone. Reload this page after adding it.`)}</div>`;
  }

  function jobList(list) {
    if (!list.length) return `<p class="aio-card aio-empty">${T("لا توجد أعمال بعد. اكتب طلبك الأول بالأعلى.", "No work yet. Write your first request above.")}</p>`;
    return `<div class="aio-list">${list.map((j) => {
      const kids = state.jobs.filter((k) => k.parent_id === j.id);
      const kidsDone = kids.filter((k) => k.status === "done").length;
      const acts = state.actions.filter((a) => a.job_id === j.id || kids.some((k) => k.id === a.job_id)).filter((a) => a.status === "pending").length;
      return `<button type="button" class="aio-card aio-row" data-job="${j.id}">${av(j.employee, j.status === "running")}
        <span><b>${esc(j.title)}</b><small>${esc(staffBy(j.employee).name)} · ${fmt(j.created_at)}</small>
          <span class="aio-sub">${SOURCE[j.source] ? `<span class="aio-badge cancelled">${SOURCE[j.source]}${j.source === "staff" ? ": " + esc((state.people.find((x) => x.id === j.requested_by) || {}).name || "") : ""}</span>` : ""}${kids.length ? `<span class="aio-badge">${T("الأقسام", "Departments")} ${kidsDone}/${kids.length}</span>` : ""}${acts ? `<span class="aio-badge waiting">${acts} ${T("بانتظار موافقتك", "waiting for you")}</span>` : ""}</span></span>
        ${badge(j.status)}</button>`;
    }).join("")}</div>`;
  }

  function viewJobs() {
    const f = state.filter;
    const list = topJobs().filter((j) => f === "all" || (f === "active" ? active(j) : j.status === f));
    const btn = (k, t) => `<button type="button" data-filter="${k}" class="${f === k ? "is-on" : ""}">${t}</button>`;
    return `<h2 class="aio-h">${T("المهام", "Jobs")}</h2><div class="aio-filter">${btn("all", T("الكل", "All"))}${btn("active", T("قيد التنفيذ", "In progress"))}${btn("done", T("منجزة", "Done"))}${btn("failed", T("تعذّرت", "Failed"))}</div>${jobList(list)}`;
  }

  function actionCard(a) {
    const p = a.payload || {};
    const job = state.jobs.find((j) => j.id === a.job_id);
    let body = "";
    if (a.kind === "send_email") body = `<div class="aio-form">
        <label class="aio-field"><span>${T("إلى", "To")}</span><input dir="ltr" data-f="to" value="${esc(p.to)}" ${a.status !== "pending" ? "disabled" : ""}></label>
        <label class="aio-field"><span>${T("الموضوع", "Subject")}</span><input data-f="subject" value="${esc(p.subject)}" ${a.status !== "pending" ? "disabled" : ""}></label>
        <label class="aio-field"><span>${T("نص الرسالة", "Message")}</span><textarea data-f="body" rows="8" dir="auto" ${a.status !== "pending" ? "disabled" : ""}>${esc(p.body)}</textarea></label></div>`;
    else if (a.kind === "record_expense") body = `<p>${esc(p.date)} · ${esc(p.category)} · <b dir="ltr">$${esc(p.amount)}</b> · ${esc(p.method)}${p.note ? ` · ${esc(p.note)}` : ""}</p>`;
    else if (a.kind === "journal_entry") body = `<p>${esc(p.date)} · ${esc(p.memo)}</p><div class="aio-md"><table><tr><th>${T("الحساب", "Account")}</th><th>${T("مدين", "Debit")}</th><th>${T("دائن", "Credit")}</th><th>${T("ملاحظة", "Note")}</th></tr>${(p.lines || []).map((l) => `<tr><td>${esc(l.account)}</td><td dir="ltr">${l.debit || ""}</td><td dir="ltr">${l.credit || ""}</td><td>${esc(l.note)}</td></tr>`).join("")}</table></div>`;
    else if (a.kind === "update_instructions") body = `<p><b>${T("السبب:", "Reason:")}</b> ${esc(p.reason)}</p><div class="aio-md small"><b>${T("التعليمات الجديدة لـ", "New instructions for")} ${esc(staffBy(p.employee).name)}:</b><br>${esc(p.instructions)}</div>`;
    else if (a.kind === "update_booking") body = `<p>${T("الحجز", "Booking")} <b dir="ltr">${esc(p.id)}</b>${p.status ? ` · ${T("الحالة الجديدة:", "New status:")} <b>${esc(p.status)}</b>` : ""}${p.note ? `<br>${T("ملاحظة:", "Note:")} ${esc(p.note)}` : ""}</p>`;
    return `<div class="aio-card" data-action="${a.id}">
      <div class="aio-row" style="cursor:default">${av(a.employee)}<span><b>${esc(ACT[a.kind] || a.kind)}: ${esc(a.summary)}</b><small>${esc(staffBy(a.employee).name)} · ${fmt(a.created_at)}${job ? ` · <a href="#" data-job="${job.id}">${esc(job.title)}</a>` : ""}</small></span>
        <span class="aio-badge ${a.status === "pending" ? "waiting" : a.status}">${{ pending: T("بانتظار موافقتك", "Waiting for you"), approved: T("نُفّذ", "Done"), rejected: T("مرفوض", "Rejected"), failed: T("تعذّر", "Failed") }[a.status]}</span></div>
      ${body}${a.result ? `<p class="small muted">${esc(a.result)}</p>` : ""}
      ${a.status === "pending" ? `<div class="aio-actions"><button type="button" class="btn btn--accent btn--sm" data-approve="${a.id}">${T("موافقة وتنفيذ", "Approve and run")}</button><button type="button" class="btn btn--danger btn--sm" data-reject="${a.id}">${T("رفض", "Reject")}</button></div>` : ""}</div>`;
  }

  function viewApprovals() {
    const pend = pending(), old = state.actions.filter((a) => a.status !== "pending").slice(0, 30);
    return `<h2 class="aio-h">${T("بانتظار موافقتك", "Waiting for your approval")} <small>${T("لا يُرسل بريد ولا يُسجَّل مبلغ ولا يُعدَّل حجز إلا بعد موافقتك", "No email is sent, no money recorded and no booking changed without your approval")}</small></h2>
      <div class="aio-list">${pend.length ? pend.map(actionCard).join("") : `<p class="aio-card aio-empty">${T("لا شيء بانتظارك.", "Nothing is waiting for you.")}</p>`}</div>
      ${old.length ? `<h2 class="aio-h">${T("قرارات سابقة", "Earlier decisions")}</h2><div class="aio-list">${old.map(actionCard).join("")}</div>` : ""}`;
  }

  const EFFORT = { low: T("جهد قليل", "Low effort"), medium: T("جهد متوسط", "Medium effort"), high: T("جهد كبير", "High effort") };
  const IDEA_ST = { proposed: T("بانتظار قرارك", "Waiting for your decision"), approved: T("معتمدة", "Approved"), rejected: T("مرفوضة", "Rejected"), done: T("منفّذة", "Done") };
  function viewIdeas() {
    const card = (i) => `<div class="aio-card" data-idea-card="${i.id}">
      <div class="aio-row" style="cursor:default">${av(i.employee)}<span><b>${esc(i.title)}</b><small>${esc(staffBy(i.employee).name)} · ${fmt(i.created_at)} · ${EFFORT[i.effort] || ""}</small></span><span class="aio-badge ${i.status === "proposed" ? "waiting" : i.status === "rejected" ? "rejected" : ""}">${IDEA_ST[i.status]}</span></div>
      <div class="aio-md">${i.problem ? `<p><b>${T("الفرصة:", "Opportunity:")}</b> ${esc(i.problem)}</p>` : ""}<p><b>${T("الفكرة:", "Idea:")}</b> ${esc(i.idea)}</p>${i.impact ? `<p><b>${T("الأثر المتوقع:", "Expected impact:")}</b> ${esc(i.impact)}</p>` : ""}${i.experiment ? `<p><b>${T("التجربة والقياس:", "Test and measure:")}</b> ${esc(i.experiment)}</p>` : ""}${i.owner_note ? `<p><b>${T("ملاحظتك:", "Your note:")}</b> ${esc(i.owner_note)}</p>` : ""}${i.result ? `<p><b>${T("النتيجة:", "Result:")}</b> ${esc(i.result)}</p>` : ""}</div>
      ${i.status === "proposed" ? `<div class="aio-form"><input class="aio-input" data-idea-note placeholder="${T("ملاحظة اختيارية (مثال: ابدأ بشركة واحدة)", "Optional note (e.g. start with one company)")}"><div class="aio-actions"><button type="button" class="btn btn--accent btn--sm" data-idea-ok="${i.id}">${T("اعتمد وابدأ التنفيذ", "Approve and start")}</button><button type="button" class="btn btn--danger btn--sm" data-idea-no="${i.id}">${T("ارفض", "Reject")}</button></div></div>` : ""}</div>`;
    const open = state.ideas.filter((i) => i.status === "proposed"), rest = state.ideas.filter((i) => i.status !== "proposed");
    return `<h2 class="aio-h">${T("أفكار التطوير والنمو", "Growth ideas")} <small>${T("يقترحها الموظفون الأذكياء، وأنت تقرر. الفكرة المعتمدة يخطط المدير العام لتنفيذها", "The AI employees propose, you decide. The general manager plans and carries out each approved idea")}</small></h2>
      <div class="aio-list">${open.length ? open.map(card).join("") : `<p class="aio-card aio-empty">${T(`لا أفكار جديدة الآن. «${esc(staffBy("innovation").name)}» يراجع النمو كل أسبوع، ويمكنك أن تطلب منه أفكاراً في أي وقت من «المكتب».`, `No new ideas right now. ${esc(staffBy("innovation").name)} reviews growth every week, and you can ask for ideas any time from the Office tab.`)}</p>`}</div>
      ${rest.length ? `<h2 class="aio-h">${T("قرارات سابقة", "Earlier decisions")}</h2><div class="aio-list">${rest.map(card).join("")}</div>` : ""}`;
  }

  function goalsBlock() {
    if (!state.progress.length) return "";
    return `<h2 class="aio-h">${T("الأهداف هذا الشهر", "Goals this month")}</h2><div class="aio-kpis">${state.progress.map((g) => {
      const pct = Math.min(100, g.percent), behind = g.percent < g.month_elapsed_percent;
      return `<div class="aio-kpi ${behind ? "warn" : ""}"><strong>${g.percent}%</strong><span>${esc(g.goal)}: ${Number(g.this_month).toLocaleString("en-US")} / ${Number(g.target).toLocaleString("en-US")}</span>
        <div class="aio-bar"><i style="width:${pct}%"></i><b style="inset-inline-start:${Math.min(100, g.month_elapsed_percent)}%" title="${T("مضى من الشهر", "Month elapsed")}"></b></div></div>`;
    }).join("")}</div>`;
  }

  function viewDocs() {
    const f = state.filter;
    const kinds = [...new Set(state.docs.map((d) => d.kind))];
    const list = state.docs.filter((d) => !KIND[f] || d.kind === f);
    return `<h2 class="aio-h">${T("المستندات", "Documents")} <small>${T("كل ما كتبه الموظفون: خطابات، عقود، تقارير…", "Everything the employees wrote: letters, contracts, reports…")}</small></h2>
      ${kinds.length > 1 ? `<div class="aio-filter"><button type="button" data-filter="all" class="${!KIND[f] ? "is-on" : ""}">${T("الكل", "All")}</button>${kinds.map((k) => `<button type="button" data-filter="${k}" class="${f === k ? "is-on" : ""}">${KIND[k] || k}</button>`).join("")}</div>` : ""}
      ${list.length ? `<div class="aio-list">${list.map((d) => `<button type="button" class="aio-card aio-row" data-doc="${d.id}">${av(d.employee)}<span><b>${esc(d.title)}</b><small>${esc(KIND[d.kind] || d.kind)} · ${esc(staffBy(d.employee).name)} · ${fmt(d.created_at)}</small></span><span class="aio-badge">${esc(KIND[d.kind] || d.kind)}</span></button>`).join("")}</div>` : `<p class="aio-card aio-empty">${T("لا توجد مستندات بعد.", "No documents yet.")}</p>`}`;
  }

  const FREQ = { daily: T("كل يوم", "Every day"), weekdays: T("أيام العمل (الإثنين–الجمعة)", "Weekdays (Mon–Fri)"), weekly: T("كل أسبوع", "Every week"), monthly: T("كل شهر", "Every month") };
  const DAYS = EN ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] : ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const hourLabel = (h) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? T("صباحاً", "AM") : T("مساءً", "PM")}`;
  const when = (s) => EN
    ? `${FREQ[s.freq]}${s.freq === "weekly" ? ` on ${DAYS[s.weekday]}` : s.freq === "monthly" ? ` on day ${s.monthday}` : ""} at ${hourLabel(s.at_hour)} (Chicago)`
    : `${FREQ[s.freq]}${s.freq === "weekly" ? ` يوم ${DAYS[s.weekday]}` : s.freq === "monthly" ? ` يوم ${s.monthday}` : ""} الساعة ${hourLabel(s.at_hour)} (شيكاغو)`;
  const SCHED_IDEAS = [
    ["gm", T("تقرير الصباح", "Morning report"), "daily", 8, T("أعطني تقرير الصباح: ما الذي يحتاج انتباهي اليوم؟ الحجوزات الجديدة، الرحلات خلال 3 أيام، المهام المتأخرة، والمبالغ المستحقة. اختصر في نقاط.", "Give me the morning report: what needs my attention today? New bookings, departures in the next 3 days, overdue tasks and money owed. Keep it to bullet points.")],
    ["accountant", T("التقرير المالي الأسبوعي", "Weekly financial report"), "weekly", 9, T("جهّز التقرير المالي للأسبوع الماضي مقارنة بالأسبوع الذي قبله، مع قائمة المستحقات المتأخرة أكثر من 14 يوماً، واحفظه كمستند.", "Prepare last week's financial report compared with the week before, with the receivables overdue by more than 14 days, and save it as a document.")],
    ["operations", T("مراجعة رحلات الغد", "Tomorrow's departures check"), "weekdays", 16, T("راجع رحلات الغد وبعد الغد: هل كل التذاكر صادرة؟ أنشئ مهام عاجلة لأي حجز ناقص، وجهّز رسائل تذكير للعملاء.", "Check tomorrow's and the next day's departures: are all tickets issued? Create urgent tasks for any incomplete booking and prepare reminders for the customers.")],
    ["legal", T("فحص الامتثال الشهري", "Monthly compliance check"), "monthly", 10, T("افحص الجوازات التي تنتهي خلال 6 أشهر وحدود الائتمان للشركات والوكلاء، واكتب تقريراً بالمخاطر والإجراءات المقترحة.", "Check passports expiring within 6 months and the credit limits of companies and agents, and write a report with the risks and proposed actions.")],
  ];

  function viewSchedule() {
    const opts = (sel) => state.staff.filter((s) => s.enabled).map((x) => staffBy(x.code)).map((s) => `<option value="${s.code}" ${s.code === sel ? "selected" : ""}>${esc(s.name)} — ${esc(s.title)}</option>`).join("");
    const hours = (sel) => Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === sel ? "selected" : ""}>${hourLabel(h)}</option>`).join("");
    return `<h2 class="aio-h">${T("المهام المجدولة", "Scheduled tasks")} <small>${T("أعمال يكررها الموظفون تلقائياً، حتى والصفحة مغلقة", "Work the employees repeat on their own, even with this page closed")}</small></h2>
      ${state.cfg && !state.cfg.configured ? setupNote() : ""}
      <div class="aio-list">${state.schedules.length ? state.schedules.map((s) => `<div class="aio-card">
        <div class="aio-row" style="cursor:default">${av(s.employee)}<span><b>${esc(s.title)}</b><small>${esc(staffBy(s.employee).name)} · ${when(s)}${s.email_to ? ` · ${T("يُرسل التقرير إلى", "report emailed to")} <span dir="ltr">${esc(s.email_to)}</span>` : ""}</small>
          <span class="aio-sub"><span class="aio-badge ${s.enabled ? "" : "cancelled"}">${s.enabled ? T("مفعّل", "On") : T("متوقف", "Off")}</span>${s.enabled && s.next_run ? `<span class="aio-badge">${T("التشغيل القادم:", "Next run:")} ${fmt(s.next_run)}</span>` : ""}${s.last_run ? `<span class="aio-badge cancelled">${T("آخر تشغيل:", "Last run:")} ${fmt(s.last_run)}</span>` : ""}</span></span><span></span></div>
        <p class="small" style="margin:8px 0">${esc(s.request)}</p>
        <div class="aio-actions"><button type="button" class="btn btn--accent btn--sm" data-run-sched="${s.id}">${T("شغّل الآن", "Run now")}</button><button type="button" class="btn btn--ghost btn--sm" data-toggle-sched="${s.id}">${s.enabled ? T("إيقاف", "Turn off") : T("تفعيل", "Turn on")}</button><button type="button" class="btn btn--danger btn--sm" data-del-sched="${s.id}">${T("حذف", "Delete")}</button></div></div>`).join("") : `<p class="aio-card aio-empty">${T("لا توجد مهام مجدولة بعد. أضف واحدة بالأسفل، أو اختر من الاقتراحات.", "No scheduled tasks yet. Add one below, or pick a suggestion.")}</p>`}</div>
      <h2 class="aio-h">${T("إضافة مهمة مجدولة", "Add a scheduled task")}</h2>
      <div class="aio-filter">${SCHED_IDEAS.map((x, k) => `<button type="button" data-sched-idea="${k}">${esc(x[1])}</button>`).join("")}</div>
      <form class="aio-card aio-form" id="schedForm">
        <div class="aio-grid2"><label class="aio-field"><span>${T("الموظف", "Employee")}</span><select name="employee">${opts("gm")}</select></label>
          <label class="aio-field"><span>${T("العنوان", "Title")}</span><input name="title" required maxlength="120" placeholder="${T("مثال: تقرير الصباح", "e.g. Morning report")}"></label></div>
        <label class="aio-field"><span>${T("المطلوب في كل مرة", "What to do each time")}</span><textarea name="request" required rows="3"></textarea></label>
        <div class="aio-grid2"><label class="aio-field"><span>${T("التكرار", "Repeat")}</span><select name="freq">${Object.entries(FREQ).map(([k, t]) => `<option value="${k}">${t}</option>`).join("")}</select></label>
          <label class="aio-field"><span>${T("الساعة (توقيت شيكاغو)", "Time (Chicago)")}</span><select name="at_hour">${hours(8)}</select></label>
          <label class="aio-field"><span>${T("اليوم (للأسبوعي)", "Day (weekly)")}</span><select name="weekday">${DAYS.map((d, k) => `<option value="${k}" ${k === 1 ? "selected" : ""}>${d}</option>`).join("")}</select></label>
          <label class="aio-field"><span>${T("يوم الشهر (للشهري)", "Day of month (monthly)")}</span><input name="monthday" type="number" min="1" max="28" value="1"></label></div>
        <label class="aio-field"><span>${T("أرسل التقرير بالبريد إلى (اختياري)", "Email the report to (optional)")}</span><input name="email_to" type="email" dir="ltr" placeholder="you@example.com"></label>
        <button class="btn btn--accent btn--sm" type="submit" style="justify-self:start">${T("إضافة", "Add")}</button>
      </form>`;
  }

  function viewTeam() {
    const c = state.cfg || {};
    return `<h2 class="aio-h">${T("التشغيل", "Setup")}</h2>
      <div class="aio-card"><p>${c.configured ? T(`✓ الموظفون متصلون بـ Claude (<span dir="ltr">${esc(c.model)}</span>، مستوى التفكير: ${esc(c.effort)}).`, `✓ The employees are connected to Claude (<span dir="ltr">${esc(c.model)}</span>, effort: ${esc(c.effort)}).`) : T("✗ لم يُضف مفتاح Anthropic بعد.", "✗ The Anthropic key is not added yet.")}
        ${c.email ? T("<br>✓ إرسال البريد مفعّل.", "<br>✓ Email sending is on.") : T("<br>✗ إرسال البريد غير مفعّل بعد (بريد cPanel أو RESEND_API_KEY): الرسائل الموافق عليها لن تُرسل حتى يُفعَّل.", "<br>✗ Email sending is not set up yet (cPanel mail or RESEND_API_KEY): approved emails will not be sent until it is.")}</p>
        ${c.configured ? "" : setupNote()}
        <p class="small muted">${T(`تكلفة التشغيل تُدفع لـ Anthropic حسب الاستخدام. يمكن تغيير النموذج بإضافة السر <code dir="ltr">AI_MODEL</code> (مثل claude-sonnet-5-5 الأقل تكلفة)، ومستوى التفكير بالسر <code dir="ltr">AI_EFFORT</code> (low / medium / high).`, `Running costs are paid to Anthropic by usage. Change the model with the <code dir="ltr">AI_MODEL</code> secret (e.g. the cheaper claude-sonnet-5-5) and the effort with <code dir="ltr">AI_EFFORT</code> (low / medium / high).`)}</p></div>
      <h2 class="aio-h">${T("العمل 24/7 والتعاون مع فريقك", "24/7 work and teamwork with your staff")} <small>${T("تعمل في الخلفية كل دقيقة، ولا تكلف شيئاً إلا عندما يحدث ما يستحق", "Runs in the background every minute and costs nothing until something needs doing")}</small></h2>
      ${state.settings ? `<form class="aio-card aio-form" id="watchForm">
        <label class="aio-switch"><input type="checkbox" name="watch_bookings" ${state.settings.watch_bookings ? "checked" : ""}> ${T(`كل حجز جديد يراجعه «${esc(staffBy("operations").name)}» خلال دقائق: يتأكد من البيانات ويقترح إسناده لموظف وينشئ له مهمة المتابعة`, `${esc(staffBy("operations").name)} reviews every new booking within minutes: checks the details, proposes who should handle it and creates their follow-up task`)}</label>
        <label class="aio-switch"><input type="checkbox" name="watch_holds" ${state.settings.watch_holds ? "checked" : ""}> ${T("الحجوزات المؤقتة التي تنتهي خلال 6 ساعات: مهمة عاجلة للموظف المسؤول", "Held seats expiring within 6 hours: an urgent task for the responsible staff member")}</label>
        <label class="aio-switch"><input type="checkbox" name="watch_tasks" ${state.settings.watch_tasks ? "checked" : ""}> ${T("عندما ينهي موظف بشري مهمة كلّفه بها موظف ذكي، يتابعها الموظف الذكي تلقائياً ويكمل الخطوة التالية", "When a staff member finishes a task an AI employee gave them, the AI employee follows up and takes the next step")}</label>
        <label class="aio-field"><span>${T(`المدقق الداخلي «${esc(staffBy("auditor").name)}» يراجع عمل الفريق البشري كل`, `The internal auditor, ${esc(staffBy("auditor").name)}, reviews the staff's work every`)}</span>
          <select name="audit_hours">${[[0, T("متوقف", "Off")], [2, T("ساعتين", "2 hours")], [4, T("4 ساعات", "4 hours")], [6, T("6 ساعات", "6 hours")], [12, T("12 ساعة", "12 hours")], [24, T("يوم", "day")]].map(([v, t]) => `<option value="${v}" ${+state.settings.audit_hours === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <p class="small muted" style="margin:0">${T("المدقق يراجع: التذاكر بلا PNR أو أرقام تذاكر، الإصدار بلا دفع، البيع تحت التكلفة، الحجوزات المتروكة أو غير المسندة، الرحلات القريبة بلا تذاكر، الاستردادات والمدفوعات غير المتطابقة، والمهام المتأخرة. ثم ينشئ مهام تصحيح للموظف المسؤول ويحفظ تقريراً", "The auditor checks: tickets without a PNR or ticket numbers, tickets issued without payment, sales below cost, bookings left or unassigned, near departures without tickets, refunds and payments that don't match, and overdue tasks. Then creates correction tasks for the responsible staff member and saves a report")}${state.settings.last_audit ? ` · ${T("آخر تدقيق:", "last audit:")} ${fmt(state.settings.last_audit)}` : ""}.</p>
        <p class="small muted" style="margin:0">${T("ليطلب موظفوك من الموظفين الأذكياء: المكتب الخلفي ← الموظفون والصلاحيات ← فعّل صلاحية «المساعد الذكي». لا يرون التكاليف والأرباح، وما يحتاج موافقة يصلك أنت.", "To let your staff ask the AI employees: back office → Team & permissions → turn on \"AI assistant\". They don't see costs or profit, and anything that needs approval comes to you.")}</p>
        <button class="btn btn--ghost btn--sm" type="submit" style="justify-self:start">${T("حفظ", "Save")}</button></form>` : ""}
      <h2 class="aio-h">${T("أهداف النمو", "Growth goals")} <small>${T("يعمل الفريق كله نحوها، ويراها المدير العام ومدير التطوير في كل تقرير", "The whole team works toward them; the general manager and the innovation manager see them in every report")}</small></h2>
      <div class="aio-card">
        ${state.goals.map((g) => `<div class="aio-mem"><span><b>${esc(g.title)}</b>: ${{ monthly_sales: T("مبيعات الشهر ($)", "Monthly sales ($)"), monthly_profit: T("ربح الشهر ($)", "Monthly profit ($)"), monthly_tickets: T("تذاكر الشهر", "Tickets this month"), monthly_new_customers: T("عملاء جدد في الشهر", "New customers this month") }[g.metric]} — ${T("الهدف", "target")} ${Number(g.target).toLocaleString("en-US")}</span><button type="button" class="aio-x-sm" data-del-goal="${g.id}" aria-label="${T("حذف", "Delete")}">×</button></div>`).join("") || `<p class="muted">${T("لا أهداف بعد. ابدأ بهدف واحد واضح، مثل مبيعات الشهر.", "No goals yet. Start with one clear goal, such as monthly sales.")}</p>`}
        <form class="aio-form" id="goalForm" style="margin-top:10px"><div class="aio-grid2">
          <label class="aio-field"><span>${T("الهدف", "Goal")}</span><input name="title" required maxlength="80" placeholder="${T("مثال: مبيعات نوفمبر", "e.g. November sales")}"></label>
          <label class="aio-field"><span>${T("المقياس", "Measure")}</span><select name="metric"><option value="monthly_sales">${T("مبيعات الشهر ($)", "Monthly sales ($)")}</option><option value="monthly_profit">${T("ربح الشهر ($)", "Monthly profit ($)")}</option><option value="monthly_tickets">${T("تذاكر الشهر", "Tickets this month")}</option><option value="monthly_new_customers">${T("عملاء جدد في الشهر", "New customers this month")}</option></select></label>
          <label class="aio-field"><span>${T("الرقم المستهدف", "Target")}</span><input name="target" type="number" min="1" required dir="ltr"></label></div>
          <button class="btn btn--ghost btn--sm" type="submit" style="justify-self:start">${T("إضافة هدف", "Add goal")}</button></form>
      </div>
      <h2 class="aio-h">${T("الموظفون", "Employees")} <small>${T("غيّر الأسماء والمسميات، وأضف تعليماتك الخاصة لكل موظف", "Change names and titles, and add your own instructions for each employee")}</small></h2>
      <div class="aio-grid2">${state.staff.map((s) => `<form class="aio-card aio-form" data-staff="${s.code}">
        <div class="aio-row" style="cursor:default;grid-template-columns:auto 1fr auto">${av(s.code)}<b>${esc(ttl(s.title))}</b><label class="aio-switch"><input type="checkbox" name="enabled" ${s.enabled ? "checked" : ""} ${s.code === "gm" ? "disabled" : ""}> ${T("يعمل", "On")}</label></div>
        <label class="aio-field"><span>${T("الاسم", "Name")}</span><input name="name" value="${esc(s.name)}" maxlength="40"></label>
        <label class="aio-field"><span>${T("المسمى الوظيفي", "Job title")}</span><input name="title" value="${esc(s.title)}" maxlength="60"></label>
        <label class="aio-field"><span>${T("تعليماتك لهذا الموظف", "Your instructions for this employee")}</span><textarea name="instructions" rows="3" placeholder="${T("مثال: اكتب دائماً بالعربية الرسمية، ووقّع باسم إدارة جرين ترافيل.", "e.g. Always write in formal English and sign as Green Travel management.")}">${esc(s.instructions)}</textarea></label>
        <button class="btn btn--ghost btn--sm" type="submit">${T("حفظ", "Save")}</button></form>`).join("")}</div>
      <h2 class="aio-h">${T("ذاكرة المكتب", "Office memory")} <small>${T("معلومات يعرفها كل الموظفين: بيانات الشركة، تفضيلاتك، قراراتك", "Facts every employee knows: company details, your preferences, your decisions")}</small></h2>
      <div class="aio-card">
        <form class="aio-form" id="memForm"><div class="aio-grid2"><label class="aio-field"><span>${T("الموضوع", "Topic")}</span><input name="topic" required maxlength="80" placeholder="${T("مثال: ساعات العمل", "e.g. Opening hours")}"></label>
          <label class="aio-field"><span>${T("المعلومة", "Note")}</span><input name="note" required maxlength="1000" placeholder="${T("مثال: من 9 صباحاً حتى 7 مساءً، السبت حتى 3 عصراً", "e.g. 9 AM to 7 PM, Saturday until 3 PM")}"></label></div>
          <button class="btn btn--ghost btn--sm" type="submit" style="justify-self:start">${T("إضافة", "Add")}</button></form>
        ${state.memory.map((m) => `<div class="aio-mem"><span><b>${esc(m.topic)}</b>: ${esc(m.note)}${m.employee ? ` <small class="muted">(${esc(staffBy(m.employee).name)})</small>` : ""}</span><button type="button" class="aio-x-sm" data-del-mem="${m.id}" aria-label="${T("حذف", "Delete")}">×</button></div>`).join("") || `<p class="muted">${T("لا توجد ملاحظات بعد.", "No notes yet.")}</p>`}
      </div>`;
  }

  /* ---------------- Panels ---------------- */
  function openPanel(fn) { state.panel = fn; $("#aioPanel").hidden = false; document.body.style.overflow = "hidden"; fn(); }
  function closePanel() { $$("#aioPanelBody [data-dirty]").forEach((x) => x.removeAttribute("data-dirty")); state.panel = null; $("#aioPanel").hidden = true; document.body.style.overflow = ""; }

  function timeline(j) {
    return `<ol class="aio-tl">${(j.steps || []).map((s) => `<li class="${esc(s.kind)}"><span>${esc(stepText(s.text))}</span><time>${time(s.at)}</time></li>`).join("")}${active(j) ? `<li class="note"><span>…</span><time></time></li>` : ""}</ol>`;
  }
  function openJob(id) {
    openPanel(() => {
      const j = state.jobs.find((x) => x.id === id);
      const body = $("#aioPanelBody");
      if (!j) { body.innerHTML = `<p class="aio-empty">${T("غير موجود.", "Not found.")}</p>`; return; }
      if ((body.contains(document.activeElement) && /TEXTAREA|INPUT/.test(document.activeElement.tagName)) || $("[data-dirty]", body)) return; // owner is typing
      const kids = state.jobs.filter((k) => k.parent_id === j.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
      const ids = [j.id, ...kids.map((k) => k.id)];
      const docs = state.docs.filter((d) => ids.includes(d.job_id));
      const acts = state.actions.filter((a) => ids.includes(a.job_id));
      const s = staffBy(j.employee);
      body.innerHTML = `
        <div class="aio-row" style="cursor:default">${av(j.employee, j.status === "running")}<span><small>${esc(s.name)} · ${esc(s.title)} · ${fmt(j.created_at)}</small><h2>${esc(j.title)}</h2></span>${badge(j.status)}</div>
        <div class="aio-card"><b>${T("الطلب", "Request")}</b><div class="aio-md">${md(j.request)}</div></div>
        <div class="aio-actions">
          ${active(j) ? `<button type="button" class="btn btn--ghost btn--sm" data-drive="${j.id}">${T("تابِع التنفيذ", "Continue")}</button><button type="button" class="btn btn--danger btn--sm" data-cancel="${j.id}">${T("إيقاف", "Stop")}</button>` : ""}
          ${["failed", "cancelled"].includes(j.status) ? `<button type="button" class="btn btn--accent btn--sm" data-retry="${j.id}">${T("إعادة المحاولة", "Retry")}</button>` : ""}
          ${!active(j) ? `<button type="button" class="btn btn--danger btn--sm" data-del-job="${j.id}">${T("حذف", "Delete")}</button>` : ""}
        </div>
        ${j.error && j.status !== "done" ? `<p class="aio-note">${esc(j.error)}</p>` : ""}
        ${j.result ? `<h3 class="aio-h">${T("التقرير", "Report")}</h3><div class="aio-card aio-md">${md(j.result)}</div>
          <div class="aio-actions"><button type="button" class="btn btn--ghost btn--sm" data-print-job="${j.id}">${T("طباعة / PDF", "Print / PDF")}</button><button type="button" class="btn btn--ghost btn--sm" data-copy-job="${j.id}">${T("نسخ", "Copy")}</button></div>
          <div class="aio-card aio-form" style="margin-top:8px"><b>${T(`قيّم هذا العمل ليتعلم منه ${esc(s.name)}`, `Rate this work so ${esc(s.name)} can learn from it`)}</b>${j.feedback ? `<p class="small muted" style="margin:0">${T("تقييمك:", "Your rating:")} ${j.feedback.rating === "up" ? "👍" : "👎"} ${esc(j.feedback.note || "")}</p>` : ""}
            <input class="aio-input" id="fbNote" placeholder="${T("ما الذي أعجبك أو تريد تغييره؟ (اختياري)", "What did you like, or what should change? (optional)")}">
            <div class="aio-actions" style="margin:0"><button type="button" class="btn btn--ghost btn--sm" data-fb-up="${j.id}">👍 ${T("ممتاز", "Great")}</button><button type="button" class="btn btn--ghost btn--sm" data-fb-down="${j.id}">👎 ${T("يحتاج تحسين", "Needs work")}</button></div></div>` : ""}
        ${acts.length ? `<h3 class="aio-h">${T("إجراءات تحتاج موافقتك", "Actions that need your approval")}</h3><div class="aio-list">${acts.map(actionCard).join("")}</div>` : ""}
        ${docs.length ? `<h3 class="aio-h">${T("المستندات", "Documents")}</h3><div class="aio-list">${docs.map((d) => `<button type="button" class="aio-card aio-row" data-doc="${d.id}">${av(d.employee)}<span><b>${esc(d.title)}</b><small>${esc(KIND[d.kind] || d.kind)} · ${esc(staffBy(d.employee).name)}</small></span><span class="aio-badge">${T("فتح", "Open")}</span></button>`).join("")}</div>` : ""}
        <h3 class="aio-h">${T("سير العمل", "Progress")}</h3>
        <div class="aio-card">${timeline(j)}</div>
        ${kids.map((k) => `<div class="aio-card aio-child"><div class="aio-row" style="cursor:default">${av(k.employee, k.status === "running")}<span><b>${esc(staffBy(k.employee).name)}: ${esc(k.title)}</b><small>${esc(staffBy(k.employee).title)}</small></span>${badge(k.status)}</div>
          <details><summary class="small">${T("التكليف وسير العمل", "Assignment and progress")}${k.result ? T(" والتقرير", " and report") : ""}</summary><div class="aio-md small">${md(k.request)}</div>${timeline(k)}${k.result ? `<hr><div class="aio-md">${md(k.result)}</div>` : ""}</details></div>`).join("")}
        ${j.status === "done" ? `<form class="aio-card aio-form" id="followForm" data-job="${j.id}" style="margin-top:14px"><label class="aio-field"><span>${T(`تعليمات إضافية لـ ${esc(s.name)} على نفس العمل`, `More instructions for ${esc(s.name)} on the same work`)}</span><textarea name="text" rows="3" required placeholder="${T("مثال: أضف مقارنة بالشهر الماضي، وأرسل التقرير للمحاسب.", "e.g. Add a comparison with last month and send the report to the accountant.")}"></textarea></label><button class="btn btn--accent btn--sm" type="submit" style="justify-self:start">${T("أرسل", "Send")}</button></form>` : ""}
        ${j.usage && j.usage.turns ? `<p class="small muted" style="margin-top:14px" dir="ltr">${j.usage.turns} steps · ${Math.round((j.usage.input || 0) / 1000)}k in · ${Math.round((j.usage.output || 0) / 1000)}k out</p>` : ""}`;
    });
  }

  function openDoc(id) {
    openPanel(() => {
      const d = state.docs.find((x) => x.id === id);
      const body = $("#aioPanelBody");
      if (!d) { body.innerHTML = `<p class="aio-empty">${T("غير موجود.", "Not found.")}</p>`; return; }
      if (body.dataset.doc === id && body.dataset.mode === "edit") return;
      body.dataset.doc = id; body.dataset.mode = "view";
      body.innerHTML = `<div class="aio-row" style="cursor:default">${av(d.employee)}<span><small>${esc(KIND[d.kind] || d.kind)} · ${esc(staffBy(d.employee).name)} · ${fmt(d.created_at)}</small><h2>${esc(d.title)}</h2></span><span></span></div>
        <div class="aio-actions"><button type="button" class="btn btn--accent btn--sm" data-print-doc="${d.id}">${T("طباعة / PDF", "Print / PDF")}</button><button type="button" class="btn btn--ghost btn--sm" data-word-doc="${d.id}">${T("تنزيل Word", "Download Word")}</button><button type="button" class="btn btn--ghost btn--sm" data-copy-doc="${d.id}">${T("نسخ النص", "Copy text")}</button><button type="button" class="btn btn--ghost btn--sm" data-edit-doc="${d.id}">${T("تعديل", "Edit")}</button><button type="button" class="btn btn--danger btn--sm" data-del-doc="${d.id}">${T("حذف", "Delete")}</button></div>
        <article class="aio-card aio-md" dir="auto">${md(d.body)}</article>`;
    });
  }

  // A printable page with the company letterhead
  function letterhead(title, html) {
    return `<!doctype html><html lang="${EN ? "en" : "ar"}" dir="${EN ? "ltr" : "rtl"}"><head><meta charset="utf-8"><title>${esc(title)}</title>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap" rel="stylesheet">
      <style>body{font-family:"IBM Plex Sans Arabic",Tahoma,sans-serif;color:#0e1b14;margin:0;padding:28px 40px;line-height:1.9}
      header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #1f9d3a;padding-bottom:12px;margin-bottom:22px}
      header b{font-size:22px;color:#0f4227}header small{display:block;color:#435349;font-size:12px;direction:ltr;text-align:left}
      table{border-collapse:collapse;width:100%}th,td{border:1px solid #cfd8cf;padding:6px 9px;text-align:start}th{background:#f1faee}
      footer{margin-top:40px;border-top:1px solid #e1e8e1;padding-top:8px;font-size:11px;color:#7a8a80;text-align:center}
      @media print{body{padding:0 10mm}}</style></head><body>
      <header><div><b>Green Travel جرين ترافيل</b><div style="font-size:13px;color:#435349">${T("طيران · فنادق · تأشيرات · عمرة", "Flights · Hotels · Visas · Umrah")}</div></div>
      <small>greentravel.us · info@greentravel.us<br>+1 (708) 963-2552 · +1 (708) 940-2929<br>+1 (331) 213-3768 · +1 (708) 953-2244</small></header>
      <main dir="auto">${html}</main><footer>Green Travel · Chicago, IL · greentravel.us</footer></body></html>`;
  }
  function printHtml(title, mdText) {
    const w = window.open("", "_blank");
    if (!w) { toast(T("اسمح بالنوافذ المنبثقة للطباعة", "Allow pop-ups to print")); return; }
    w.document.write(letterhead(title, md(mdText)));
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 600);
  }
  function wordDoc(d) {
    const blob = new Blob(["﻿" + letterhead(d.title, md(d.body))], { type: "application/msword" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${d.title.replace(/[\\/:*?"<>|]+/g, " ").slice(0, 80)}.doc`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const clean = () => $$("[data-dirty]").forEach((x) => x.removeAttribute("data-dirty"));
  const copy = (t) => navigator.clipboard.writeText(t).then(() => toast(T("نُسخ", "Copied")), () => toast(T("تعذّر النسخ", "Could not copy")));

  /* ---------------- Events ---------------- */
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-close],[data-emp],[data-idea],[data-job],[data-doc],[data-filter],[data-approve],[data-reject],[data-drive],[data-cancel],[data-retry],[data-del-job],[data-print-job],[data-copy-job],[data-print-doc],[data-word-doc],[data-copy-doc],[data-edit-doc],[data-del-doc],[data-del-mem],[data-save-doc],[data-run-sched],[data-toggle-sched],[data-del-sched],[data-sched-idea],[data-idea-ok],[data-idea-no],[data-fb-up],[data-fb-down],[data-del-goal]");
    if (!t) return;
    const d = t.dataset;
    if ("close" in d) return closePanel();
    if (d.emp) { const s = staffBy(d.emp); if (!s.enabled) return toast(T("هذا الموظف متوقف، فعّله من الإعدادات", "This employee is off; turn them on in settings")); location.hash = "#office"; setTimeout(() => { $("#cmdTo").value = d.emp; $("#cmdText").focus(); $("#cmdText").placeholder = T(`اكتب المهمة التي تريدها من ${s.name} (${s.title})…`, `Write the task for ${s.name} (${s.title})…`); }, 50); return; }
    if (d.idea) { const [c, txt] = IDEAS[+d.idea]; $("#cmdTo").value = c; $("#cmdText").value = txt; $("#cmdText").focus(); return; }
    if (d.job) { e.preventDefault(); return openJob(d.job); }
    if (d.doc) return openDoc(d.doc);
    if (d.filter) { state.filter = d.filter; return render(true); }
    try {
      if (d.approve || d.reject) {
        const id = d.approve || d.reject;
        const card = t.closest("[data-action]");
        const payload = {};
        $$("[data-f]", card).forEach((f) => (payload[f.dataset.f] = f.value));
        t.disabled = true;
        const r = await call("decide", { id, approve: !!d.approve, payload: Object.keys(payload).length ? payload : undefined });
        toast(d.approve ? r.result || T("نُفّذ", "Done") : T("رُفض", "Rejected"));
        clean(); return load();
      }
      if (d.drive) { toast(T("يتابع التنفيذ…", "Continuing…")); return drive(d.drive); }
      if (d.cancel) { await call("cancel", { id: d.cancel }); toast(T("أُوقف", "Stopped")); return load(); }
      if (d.retry) { await call("retry", { id: d.retry }); await load(); return drive(d.retry); }
      if (d.delJob) { if (!confirm(T("حذف هذا العمل وسجله؟ (المستندات تبقى)", "Delete this job and its history? (Documents are kept)"))) return; const { error } = await sb.from("ai_jobs").delete().eq("id", d.delJob); if (error) throw error; closePanel(); return load(); }
      if (d.printJob) { const j = state.jobs.find((x) => x.id === d.printJob); return printHtml(j.title, `# ${j.title}\n\n${j.result}`); }
      if (d.copyJob) return copy(state.jobs.find((x) => x.id === d.copyJob).result);
      if (d.printDoc) { const x = state.docs.find((y) => y.id === d.printDoc); return printHtml(x.title, x.body); }
      if (d.wordDoc) return wordDoc(state.docs.find((y) => y.id === d.wordDoc));
      if (d.copyDoc) return copy(state.docs.find((y) => y.id === d.copyDoc).body);
      if (d.editDoc) {
        const x = state.docs.find((y) => y.id === d.editDoc), body = $("#aioPanelBody");
        body.dataset.mode = "edit";
        body.innerHTML = `<h2>${T("تعديل:", "Edit:")} ${esc(x.title)}</h2><div class="aio-form"><label class="aio-field"><span>${T("العنوان", "Title")}</span><input id="edTitle" value="${esc(x.title)}"></label>
          <label class="aio-field"><span>${T("النص (Markdown)", "Text (Markdown)")}</span><textarea id="edBody" rows="22" dir="auto">${esc(x.body)}</textarea></label>
          <div class="aio-actions"><button type="button" class="btn btn--accent btn--sm" data-save-doc="${x.id}">${T("حفظ", "Save")}</button><button type="button" class="btn btn--ghost btn--sm" data-doc="${x.id}">${T("إلغاء", "Cancel")}</button></div></div>`;
        return;
      }
      if (d.saveDoc) {
        const { error } = await sb.from("ai_documents").update({ title: $("#edTitle").value.trim() || T("مستند", "Document"), body: $("#edBody").value }).eq("id", d.saveDoc);
        if (error) throw error;
        $("#aioPanelBody").dataset.mode = "view"; toast(T("حُفظ", "Saved")); await load(); return openDoc(d.saveDoc);
      }
      if (d.delDoc) { if (!confirm(T("حذف المستند؟", "Delete this document?"))) return; const { error } = await sb.from("ai_documents").delete().eq("id", d.delDoc); if (error) throw error; closePanel(); return load(); }
      if (d.ideaOk || d.ideaNo) {
        const id = d.ideaOk || d.ideaNo, note = ($("[data-idea-note]", t.closest("[data-idea-card]")) || {}).value || "";
        t.disabled = true;
        const r = await call("decide_idea", { id, approve: !!d.ideaOk, note });
        clean(); await load();
        if (r.job_id) { toast(T("اعتُمدت. بدأ المدير العام التخطيط للتنفيذ", "Approved. The general manager is planning it")); openJob(r.job_id); drive(r.job_id); } else toast(T("رُفضت", "Rejected"));
        return;
      }
      if (d.fbUp || d.fbDown) {
        await call("feedback", { id: d.fbUp || d.fbDown, rating: d.fbUp ? "up" : "down", note: ($("#fbNote") || {}).value || "" });
        clean(); toast(T("شكراً، سيتعلم الموظف من تقييمك", "Thanks, the employee will learn from your rating")); return load();
      }
      if (d.delGoal) { const { error } = await sb.from("ai_goals").delete().eq("id", d.delGoal); if (error) throw error; return load(); }
      if (d.schedIdea) { const [c, ttl, fq, h, req] = SCHED_IDEAS[+d.schedIdea], f = $("#schedForm").elements; f.employee.value = c; f.title.value = ttl; f.freq.value = fq; f.at_hour.value = h; f.request.value = req; f.request.focus(); return; }
      if (d.runSched) { const { id } = await call("run_schedule", { id: d.runSched }); toast(T("بدأ التنفيذ", "Started")); await load(); openJob(id); return drive(id); }
      if (d.toggleSched) { const x = state.schedules.find((y) => y.id === d.toggleSched); const { error } = await sb.from("ai_schedules").update({ enabled: !x.enabled }).eq("id", x.id); if (error) throw error; return load(); }
      if (d.delSched) { if (!confirm(T("حذف هذه المهمة المجدولة؟", "Delete this scheduled task?"))) return; const { error } = await sb.from("ai_schedules").delete().eq("id", d.delSched); if (error) throw error; return load(); }
      if (d.delMem) { const { error } = await sb.from("ai_memory").delete().eq("id", d.delMem); if (error) throw error; return load(); }
    } catch (er) { toast(er.message || String(er)); t.disabled = false; }
  });

  document.addEventListener("submit", async (e) => {
    const f = e.target;
    e.preventDefault();
    try {
      if (f.id === "cmdForm") {
        const text = $("#cmdText").value.trim();
        if (text.length < 3) return toast(T("اكتب الطلب", "Write the request"));
        f.querySelector("button[type=submit]").disabled = true;
        await newJob($("#cmdTo").value, text);
        $("#cmdText").value = "";
        f.querySelector("button[type=submit]").disabled = false;
        return;
      }
      if (f.id === "followForm") {
        const id = f.dataset.job, box = f.elements.text, text = box.value.trim();
        if (!text) return;
        await call("followup", { id, text });
        box.value = ""; box.blur();
        await load(); return drive(id);
      }
      if (f.id === "goalForm") {
        const el = f.elements;
        const { error } = await sb.from("ai_goals").insert({ title: el.title.value.trim(), metric: el.metric.value, target: +el.target.value });
        if (error) throw error;
        f.reset(); clean(); toast(T("أُضيف الهدف", "Goal added")); return load();
      }
      if (f.id === "watchForm") {
        const el = f.elements;
        const { error } = await sb.from("ai_settings").update({ watch_bookings: el.watch_bookings.checked, watch_holds: el.watch_holds.checked, watch_tasks: el.watch_tasks.checked, audit_hours: +el.audit_hours.value, updated_at: new Date().toISOString() }).eq("id", 1);
        if (error) throw error;
        clean(); toast(T("حُفظ", "Saved")); return load();
      }
      if (f.id === "schedForm") {
        const el = f.elements;
        const row = { employee: el.employee.value, title: el.title.value.trim(), request: el.request.value.trim(), freq: el.freq.value, at_hour: +el.at_hour.value, weekday: +el.weekday.value, monthday: Math.min(28, Math.max(1, +el.monthday.value || 1)), email_to: el.email_to.value.trim() || null };
        if (!row.title || !row.request) return toast(T("اكتب العنوان والمطلوب", "Write the title and the task"));
        const { error } = await sb.from("ai_schedules").insert(row);
        if (error) throw error;
        f.reset(); document.activeElement && document.activeElement.blur(); clean(); toast(T("أُضيفت المهمة المجدولة", "Scheduled task added")); return load();
      }
      if (f.id === "memForm") {
        const { error } = await sb.from("ai_memory").insert({ topic: f.elements.topic.value.trim(), note: f.elements.note.value.trim() });
        if (error) throw error;
        f.reset(); document.activeElement && document.activeElement.blur(); toast(T("أُضيفت", "Added")); return load();
      }
      if (f.dataset.staff) {
        const el = f.elements, code = f.dataset.staff;
        const { error } = await sb.from("ai_staff").update({ name: el.name.value.trim() || (state.staff.find((x) => x.code === code) || {}).name, title: el.title.value.trim() || (state.staff.find((x) => x.code === code) || {}).title, instructions: el.instructions.value.trim(), enabled: code === "gm" ? true : el.enabled.checked }).eq("code", code);
        if (error) throw error;
        document.activeElement && document.activeElement.blur();
        clean(); toast(T("حُفظ", "Saved")); return load();
      }
    } catch (er) { toast(er.message || String(er)); $$("button[type=submit]", f).forEach((b) => (b.disabled = false)); }
  });
  document.addEventListener("input", (e) => { if (e.target.matches("[data-f], [data-staff] *, #schedForm *, #watchForm *, #goalForm *, [data-idea-note], #fbNote")) e.target.dataset.dirty = "1"; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.panel) closePanel(); if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && e.target.id === "cmdText") $("#cmdForm").requestSubmit(); });
  window.addEventListener("hashchange", () => { clean(); state.view = location.hash.slice(1) || "office"; state.filter = "all"; closePanel(); document.activeElement && document.activeElement.blur(); render(true); window.scrollTo(0, 0); });

  /* ---------------- Start ---------------- */
  async function start() {
    $("#aioLogin").hidden = true; $("#aioApp").hidden = false;
    state.view = location.hash.slice(1) || "office";
    try { state.cfg = await call("status"); } catch (e) { state.cfg = { configured: false }; toast(e.message); }
    await load();
    sb.channel("ai-office").on("postgres_changes", { event: "*", schema: "public", table: "ai_jobs" }, () => reloadSoon())
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_actions" }, () => reloadSoon())
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_documents" }, () => reloadSoon())
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_schedules" }, () => reloadSoon())
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_ideas" }, () => reloadSoon()).subscribe();
    setInterval(() => { if (state.jobs.some(active)) reloadSoon(0); }, 5000);
    resumeOpen();
  }
  function showLogin(msg) { $("#aioApp").hidden = true; $("#aioLogin").hidden = false; $("#aioLoginStatus").textContent = msg || ""; }
  $("#aioLoginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const r = await DB.login($("#aioUser").value, $("#aioPass").value);
    if (!r) return showLogin(T("اسم المستخدم أو كلمة المرور غير صحيحة", "Wrong username or password"));
    if (r.error === "mfa") return showLogin(T("لم تكتمل خطوة التحقق الثانية. حاول مرة أخرى.", "Two-step verification was not completed. Try again."));
    if (r.error) return showLogin(T("الحساب موقوف", "This account is suspended"));
    if (r.role !== "owner") { await DB.logout(); return showLogin(T("المكتب الإلكتروني متاح لحساب المالك فقط", "The AI office is for the owner's account only")); }
    start().catch((er) => toast(er.message));
  });
  DB.ready.then(() => {
    const p = DB.profile;
    if (p && p.kind === "owner" && p.status === "active") start().catch((er) => toast(er.message));
    else showLogin(p ? T("المكتب الإلكتروني متاح لحساب المالك فقط", "The AI office is for the owner's account only") : "");
  });
})();
