// Green Travel: one door to every connected booking provider.
//   providers  (owner)  : which providers exist, whether their secrets are set, what each can do
//   search     (anyone) : searches all enabled + configured providers at once, merges and prices the results
//   book       (anyone) : books the chosen offer with the provider (hold → PNR) and saves it in the back office
//   ticket     (staff with "issue tickets") / cancel (staff with "cancel") : act on the provider booking
// Offers are kept server-side (offer_cache), so the customer can only book at the price the provider gave us.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { ADAPTERS, type Query, type Traveler } from "./providers.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const IATA = /^[A-Z]{3}$/, DATE = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }

  // Who is calling (optional): staff get more actions
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  let me: any = null;
  if (token) {
    const { data: who } = await admin.auth.getUser(token);
    if (who?.user) { const { data } = await admin.from("profiles").select("*").eq("id", who.user.id).maybeSingle(); if (data && data.status === "active") me = data; }
  }
  const can = (p: string) => !!me && (me.kind === "owner" || (me.kind === "staff" && (me.perms || []).includes(p)));
  const { data: rows } = await admin.from("booking_providers").select("*").order("priority");
  const providers = (rows || []).map((p: any) => ({ ...p, adapter: ADAPTERS[p.code] }));

  /* ---------- Provider status for the owner's settings page ---------- */
  if (body.action === "providers") {
    if (!me || me.kind !== "owner") return json({ error: "Not allowed" }, 403);
    return json({ providers: providers.map((p: any) => ({ code: p.code, name: p.name, enabled: p.enabled, mode: p.mode, priority: p.priority, markup_pct: +p.markup_pct, notes: p.notes,
      supported: !!p.adapter, configured: !!p.adapter && p.adapter.configured(), secrets: p.adapter ? p.adapter.secrets : [],
      canSearch: !!p.adapter, canBook: !!p.adapter?.book, canTicket: !!p.adapter?.ticket, canCancel: !!p.adapter?.cancel })) });
  }

  /* ---------- Search ---------- */
  if (body.action === "search") {
    const q: Query = { from: String(body.from || "").toUpperCase(), to: String(body.to || "").toUpperCase(), depart: String(body.depart || ""), ret: body.ret ? String(body.ret) : null, cabin: String(body.cabin || "economy"),
      pax: { adults: Math.max(1, Math.min(9, +body.pax?.adults || 1)), children: Math.max(0, Math.min(8, +body.pax?.children || 0)), infants: Math.max(0, Math.min(4, +body.pax?.infants || 0)) } };
    if (!IATA.test(q.from) || !IATA.test(q.to) || !DATE.test(q.depart) || (q.ret && !DATE.test(q.ret)) || q.pax.infants > q.pax.adults) return json({ error: "Bad search" }, 400);
    const live = providers.filter((p: any) => p.enabled && p.adapter && p.adapter.configured());
    if (!live.length) return json({ offers: [], live: false });
    await admin.from("offer_cache").delete().lt("expires_at", new Date().toISOString());
    const results = await Promise.allSettled(live.map((p: any) => p.adapter.search(q).then((list: any[]) => list.map((o) => ({ ...o, provider: p }))))) ;
    const errors = results.map((r: any, i) => (r.status === "rejected" ? `${live[i].code}: ${String(r.reason).slice(0, 160)}` : "")).filter(Boolean);
    let offers = results.flatMap((r: any) => (r.status === "fulfilled" ? r.value : [])).filter((o: any) => o.currency === "USD" && o.total > 0);
    // Same flights from two providers: keep the cheaper (then the preferred provider)
    const best = new Map<string, any>();
    for (const o of offers) {
      const key = o.slices.map((s: any) => s.segments.map((g: any) => g.flight + g.depAt).join("|")).join("/");
      const sell = Math.round(o.total * (1 + (+o.provider.markup_pct || 0) / 100));
      const cur = best.get(key);
      if (!cur || sell < cur.sell || (sell === cur.sell && o.provider.priority < cur.provider.priority)) best.set(key, { ...o, sell });
    }
    offers = [...best.values()].sort((a, b) => a.sell - b.sell).slice(0, 80);
    if (!offers.length) return json({ offers: [], live: true, errors });
    const insert = offers.map((o: any) => ({ provider: o.provider.code, provider_offer_id: o.providerOfferId, payload: o.payload, net: o.total, sell: o.sell, currency: o.currency, search: q,
      summary: { carrier: o.carrier, carrierName: o.carrierName, slices: o.slices, holdable: !!o.holdable } }));
    const { data: saved, error } = await admin.from("offer_cache").insert(insert).select("id, provider, sell, summary, expires_at");
    if (error) return json({ error: error.message }, 500);
    return json({ live: true, errors, offers: (saved || []).map((s: any) => ({ id: s.id, provider: s.provider, sell: +s.sell, expires: s.expires_at, ...s.summary,
      canBook: !!ADAPTERS[s.provider]?.book && providers.find((p: any) => p.code === s.provider)?.can_book })) });
  }

  /* ---------- Book (hold → PNR), saved straight into the back office ---------- */
  if (body.action === "book") {
    const { data: o } = await admin.from("offer_cache").select("*").eq("id", String(body.offerId || "")).maybeSingle();
    if (!o || Date.parse(o.expires_at) < Date.now()) return json({ error: "offer_expired" }, 410);
    const p = providers.find((x: any) => x.code === o.provider);
    if (!p?.adapter?.book || !p.can_book) return json({ error: "cannot_book" }, 409);
    const pax: Traveler[] = (body.passengers || []).slice(0, 13).map((t: any) => ({ given: String(t.given || "").trim().slice(0, 60), family: String(t.family || "").trim().slice(0, 60), dob: String(t.dob || ""), gender: t.gender === "f" ? "f" : "m", type: ["child", "infant"].includes(t.type) ? t.type : "adult" }));
    const contact = { email: String(body.contact?.email || "").trim().slice(0, 160), phone: String(body.contact?.phone || "").trim().slice(0, 40) };
    const q = o.search || {};
    const need = (q.pax?.adults || 1) + (q.pax?.children || 0) + (q.pax?.infants || 0);
    if (pax.length !== need || pax.some((t) => !t.given || !t.family || !DATE.test(t.dob)) || !/^\S+@\S+\.\S+$/.test(contact.email) || contact.phone.length < 7) return json({ error: "Check the traveler and contact details" }, 400);
    let res;
    try { res = await p.adapter.book({ payload: o.payload, providerOfferId: o.provider_offer_id, net: +o.net, currency: o.currency }, pax, contact); }
    catch (e) { return json({ error: "provider_error", detail: String(e).slice(0, 300) }, 502); }
    const s = o.summary, hm = (t: string) => (t || "").slice(11, 16), d = (t: string) => (t || "").slice(0, 10);
    const segments = s.slices.flatMap((sl: any) => sl.segments.map((g: any) => ({ flight: g.flight, from: g.from, to: g.to, date: d(g.depAt), dep: hm(g.depAt), arr: hm(g.arrAt), arrDate: d(g.arrAt) })));
    const names = pax.map((t) => `${t.given} ${t.family}`.toUpperCase());
    const source = me && me.kind !== "partner" ? "office" : "website";
    const { data: b, error } = await admin.from("bookings").insert({
      source, status: "confirmed", customer: { name: `${pax[0].given} ${pax[0].family}`, phone: contact.phone, email: contact.email },
      route: `${q.from} → ${q.to}`, airline: s.carrierName || s.carrier, cabin: q.cabin || "economy", depart: q.depart, ret: q.ret || null, pax: pax.length, travelers: names,
      pnr: res.pnr || "", sell: +o.sell, segments, provider: o.provider, provider_ref: res.ref, hold_expires: res.expires || null,
      notes: `${p.name} · ${String(body.notes || "").slice(0, 1500)}`.trim(), assigned_to: me && me.kind !== "partner" ? me.id : null,
    }).select("id").single();
    if (error) return json({ error: "saved_failed", detail: error.message, pnr: res.pnr, ref: res.ref }, 500);
    await admin.from("booking_costs").insert({ booking_id: b.id, cost: +o.net, fee: 0 });
    await admin.from("activity_log").insert({ who: me?.id || null, action: "Online booking with provider", ref: `${b.id} · ${o.provider} · PNR ${res.pnr}` });
    await admin.from("offer_cache").delete().eq("id", o.id);
    return json({ ok: true, id: b.id, pnr: res.pnr, expires: res.expires || null });
  }

  /* ---------- Issue / cancel with the provider (back office) ---------- */
  if (body.action === "ticket" || body.action === "cancel") {
    const need = body.action === "ticket" ? "bookings_issue" : "bookings_cancel";
    if (!can(need)) return json({ error: "Not allowed" }, 403);
    const { data: b } = await admin.from("bookings").select("*").eq("id", String(body.bookingId || "")).maybeSingle();
    if (!b || !b.provider || !b.provider_ref) return json({ error: "Not a provider booking" }, 400);
    if (me.kind === "staff" && !(me.perms || []).includes("bookings_all") && b.assigned_to !== me.id) return json({ error: "Not allowed" }, 403);
    const a = ADAPTERS[b.provider];
    try {
      if (body.action === "ticket") {
        if (!a?.ticket) return json({ error: "ticketing_not_supported" }, 409);
        const r = await a.ticket(b.provider_ref);
        await admin.from("bookings").update({ status: "ticketed", tickets: r.tickets.length ? r.tickets : b.tickets }).eq("id", b.id);
        await admin.from("activity_log").insert({ who: me.id, action: "Issued tickets with provider", ref: `${b.id} · ${b.provider}` });
        return json({ ok: true, tickets: r.tickets });
      }
      if (!a?.cancel) return json({ error: "cancel_not_supported" }, 409);
      await a.cancel(b.provider_ref);
      await admin.from("bookings").update({ status: "cancelled" }).eq("id", b.id);
      await admin.from("activity_log").insert({ who: me.id, action: "Cancelled with provider", ref: `${b.id} · ${b.provider}` });
      return json({ ok: true });
    } catch (e) { return json({ error: "provider_error", detail: String(e).slice(0, 300) }, 502); }
  }

  return json({ error: "Unknown action" }, 400);
});
