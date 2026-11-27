/* =========================================================
   Green Travel — shared data layer (Supabase)
   ---------------------------------------------------------
   One database for the whole system: the public website, the partner (B2B)
   portal and the back office. Security is enforced by the database itself
   (row-level security), not by this file:
     - website visitors can only submit a booking request
     - each B2B agent can only read their own account (via server functions
       that never return our cost or fee)
     - staff see only what the owner allowed; costs, profit, supplier
       payments, expenses and the activity log are owner-only
   The key below is the public "publishable" key: it is safe in the browser.
   ========================================================= */
window.GTDB = (() => {
  const SUPABASE_URL = "https://qlhtjnhuhkaapzufxvzd.supabase.co";
  const SUPABASE_KEY = "sb_publishable_PrkHG8g2bQBZvjDXNLsL_Q_gP1H09Wg";
  const STAFF_DOMAIN = "staff.greentravel.us"; // staff sign in with a username; this turns it into their login id
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, storageKey: "gt-auth", autoRefreshToken: true } });

  const cache = { staff: [], partners: [], bookings: [], payments: [], expenses: [], tasks: [], log: [], journal: [],
    companies: [], costCenters: [], travelers: [], policies: [], trips: [], invoices: [], companyUsers: [] };
  // The company's own details (letterhead of invoices, tickets and emails); defaults until loaded
  const COMPANY_DEFAULT = { tradeName: "Green Travel", tradeNameAr: "جرين ترافيل", legalName: "World Services dba Green Travel", address: "", city: "Chicago", state: "IL", zip: "", country: "United States",
    phones: ["+1 (708) 963-2552", "+1 (708) 940-2929", "+1 (331) 213-3768", "+1 (708) 953-2244"], email: "info@greentravel.us", website: "greentravel.us", taxId: "", iata: "", sellerOfTravel: "",
    invoiceTerms: "Payment is due on receipt unless agreed otherwise. All bookings are subject to the airline's fare rules.", paymentInfo: "" };
  let company = Object.assign({}, COMPANY_DEFAULT);
  // snake_case row -> camelCase object (TMC tables)
  const camel = (r) => Object.fromEntries(Object.entries(r || {}).map(([k, v]) => [k.replace(/_([a-z])/g, (m, c) => c.toUpperCase()), v]));
  const listeners = [];
  let profile = null;
  const notify = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  const fail = (error) => { if (error) throw new Error(error.message || String(error)); };

  /* ---------- Row <-> app object ---------- */
  const mapStaff = (r) => ({ id: r.id, kind: r.kind, role: r.kind, username: r.username || "", email: r.email || "", name: r.name, title: r.title, phone: r.phone, status: r.status, perms: r.perms || [], lastLogin: r.last_login, created: (r.created_at || "").slice(0, 10) });
  const mapPricing = (p) => (p ? { mode: p.mode, flatAll: +p.flat_all, pctAll: +p.pct_all, flat: +p.flat, threshold: +p.threshold, pct: +p.pct, publicMarkup: +p.public_markup } : {});
  const mapPartner = (r, pr) => ({ id: r.id, email: r.email, agency: r.agency, contact: r.contact, phone: r.phone, contactEmail: r.contact_email, website: r.website, logo: r.logo, sellMarkup: +r.sell_markup, status: r.status, creditLimit: +r.credit_limit, created: (r.created_at || "").slice(0, 10), pricing: mapPricing(pr) });
  const mapBooking = (r, c) => ({ id: r.id, created: r.created, source: r.source, partnerId: r.partner_id, status: r.status, customer: Object.assign({ name: "", phone: "", email: "" }, r.customer || {}), route: r.route, airline: r.airline, cabin: r.cabin, depart: r.depart || "", ret: r.ret || "", pax: r.pax, travelers: r.travelers || [], pnr: r.pnr, tickets: r.tickets || [], sell: +r.sell, notes: r.notes, assignedTo: r.assigned_to || "", cost: c ? +c.cost : 0, fee: c ? +c.fee : 0, segments: r.segments || [], baggage: r.baggage || "", ticketedAt: r.ticketed_at || "", reminders: r.reminders || {}, provider: r.provider || "", providerRef: r.provider_ref || "", holdExpires: r.hold_expires || "",
    companyId: r.company_id || "", travelerId: r.traveler_id || "", costCenterId: r.cost_center_id || "", tripId: r.trip_id || "", invoiceId: r.invoice_id || "", serviceFee: +r.service_fee || 0, passports: Array.isArray(r.passports) ? r.passports : [] });
  const bookingRow = (b) => {
    const r = {};
    const m = { status: "status", source: "source", partnerId: "partner_id", customer: "customer", route: "route", airline: "airline", cabin: "cabin", depart: "depart", ret: "ret", pax: "pax", travelers: "travelers", pnr: "pnr", tickets: "tickets", sell: "sell", notes: "notes", assignedTo: "assigned_to", segments: "segments", baggage: "baggage",
      companyId: "company_id", travelerId: "traveler_id", costCenterId: "cost_center_id", tripId: "trip_id", serviceFee: "service_fee", passports: "passports" };
    Object.entries(m).forEach(([k, col]) => { if (k in b) r[col] = b[k]; });
    if ("depart" in r) r.depart = r.depart || null;
    if ("ret" in r) r.ret = r.ret || null;
    if ("assigned_to" in r) r.assigned_to = r.assigned_to || null;
    if ("partner_id" in r) r.partner_id = r.partner_id || null;
    ["company_id", "traveler_id", "cost_center_id"].forEach((k) => { if (k in r) r[k] = r[k] || null; });
    return r;
  };
  const mapPayment = (r) => ({ id: r.id, date: r.date, dir: r.dir, amount: +r.amount, method: r.method, bookingId: r.booking_id, partnerId: r.partner_id, companyId: r.company_id || "", invoiceId: r.invoice_id || "", ref: r.ref, note: r.note, by: r.created_by });
  const mapExpense = (r) => ({ id: r.id, date: r.date, category: r.category, amount: +r.amount, note: r.note, method: r.method || "bank" });
  const mapJournal = (r) => ({ id: r.id, date: r.date, memo: r.memo, lines: (r.lines || []).map((l) => ({ account: String(l.account), debit: +l.debit || 0, credit: +l.credit || 0, note: l.note || "" })) });
  const mapTask = (r) => ({ id: r.id, title: r.title, details: r.details, assignee: r.assignee, due: r.due || "", priority: r.priority, status: r.status, bookingId: r.booking_id, created: r.created, createdBy: r.created_by, doneAt: r.done_at || "" });

  /* ---------- Two-step verification (authenticator app) ----------
     Owner and staff accounts must pass a second step: a 6-digit code from an app such as
     Google Authenticator or Microsoft Authenticator. The database enforces it too:
     once an account has the app linked, nothing is readable without the code. */
  const TT = (ar, en) => (window.T ? window.T(ar, en) : en);
  async function mfaNeed() {
    if (!profile || !["owner", "staff"].includes(profile.kind)) return null;
    const { data, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data || data.currentLevel === "aal2") return null;
    return data.nextLevel === "aal2" ? "verify" : "setup";
  }
  function mfaDialog(mode) {
    return new Promise((resolve) => {
      const wrap = document.createElement("div");
      wrap.className = "gt-mfa"; wrap.setAttribute("role", "dialog"); wrap.setAttribute("aria-modal", "true");
      wrap.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(3,20,12,.72);display:grid;place-items:center;padding:16px;overflow:auto";
      const card = document.createElement("form");
      card.noValidate = true;
      card.style.cssText = "background:#fff;color:#10231a;border-radius:18px;max-width:420px;width:100%;padding:24px;display:grid;gap:12px;box-shadow:0 20px 60px rgba(0,0,0,.35);font:inherit";
      const inp = "font:inherit;font-size:1.4rem;letter-spacing:.35em;text-align:center;padding:.55em;border:1px solid #c9d6ce;border-radius:12px;width:100%;box-sizing:border-box";
      card.innerHTML = `<h2 style="margin:0;font-size:1.25rem">🔐 ${TT("التحقق بخطوتين", "Two-step verification")}</h2>
        <div data-body style="display:grid;gap:10px"><p style="margin:0">${TT("جارٍ التحضير…", "Getting ready…")}</p></div>
        <label style="display:grid;gap:6px"><span data-label style="font-weight:600"></span><input data-code inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" dir="ltr" style="${inp}" required></label>
        <p data-err role="status" aria-live="polite" style="margin:0;color:#b42318;min-height:1.2em"></p>
        <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="submit" class="btn btn--accent">${TT("تأكيد", "Confirm")}</button><button type="button" data-cancel class="btn btn--ghost">${TT("إلغاء وتسجيل الخروج", "Cancel and sign out")}</button></div>`;
      wrap.appendChild(card);
      document.body.appendChild(wrap);
      const $q = (sel) => card.querySelector(sel);
      const err = (m) => { $q("[data-err]").textContent = m || ""; };
      const done = (ok) => { wrap.remove(); resolve(ok); };
      let factorId = null;
      $q("[data-cancel]").addEventListener("click", () => done(false));
      (async () => {
        try {
          const { data: list } = await sb.auth.mfa.listFactors();
          if (mode === "verify") {
            const f = ((list && list.totp) || []).find((x) => x.status === "verified");
            if (!f) throw new Error("no factor");
            factorId = f.id;
            $q("[data-body]").innerHTML = `<p style="margin:0">${TT("افتح تطبيق المصادقة على جوالك واكتب الرمز المكوّن من 6 أرقام لحساب Green Travel.", "Open the authenticator app on your phone and enter the 6-digit code for Green Travel.")}</p>`;
          } else {
            // Remove any half-finished setup, then start a new one
            for (const f of ((list && list.all) || []).filter((x) => x.status !== "verified")) await sb.auth.mfa.unenroll({ factorId: f.id });
            const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "Green Travel " + new Date().toISOString().slice(0, 16) });
            if (error) throw error;
            factorId = data.id;
            const qr = document.createElement("img");
            const raw = String(data.totp.qr_code || ""), comma = raw.indexOf(",");
            qr.src = raw.startsWith("data:image/svg+xml") && comma > 0 && !/;base64,/.test(raw) ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(decodeURIComponent(raw.slice(comma + 1))) : raw; qr.alt = TT("رمز QR للربط", "QR code to link the app"); qr.width = 180; qr.height = 180;
            qr.style.cssText = "justify-self:center;background:#fff;border:1px solid #e3ebe6;border-radius:12px;padding:6px";
            const body = $q("[data-body]");
            body.innerHTML = `<p style="margin:0">${TT("لحماية بيانات العملاء، حسابك يحتاج خطوة ثانية عند الدخول. مرة واحدة فقط:", "To protect customer data, your account needs a second step at sign-in. One-time setup:")}</p>
              <ol style="margin:0;padding-inline-start:1.4em;display:grid;gap:4px;list-style:decimal">
                <li>${TT("ثبّت تطبيق Google Authenticator أو Microsoft Authenticator على جوالك.", "Install Google Authenticator or Microsoft Authenticator on your phone.")}</li>
                <li>${TT("في التطبيق اختر «إضافة» ثم «مسح رمز QR» وامسح هذا الرمز.", "In the app choose Add, then Scan a QR code, and scan this code.")}</li>
                <li>${TT("اكتب الرمز المكوّن من 6 أرقام الذي يظهر في التطبيق.", "Enter the 6-digit code the app shows.")}</li></ol>`;
            body.appendChild(qr);
            const sec = document.createElement("p");
            sec.style.cssText = "margin:0;font-size:.85rem;color:#4a5c52;word-break:break-all";
            sec.textContent = TT("لا تستطيع المسح؟ أدخل هذا المفتاح يدوياً: ", "Can't scan? Enter this key by hand: ") + data.totp.secret;
            body.appendChild(sec);
          }
          $q("[data-label]").textContent = TT("الرمز من التطبيق", "Code from the app");
          $q("[data-code]").focus();
        } catch (e) { err(TT("تعذّر بدء التحقق. حدّث الصفحة وحاول مرة أخرى.", "Could not start verification. Reload the page and try again.")); }
      })();
      card.addEventListener("submit", async (e) => {
        e.preventDefault();
        const code = $q("[data-code]").value.replace(/\D/g, "");
        if (code.length !== 6 || !factorId) return err(TT("اكتب الرمز المكوّن من 6 أرقام.", "Enter the 6-digit code."));
        const btn = $q("[type=submit]"); btn.disabled = true; err("");
        const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code });
        btn.disabled = false;
        if (error) { $q("[data-code]").value = ""; $q("[data-code]").focus(); return err(TT("الرمز غير صحيح أو انتهت مدته. جرّب الرمز الجديد.", "Wrong or expired code. Try the new code.")); }
        done(true);
      });
    });
  }
  // Ask for the second step when needed; false = the person cancelled (they are signed out)
  async function mfaGate() {
    const need = await mfaNeed();
    if (!need) return true;
    if (await mfaDialog(need)) return true;
    await sb.auth.signOut();
    profile = null;
    return false;
  }

  /* ---------- Forgot password (every account) ----------
     Step 1: username or email → a 6-digit code goes to the email on the account.
     Step 2: code + new password. Staff without an email: the owner gets a task to reset it. */
  function forgotDialog(prefill) {
    const wrap = document.createElement("div");
    wrap.className = "gt-mfa gt-forgot"; wrap.setAttribute("role", "dialog"); wrap.setAttribute("aria-modal", "true");
    wrap.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(3,20,12,.72);display:grid;place-items:center;padding:16px;overflow:auto";
    const card = document.createElement("form");
    card.noValidate = true;
    card.style.cssText = "background:#fff;color:#10231a;border-radius:18px;max-width:420px;width:100%;padding:24px;display:grid;gap:12px;box-shadow:0 20px 60px rgba(0,0,0,.35);font:inherit";
    const field = "font:inherit;padding:.65em .8em;border:1px solid #c9d6ce;border-radius:12px;width:100%;box-sizing:border-box";
    const lbl = (t, inner) => `<label style="display:grid;gap:6px"><span style="font-weight:600">${t}</span>${inner}</label>`;
    card.innerHTML = `<h2 style="margin:0;font-size:1.25rem">🔑 ${TT("نسيت كلمة المرور", "Forgot password")}</h2>
      <div data-s1 style="display:grid;gap:12px">
        <p style="margin:0">${TT("اكتب اسم المستخدم أو البريد. نرسل رمزاً من 6 أرقام إلى البريد المسجل في حسابك.", "Enter your username or email. We'll send a 6-digit code to the email on your account.")}</p>
        ${lbl(TT("اسم المستخدم أو البريد", "Username or email"), `<input data-login dir="ltr" autocomplete="username" autocapitalize="none" style="${field}">`)}
      </div>
      <div data-s2 hidden style="display:grid;gap:12px">
        <p data-sent style="margin:0"></p>
        ${lbl(TT("الرمز من البريد", "Code from the email"), `<input data-code inputmode="numeric" autocomplete="one-time-code" maxlength="6" dir="ltr" style="${field};font-size:1.3rem;letter-spacing:.3em;text-align:center">`)}
        ${lbl(TT("كلمة المرور الجديدة (8 أحرف على الأقل)", "New password (8+ characters)"), `<input data-p1 type="password" dir="ltr" autocomplete="new-password" style="${field}">`)}
        ${lbl(TT("أعد كتابة كلمة المرور", "Repeat the password"), `<input data-p2 type="password" dir="ltr" autocomplete="new-password" style="${field}">`)}
      </div>
      <p data-err role="status" aria-live="polite" style="margin:0;color:#b42318;min-height:1.2em"></p>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="submit" class="btn btn--accent">${TT("أرسل الرمز", "Send the code")}</button><button type="button" data-cancel class="btn btn--ghost">${TT("إغلاق", "Close")}</button></div>`;
    wrap.appendChild(card);
    document.body.appendChild(wrap);
    const $q = (sel) => card.querySelector(sel);
    const err = (m, ok) => { const e = $q("[data-err]"); e.style.color = ok ? "#1b6b3a" : "#b42318"; e.textContent = m || ""; };
    const close = () => wrap.remove();
    $q("[data-cancel]").addEventListener("click", close);
    wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    $q("[data-login]").value = prefill || "";
    setTimeout(() => $q(prefill ? "[type=submit]" : "[data-login]").focus(), 30);
    let step = 1;
    const call = async (body) => {
      const { data, error } = await sb.functions.invoke("password-reset", { body });
      if (error) { let msg = error.message; try { const j = await error.context.json(); msg = j.error || msg; } catch (e) {} throw new Error(msg); }
      if (data && data.error) throw new Error(data.error);
      return data;
    };
    card.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $q("[type=submit]"); err("");
      const login = $q("[data-login]").value.trim();
      if (step === 1) {
        if (login.length < 3) return err(TT("اكتب اسم المستخدم أو البريد.", "Enter your username or email."));
        btn.disabled = true;
        try { await call({ action: "request", login }); } catch (er) { btn.disabled = false; return err(TT("تعذّر الإرسال الآن. حاول بعد قليل.", "Could not send now. Try again shortly.")); }
        btn.disabled = false; step = 2;
        $q("[data-s1]").hidden = true; $q("[data-s2]").hidden = false;
        $q("[data-sent]").textContent = TT("إذا كان الحساب موجوداً وله بريد مسجل، فقد أرسلنا إليه رمزاً صالحاً 15 دقيقة. لا يصلك شيء؟ الموظف: اطلب من المالك تغيير كلمة مرورك (وصله طلبك كمهمة). الوكيل أو الشركة: تواصل معنا.", "If the account exists and has an email on file, we sent it a code valid for 15 minutes. Nothing arrived? Staff: ask the owner to set a new password (your request reached them as a task). Agents and companies: contact us.");
        btn.textContent = TT("تغيير كلمة المرور", "Change password");
        $q("[data-code]").focus();
        return;
      }
      const code = $q("[data-code]").value.replace(/\D/g, ""), p1 = $q("[data-p1]").value, p2 = $q("[data-p2]").value;
      if (code.length !== 6) return err(TT("اكتب الرمز المكوّن من 6 أرقام.", "Enter the 6-digit code."));
      if (p1.length < 8) return err(TT("كلمة المرور 8 أحرف على الأقل.", "The password needs 8+ characters."));
      if (p1 !== p2) return err(TT("كلمتا المرور غير متطابقتين.", "The passwords do not match."));
      btn.disabled = true;
      try { await call({ action: "reset", login, code, password: p1 }); }
      catch (er) { btn.disabled = false; return err(/Wrong or expired/.test(er.message) ? TT("الرمز غير صحيح أو انتهت مدته.", "Wrong or expired code.") : er.message); }
      card.querySelectorAll("input").forEach((i) => (i.value = ""));
      $q("[data-s2]").hidden = true; btn.hidden = true; $q("[data-cancel]").textContent = TT("تسجيل الدخول", "Sign in");
      err(TT("تم تغيير كلمة المرور. سجّل الدخول بكلمة المرور الجديدة.", "Your password was changed. Sign in with the new password."), true);
    });
  }
  // Any "Forgot password?" link on a sign-in form opens the dialog, with what was typed as the username
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-forgot]");
    if (!b) return;
    e.preventDefault();
    const form = b.closest("form"), first = form && form.querySelector("input:not([type=password]):not([type=hidden])");
    forgotDialog(first ? first.value.trim() : "");
  });

  /* ---------- Load everything this user may see ---------- */
  async function loadProfile() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { profile = null; return null; }
    const { data } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
    profile = data ? mapStaff(data) : null;
    return profile;
  }
  async function load() {
    Object.keys(cache).forEach((k) => (cache[k] = []));
    if (!profile || profile.kind === "partner" || profile.status !== "active") { notify(); return; }
    const owner = profile.kind === "owner";
    const q = (t, sel = "*") => sb.from(t).select(sel).range(0, 9999);
    sb.from("company_profile").select("*").eq("id", 1).maybeSingle().then(({ data }) => { if (data) { company = Object.assign({}, COMPANY_DEFAULT, camel(data)); delete company.id; notify(); } }, () => {});
    const [st, pa, bk, pay, tk, costs, pricing, exp, lg, jr] = await Promise.all([
      q("profiles").in("kind", ["owner", "staff"]).order("created_at"),
      q("partners").order("agency"),
      q("bookings").order("created_at", { ascending: false }),
      q("payments").order("date", { ascending: false }),
      q("tasks").order("created", { ascending: false }),
      owner ? q("booking_costs") : { data: [] },
      owner ? q("partner_pricing") : { data: [] },
      owner ? q("expenses").order("date", { ascending: false }) : { data: [] },
      owner ? sb.from("activity_log").select("*").order("at", { ascending: false }).limit(300) : { data: [] },
      owner ? q("journal_entries").order("date", { ascending: false }) : { data: [] },
    ]);
    // Corporate travel (TMC): only for the owner and staff with the "corporate" permission
    const corp = owner || (profile.perms || []).includes("corporate");
    const [co, cc, tv, po, tr, iv, cu] = corp ? await Promise.all([
      q("companies").order("name"), q("cost_centers").order("name"), q("travelers").order("last_name"), q("travel_policies"),
      q("trip_requests").order("created_at", { ascending: false }), q("company_invoices").order("issued", { ascending: false }), q("company_users"),
    ]) : [{}, {}, {}, {}, {}, {}, {}];
    cache.companies = (co.data || []).map(camel); cache.costCenters = (cc.data || []).map(camel); cache.travelers = (tv.data || []).map(camel);
    cache.policies = (po.data || []).map((x) => Object.assign(camel(x), { id: x.company_id })); cache.trips = (tr.data || []).map(camel);
    cache.invoices = (iv.data || []).map(camel); cache.companyUsers = (cu.data || []).map((x) => Object.assign(camel(x), { id: x.user_id }));
    const costBy = new Map((costs.data || []).map((c) => [c.booking_id, c]));
    const priceBy = new Map((pricing.data || []).map((p) => [p.partner_id, p]));
    cache.staff = (st.data || []).map(mapStaff);
    cache.partners = (pa.data || []).map((r) => mapPartner(r, priceBy.get(r.id)));
    cache.bookings = (bk.data || []).map((r) => mapBooking(r, costBy.get(r.id)));
    cache.payments = (pay.data || []).map(mapPayment);
    cache.tasks = (tk.data || []).map(mapTask);
    cache.expenses = (exp.data || []).map(mapExpense);
    cache.journal = (jr.data || []).map(mapJournal);
    cache.log = (lg.data || []).map((r) => ({ at: r.at, who: r.who, action: r.action, ref: r.ref }));
    const me = cache.staff.find((s) => s.id === profile.id);
    if (me) profile = me;
    notify();
  }
  // Live updates: when anyone changes something, refresh (debounced)
  let channel = null, timer = null;
  function subscribe() {
    if (channel || !profile || profile.kind === "partner") return;
    channel = sb.channel("gt-live").on("postgres_changes", { event: "*", schema: "public" }, () => { clearTimeout(timer); timer = setTimeout(() => load().catch(() => {}), 500); }).subscribe();
  }
  const ready = (async () => {
    try { await loadProfile(); if (!document.querySelector("#ofLogin, #aioLogin") || await mfaGate()) { await load(); subscribe(); } else notify(); } catch (e) { console.error(e); }
  })();

  const api = {
    client: sb,
    ready,
    get profile() { return profile; },
    get company() { return company; },
    // Owner: save the company's details (letterhead)
    async saveCompany(c) {
      const row = { trade_name: c.tradeName, trade_name_ar: c.tradeNameAr, legal_name: c.legalName, address: c.address, city: c.city, state: c.state, zip: c.zip, country: c.country,
        phones: c.phones, email: c.email, website: c.website, tax_id: c.taxId, iata: c.iata, seller_of_travel: c.sellerOfTravel, invoice_terms: c.invoiceTerms, payment_info: c.paymentInfo, updated_at: new Date().toISOString() };
      const { data, error } = await sb.from("company_profile").update(row).eq("id", 1).select().single();
      fail(error);
      company = Object.assign({}, COMPANY_DEFAULT, camel(data)); delete company.id;
      notify();
      return company;
    },
    reload: () => load(),
    all: (col) => cache[col] || [],
    get: (col, id) => (cache[col] || []).find((x) => x.id === id || (id && x.email === id)) || null,
    onChange(fn) { listeners.push(fn); },
    hasDemo: () => false,

    /* ---------- Auth ---------- */
    async login(identifier, password) {
      identifier = String(identifier || "").trim().toLowerCase();
      const email = identifier.includes("@") ? identifier : `${identifier}@${STAFF_DOMAIN}`;
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) return /banned/i.test(error.message) ? { error: "inactive" } : null;
      await loadProfile();
      if (!profile) { await sb.auth.signOut(); return null; }
      if (profile.status !== "active") { await sb.auth.signOut(); profile = null; return { error: "inactive" }; }
      if (profile.kind === "company") return { kind: "company", id: profile.id, name: profile.name, email: profile.email };
      // The company portal only tells owner/staff to use the back office, so no second step there
      if (profile.kind !== "company" && !document.getElementById("cpLogin") && !(await mfaGate())) return { error: "mfa" };
      sb.rpc("touch_login").then(() => {}, () => {});
      await load();
      subscribe();
      return { kind: profile.kind === "partner" ? "partner" : "staff", id: profile.id, role: profile.kind, email: profile.email, name: profile.name };
    },
    async logout() {
      await sb.auth.signOut();
      profile = null;
      if (channel) { sb.removeChannel(channel); channel = null; }
      Object.keys(cache).forEach((k) => (cache[k] = []));
      notify();
    },
    hasOwner: async () => { const { data } = await sb.rpc("has_owner"); return !!data; },
    // Server-side account management (create/edit staff and agent logins)
    async admin(action, payload) {
      const { data, error } = await sb.functions.invoke("admin-users", { body: Object.assign({ action }, payload) });
      if (error) {
        let msg = error.message;
        try { const j = await error.context.json(); msg = j.error || msg; } catch (e) {}
        throw new Error(msg);
      }
      if (data && data.error) throw new Error(data.error);
      if (action !== "bootstrap") await load();
      return data;
    },

    /* ---------- Writes ---------- */
    async insert(col, obj) {
      let res;
      if (col === "tasks") res = await sb.from("tasks").insert({ title: obj.title, details: obj.details || "", assignee: obj.assignee || null, due: obj.due || null, priority: obj.priority || "normal", status: obj.status || "open", booking_id: obj.bookingId || "" }).select().single();
      else if (col === "expenses") res = await sb.from("expenses").insert({ date: obj.date, category: obj.category, amount: obj.amount, note: obj.note || "", method: obj.method || "bank" }).select().single();
      else if (col === "journal") res = await sb.from("journal_entries").insert({ date: obj.date, memo: obj.memo || "", lines: obj.lines }).select().single();
      else if (col === "payments") res = await sb.from("payments").insert({ date: obj.date, dir: obj.dir, amount: obj.amount, method: obj.method, booking_id: obj.bookingId || null, partner_id: obj.partnerId || null, company_id: obj.companyId || null, invoice_id: obj.invoiceId || "", ref: obj.ref || "", note: obj.note || "" }).select().single();
      else throw new Error("insert " + col);
      fail(res.error);
      const item = { tasks: mapTask, expenses: mapExpense, payments: mapPayment, journal: mapJournal }[col](res.data);
      cache[col].unshift(item);
      notify();
      return item;
    },
    async update(col, id, patch) {
      if (col === "bookings") {
        const row = bookingRow(patch);
        if (Object.keys(row).length) fail((await sb.from("bookings").update(row).eq("id", id)).error);
        if (profile && profile.kind === "owner" && ("cost" in patch || "fee" in patch)) {
          const cur = api.get("bookings", id) || {};
          fail((await sb.from("booking_costs").upsert({ booking_id: id, cost: "cost" in patch ? patch.cost : cur.cost || 0, fee: "fee" in patch ? patch.fee : cur.fee || 0 })).error);
        }
      } else if (col === "tasks") {
        const r = {};
        ["title", "details", "assignee", "priority", "status"].forEach((k) => k in patch && (r[k] = patch[k]));
        if ("due" in patch) r.due = patch.due || null;
        if ("bookingId" in patch) r.booking_id = patch.bookingId || "";
        fail((await sb.from("tasks").update(r).eq("id", id)).error);
      } else if (col === "partners" && "pricing" in patch) {
        const p = patch.pricing || {};
        fail((await sb.from("partner_pricing").upsert({ partner_id: id, mode: p.mode || "hybrid", flat_all: p.flatAll ?? 20, pct_all: p.pctAll ?? 0.02, flat: p.flat ?? 20, threshold: p.threshold ?? 1000, pct: p.pct ?? 0.02, public_markup: p.publicMarkup ?? 0.08 })).error);
      } else throw new Error("update " + col);
      await load();
      return api.get(col, id);
    },
    async remove(col, id) {
      const table = { bookings: "bookings", payments: "payments", expenses: "expenses", tasks: "tasks", journal: "journal_entries" }[col];
      if (!table) throw new Error("remove " + col);
      fail((await sb.from(table).delete().eq("id", id)).error);
      cache[col] = cache[col].filter((x) => x.id !== id);
      notify();
    },
    async addBooking(b) {
      const row = bookingRow(Object.assign({ status: "new", source: "office", customer: { name: "", phone: "", email: "" }, cabin: "economy", pax: 1, travelers: [], tickets: [], pnr: "", sell: 0, notes: "" }, b));
      const { data, error } = await sb.from("bookings").insert(row).select().single();
      fail(error);
      if (profile && profile.kind === "owner" && (b.cost || b.fee)) await sb.from("booking_costs").upsert({ booking_id: data.id, cost: b.cost || 0, fee: b.fee || 0 });
      await load();
      return api.get("bookings", data.id) || mapBooking(data);
    },
    async toggleTask(id) { const { data, error } = await sb.rpc("toggle_task", { p_id: id }); fail(error); await load(); return data; },
    // Email a ticket ("ticket") or a reminder ("week" / "day") to the customer. Throws "email_not_configured" until the email service is set up.
    async sendEmail(kind, bookingId, to, extra) {
      const { data, error } = await sb.functions.invoke("send-email", { body: Object.assign({ kind, bookingId, to: to || undefined }, extra || {}) });
      if (error) {
        let msg = error.message;
        try { const j = await error.context.json(); msg = j.error || msg; } catch (e) {}
        throw new Error(msg);
      }
      if (data && data.error) throw new Error(data.error);
      await load();
      return data;
    },
    // Live fares and bookings through the connected providers (Travelport, Amadeus, Duffel...) — see supabase/functions/flights
    async flightsApi(action, payload) {
      const { data, error } = await sb.functions.invoke("flights", { body: Object.assign({ action }, payload) });
      if (error) {
        let msg = error.message;
        try { const j = await error.context.json(); msg = j.error || msg; } catch (e) {}
        throw new Error(msg);
      }
      return data;
    },
    // TMC rows are written with their database column names (snake_case); the cache is refreshed afterwards
    async saveRow(table, row, key = "id") {
      const id = row[key];
      const res = id ? await sb.from(table).update(row).eq(key, id).select().maybeSingle() : await sb.from(table).insert(row).select().single();
      fail(res.error);
      await load();
      return res.data;
    },
    async upsertRow(table, row) { fail((await sb.from(table).upsert(row)).error); await load(); },
    async deleteRow(table, id, key = "id") { fail((await sb.from(table).delete().eq(key, id)).error); await load(); },
    async rpc(name, args) { const { data, error } = await sb.rpc(name, args || {}); fail(error); return data; },
    log(action, ref) { sb.rpc("log_action", { p_action: String(action || ""), p_ref: String(ref || "") }).then(() => {}, () => {}); },

    /* ---------- Public website ---------- */
    async websiteBooking(p) { const { data, error } = await sb.rpc("submit_website_booking", { p }); fail(error); return data; },

    /* ---------- Partner portal (server computes prices; never returns our cost or fee) ---------- */
    async partnerRow(pid) { const { data, error } = await sb.from("partners").select("*").eq("id", pid).maybeSingle(); fail(error); return data ? mapPartner(data) : null; },
    async partnerPrices(pubs, pid) { const { data, error } = await sb.rpc("partner_prices", { p_pubs: pubs, p_partner: pid || null }); fail(error); return data || []; },
    async partnerRequest(p, pid) { const { data, error } = await sb.rpc("partner_request_ticket", { p, p_partner: pid || null }); fail(error); return data; },
    async partnerAccount(pid) { const { data, error } = await sb.rpc("partner_account", { p_partner: pid || null }); fail(error); return data; },
    async updatePartnerProfile(p, pid) { const { error } = await sb.rpc("update_partner_profile", { p, p_partner: pid || null }); fail(error); },

    /* ---------- Money helpers (from what this user is allowed to see) ---------- */
    paidIn: (bookingId) => cache.payments.filter((p) => p.bookingId === bookingId && p.dir === "in").reduce((s, p) => s + p.amount, 0),
    paidOut: (bookingId) => cache.payments.filter((p) => p.bookingId === bookingId && p.dir === "out").reduce((s, p) => s + p.amount, 0),
    partnerBalance(partnerId) {
      const charges = cache.bookings.filter((b) => b.partnerId === partnerId && ["confirmed", "ticketed"].includes(b.status)).reduce((s, b) => s + b.sell, 0);
      const paid = cache.payments.filter((p) => p.partnerId === partnerId && (p.dir === "in" || p.dir === "refund")).reduce((s, p) => s + (p.dir === "in" ? p.amount : -p.amount), 0);
      return { charges, paid, balance: charges - paid };
    },
  };
  return api;
})();
