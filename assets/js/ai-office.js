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
  const fmt = (iso) => { if (!iso) return ""; const d = new Date(iso); return d.toLocaleString("ar-EG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };
  const time = (iso) => (iso ? new Date(iso).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }) : "");
  const toast = (msg) => { const t = $("#toast"); t.textContent = msg; t.classList.add("is-visible"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("is-visible"), 3500); };

  const COLORS = { gm: "#0f4227", secretary: "#b5487a", accountant: "#2459c7", legal: "#6b4bc4", operations: "#d97a00", customer_service: "#0e8f8f", marketing: "#d4463c", hr: "#5a7a1f" };
  const STATUS = { queued: "في الانتظار", running: "يعمل الآن", waiting: "بانتظار الأقسام", done: "منجز", failed: "تعذّر", cancelled: "أُلغي" };
  const KIND = { letter: "خطاب", contract: "عقد", report: "تقرير", memo: "مذكرة", email: "بريد", policy: "سياسة", offer: "عرض", invoice: "فاتورة", minutes: "محضر", other: "مستند" };
  const ACT = { send_email: "إرسال بريد", record_expense: "تسجيل مصروف", journal_entry: "قيد يومية", update_booking: "تعديل حجز" };
  const IDEAS = [
    ["gm", "أعطني تقريراً شاملاً عن وضع الشركة هذا الشهر: المبيعات والأرباح والمستحقات والحجوزات التي تحتاج متابعة، مع توصياتك."],
    ["operations", "راجع الحجوزات الجديدة والرحلات القادمة خلال 7 أيام، ووزّع ما لم يُسند على الموظفين، وأنشئ مهام المتابعة."],
    ["accountant", "جهّز قائمة المستحقات غير المحصّلة من العملاء والوكلاء والشركات، وصِغ رسالة تذكير مهذبة لكل جهة."],
    ["legal", "اكتب عقد وكالة B2B بين جرين ترافيل ووكيل سفر فرعي: العمولة، حد الائتمان، السداد، الإلغاء، والمسؤوليات."],
    ["marketing", "جهّز حملة تسويقية لعروض العمرة القادمة: 5 منشورات للسوشيال ميديا ونص رسالة لعملائنا السابقين."],
    ["hr", "اكتب وصفاً وظيفياً وإعلان توظيف لموظف حجوزات طيران يتحدث العربية والإنجليزية في شيكاغو."],
    ["secretary", "اكتب خطاباً رسمياً لشركة طيران نطلب فيه اتفاقية أسعار خاصة للمجموعات، وأنشئ مهمة متابعة بعد أسبوع."],
    ["customer_service", "اكتب ردوداً جاهزة لأكثر 8 أسئلة يطرحها العملاء (الأمتعة، الإلغاء، تغيير الموعد، التأشيرة…)."],
  ];

  const state = { staff: [], jobs: [], actions: [], docs: [], memory: [], schedules: [], cfg: null, view: "office", filter: "all", panel: null };
  const driving = new Set();
  const staffBy = (code) => state.staff.find((s) => s.code === code) || { code, name: code, title: "" };
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
    const [st, jb, ac, dc, mm, sc] = await Promise.all([
      sb.from("ai_staff").select("*").order("sort"),
      sb.from("ai_jobs").select("id,parent_id,employee,title,request,status,steps,result,error,usage,created_at,updated_at,done_at").order("created_at", { ascending: false }).limit(300),
      sb.from("ai_actions").select("*").order("created_at", { ascending: false }).limit(300),
      sb.from("ai_documents").select("*").order("created_at", { ascending: false }).limit(300),
      sb.from("ai_memory").select("*").order("created_at", { ascending: false }),
      sb.from("ai_schedules").select("*").order("created_at"),
    ]);
    const e = st.error || jb.error || ac.error || dc.error || mm.error || sc.error;
    if (e) throw new Error(e.message);
    state.staff = st.data; state.jobs = jb.data; state.actions = ac.data; state.docs = dc.data; state.memory = mm.data; state.schedules = sc.data;
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
        if (r.status === "done") { const j = state.jobs.find((x) => x.id === id); if (j && !j.parent_id) toast(`أنجز ${staffBy(j.employee).name}: ${j.title}`); }
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
    if (!state.cfg?.configured) { toast("فعّل مفتاح Anthropic أولاً (الفريق والإعدادات)"); location.hash = "#team"; return; }
    const { id } = await call("create", { employee, request });
    toast(`استلم ${staffBy(employee).name} الطلب`);
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
    $$("#aioTabs a").forEach((a) => a.classList.toggle("is-active", a.getAttribute("href") === "#" + state.view));
    const st = $("#aioStatus");
    if (state.cfg) { st.className = "aio-status " + (state.cfg.configured ? "ok" : "bad"); st.textContent = state.cfg.configured ? "الموظفون متصلون" : "غير مفعّل"; }
    const v = { office: viewOffice, jobs: viewJobs, approvals: viewApprovals, docs: viewDocs, schedule: viewSchedule, team: viewTeam }[state.view] || viewOffice;
    // Keep what the owner is typing when the page refreshes itself
    const typing = (document.activeElement && $("#aioView").contains(document.activeElement) && /TEXTAREA|INPUT|SELECT/.test(document.activeElement.tagName)) || $("#aioView [data-dirty]");
    if (force || !typing) $("#aioView").innerHTML = v();
    if (state.panel) state.panel();
  }

  function viewOffice() {
    const busy = (code) => state.jobs.filter((j) => j.employee === code && active(j)).length;
    const opts = state.staff.filter((s) => s.enabled).map((s) => `<option value="${s.code}">${esc(s.name)} — ${esc(s.title)}</option>`).join("");
    const done = state.jobs.filter((j) => j.status === "done").length;
    return `
      ${state.cfg && !state.cfg.configured ? setupNote() : ""}
      <form class="aio-cmd" id="cmdForm">
        <h1>ماذا تريد أن ينجز فريقك اليوم؟</h1>
        <p>اكتب طلبك كما تكلّم مديرك العام: هو يوزّع العمل على الأقسام، ويرجع إليك بالنتيجة. أو أرسله مباشرة إلى قسم معيّن.</p>
        <textarea id="cmdText" placeholder="مثال: راجع حسابات الشهر، وأرسل تذكيراً لكل من عليه مبلغ، وجهّز لي تقريراً مختصراً." required></textarea>
        <div class="aio-cmd__row">
          <label class="sr-only" for="cmdTo">إلى</label>
          <select id="cmdTo">${opts}</select>
          <button class="btn btn--accent" type="submit">أرسل الطلب</button>
        </div>
        <div class="aio-chips">${IDEAS.map(([c, t], k) => `<button type="button" class="aio-chip" data-idea="${k}">${esc(staffBy(c).title)}: ${esc(t.slice(0, 70))}…</button>`).join("")}</div>
      </form>
      <div class="aio-kpis">
        <div class="aio-kpi"><strong>${topJobs().filter(active).length}</strong><span>طلبات قيد التنفيذ</span></div>
        <div class="aio-kpi ${pending().length ? "warn" : ""}"><strong>${pending().length}</strong><span>إجراءات بانتظار موافقتك</span></div>
        <div class="aio-kpi"><strong>${done}</strong><span>مهام منجزة</span></div>
        <div class="aio-kpi"><strong>${state.docs.length}</strong><span>مستندات جاهزة</span></div>
      </div>
      <h2 class="aio-h">فريق العمل <small>اضغط على موظف لتكليفه مباشرة</small></h2>
      <div class="aio-staff">${state.staff.map((s) => { const n = busy(s.code); return `
        <button type="button" class="aio-card aio-emp${s.enabled ? "" : " is-off"}" data-emp="${s.code}">${av(s.code, n)}
          <span><b>${esc(s.name)}</b><span>${esc(s.title)}</span><i class="${n ? "busy" : ""}">${!s.enabled ? "متوقف" : n ? `يعمل على ${n} ${n === 1 ? "مهمة" : "مهام"}` : "متاح"}</i></span></button>`; }).join("")}</div>
      <h2 class="aio-h">آخر الأعمال</h2>
      ${jobList(topJobs().slice(0, 6))}`;
  }

  function setupNote() {
    return `<div class="aio-note" style="margin-bottom:16px"><b>خطوة واحدة لتشغيل الموظفين:</b> أضف مفتاح Anthropic في Supabase ← Edge Functions ← Secrets باسم <code>ANTHROPIC_API_KEY</code>.
      أنشئ المفتاح من console.anthropic.com ← API Keys. لا تكتب المفتاح هنا ولا ترسله لأحد. بعد إضافته حدّث الصفحة.</div>`;
  }

  function jobList(list) {
    if (!list.length) return `<p class="aio-card aio-empty">لا توجد أعمال بعد. اكتب طلبك الأول بالأعلى.</p>`;
    return `<div class="aio-list">${list.map((j) => {
      const kids = state.jobs.filter((k) => k.parent_id === j.id);
      const kidsDone = kids.filter((k) => k.status === "done").length;
      const acts = state.actions.filter((a) => a.job_id === j.id || kids.some((k) => k.id === a.job_id)).filter((a) => a.status === "pending").length;
      return `<button type="button" class="aio-card aio-row" data-job="${j.id}">${av(j.employee, j.status === "running")}
        <span><b>${esc(j.title)}</b><small>${esc(staffBy(j.employee).name)} · ${fmt(j.created_at)}</small>
          <span class="aio-sub">${kids.length ? `<span class="aio-badge">الأقسام ${kidsDone}/${kids.length}</span>` : ""}${acts ? `<span class="aio-badge waiting">${acts} بانتظار موافقتك</span>` : ""}</span></span>
        ${badge(j.status)}</button>`;
    }).join("")}</div>`;
  }

  function viewJobs() {
    const f = state.filter;
    const list = topJobs().filter((j) => f === "all" || (f === "active" ? active(j) : j.status === f));
    const btn = (k, t) => `<button type="button" data-filter="${k}" class="${f === k ? "is-on" : ""}">${t}</button>`;
    return `<h2 class="aio-h">المهام</h2><div class="aio-filter">${btn("all", "الكل")}${btn("active", "قيد التنفيذ")}${btn("done", "منجزة")}${btn("failed", "تعذّرت")}</div>${jobList(list)}`;
  }

  function actionCard(a) {
    const p = a.payload || {};
    const job = state.jobs.find((j) => j.id === a.job_id);
    let body = "";
    if (a.kind === "send_email") body = `<div class="aio-form">
        <label class="aio-field"><span>إلى</span><input dir="ltr" data-f="to" value="${esc(p.to)}" ${a.status !== "pending" ? "disabled" : ""}></label>
        <label class="aio-field"><span>الموضوع</span><input data-f="subject" value="${esc(p.subject)}" ${a.status !== "pending" ? "disabled" : ""}></label>
        <label class="aio-field"><span>نص الرسالة</span><textarea data-f="body" rows="8" dir="auto" ${a.status !== "pending" ? "disabled" : ""}>${esc(p.body)}</textarea></label></div>`;
    else if (a.kind === "record_expense") body = `<p>${esc(p.date)} · ${esc(p.category)} · <b dir="ltr">$${esc(p.amount)}</b> · ${esc(p.method)}${p.note ? ` · ${esc(p.note)}` : ""}</p>`;
    else if (a.kind === "journal_entry") body = `<p>${esc(p.date)} · ${esc(p.memo)}</p><div class="aio-md"><table><tr><th>الحساب</th><th>مدين</th><th>دائن</th><th>ملاحظة</th></tr>${(p.lines || []).map((l) => `<tr><td>${esc(l.account)}</td><td dir="ltr">${l.debit || ""}</td><td dir="ltr">${l.credit || ""}</td><td>${esc(l.note)}</td></tr>`).join("")}</table></div>`;
    else if (a.kind === "update_booking") body = `<p>الحجز <b dir="ltr">${esc(p.id)}</b>${p.status ? ` · الحالة الجديدة: <b>${esc(p.status)}</b>` : ""}${p.note ? `<br>ملاحظة: ${esc(p.note)}` : ""}</p>`;
    return `<div class="aio-card" data-action="${a.id}">
      <div class="aio-row" style="cursor:default">${av(a.employee)}<span><b>${esc(ACT[a.kind] || a.kind)}: ${esc(a.summary)}</b><small>${esc(staffBy(a.employee).name)} · ${fmt(a.created_at)}${job ? ` · <a href="#" data-job="${job.id}">${esc(job.title)}</a>` : ""}</small></span>
        <span class="aio-badge ${a.status === "pending" ? "waiting" : a.status}">${{ pending: "بانتظار موافقتك", approved: "نُفّذ", rejected: "مرفوض", failed: "تعذّر" }[a.status]}</span></div>
      ${body}${a.result ? `<p class="small muted">${esc(a.result)}</p>` : ""}
      ${a.status === "pending" ? `<div class="aio-actions"><button type="button" class="btn btn--accent btn--sm" data-approve="${a.id}">موافقة وتنفيذ</button><button type="button" class="btn btn--danger btn--sm" data-reject="${a.id}">رفض</button></div>` : ""}</div>`;
  }

  function viewApprovals() {
    const pend = pending(), old = state.actions.filter((a) => a.status !== "pending").slice(0, 30);
    return `<h2 class="aio-h">بانتظار موافقتك <small>لا يُرسل بريد ولا يُسجَّل مبلغ ولا يُعدَّل حجز إلا بعد موافقتك</small></h2>
      <div class="aio-list">${pend.length ? pend.map(actionCard).join("") : `<p class="aio-card aio-empty">لا شيء بانتظارك.</p>`}</div>
      ${old.length ? `<h2 class="aio-h">قرارات سابقة</h2><div class="aio-list">${old.map(actionCard).join("")}</div>` : ""}`;
  }

  function viewDocs() {
    const f = state.filter;
    const kinds = [...new Set(state.docs.map((d) => d.kind))];
    const list = state.docs.filter((d) => !KIND[f] || d.kind === f);
    return `<h2 class="aio-h">المستندات <small>كل ما كتبه الموظفون: خطابات، عقود، تقارير…</small></h2>
      ${kinds.length > 1 ? `<div class="aio-filter"><button type="button" data-filter="all" class="${!KIND[f] ? "is-on" : ""}">الكل</button>${kinds.map((k) => `<button type="button" data-filter="${k}" class="${f === k ? "is-on" : ""}">${KIND[k] || k}</button>`).join("")}</div>` : ""}
      ${list.length ? `<div class="aio-list">${list.map((d) => `<button type="button" class="aio-card aio-row" data-doc="${d.id}">${av(d.employee)}<span><b>${esc(d.title)}</b><small>${esc(KIND[d.kind] || d.kind)} · ${esc(staffBy(d.employee).name)} · ${fmt(d.created_at)}</small></span><span class="aio-badge">${esc(KIND[d.kind] || d.kind)}</span></button>`).join("")}</div>` : `<p class="aio-card aio-empty">لا توجد مستندات بعد.</p>`}`;
  }

  const FREQ = { daily: "كل يوم", weekdays: "أيام العمل (الإثنين–الجمعة)", weekly: "كل أسبوع", monthly: "كل شهر" };
  const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const hourLabel = (h) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? "صباحاً" : "مساءً"}`;
  const when = (s) => `${FREQ[s.freq]}${s.freq === "weekly" ? ` يوم ${DAYS[s.weekday]}` : s.freq === "monthly" ? ` يوم ${s.monthday}` : ""} الساعة ${hourLabel(s.at_hour)} (شيكاغو)`;
  const SCHED_IDEAS = [
    ["gm", "تقرير الصباح", "daily", 8, "أعطني تقرير الصباح: ما الذي يحتاج انتباهي اليوم؟ الحجوزات الجديدة، الرحلات خلال 3 أيام، المهام المتأخرة، والمبالغ المستحقة. اختصر في نقاط."],
    ["accountant", "التقرير المالي الأسبوعي", "weekly", 9, "جهّز التقرير المالي للأسبوع الماضي مقارنة بالأسبوع الذي قبله، مع قائمة المستحقات المتأخرة أكثر من 14 يوماً، واحفظه كمستند."],
    ["operations", "مراجعة رحلات الغد", "weekdays", 16, "راجع رحلات الغد وبعد الغد: هل كل التذاكر صادرة؟ أنشئ مهام عاجلة لأي حجز ناقص، وجهّز رسائل تذكير للعملاء."],
    ["legal", "فحص الامتثال الشهري", "monthly", 10, "افحص الجوازات التي تنتهي خلال 6 أشهر وحدود الائتمان للشركات والوكلاء، واكتب تقريراً بالمخاطر والإجراءات المقترحة."],
  ];

  function viewSchedule() {
    const opts = (sel) => state.staff.filter((s) => s.enabled).map((s) => `<option value="${s.code}" ${s.code === sel ? "selected" : ""}>${esc(s.name)} — ${esc(s.title)}</option>`).join("");
    const hours = (sel) => Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === sel ? "selected" : ""}>${hourLabel(h)}</option>`).join("");
    return `<h2 class="aio-h">المهام المجدولة <small>أعمال يكررها الموظفون تلقائياً، حتى والصفحة مغلقة</small></h2>
      ${state.cfg && !state.cfg.configured ? setupNote() : ""}
      <div class="aio-list">${state.schedules.length ? state.schedules.map((s) => `<div class="aio-card">
        <div class="aio-row" style="cursor:default">${av(s.employee)}<span><b>${esc(s.title)}</b><small>${esc(staffBy(s.employee).name)} · ${when(s)}${s.email_to ? ` · يُرسل التقرير إلى <span dir="ltr">${esc(s.email_to)}</span>` : ""}</small>
          <span class="aio-sub"><span class="aio-badge ${s.enabled ? "" : "cancelled"}">${s.enabled ? "مفعّل" : "متوقف"}</span>${s.enabled && s.next_run ? `<span class="aio-badge">التشغيل القادم: ${fmt(s.next_run)}</span>` : ""}${s.last_run ? `<span class="aio-badge cancelled">آخر تشغيل: ${fmt(s.last_run)}</span>` : ""}</span></span><span></span></div>
        <p class="small" style="margin:8px 0">${esc(s.request)}</p>
        <div class="aio-actions"><button type="button" class="btn btn--accent btn--sm" data-run-sched="${s.id}">شغّل الآن</button><button type="button" class="btn btn--ghost btn--sm" data-toggle-sched="${s.id}">${s.enabled ? "إيقاف" : "تفعيل"}</button><button type="button" class="btn btn--danger btn--sm" data-del-sched="${s.id}">حذف</button></div></div>`).join("") : `<p class="aio-card aio-empty">لا توجد مهام مجدولة بعد. أضف واحدة بالأسفل، أو اختر من الاقتراحات.</p>`}</div>
      <h2 class="aio-h">إضافة مهمة مجدولة</h2>
      <div class="aio-filter">${SCHED_IDEAS.map((x, k) => `<button type="button" data-sched-idea="${k}">${esc(x[1])}</button>`).join("")}</div>
      <form class="aio-card aio-form" id="schedForm">
        <div class="aio-grid2"><label class="aio-field"><span>الموظف</span><select name="employee">${opts("gm")}</select></label>
          <label class="aio-field"><span>العنوان</span><input name="title" required maxlength="120" placeholder="مثال: تقرير الصباح"></label></div>
        <label class="aio-field"><span>المطلوب في كل مرة</span><textarea name="request" required rows="3"></textarea></label>
        <div class="aio-grid2"><label class="aio-field"><span>التكرار</span><select name="freq">${Object.entries(FREQ).map(([k, t]) => `<option value="${k}">${t}</option>`).join("")}</select></label>
          <label class="aio-field"><span>الساعة (توقيت شيكاغو)</span><select name="at_hour">${hours(8)}</select></label>
          <label class="aio-field"><span>اليوم (للأسبوعي)</span><select name="weekday">${DAYS.map((d, k) => `<option value="${k}" ${k === 1 ? "selected" : ""}>${d}</option>`).join("")}</select></label>
          <label class="aio-field"><span>يوم الشهر (للشهري)</span><input name="monthday" type="number" min="1" max="28" value="1"></label></div>
        <label class="aio-field"><span>أرسل التقرير بالبريد إلى (اختياري)</span><input name="email_to" type="email" dir="ltr" placeholder="you@example.com"></label>
        <button class="btn btn--accent btn--sm" type="submit" style="justify-self:start">إضافة</button>
      </form>`;
  }

  function viewTeam() {
    const c = state.cfg || {};
    return `<h2 class="aio-h">التشغيل</h2>
      <div class="aio-card"><p>${c.configured ? `✓ الموظفون متصلون بـ Claude (<span dir="ltr">${esc(c.model)}</span>، مستوى التفكير: ${esc(c.effort)}).` : "✗ لم يُضف مفتاح Anthropic بعد."}
        ${c.email ? "<br>✓ إرسال البريد مفعّل." : "<br>✗ إرسال البريد غير مفعّل بعد (RESEND_API_KEY): الرسائل الموافق عليها لن تُرسل حتى يُفعَّل."}</p>
        ${c.configured ? "" : setupNote()}
        <p class="small muted">تكلفة التشغيل تُدفع لـ Anthropic حسب الاستخدام. يمكن تغيير النموذج بإضافة السر <code dir="ltr">AI_MODEL</code> (مثل claude-sonnet-5-5 الأقل تكلفة)، ومستوى التفكير بالسر <code dir="ltr">AI_EFFORT</code> (low / medium / high).</p></div>
      <h2 class="aio-h">الموظفون <small>غيّر الأسماء والمسميات، وأضف تعليماتك الخاصة لكل موظف</small></h2>
      <div class="aio-grid2">${state.staff.map((s) => `<form class="aio-card aio-form" data-staff="${s.code}">
        <div class="aio-row" style="cursor:default;grid-template-columns:auto 1fr auto">${av(s.code)}<b>${esc(s.title)}</b><label class="aio-switch"><input type="checkbox" name="enabled" ${s.enabled ? "checked" : ""} ${s.code === "gm" ? "disabled" : ""}> يعمل</label></div>
        <label class="aio-field"><span>الاسم</span><input name="name" value="${esc(s.name)}" maxlength="40"></label>
        <label class="aio-field"><span>المسمى الوظيفي</span><input name="title" value="${esc(s.title)}" maxlength="60"></label>
        <label class="aio-field"><span>تعليماتك لهذا الموظف</span><textarea name="instructions" rows="3" placeholder="مثال: اكتب دائماً بالعربية الرسمية، ووقّع باسم إدارة جرين ترافيل.">${esc(s.instructions)}</textarea></label>
        <button class="btn btn--ghost btn--sm" type="submit">حفظ</button></form>`).join("")}</div>
      <h2 class="aio-h">ذاكرة المكتب <small>معلومات يعرفها كل الموظفين: بيانات الشركة، تفضيلاتك، قراراتك</small></h2>
      <div class="aio-card">
        <form class="aio-form" id="memForm"><div class="aio-grid2"><label class="aio-field"><span>الموضوع</span><input name="topic" required maxlength="80" placeholder="مثال: ساعات العمل"></label>
          <label class="aio-field"><span>المعلومة</span><input name="note" required maxlength="1000" placeholder="مثال: من 9 صباحاً حتى 7 مساءً، السبت حتى 3 عصراً"></label></div>
          <button class="btn btn--ghost btn--sm" type="submit" style="justify-self:start">إضافة</button></form>
        ${state.memory.map((m) => `<div class="aio-mem"><span><b>${esc(m.topic)}</b>: ${esc(m.note)}${m.employee ? ` <small class="muted">(${esc(staffBy(m.employee).name)})</small>` : ""}</span><button type="button" class="aio-x-sm" data-del-mem="${m.id}" aria-label="حذف">×</button></div>`).join("") || `<p class="muted">لا توجد ملاحظات بعد.</p>`}
      </div>`;
  }

  /* ---------------- Panels ---------------- */
  function openPanel(fn) { state.panel = fn; $("#aioPanel").hidden = false; document.body.style.overflow = "hidden"; fn(); }
  function closePanel() { $$("#aioPanelBody [data-dirty]").forEach((x) => x.removeAttribute("data-dirty")); state.panel = null; $("#aioPanel").hidden = true; document.body.style.overflow = ""; }

  function timeline(j) {
    return `<ol class="aio-tl">${(j.steps || []).map((s) => `<li class="${esc(s.kind)}"><span>${esc(s.text)}</span><time>${time(s.at)}</time></li>`).join("")}${active(j) ? `<li class="note"><span>…</span><time></time></li>` : ""}</ol>`;
  }
  function openJob(id) {
    openPanel(() => {
      const j = state.jobs.find((x) => x.id === id);
      const body = $("#aioPanelBody");
      if (!j) { body.innerHTML = `<p class="aio-empty">غير موجود.</p>`; return; }
      if ((body.contains(document.activeElement) && /TEXTAREA|INPUT/.test(document.activeElement.tagName)) || $("[data-dirty]", body)) return; // owner is typing
      const kids = state.jobs.filter((k) => k.parent_id === j.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
      const ids = [j.id, ...kids.map((k) => k.id)];
      const docs = state.docs.filter((d) => ids.includes(d.job_id));
      const acts = state.actions.filter((a) => ids.includes(a.job_id));
      const s = staffBy(j.employee);
      body.innerHTML = `
        <div class="aio-row" style="cursor:default">${av(j.employee, j.status === "running")}<span><small>${esc(s.name)} · ${esc(s.title)} · ${fmt(j.created_at)}</small><h2>${esc(j.title)}</h2></span>${badge(j.status)}</div>
        <div class="aio-card"><b>الطلب</b><div class="aio-md">${md(j.request)}</div></div>
        <div class="aio-actions">
          ${active(j) ? `<button type="button" class="btn btn--ghost btn--sm" data-drive="${j.id}">تابِع التنفيذ</button><button type="button" class="btn btn--danger btn--sm" data-cancel="${j.id}">إيقاف</button>` : ""}
          ${["failed", "cancelled"].includes(j.status) ? `<button type="button" class="btn btn--accent btn--sm" data-retry="${j.id}">إعادة المحاولة</button>` : ""}
          ${!active(j) ? `<button type="button" class="btn btn--danger btn--sm" data-del-job="${j.id}">حذف</button>` : ""}
        </div>
        ${j.error && j.status !== "done" ? `<p class="aio-note">${esc(j.error)}</p>` : ""}
        ${j.result ? `<h3 class="aio-h">التقرير</h3><div class="aio-card aio-md">${md(j.result)}</div>
          <div class="aio-actions"><button type="button" class="btn btn--ghost btn--sm" data-print-job="${j.id}">طباعة / PDF</button><button type="button" class="btn btn--ghost btn--sm" data-copy-job="${j.id}">نسخ</button></div>` : ""}
        ${acts.length ? `<h3 class="aio-h">إجراءات تحتاج موافقتك</h3><div class="aio-list">${acts.map(actionCard).join("")}</div>` : ""}
        ${docs.length ? `<h3 class="aio-h">المستندات</h3><div class="aio-list">${docs.map((d) => `<button type="button" class="aio-card aio-row" data-doc="${d.id}">${av(d.employee)}<span><b>${esc(d.title)}</b><small>${esc(KIND[d.kind] || d.kind)} · ${esc(staffBy(d.employee).name)}</small></span><span class="aio-badge">فتح</span></button>`).join("")}</div>` : ""}
        <h3 class="aio-h">سير العمل</h3>
        <div class="aio-card">${timeline(j)}</div>
        ${kids.map((k) => `<div class="aio-card aio-child"><div class="aio-row" style="cursor:default">${av(k.employee, k.status === "running")}<span><b>${esc(staffBy(k.employee).name)}: ${esc(k.title)}</b><small>${esc(staffBy(k.employee).title)}</small></span>${badge(k.status)}</div>
          <details><summary class="small">التكليف وسير العمل${k.result ? " والتقرير" : ""}</summary><div class="aio-md small">${md(k.request)}</div>${timeline(k)}${k.result ? `<hr><div class="aio-md">${md(k.result)}</div>` : ""}</details></div>`).join("")}
        ${j.status === "done" ? `<form class="aio-card aio-form" id="followForm" data-job="${j.id}" style="margin-top:14px"><label class="aio-field"><span>تعليمات إضافية لـ ${esc(s.name)} على نفس العمل</span><textarea name="text" rows="3" required placeholder="مثال: أضف مقارنة بالشهر الماضي، وأرسل التقرير للمحاسب."></textarea></label><button class="btn btn--accent btn--sm" type="submit" style="justify-self:start">أرسل</button></form>` : ""}
        ${j.usage && j.usage.turns ? `<p class="small muted" style="margin-top:14px" dir="ltr">${j.usage.turns} steps · ${Math.round((j.usage.input || 0) / 1000)}k in · ${Math.round((j.usage.output || 0) / 1000)}k out</p>` : ""}`;
    });
  }

  function openDoc(id) {
    openPanel(() => {
      const d = state.docs.find((x) => x.id === id);
      const body = $("#aioPanelBody");
      if (!d) { body.innerHTML = `<p class="aio-empty">غير موجود.</p>`; return; }
      if (body.dataset.doc === id && body.dataset.mode === "edit") return;
      body.dataset.doc = id; body.dataset.mode = "view";
      body.innerHTML = `<div class="aio-row" style="cursor:default">${av(d.employee)}<span><small>${esc(KIND[d.kind] || d.kind)} · ${esc(staffBy(d.employee).name)} · ${fmt(d.created_at)}</small><h2>${esc(d.title)}</h2></span><span></span></div>
        <div class="aio-actions"><button type="button" class="btn btn--accent btn--sm" data-print-doc="${d.id}">طباعة / PDF</button><button type="button" class="btn btn--ghost btn--sm" data-word-doc="${d.id}">تنزيل Word</button><button type="button" class="btn btn--ghost btn--sm" data-copy-doc="${d.id}">نسخ النص</button><button type="button" class="btn btn--ghost btn--sm" data-edit-doc="${d.id}">تعديل</button><button type="button" class="btn btn--danger btn--sm" data-del-doc="${d.id}">حذف</button></div>
        <article class="aio-card aio-md" dir="auto">${md(d.body)}</article>`;
    });
  }

  // A printable page with the company letterhead
  function letterhead(title, html) {
    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap" rel="stylesheet">
      <style>body{font-family:"IBM Plex Sans Arabic",Tahoma,sans-serif;color:#0e1b14;margin:0;padding:28px 40px;line-height:1.9}
      header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #1f9d3a;padding-bottom:12px;margin-bottom:22px}
      header b{font-size:22px;color:#0f4227}header small{display:block;color:#435349;font-size:12px;direction:ltr;text-align:left}
      table{border-collapse:collapse;width:100%}th,td{border:1px solid #cfd8cf;padding:6px 9px;text-align:start}th{background:#f1faee}
      footer{margin-top:40px;border-top:1px solid #e1e8e1;padding-top:8px;font-size:11px;color:#7a8a80;text-align:center}
      @media print{body{padding:0 10mm}}</style></head><body>
      <header><div><b>جرين ترافيل Green Travel</b><div style="font-size:13px;color:#435349">طيران · فنادق · تأشيرات · عمرة</div></div>
      <small>greentravel.us · info@greentravel.us<br>+1 (708) 963-2552 · +1 (708) 940-2929<br>+1 (331) 213-3768 · +1 (708) 953-2244</small></header>
      <main dir="auto">${html}</main><footer>Green Travel · Chicago, IL · greentravel.us</footer></body></html>`;
  }
  function printHtml(title, mdText) {
    const w = window.open("", "_blank");
    if (!w) { toast("اسمح بالنوافذ المنبثقة للطباعة"); return; }
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
  const copy = (t) => navigator.clipboard.writeText(t).then(() => toast("نُسخ"), () => toast("تعذّر النسخ"));

  /* ---------------- Events ---------------- */
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-close],[data-emp],[data-idea],[data-job],[data-doc],[data-filter],[data-approve],[data-reject],[data-drive],[data-cancel],[data-retry],[data-del-job],[data-print-job],[data-copy-job],[data-print-doc],[data-word-doc],[data-copy-doc],[data-edit-doc],[data-del-doc],[data-del-mem],[data-save-doc],[data-run-sched],[data-toggle-sched],[data-del-sched],[data-sched-idea]");
    if (!t) return;
    const d = t.dataset;
    if ("close" in d) return closePanel();
    if (d.emp) { const s = staffBy(d.emp); if (!s.enabled) return toast("هذا الموظف متوقف، فعّله من الإعدادات"); location.hash = "#office"; setTimeout(() => { $("#cmdTo").value = d.emp; $("#cmdText").focus(); $("#cmdText").placeholder = `اكتب المهمة التي تريدها من ${s.name} (${s.title})…`; }, 50); return; }
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
        toast(d.approve ? r.result || "نُفّذ" : "رُفض");
        clean(); return load();
      }
      if (d.drive) { toast("يتابع التنفيذ…"); return drive(d.drive); }
      if (d.cancel) { await call("cancel", { id: d.cancel }); toast("أُوقف"); return load(); }
      if (d.retry) { await call("retry", { id: d.retry }); await load(); return drive(d.retry); }
      if (d.delJob) { if (!confirm("حذف هذا العمل وسجله؟ (المستندات تبقى)")) return; const { error } = await sb.from("ai_jobs").delete().eq("id", d.delJob); if (error) throw error; closePanel(); return load(); }
      if (d.printJob) { const j = state.jobs.find((x) => x.id === d.printJob); return printHtml(j.title, `# ${j.title}\n\n${j.result}`); }
      if (d.copyJob) return copy(state.jobs.find((x) => x.id === d.copyJob).result);
      if (d.printDoc) { const x = state.docs.find((y) => y.id === d.printDoc); return printHtml(x.title, x.body); }
      if (d.wordDoc) return wordDoc(state.docs.find((y) => y.id === d.wordDoc));
      if (d.copyDoc) return copy(state.docs.find((y) => y.id === d.copyDoc).body);
      if (d.editDoc) {
        const x = state.docs.find((y) => y.id === d.editDoc), body = $("#aioPanelBody");
        body.dataset.mode = "edit";
        body.innerHTML = `<h2>تعديل: ${esc(x.title)}</h2><div class="aio-form"><label class="aio-field"><span>العنوان</span><input id="edTitle" value="${esc(x.title)}"></label>
          <label class="aio-field"><span>النص (Markdown)</span><textarea id="edBody" rows="22" dir="auto">${esc(x.body)}</textarea></label>
          <div class="aio-actions"><button type="button" class="btn btn--accent btn--sm" data-save-doc="${x.id}">حفظ</button><button type="button" class="btn btn--ghost btn--sm" data-doc="${x.id}">إلغاء</button></div></div>`;
        return;
      }
      if (d.saveDoc) {
        const { error } = await sb.from("ai_documents").update({ title: $("#edTitle").value.trim() || "مستند", body: $("#edBody").value }).eq("id", d.saveDoc);
        if (error) throw error;
        $("#aioPanelBody").dataset.mode = "view"; toast("حُفظ"); await load(); return openDoc(d.saveDoc);
      }
      if (d.delDoc) { if (!confirm("حذف المستند؟")) return; const { error } = await sb.from("ai_documents").delete().eq("id", d.delDoc); if (error) throw error; closePanel(); return load(); }
      if (d.schedIdea) { const [c, ttl, fq, h, req] = SCHED_IDEAS[+d.schedIdea], f = $("#schedForm").elements; f.employee.value = c; f.title.value = ttl; f.freq.value = fq; f.at_hour.value = h; f.request.value = req; f.request.focus(); return; }
      if (d.runSched) { const { id } = await call("run_schedule", { id: d.runSched }); toast("بدأ التنفيذ"); await load(); openJob(id); return drive(id); }
      if (d.toggleSched) { const x = state.schedules.find((y) => y.id === d.toggleSched); const { error } = await sb.from("ai_schedules").update({ enabled: !x.enabled }).eq("id", x.id); if (error) throw error; return load(); }
      if (d.delSched) { if (!confirm("حذف هذه المهمة المجدولة؟")) return; const { error } = await sb.from("ai_schedules").delete().eq("id", d.delSched); if (error) throw error; return load(); }
      if (d.delMem) { const { error } = await sb.from("ai_memory").delete().eq("id", d.delMem); if (error) throw error; return load(); }
    } catch (er) { toast(er.message || String(er)); t.disabled = false; }
  });

  document.addEventListener("submit", async (e) => {
    const f = e.target;
    e.preventDefault();
    try {
      if (f.id === "cmdForm") {
        const text = $("#cmdText").value.trim();
        if (text.length < 3) return toast("اكتب الطلب");
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
      if (f.id === "schedForm") {
        const el = f.elements;
        const row = { employee: el.employee.value, title: el.title.value.trim(), request: el.request.value.trim(), freq: el.freq.value, at_hour: +el.at_hour.value, weekday: +el.weekday.value, monthday: Math.min(28, Math.max(1, +el.monthday.value || 1)), email_to: el.email_to.value.trim() || null };
        if (!row.title || !row.request) return toast("اكتب العنوان والمطلوب");
        const { error } = await sb.from("ai_schedules").insert(row);
        if (error) throw error;
        f.reset(); document.activeElement && document.activeElement.blur(); clean(); toast("أُضيفت المهمة المجدولة"); return load();
      }
      if (f.id === "memForm") {
        const { error } = await sb.from("ai_memory").insert({ topic: f.elements.topic.value.trim(), note: f.elements.note.value.trim() });
        if (error) throw error;
        f.reset(); document.activeElement && document.activeElement.blur(); toast("أُضيفت"); return load();
      }
      if (f.dataset.staff) {
        const el = f.elements, code = f.dataset.staff;
        const { error } = await sb.from("ai_staff").update({ name: el.name.value.trim() || staffBy(code).name, title: el.title.value.trim() || staffBy(code).title, instructions: el.instructions.value.trim(), enabled: code === "gm" ? true : el.enabled.checked }).eq("code", code);
        if (error) throw error;
        document.activeElement && document.activeElement.blur();
        clean(); toast("حُفظ"); return load();
      }
    } catch (er) { toast(er.message || String(er)); $$("button[type=submit]", f).forEach((b) => (b.disabled = false)); }
  });
  document.addEventListener("input", (e) => { if (e.target.matches("[data-f], [data-staff] *, #schedForm *")) e.target.dataset.dirty = "1"; });
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
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_schedules" }, () => reloadSoon()).subscribe();
    setInterval(() => { if (state.jobs.some(active)) reloadSoon(0); }, 5000);
    resumeOpen();
  }
  function showLogin(msg) { $("#aioApp").hidden = true; $("#aioLogin").hidden = false; $("#aioLoginStatus").textContent = msg || ""; }
  $("#aioLoginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const r = await DB.login($("#aioUser").value, $("#aioPass").value);
    if (!r) return showLogin("اسم المستخدم أو كلمة المرور غير صحيحة");
    if (r.error) return showLogin("الحساب موقوف");
    if (r.role !== "owner") { await DB.logout(); return showLogin("المكتب الإلكتروني متاح لحساب المالك فقط"); }
    start().catch((er) => toast(er.message));
  });
  DB.ready.then(() => {
    const p = DB.profile;
    if (p && p.kind === "owner" && p.status === "active") start().catch((er) => toast(er.message));
    else showLogin(p ? "المكتب الإلكتروني متاح لحساب المالك فقط" : "");
  });
})();
