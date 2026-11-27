// Green Travel: email a ticket, a travel reminder or a written message to the customer, from the back office.
// The caller must be signed in (with two-step verification when their account has it) and allowed to see the booking.
// The email carries the employee's name, and the customer's reply goes to the employee's email (or info@).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { ticketEmail, sendEmail, PHONES, type Kind, type Attachment } from "./ticket.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const tokenAal = (t: string) => { try { const p = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); return String(JSON.parse(atob(p + "=".repeat((4 - p.length % 4) % 4))).aal || ""); } catch { return ""; } };
// A message the employee wrote, in the company's email design
function messageEmail(b: Record<string, any>, subject: string, message: string, sender: string) {
  const dir = /[؀-ۿ]/.test(message) ? "rtl" : "ltr";
  const html = `<!doctype html><html><body style="margin:0;background:#f3f6f3;font-family:Arial,Helvetica,sans-serif;color:#10231a">
  <div style="max-width:640px;margin:0 auto;padding:20px">
    <div style="background:#0b3d1f;color:#fff;border-radius:16px 16px 0 0;padding:18px 22px"><div style="font-size:20px;font-weight:bold">Green Travel · جرين ترافيل</div>
      <div style="font-size:12px;opacity:.85">${PHONES.join(" · ")} (Call / WhatsApp) · greentravel.us</div></div>
    <div style="background:#fff;border-radius:0 0 16px 16px;padding:22px">
      <div dir="${dir}" style="font-size:15px;line-height:1.7;white-space:pre-wrap">${esc(message)}</div>
      <p dir="${dir}" style="margin:18px 0 0;font-size:14px">${esc(sender)}<br><span style="color:#6b7a70">Green Travel · ${PHONES[0]}</span></p>
      ${b.pnr || b.id ? `<p style="font-size:12px;color:#6b7a70;margin-top:14px">Ref: ${esc(b.pnr ? "PNR " + b.pnr : b.id)}</p>` : ""}
    </div></div></body></html>`;
  return { subject, html, text: `${message}\n\n${sender}\nGreen Travel ${PHONES.join(" / ")}` };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who } = await admin.auth.getUser(token);
  if (!who?.user) return json({ error: "Not signed in" }, 401);
  const { data: me } = await admin.from("profiles").select("*").eq("id", who.user.id).single();
  if (!me || me.status !== "active" || !["owner", "staff"].includes(me.kind)) return json({ error: "Not allowed" }, 403);
  { const { data: mfa } = await admin.rpc("mfa_ok_for", { p_uid: who.user.id, p_aal: tokenAal(token) }); if (mfa !== true) return json({ error: "Two-step verification needed" }, 403); }
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const custom = body.kind === "message", invoice = body.kind === "invoice";
  // A PDF made in the back office (invoice or ticket) to attach: checked to be a real PDF of reasonable size
  let attachments: Attachment[] = [];
  if (body.pdf) {
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(String(body.pdf)), (c) => c.charCodeAt(0)); } catch { return json({ error: "Bad PDF" }, 400); }
    if (bytes.length > 4_500_000) return json({ error: "The PDF is too large" }, 413);
    if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") return json({ error: "Bad PDF" }, 400);
    const fname = (String(body.filename || "document.pdf").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+/, "").slice(0, 80) || "document").replace(/(\.pdf)?$/i, ".pdf");
    attachments = [{ filename: fname, content: bytes, contentType: "application/pdf" }];
  }
  if (invoice && !attachments.length) return json({ error: "The invoice PDF is missing" }, 400);
  const kind: Kind = ["booking", "ticket", "week", "day"].includes(body.kind) ? body.kind : "ticket";
  const subject = String(body.subject || "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  const message = String(body.message || "").trim().slice(0, 20000);
  if (custom && (!subject || !message)) return json({ error: "Subject and message are required" }, 400);
  const { data: b } = await admin.from("bookings").select("*").eq("id", String(body.bookingId || "")).single();
  if (!b) return json({ error: "Booking not found" }, 404);
  const perms: string[] = me.perms || [];
  const allowed = me.kind === "owner" || perms.includes("bookings_all") || b.assigned_to === me.id || (b.partner_id && perms.includes("agents"));
  if (!allowed) return json({ error: "Not allowed" }, 403);
  const to = String(body.to || b.customer?.email || "").trim();
  if (!/^\S+@\S+\.\S+$/.test(to)) return json({ error: "no_email" }, 400);
  const sender = String(me.name || "Green Travel");
  // Invoices are in English; the number and total follow the invoice as edited in the back office
  const invEd = b.invoice && typeof b.invoice === "object" ? b.invoice : {};
  const invNo = String(invEd.number || `INV-${b.id}`).slice(0, 40);
  const total = Array.isArray(invEd.items) && invEd.items.length ? invEd.items.reduce((sum: number, x: any) => sum + (+x.qty || 0) * (+x.unit || 0), 0) : (+b.sell || 0) + (+b.service_fee || 0);
  const invoiceMsg = () => messageEmail(b, `Invoice ${invNo} — Green Travel`,
    `Hello ${b.customer?.name || ""},\n\nPlease find attached invoice ${invNo}${b.pnr ? " (PNR " + b.pnr + ")" : ""} for USD ${total.toFixed(2)}.\nIf you have any question, simply reply to this email or call us.\n\nThank you for choosing Green Travel.`, sender);
  const r = await sendEmail(to, custom ? messageEmail(b, subject, message, sender) : invoice ? invoiceMsg() : ticketEmail(b, kind), { fromName: sender, replyTo: me.email || "", attachments });
  if (!r.ok) return json({ error: r.error }, r.error === "email_not_configured" ? 412 : 502);
  if (!custom) await admin.from("bookings").update({ reminders: { ...(b.reminders || {}), [invoice ? "invoice" : kind]: new Date().toISOString() } }).eq("id", b.id);
  await admin.from("activity_log").insert({ who: me.id, action: custom ? "Emailed customer: " + subject.slice(0, 120) : invoice ? "Emailed invoice (PDF)" : kind === "ticket" ? (attachments.length ? "Emailed ticket (PDF)" : "Emailed ticket") : "Emailed travel reminder", ref: `${b.id} → ${to}` });
  return json({ ok: true, to });
});
