// Green Travel: booking-provider adapters. Each adapter turns one company's API into the same shape:
//   search(q) -> Offer[]     book(offer, pax, contact) -> { ref, pnr, expires }
//   ticket(ref) -> { tickets }     cancel(ref) -> void
// Credentials come from Supabase secrets (Edge Functions → Secrets); configured() says whether they are set.
// Adding another company (Sabre, an airline NDC API, a consolidator...) = one more adapter in this file.

export type Pax = { adults: number; children: number; infants: number };
export type Query = { from: string; to: string; depart: string; ret?: string | null; cabin: string; pax: Pax };
export type Seg = { flight: string; carrier: string; from: string; to: string; depAt: string; arrAt: string; duration: number };
export type Offer = {
  providerOfferId: string;
  carrier: string; carrierName: string;
  total: number; currency: string;
  slices: { segments: Seg[]; duration: number }[];
  payload: unknown;               // what the provider needs back to book
  holdable?: boolean;
};
export type Traveler = { given: string; family: string; dob: string; gender: "m" | "f"; type: "adult" | "child" | "infant" };
export type Contact = { email: string; phone: string };
export type Adapter = {
  configured(): boolean;
  secrets: string[];
  search(q: Query): Promise<Offer[]>;
  book?(o: { payload: any; providerOfferId: string; net: number; currency: string }, pax: Traveler[], c: Contact): Promise<{ ref: string; pnr: string; expires?: string }>;
  ticket?(ref: string): Promise<{ tickets: string[] }>;
  cancel?(ref: string): Promise<void>;
};

const env = (k: string) => Deno.env.get(k) || "";
const iso8601min = (d: string) => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?/.exec(d || ""); return m ? (+(m[1] || 0)) * 60 + (+(m[2] || 0)) : 0; };
const minsBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 60000);
async function fetchJson(url: string, init: RequestInit, ms = 20000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    const text = await res.text();
    let body: any; try { body = JSON.parse(text); } catch { body = text; }
    if (!res.ok) throw new Error(`${res.status} ${typeof body === "string" ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`);
    return body;
  } finally { clearTimeout(t); }
}

/* ================= Duffel (https://duffel.com/docs/api) ================= */
const duffel: Adapter = {
  secrets: ["DUFFEL_TOKEN"],
  configured: () => !!env("DUFFEL_TOKEN"),
  async search(q) {
    const h = { Authorization: `Bearer ${env("DUFFEL_TOKEN")}`, "Duffel-Version": "v2", "Content-Type": "application/json", Accept: "application/json" };
    const slices = [{ origin: q.from, destination: q.to, departure_date: q.depart }, ...(q.ret ? [{ origin: q.to, destination: q.from, departure_date: q.ret }] : [])];
    const passengers = [...Array(q.pax.adults).fill({ type: "adult" }), ...Array(q.pax.children).fill({ age: 8 }), ...Array(q.pax.infants).fill({ type: "infant_without_seat" })];
    const cabin = { economy: "economy", premium: "premium_economy", business: "business", first: "first" }[q.cabin] || "economy";
    const r = await fetchJson("https://api.duffel.com/air/offer_requests?return_offers=true&supplier_timeout=15000", { method: "POST", headers: h, body: JSON.stringify({ data: { slices, passengers, cabin_class: cabin } }) }, 25000);
    return (r.data?.offers || []).slice(0, 60).map((o: any) => ({
      providerOfferId: o.id, carrier: o.owner?.iata_code || "", carrierName: o.owner?.name || "",
      total: +o.total_amount, currency: o.total_currency,
      holdable: o.payment_requirements ? !o.payment_requirements.requires_instant_payment : false,
      slices: (o.slices || []).map((s: any) => ({
        duration: iso8601min(s.duration),
        segments: (s.segments || []).map((g: any) => ({ flight: `${g.marketing_carrier?.iata_code || ""} ${g.marketing_carrier_flight_number || ""}`.trim(), carrier: g.marketing_carrier?.iata_code || "", from: g.origin?.iata_code, to: g.destination?.iata_code, depAt: g.departing_at, arrAt: g.arriving_at, duration: iso8601min(g.duration) })),
      })),
      payload: { id: o.id },
    }));
  },
  async book(o, pax, c) {
    const h = { Authorization: `Bearer ${env("DUFFEL_TOKEN")}`, "Duffel-Version": "v2", "Content-Type": "application/json", Accept: "application/json" };
    const fresh = await fetchJson(`https://api.duffel.com/air/offers/${o.providerOfferId}?return_available_services=false`, { headers: h });
    const ids = (fresh.data?.passengers || []).map((p: any) => p.id);
    const passengers = pax.map((p, i) => ({ id: ids[i], given_name: p.given, family_name: p.family, born_on: p.dob, gender: p.gender, title: p.gender === "f" ? "ms" : "mr", email: c.email, phone_number: c.phone }));
    const requiresPay = fresh.data?.payment_requirements?.requires_instant_payment;
    if (requiresPay) throw new Error("This fare must be paid at booking (no hold). The team will book it manually.");
    const r = await fetchJson("https://api.duffel.com/air/orders", { method: "POST", headers: h, body: JSON.stringify({ data: { type: "hold", selected_offers: [o.providerOfferId], passengers } }) });
    return { ref: r.data.id, pnr: r.data.booking_reference, expires: r.data.payment_status?.payment_required_by };
  },
  async ticket(ref) {
    const h = { Authorization: `Bearer ${env("DUFFEL_TOKEN")}`, "Duffel-Version": "v2", "Content-Type": "application/json", Accept: "application/json" };
    const order = await fetchJson(`https://api.duffel.com/air/orders/${ref}`, { headers: h });
    await fetchJson("https://api.duffel.com/air/payments", { method: "POST", headers: h, body: JSON.stringify({ data: { order_id: ref, payment: { type: "balance", amount: order.data.total_amount, currency: order.data.total_currency } } }) });
    const after = await fetchJson(`https://api.duffel.com/air/orders/${ref}`, { headers: h });
    return { tickets: (after.data?.documents || []).filter((d: any) => d.type === "electronic_ticket").map((d: any) => d.unique_identifier) };
  },
  async cancel(ref) {
    const h = { Authorization: `Bearer ${env("DUFFEL_TOKEN")}`, "Duffel-Version": "v2", "Content-Type": "application/json", Accept: "application/json" };
    const c = await fetchJson("https://api.duffel.com/air/order_cancellations", { method: "POST", headers: h, body: JSON.stringify({ data: { order_id: ref } }) });
    await fetchJson(`https://api.duffel.com/air/order_cancellations/${c.data.id}/actions/confirm`, { method: "POST", headers: h });
  },
};

/* ================= Amadeus Self-Service (https://developers.amadeus.com) ================= */
const amaHost = () => (env("AMADEUS_ENV") === "production" ? "https://api.amadeus.com" : "https://test.api.amadeus.com");
let amaToken = { v: "", exp: 0 };
async function amaAuth() {
  if (amaToken.v && Date.now() < amaToken.exp) return amaToken.v;
  const r = await fetchJson(`${amaHost()}/v1/security/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: env("AMADEUS_CLIENT_ID"), client_secret: env("AMADEUS_CLIENT_SECRET") }) });
  amaToken = { v: r.access_token, exp: Date.now() + (r.expires_in - 60) * 1000 };
  return amaToken.v;
}
const amadeus: Adapter = {
  secrets: ["AMADEUS_CLIENT_ID", "AMADEUS_CLIENT_SECRET", "AMADEUS_ENV"],
  configured: () => !!(env("AMADEUS_CLIENT_ID") && env("AMADEUS_CLIENT_SECRET")),
  async search(q) {
    const tok = await amaAuth();
    const travelers: any[] = [];
    let n = 0;
    for (let i = 0; i < q.pax.adults; i++) travelers.push({ id: String(++n), travelerType: "ADULT" });
    for (let i = 0; i < q.pax.children; i++) travelers.push({ id: String(++n), travelerType: "CHILD" });
    for (let i = 0; i < q.pax.infants; i++) travelers.push({ id: String(++n), travelerType: "HELD_INFANT", associatedAdultId: String(i + 1) });
    const ods = [{ id: "1", originLocationCode: q.from, destinationLocationCode: q.to, departureDateTimeRange: { date: q.depart } }, ...(q.ret ? [{ id: "2", originLocationCode: q.to, destinationLocationCode: q.from, departureDateTimeRange: { date: q.ret } }] : [])];
    const cabin = { economy: "ECONOMY", premium: "PREMIUM_ECONOMY", business: "BUSINESS", first: "FIRST" }[q.cabin] || "ECONOMY";
    const body = { currencyCode: "USD", originDestinations: ods, travelers, sources: ["GDS"], searchCriteria: { maxFlightOffers: 50, flightFilters: { cabinRestrictions: [{ cabin, coverage: "MOST_SEGMENTS", originDestinationIds: ods.map((o) => o.id) }] } } };
    const r = await fetchJson(`${amaHost()}/v2/shopping/flight-offers`, { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }, 25000);
    const carriers = r.dictionaries?.carriers || {};
    return (r.data || []).map((o: any) => {
      const code = (o.validatingAirlineCodes || [])[0] || o.itineraries?.[0]?.segments?.[0]?.carrierCode || "";
      return {
        providerOfferId: o.id, carrier: code, carrierName: carriers[code] || code, total: +o.price.grandTotal, currency: o.price.currency, holdable: true,
        slices: (o.itineraries || []).map((it: any) => ({ duration: iso8601min(it.duration), segments: it.segments.map((g: any) => ({ flight: `${g.carrierCode} ${g.number}`, carrier: g.carrierCode, from: g.departure.iataCode, to: g.arrival.iataCode, depAt: g.departure.at, arrAt: g.arrival.at, duration: iso8601min(g.duration) })) })),
        payload: o,
      };
    });
  },
  async book(o, pax, c) {
    const tok = await amaAuth();
    const h = { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" };
    const priced = await fetchJson(`${amaHost()}/v1/shopping/flight-offers/pricing`, { method: "POST", headers: h, body: JSON.stringify({ data: { type: "flight-offers-pricing", flightOffers: [o.payload] } }) });
    const offer = priced.data.flightOffers[0];
    if (+offer.price.grandTotal > o.net * 1.02) throw new Error("The fare changed. Please search again.");
    const digits = c.phone.replace(/[^\d]/g, "");
    const travelers = pax.map((p, i) => ({ id: String(i + 1), dateOfBirth: p.dob, name: { firstName: p.given.toUpperCase(), lastName: p.family.toUpperCase() }, gender: p.gender === "f" ? "FEMALE" : "MALE",
      contact: { emailAddress: c.email, phones: [{ deviceType: "MOBILE", countryCallingCode: digits.length > 10 ? digits.slice(0, digits.length - 10) : "1", number: digits.slice(-10) }] } }));
    const r = await fetchJson(`${amaHost()}/v1/booking/flight-orders`, { method: "POST", headers: h, body: JSON.stringify({ data: { type: "flight-order", flightOffers: [offer], travelers } }) });
    return { ref: r.data.id, pnr: r.data.associatedRecords?.[0]?.reference || "", expires: offer.lastTicketingDate };
  },
  async cancel(ref) {
    const tok = await amaAuth();
    await fetch(`${amaHost()}/v1/booking/flight-orders/${encodeURIComponent(ref)}`, { method: "DELETE", headers: { Authorization: `Bearer ${tok}` } });
  },
};

/* ================= Travelport Universal API (uAPI, SOAP) =================
   Secrets: TRAVELPORT_USERNAME (e.g. Universal API/uAPI1234567890), TRAVELPORT_PASSWORD,
            TRAVELPORT_TARGET_BRANCH (e.g. P1234567), TRAVELPORT_ENDPOINT (e.g. https://americas.universal-api.pp.travelport.com/B2BGateway/connect/uAPI)
   Search (LowFareSearch) is implemented. Reservation and ticketing are completed during
   Travelport certification with your test credentials (their schema depends on your PCC setup). */
const tpAuth = () => "Basic " + btoa(`${env("TRAVELPORT_USERNAME")}:${env("TRAVELPORT_PASSWORD")}`);
const attr = (tag: string, name: string) => { const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag); return m ? m[1] : ""; };
const travelport: Adapter = {
  secrets: ["TRAVELPORT_USERNAME", "TRAVELPORT_PASSWORD", "TRAVELPORT_TARGET_BRANCH", "TRAVELPORT_ENDPOINT"],
  configured: () => !!(env("TRAVELPORT_USERNAME") && env("TRAVELPORT_PASSWORD") && env("TRAVELPORT_TARGET_BRANCH") && env("TRAVELPORT_ENDPOINT")),
  async search(q) {
    const cabin = { economy: "Economy", premium: "PremiumEconomy", business: "Business", first: "First" }[q.cabin] || "Economy";
    const leg = (a: string, b: string, d: string) => `<air:SearchAirLeg><air:SearchOrigin><com:CityOrAirport Code="${a}"/></air:SearchOrigin><air:SearchDestination><com:CityOrAirport Code="${b}"/></air:SearchDestination><air:SearchDepTime PreferredTime="${d}"/><air:AirLegModifiers><air:PreferredCabins><com:CabinClass Type="${cabin}"/></air:PreferredCabins></air:AirLegModifiers></air:SearchAirLeg>`;
    const pax = [...Array(q.pax.adults).fill('<com:SearchPassenger Code="ADT"/>'), ...Array(q.pax.children).fill('<com:SearchPassenger Code="CNN" Age="8"/>'), ...Array(q.pax.infants).fill('<com:SearchPassenger Code="INF" Age="1"/>')].join("");
    const xml = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>
      <air:LowFareSearchReq xmlns:air="http://www.travelport.com/schema/air_v52_0" xmlns:com="http://www.travelport.com/schema/common_v52_0" TargetBranch="${env("TRAVELPORT_TARGET_BRANCH")}" SolutionResult="true" AuthorizedBy="GreenTravel">
        <com:BillingPointOfSaleInfo OriginApplication="UAPI"/>${leg(q.from, q.to, q.depart)}${q.ret ? leg(q.to, q.from, q.ret) : ""}
        <air:AirSearchModifiers MaxSolutions="60"><air:PreferredProviders><com:Provider Code="1G"/></air:PreferredProviders></air:AirSearchModifiers>${pax}
        <air:AirPricingModifiers CurrencyType="USD"/></air:LowFareSearchReq></soapenv:Body></soapenv:Envelope>`;
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 25000);
    const res = await fetch(`${env("TRAVELPORT_ENDPOINT")}/AirService`, { method: "POST", headers: { Authorization: tpAuth(), "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" }, body: xml, signal: ctl.signal }).finally(() => clearTimeout(t));
    const body = await res.text();
    if (!res.ok || /<SOAP:Fault|<soap:Fault/i.test(body)) throw new Error("Travelport: " + (/<faultstring>([^<]*)/.exec(body)?.[1] || res.status));
    const segs: Record<string, Seg> = {};
    for (const m of body.matchAll(/<air:AirSegment\b[^>]*>/g)) {
      const s = m[0];
      segs[attr(s, "Key")] = { flight: `${attr(s, "Carrier")} ${attr(s, "FlightNumber")}`, carrier: attr(s, "Carrier"), from: attr(s, "Origin"), to: attr(s, "Destination"), depAt: attr(s, "DepartureTime"), arrAt: attr(s, "ArrivalTime"), duration: +attr(s, "FlightTime") || 0 };
    }
    const out: Offer[] = [];
    for (const m of body.matchAll(/<air:AirPricingSolution\b([^>]*)>([\s\S]*?)<\/air:AirPricingSolution>/g)) {
      const price = /([A-Z]{3})([\d.]+)/.exec(attr(m[1], "TotalPrice"));
      const journeys = [...m[2].matchAll(/<air:Journey\b[^>]*>([\s\S]*?)<\/air:Journey>/g)].map((j) => [...j[1].matchAll(/<air:AirSegmentRef Key="([^"]+)"/g)].map((r) => segs[r[1]]).filter(Boolean));
      if (!price || !journeys.length) continue;
      const first = journeys[0][0];
      out.push({ providerOfferId: attr(m[1], "Key"), carrier: first.carrier, carrierName: first.carrier, total: +price[2], currency: price[1], holdable: true,
        slices: journeys.map((js) => ({ segments: js, duration: minsBetween(js[0].depAt, js[js.length - 1].arrAt) })), payload: { key: attr(m[1], "Key"), xml: m[0].slice(0, 20000) } });
    }
    return out;
  },
  // book / ticket / cancel: finished during Travelport certification (AirCreateReservationReq, AirTicketingReq, UniversalRecordCancelReq)
};

export const ADAPTERS: Record<string, Adapter> = { travelport, amadeus, duffel };
