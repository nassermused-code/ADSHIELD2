/* =========================================================
   Green Travel — "Manage my booking" (customer self-service)
   The customer enters the booking reference (or airline PNR) and their last name to:
   see the itinerary and tickets, cancel free of charge before ticketing,
   ask for a change, and print / save the itinerary. Opens on #manage.
   ========================================================= */
(() => {
  const $ = (s, c = document) => c.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const date = (iso) => (iso ? new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString(I18N.locale, { weekday: "short", day: "numeric", month: "long", year: "numeric" }) : "");
  const STATUS = () => ({ new: T("قيد المراجعة", "In review"), quoted: T("عرض سعر", "Quoted"), confirmed: T("محجوز، بانتظار الإصدار", "Booked, awaiting ticketing"), ticketed: T("صادرة", "Ticketed"), cancelled: T("ملغي", "Cancelled"), refunded: T("مسترد", "Refunded") });
  let modal, last = null, creds = null;

  function ensure() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "modal"; modal.id = "manageModal"; modal.hidden = true;
    modal.innerHTML = `<div class="modal__backdrop" data-close></div>
      <div class="modal__dialog modal__dialog--form" role="dialog" aria-modal="true" aria-labelledby="mgTitle">
        <button class="modal__close" data-close aria-label="${T("إغلاق", "Close")}">×</button>
        <div class="modal__icon"><svg class="i"><use href="#i-ticket"/></svg></div>
        <h3 id="mgTitle">${T("إدارة حجزي", "Manage my booking")}</h3>
        <p class="modal__note">${T("أدخل رقم الحجز (PNR) أو رقم المرجع من رسالة التأكيد، واسم العائلة كما في الجواز.", "Enter the booking reference (PNR) or the reference from your confirmation, and your last name as on the passport.")}</p>
        <form id="mgForm" class="form-row" novalidate>
          <div class="field"><label for="mgRef">${T("رقم الحجز أو المرجع", "Booking reference")}</label><input id="mgRef" dir="ltr" autocapitalize="characters" placeholder="ABC123 / GT-1001" required></div>
          <div class="field"><label for="mgLast">${T("اسم العائلة", "Last name")}</label><input id="mgLast" dir="ltr" autocapitalize="characters" required></div>
          <button type="submit" class="btn btn--accent btn--block">${T("عرض الحجز", "Find booking")}</button>
        </form>
        <p class="form-status err" id="mgStatus" role="status" aria-live="polite"></p>
        <div id="mgResult"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
    modal.addEventListener("keydown", (e) => e.key === "Escape" && close());
    $("#mgForm", modal).addEventListener("submit", async (e) => {
      e.preventDefault();
      const ref = $("#mgRef").value.trim(), ln = $("#mgLast").value.trim(), st = $("#mgStatus");
      st.textContent = "";
      if (!ref || !ln) { st.textContent = T("أدخل رقم الحجز واسم العائلة.", "Enter the booking reference and last name."); return; }
      const btn = e.submitter || $("#mgForm button"); btn.disabled = true;
      const r = await call("lookup", { ref, last: ln });
      btn.disabled = false;
      if (!r || !r.ok) { st.textContent = T("لم نجد حجزاً بهذه البيانات. تأكد من الرقم واسم العائلة، أو اتصل بنا.", "We couldn't find a booking with these details. Check them, or call us."); $("#mgResult").innerHTML = ""; return; }
      creds = { ref, last: ln }; last = r.booking; render();
    });
    return modal;
  }
  async function call(action, payload) {
    if (!window.GTDB || !window.GTDB.flightsApi) return null;
    try { return await window.GTDB.flightsApi(action, payload); } catch (e) { return { error: e.message }; }
  }
  function itinerary(b) {
    const segs = (b.segments || []).length ? b.segments : [{ from: (b.route || "").split("→")[0], to: (b.route || "").split("→")[1], date: b.depart }];
    return `<div class="mg-card">
      <div class="mg-head"><div><small>${T("رقم الحجز", "Booking ref")}</small><b dir="ltr">${esc(b.pnr || b.id)}</b></div><span class="pill pill--${esc(b.status)}">${STATUS()[b.status] || esc(b.status)}</span></div>
      <p class="mg-air">${esc(b.airline || "")}</p>
      <ul class="mg-segs">${segs.map((s) => `<li><b dir="ltr">${esc(s.flight || "")} ${esc(s.from)} → ${esc(s.to)}</b><span>${date(s.date)}${s.dep ? ` · <span dir="ltr">${esc(s.dep)}${s.arr ? " → " + esc(s.arr) : ""}</span>` : ""}</span></li>`).join("")}</ul>
      <p class="mg-pax">${T("المسافرون", "Travelers")}: ${esc((b.travelers || []).join("، "))}${(b.tickets || []).length ? `<br>${T("التذاكر", "Tickets")}: <span dir="ltr">${esc(b.tickets.join(", "))}</span>` : ""}${b.baggage ? `<br>${T("الأمتعة", "Baggage")}: ${esc(b.baggage)}` : ""}</p>
      <ul class="mg-policy">${(b.policy || []).map((p) => `<li>${esc(T(p[0], p[1]))}</li>`).join("")}</ul>
    </div>`;
  }
  function render() {
    const b = last;
    $("#mgResult").innerHTML = `${itinerary(b)}
      <div class="mg-actions">
        <button type="button" class="btn btn--ghost btn--sm" id="mgPrint">${T("طباعة / حفظ PDF", "Print / save PDF")}</button>
        ${b.canCancel ? `<button type="button" class="btn btn--ghost btn--sm danger" id="mgCancel">${T("إلغاء الحجز مجاناً", "Cancel booking (free)")}</button>` : b.status === "ticketed" ? `<button type="button" class="btn btn--ghost btn--sm" id="mgCancel">${T("طلب إلغاء التذكرة", "Request ticket cancellation")}</button>` : ""}
      </div>
      ${["cancelled", "refunded"].includes(b.status) ? "" : `<form id="mgChange" class="mg-change" novalidate><label for="mgMsg">${T("تريد تعديل الموعد أو الأسماء أو غيره؟ اكتب طلبك وسنتواصل معك.", "Want to change the date, names or anything else? Write your request and we'll contact you.")}</label>
        <textarea id="mgMsg" rows="2" placeholder="${T("مثال: تغيير موعد العودة إلى 20 ديسمبر", "e.g. move the return to December 20")}"></textarea>
        <button type="submit" class="btn btn--primary btn--sm">${T("إرسال طلب التعديل", "Send change request")}</button></form>`}
      <p class="form-status" id="mgDone" role="status" aria-live="polite"></p>`;
    $("#mgPrint").addEventListener("click", () => printIt(b));
    const c = $("#mgCancel");
    if (c) c.addEventListener("click", async () => {
      if (c.dataset.confirm !== "1") { c.dataset.confirm = "1"; c.textContent = T("اضغط مرة أخرى لتأكيد الإلغاء", "Press again to confirm"); return; }
      c.disabled = true;
      const r = await call("customer_cancel", creds);
      if (r && r.ok && r.cancelled) { last.status = "cancelled"; last.canCancel = false; render(); $("#mgDone").textContent = T("تم إلغاء حجزك بنجاح دون أي رسوم.", "Your booking was cancelled free of charge."); }
      else if (r && r.ok) { $("#mgDone").textContent = T("استلمنا طلب الإلغاء، وسيتواصل معك فريقنا خلال وقت قصير.", "We received your cancellation request; our team will contact you shortly."); c.disabled = true; }
      else { c.disabled = false; $("#mgDone").textContent = T("تعذّر الإلغاء الآن، اتصل بنا من فضلك.", "Couldn't cancel right now, please call us."); }
    });
    const f = $("#mgChange");
    if (f) f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = $("#mgMsg").value.trim();
      if (msg.length < 3) { $("#mgMsg").focus(); return; }
      const r = await call("change_request", Object.assign({ message: msg }, creds));
      $("#mgDone").textContent = r && r.ok ? T("وصل طلبك إلى فريقنا، وسنتواصل معك لتأكيد التعديل وأي فرق في السعر.", "Your request reached our team; we'll contact you to confirm the change and any fare difference.") : T("تعذّر الإرسال، اتصل بنا من فضلك.", "Couldn't send, please call us.");
      if (r && r.ok) f.reset();
    });
  }
  function printIt(b) {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!doctype html><html dir="${document.documentElement.dir}" lang="${document.documentElement.lang}"><head><meta charset="utf-8"><title>Green Travel · ${esc(b.pnr || b.id)}</title>
      <style>body{font-family:Arial,sans-serif;color:#10231a;max-width:720px;margin:24px auto;padding:0 16px}header{display:flex;gap:12px;align-items:center;border-bottom:2px solid #0b3d1f;padding-bottom:10px;margin-bottom:14px}
      header img{width:56px;height:56px}small{color:#5b6b60}.mg-head{display:flex;justify-content:space-between}.mg-head b{font-size:22px;display:block}ul{padding-inline-start:18px}li{margin-bottom:6px}.pill{border:1px solid #0b3d1f;border-radius:99px;padding:2px 10px;font-size:12px}</style></head>
      <body><header><img src="${location.origin}/assets/img/logo.png" alt=""><div><b>Green Travel · جرين ترافيل</b><br><small>info@greentravel.us · +1 (708) 963-2552 · +1 (708) 940-2929 · +1 (331) 213-3768 · +1 (708) 953-2244</small></div></header>
      ${itinerary(b)}</body></html>`);
    w.document.close(); setTimeout(() => { w.focus(); w.print(); }, 500);
  }
  function open() { ensure(); modal.hidden = false; document.body.style.overflow = "hidden"; setTimeout(() => $("#mgRef").focus(), 50); }
  function close() { if (!modal) return; modal.hidden = true; document.body.style.overflow = ""; if (location.hash === "#manage") history.replaceState(null, "", location.pathname + location.search); }
  const check = () => { if (location.hash === "#manage") open(); };
  window.addEventListener("hashchange", check);
  document.addEventListener("DOMContentLoaded", () => {
    document.addEventListener("click", (e) => { const a = e.target.closest('a[href="#manage"]'); if (a) { e.preventDefault(); open(); } });
    check();
  });
  window.GTManage = { open };
})();
