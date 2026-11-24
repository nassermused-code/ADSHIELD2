// Green Travel: email a ticket or a travel reminder to the customer, on request from the back office.
// The caller must be signed in and allowed to see the booking.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { ticketEmail, sendEmail, type Kind } from "./ticket.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who } = await admin.auth.getUser(token);
  if (!who?.user) return json({ error: "Not signed in" }, 401);
  const { data: me } = await admin.from("profiles").select("*").eq("id", who.user.id).single();
  if (!me || me.status !== "active" || !["owner", "staff"].includes(me.kind)) return json({ error: "Not allowed" }, 403);
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const kind: Kind = ["booking", "ticket", "week", "day"].includes(body.kind) ? body.kind : "ticket";
  const { data: b } = await admin.from("bookings").select("*").eq("id", String(body.bookingId || "")).single();
  if (!b) return json({ error: "Booking not found" }, 404);
  const perms: string[] = me.perms || [];
  const allowed = me.kind === "owner" || perms.includes("bookings_all") || b.assigned_to === me.id || (b.partner_id && perms.includes("agents"));
  if (!allowed) return json({ error: "Not allowed" }, 403);
  const to = String(body.to || b.customer?.email || "").trim();
  if (!/^\S+@\S+\.\S+$/.test(to)) return json({ error: "no_email" }, 400);
  const r = await sendEmail(to, ticketEmail(b, kind));
  if (!r.ok) return json({ error: r.error }, r.error === "email_not_configured" ? 412 : 502);
  await admin.from("bookings").update({ reminders: { ...(b.reminders || {}), [kind]: new Date().toISOString() } }).eq("id", b.id);
  await admin.from("activity_log").insert({ who: me.id, action: kind === "ticket" ? "Emailed ticket" : "Emailed travel reminder", ref: `${b.id} → ${to}` });
  return json({ ok: true, to });
});
