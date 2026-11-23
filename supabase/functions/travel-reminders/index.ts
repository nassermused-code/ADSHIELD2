// Green Travel: daily job (pg_cron) that emails travelers one week and one day before departure.
// Each reminder goes out once per booking (tracked in bookings.reminders). It returns counts only.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { ticketEmail, sendEmail } from "./ticket.ts";

const iso = (d: Date) => d.toISOString().slice(0, 10);

Deno.serve(async () => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  if (!Deno.env.get("RESEND_API_KEY")) return new Response(JSON.stringify({ skipped: "email_not_configured" }), { headers: { "Content-Type": "application/json" } });
  const now = new Date();
  const day = (n: number) => { const d = new Date(now); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const sent = { week: 0, day: 0, noEmail: 0, failed: 0 };
  // "week": departing in 1–7 days and not yet reminded; "day": departing tomorrow
  const { data: rows } = await admin.from("bookings").select("*").in("status", ["confirmed", "ticketed"]).gte("depart", day(1)).lte("depart", day(7));
  for (const b of rows || []) {
    const kinds: ("week" | "day")[] = [];
    if (!b.reminders?.week) kinds.push("week");
    if (b.depart === day(1) && !b.reminders?.day) kinds.push("day");
    if (!kinds.length) continue;
    const to = String(b.customer?.email || "").trim();
    if (!/^\S+@\S+\.\S+$/.test(to)) { sent.noEmail++; continue; }
    const kind = kinds.includes("day") ? "day" : "week";
    const r = await sendEmail(to, ticketEmail(b, kind));
    if (!r.ok) { sent.failed++; continue; }
    const rem = { ...(b.reminders || {}) } as Record<string, string>;
    kinds.forEach((k) => (rem[k] = new Date().toISOString()));
    await admin.from("bookings").update({ reminders: rem }).eq("id", b.id);
    await admin.from("activity_log").insert({ who: null, action: "Automatic travel reminder", ref: `${b.id} → ${to}` });
    sent[kind]++;
  }
  return new Response(JSON.stringify(sent), { headers: { "Content-Type": "application/json" } });
});
