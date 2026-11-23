/* =========================================================
   Green Travel — shared data layer (DEMO)
   ---------------------------------------------------------
   One store for the whole system: the public website, the partner (B2B)
   portal and the back office all read and write the same records:
     staff, partners, bookings, payments, expenses
   DEMO: data lives in this browser's localStorage. For real use, replace the
   load/save functions with a backend (e.g. Supabase tables with the same
   fields + row-level security: partners see only their rows).
   ========================================================= */
window.GTDB = (() => {
  const KEY = "gt-db-v2";
  const listeners = [];
  let db = null;

  const iso = (d) => d.toISOString().slice(0, 10);
  const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
  const daysAhead = (n) => daysAgo(-n);
  const uid = (p) => p + "-" + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 900 + 100);

  /* ---------- Sample data (clearly marked demo) ---------- */
  function seed() {
    const partners = [
      { id: "P-DEMO", email: "demo@partner.com", password: "demo1234", agency: "Demo Partner Travel", contact: "Partner Manager", phone: "+1 (312) 555-0100", contactEmail: "demo@partner.com", website: "", logo: "", sellMarkup: 6, status: "active", creditLimit: 5000, created: daysAgo(120), pricing: { mode: "hybrid" } },
      { id: "P-SAMPLE", email: "sample@agency.com", password: "sample1234", agency: "Sample Agency (demo)", contact: "Sample Contact", phone: "+1 (773) 555-0142", contactEmail: "sample@agency.com", website: "", logo: "", sellMarkup: 5, status: "active", creditLimit: 3000, created: daysAgo(60), pricing: { mode: "flat", flatAll: 20 } },
    ];
    const staff = [
      { email: "admin@greentravel.us", password: "admin1234", name: "Green Travel Admin", role: "admin" },
      { email: "agent@greentravel.us", password: "agent1234", name: "Travel Agent", role: "agent" },
    ];
    // ~40 sample bookings over the last 90 days (deterministic, so the demo looks the same every time)
    const ROUTES = [["ORD → AMM", "Royal Jordanian", 1150], ["ORD → CAI", "EgyptAir", 1110], ["ORD → DXB", "Emirates", 1290], ["ORD → IST", "Turkish Airlines", 980],
      ["ORD → JED", "Saudia", 1210], ["ORD → BEY", "Middle East Airlines", 1090], ["ORD → LHR", "British Airways", 820], ["ORD → DOH", "Qatar Airways", 1180],
      ["ORD → BGW", "Turkish Airlines", 1170], ["ORD → LAX", "United Airlines", 260], ["ORD → MCO", "Southwest Airlines", 210], ["ORD → CMN", "Royal Air Maroc", 1020]];
    let r = 7;
    const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    const STATUSES = ["ticketed", "ticketed", "ticketed", "ticketed", "ticketed", "ticketed", "confirmed", "cancelled", "new"];
    let n = 1000;
    const bookings = [], payments = [];
    for (let i = 0; i < 40; i++) {
      const ago = Math.round(88 - i * 2.2);
      const [route, airline, base] = ROUTES[Math.floor(rnd() * ROUTES.length)];
      const pax = rnd() < 0.3 ? 2 : 1;
      const roll = rnd();
      const source = roll < 0.35 ? "b2b" : roll < 0.75 ? "website" : "office";
      const partnerId = source === "b2b" ? (rnd() < 0.6 ? "P-DEMO" : "P-SAMPLE") : null;
      const cost = Math.round(base * (0.9 + rnd() * 0.2)) * pax;
      const sell = source === "b2b" ? cost + 20 * pax : Math.round(cost * (1.07 + rnd() * 0.04));
      let status = ago < 4 ? "new" : STATUSES[Math.floor(rnd() * STATUSES.length)];
      if (status === "new" && ago > 10) status = "ticketed";
      const ticketed = status === "ticketed";
      const id = "GT-" + (++n);
      const customer = "Sample Customer " + (i + 1);
      bookings.push({
        id, created: daysAgo(ago), source, partnerId, status,
        customer: { name: customer, phone: "", email: "" },
        route, airline, cabin: "economy", depart: daysAhead(5 + (i % 20) * 2), ret: daysAhead(19 + (i % 20) * 2), pax,
        travelers: pax === 2 ? [customer, customer + " (2)"] : [customer], pnr: ticketed || status === "confirmed" ? "DEMO" + (100 + i) : "",
        tickets: ticketed ? Array.from({ length: pax }, (_, k) => "000-" + (2400000000 + i * 1371 + k)) : [],
        cost, sell, fee: source === "b2b" ? sell - cost : 0, notes: "", demo: true, assignedTo: "agent@greentravel.us",
      });
      if (ticketed) {
        // most customers pay in full; some balances stay open so receivables show up
        const paidIn = ago > 20 || rnd() < 0.5 ? sell : Math.round(sell * 0.5);
        if (!(source === "b2b" && ago < 30 && rnd() < 0.6)) payments.push({ id: "PAY-" + (++n), date: daysAgo(Math.max(0, ago - 1)), dir: "in", amount: paidIn, method: source === "b2b" ? "bank" : rnd() < 0.7 ? "card" : "zelle", bookingId: id, partnerId, ref: "", note: "", demo: true });
        if (ago > 6) payments.push({ id: "PAY-" + (++n), date: daysAgo(Math.max(0, ago - 2)), dir: "out", amount: cost, method: "bank", bookingId: id, partnerId: null, ref: "BSP", note: T("دفع لشركة الطيران/المورّد", "Paid to airline/supplier"), demo: true });
      }
    }
    const expenses = [];
    [[80, "rent", 650], [50, "rent", 650], [20, "rent", 650], [60, "marketing", 250], [25, "software", 60], [10, "marketing", 150], [40, "utilities", 90]].forEach(([ago, cat, amount]) =>
      expenses.push({ id: "EXP-" + (++n), date: daysAgo(ago), category: cat, amount, note: "", demo: true }));
    return { version: 1, staff, partners, bookings, payments, expenses, seq: n, demo: true };
  }

  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) { db = JSON.parse(raw); return; } } catch (e) {}
    db = seed();
    save(false);
  }
  function save(notify = true) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {}
    if (notify) listeners.forEach((fn) => { try { fn(); } catch (e) {} });
  }
  window.addEventListener("storage", (e) => { if (e.key === KEY) { load(); listeners.forEach((fn) => fn()); } });

  load();

  /* ---------- API ---------- */
  const api = {
    all: (col) => db[col] || [],
    get: (col, id) => (db[col] || []).find((x) => x.id === id || x.email === id) || null,
    insert(col, obj, prefix) {
      if (!obj.id) obj.id = prefix ? prefix + "-" + (++db.seq) : uid(col.slice(0, 3).toUpperCase());
      db[col] = db[col] || [];
      db[col].unshift(obj);
      save();
      return obj;
    },
    update(col, id, patch) {
      const it = api.get(col, id);
      if (!it) return null;
      Object.assign(it, patch);
      save();
      return it;
    },
    remove(col, id) { db[col] = (db[col] || []).filter((x) => x.id !== id); save(); },
    onChange(fn) { listeners.push(fn); },
    reset() { db = seed(); save(); },
    clearDemo() {
      db.bookings = db.bookings.filter((b) => !b.demo);
      db.payments = db.payments.filter((p) => !p.demo);
      db.expenses = db.expenses.filter((x) => !x.demo);
      db.demo = false;
      save();
    },
    hasDemo: () => [...db.bookings, ...db.payments, ...db.expenses].some((x) => x.demo),

    /* ---------- Auth (DEMO: plain-text passwords in the browser — not secure) ---------- */
    login(email, password) {
      email = String(email || "").trim().toLowerCase();
      const st = db.staff.find((s) => s.email === email && s.password === password);
      if (st) return { kind: "staff", email: st.email, role: st.role, name: st.name };
      const pa = db.partners.find((p) => p.email === email && p.password === password);
      if (pa) return pa.status === "active" ? { kind: "partner", email: pa.email, id: pa.id, name: pa.agency } : { error: "inactive" };
      return null;
    },

    /* ---------- Money helpers ---------- */
    paidIn: (bookingId) => db.payments.filter((p) => p.bookingId === bookingId && p.dir === "in").reduce((s, p) => s + p.amount, 0),
    paidOut: (bookingId) => db.payments.filter((p) => p.bookingId === bookingId && p.dir === "out").reduce((s, p) => s + p.amount, 0),
    // What a partner owes: sell price of their non-cancelled bookings minus their payments
    partnerBalance(partnerId) {
      const charges = db.bookings.filter((b) => b.partnerId === partnerId && ["confirmed", "ticketed"].includes(b.status)).reduce((s, b) => s + b.sell, 0);
      const paid = db.payments.filter((p) => p.partnerId === partnerId && p.dir === "in").reduce((s, p) => s + p.amount, 0);
      return { charges, paid, balance: charges - paid };
    },

    /* ---------- Booking creation from the website and the partner portal ---------- */
    addBooking(b) {
      return api.insert("bookings", Object.assign({
        created: iso(new Date()), status: "new", source: "website", partnerId: null, customer: { name: "", phone: "", email: "" },
        route: "", airline: "", cabin: "economy", depart: "", ret: "", pax: 1, travelers: [], pnr: "", tickets: [],
        cost: 0, sell: 0, fee: 0, notes: "", assignedTo: "",
      }, b), "GT");
    },
  };
  return api;
})();
