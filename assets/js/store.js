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

  const cache = { staff: [], partners: [], bookings: [], payments: [], expenses: [], tasks: [], log: [] };
  const listeners = [];
  let profile = null;
  const notify = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  const fail = (error) => { if (error) throw new Error(error.message || String(error)); };

  /* ---------- Row <-> app object ---------- */
  const mapStaff = (r) => ({ id: r.id, kind: r.kind, role: r.kind, username: r.username || "", email: r.email || "", name: r.name, title: r.title, phone: r.phone, status: r.status, perms: r.perms || [], lastLogin: r.last_login, created: (r.created_at || "").slice(0, 10) });
  const mapPricing = (p) => (p ? { mode: p.mode, flatAll: +p.flat_all, pctAll: +p.pct_all, flat: +p.flat, threshold: +p.threshold, pct: +p.pct, publicMarkup: +p.public_markup } : {});
  const mapPartner = (r, pr) => ({ id: r.id, email: r.email, agency: r.agency, contact: r.contact, phone: r.phone, contactEmail: r.contact_email, website: r.website, logo: r.logo, sellMarkup: +r.sell_markup, status: r.status, creditLimit: +r.credit_limit, created: (r.created_at || "").slice(0, 10), pricing: mapPricing(pr) });
  const mapBooking = (r, c) => ({ id: r.id, created: r.created, source: r.source, partnerId: r.partner_id, status: r.status, customer: Object.assign({ name: "", phone: "", email: "" }, r.customer || {}), route: r.route, airline: r.airline, cabin: r.cabin, depart: r.depart || "", ret: r.ret || "", pax: r.pax, travelers: r.travelers || [], pnr: r.pnr, tickets: r.tickets || [], sell: +r.sell, notes: r.notes, assignedTo: r.assigned_to || "", cost: c ? +c.cost : 0, fee: c ? +c.fee : 0 });
  const bookingRow = (b) => {
    const r = {};
    const m = { status: "status", source: "source", partnerId: "partner_id", customer: "customer", route: "route", airline: "airline", cabin: "cabin", depart: "depart", ret: "ret", pax: "pax", travelers: "travelers", pnr: "pnr", tickets: "tickets", sell: "sell", notes: "notes", assignedTo: "assigned_to" };
    Object.entries(m).forEach(([k, col]) => { if (k in b) r[col] = b[k]; });
    if ("depart" in r) r.depart = r.depart || null;
    if ("ret" in r) r.ret = r.ret || null;
    if ("assigned_to" in r) r.assigned_to = r.assigned_to || null;
    if ("partner_id" in r) r.partner_id = r.partner_id || null;
    return r;
  };
  const mapPayment = (r) => ({ id: r.id, date: r.date, dir: r.dir, amount: +r.amount, method: r.method, bookingId: r.booking_id, partnerId: r.partner_id, ref: r.ref, note: r.note, by: r.created_by });
  const mapExpense = (r) => ({ id: r.id, date: r.date, category: r.category, amount: +r.amount, note: r.note });
  const mapTask = (r) => ({ id: r.id, title: r.title, details: r.details, assignee: r.assignee, due: r.due || "", priority: r.priority, status: r.status, bookingId: r.booking_id, created: r.created, createdBy: r.created_by, doneAt: r.done_at || "" });

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
    const [st, pa, bk, pay, tk, costs, pricing, exp, lg] = await Promise.all([
      q("profiles").in("kind", ["owner", "staff"]).order("created_at"),
      q("partners").order("agency"),
      q("bookings").order("created_at", { ascending: false }),
      q("payments").order("date", { ascending: false }),
      q("tasks").order("created", { ascending: false }),
      owner ? q("booking_costs") : { data: [] },
      owner ? q("partner_pricing") : { data: [] },
      owner ? q("expenses").order("date", { ascending: false }) : { data: [] },
      owner ? sb.from("activity_log").select("*").order("at", { ascending: false }).limit(300) : { data: [] },
    ]);
    const costBy = new Map((costs.data || []).map((c) => [c.booking_id, c]));
    const priceBy = new Map((pricing.data || []).map((p) => [p.partner_id, p]));
    cache.staff = (st.data || []).map(mapStaff);
    cache.partners = (pa.data || []).map((r) => mapPartner(r, priceBy.get(r.id)));
    cache.bookings = (bk.data || []).map((r) => mapBooking(r, costBy.get(r.id)));
    cache.payments = (pay.data || []).map(mapPayment);
    cache.tasks = (tk.data || []).map(mapTask);
    cache.expenses = (exp.data || []).map(mapExpense);
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
    try { await loadProfile(); await load(); subscribe(); } catch (e) { console.error(e); }
  })();

  const api = {
    client: sb,
    ready,
    get profile() { return profile; },
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
      else if (col === "expenses") res = await sb.from("expenses").insert({ date: obj.date, category: obj.category, amount: obj.amount, note: obj.note || "" }).select().single();
      else if (col === "payments") res = await sb.from("payments").insert({ date: obj.date, dir: obj.dir, amount: obj.amount, method: obj.method, booking_id: obj.bookingId || null, partner_id: obj.partnerId || null, ref: obj.ref || "", note: obj.note || "" }).select().single();
      else throw new Error("insert " + col);
      fail(res.error);
      const item = { tasks: mapTask, expenses: mapExpense, payments: mapPayment }[col](res.data);
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
      const table = { bookings: "bookings", payments: "payments", expenses: "expenses", tasks: "tasks" }[col];
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
      const paid = cache.payments.filter((p) => p.partnerId === partnerId && p.dir === "in").reduce((s, p) => s + p.amount, 0);
      return { charges, paid, balance: charges - paid };
    },
  };
  return api;
})();
