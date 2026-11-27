// Green Travel: "forgot password" for every account (owner, staff, B2B agents, company users).
// 1) request: the person types their username or email; a 6-digit code is emailed to the email on their profile.
//    Staff without an email: the owner gets a task to reset the password from the back office.
// 2) reset: code + new password. The code is valid 15 minutes, 5 tries; then the account is signed out everywhere.
// The answer to "request" never says whether an account exists. Two-step verification still applies at sign-in.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const STAFF_DOMAIN = "staff.greentravel.us";
const realEmail = (e: unknown) => { const s = String(e || "").trim().toLowerCase(); return /^\S+@\S+\.\S+$/.test(s) && !s.endsWith("@" + STAFF_DOMAIN) ? s : ""; };
const mask = (e: string) => e.replace(/^(.)[^@]*(@.).*(\.[^.]+)$/, "$1***$2***$3");

async function hash(uid: string, code: string) {
  const pepper = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${uid}:${code}:${pepper}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const sixDigits = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");

// Same senders as the other functions: the company's cPanel mail server (SMTP_*), otherwise Resend
async function sendEmail(to: string, subject: string, text: string, html: string) {
  const host = Deno.env.get("SMTP_HOST"), user = Deno.env.get("SMTP_USER"), pass = Deno.env.get("SMTP_PASS");
  if (host && user && pass) {
    const client = new SMTPClient({ connection: { hostname: host, port: Number(Deno.env.get("SMTP_PORT") || 465), tls: true, auth: { username: user, password: pass } } });
    try { await client.send({ from: `Green Travel <${user}>`, to, subject, content: text, html }); return true; }
    catch { return false; }
    finally { try { await client.close(); } catch { /* closed */ } }
  }
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return false;
  const from = Deno.env.get("EMAIL_FROM") || "Green Travel <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [to], subject, html, text }) });
  return res.ok;
}
const codeEmail = (name: string, code: string) => ({
  subject: `رمز تغيير كلمة المرور · Password reset code: ${code}`,
  text: `Hello ${name},\n\nYour Green Travel password reset code is: ${code}\nIt is valid for 15 minutes. If you did not ask for it, ignore this email: your password stays the same.\n\nرمز تغيير كلمة المرور: ${code} (صالح 15 دقيقة). إذا لم تطلبه فتجاهل هذه الرسالة.`,
  html: `<!doctype html><html><body style="margin:0;background:#f3f6f3;font-family:Arial,Helvetica,sans-serif;color:#10231a"><div style="max-width:520px;margin:0 auto;padding:20px">
    <div style="background:#0b3d1f;color:#fff;border-radius:16px 16px 0 0;padding:16px 22px;font-size:18px;font-weight:bold">Green Travel · جرين ترافيل</div>
    <div style="background:#fff;border-radius:0 0 16px 16px;padding:22px">
      <p>Hello ${name.replace(/[<>&"]/g, "")},</p><p>Your password reset code:</p>
      <p style="font-size:32px;letter-spacing:.3em;font-weight:bold;font-family:monospace;margin:10px 0">${code}</p>
      <p style="color:#4a5a50;font-size:13px">Valid for 15 minutes. If you did not ask for it, ignore this email: your password stays the same.</p>
      <p dir="rtl" style="text-align:right;color:#4a5a50;font-size:13px">رمز تغيير كلمة المرور صالح 15 دقيقة. إذا لم تطلبه فتجاهل هذه الرسالة، وتبقى كلمة مرورك كما هي.</p>
    </div></div></body></html>`,
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const login = String(body.login || "").trim().toLowerCase().slice(0, 160);
  if (login.length < 3) return json({ error: "Enter your username or email" }, 400);

  // Find the account: a username, a staff login (username@staff…), or the email on the profile
  const username = login.endsWith("@" + STAFF_DOMAIN) ? login.split("@")[0] : login.includes("@") ? "" : login;
  const { data: rows } = username
    ? await admin.from("profiles").select("id,kind,name,username,email,status").eq("username", username).limit(1)
    : await admin.from("profiles").select("id,kind,name,username,email,status").eq("email", login).limit(1); // emails are saved in lower case
  const p = (rows || [])[0];

  if (body.action === "request") {
    const generic = json({ ok: true });
    // Slow down floods: at most 30 requests every 10 minutes for the whole site
    const since10 = new Date(Date.now() - 10 * 60e3).toISOString();
    const { count: recent } = await admin.from("password_resets").select("id", { count: "exact", head: true }).gte("created_at", since10);
    if ((recent || 0) >= 30) return generic;
    if (!p || p.status !== "active") return generic;
    // At most 3 codes per account per hour
    const since60 = new Date(Date.now() - 60 * 60e3).toISOString();
    const { count: mine } = await admin.from("password_resets").select("id", { count: "exact", head: true }).eq("user_id", p.id).gte("created_at", since60);
    if ((mine || 0) >= 3) return generic;
    const to = realEmail(p.email);
    if (!to) {
      // No email on file: a staff member's request goes to the owner as a task (once an hour)
      await admin.from("password_resets").insert({ user_id: p.id, code_hash: "no-email", expires_at: new Date().toISOString(), used: true });
      if (p.kind === "staff") {
        const { data: owner } = await admin.from("profiles").select("id").eq("kind", "owner").limit(1).maybeSingle();
        if (owner) await admin.from("tasks").insert({ title: `Password reset requested: ${p.name} (${p.username})`, details: "The employee forgot their password and has no email on file. Back office → Team → Edit → set a new password, and add their email so they can reset it themselves next time.", assignee: owner.id, priority: "high", status: "open" });
      }
      await admin.from("activity_log").insert({ who: p.id, action: "Password reset requested (no email on file)", ref: p.username || p.email || "" });
      return generic;
    }
    const code = sixDigits();
    await admin.from("password_resets").insert({ user_id: p.id, code_hash: await hash(p.id, code), expires_at: new Date(Date.now() + 15 * 60e3).toISOString() });
    const m = codeEmail(p.name || p.username || "", code);
    const sent = await sendEmail(to, m.subject, m.text, m.html);
    await admin.from("activity_log").insert({ who: p.id, action: sent ? "Password reset code sent" : "Password reset code could not be sent", ref: mask(to) });
    return generic;
  }

  if (body.action === "reset") {
    const code = String(body.code || "").replace(/\D/g, "");
    const password = String(body.password || "");
    if (password.length < 8) return json({ error: "Password must be 8+ characters" }, 400);
    const wrong = json({ error: "Wrong or expired code" }, 400);
    if (!p || p.status !== "active" || code.length !== 6) return wrong;
    const { data: r } = await admin.from("password_resets").select("*").eq("user_id", p.id).eq("used", false).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!r || r.attempts >= 5) return wrong;
    if (r.code_hash !== (await hash(p.id, code))) { await admin.from("password_resets").update({ attempts: r.attempts + 1 }).eq("id", r.id); return wrong; }
    const { error } = await admin.auth.admin.updateUserById(p.id, { password });
    if (error) return json({ error: error.message }, 400);
    await admin.from("password_resets").update({ used: true }).eq("user_id", p.id);
    await admin.rpc("revoke_user_sessions", { p_uid: p.id });
    await admin.from("activity_log").insert({ who: p.id, action: "Password changed with a reset code", ref: p.username || mask(realEmail(p.email)) });
    return json({ ok: true, login: p.kind === "owner" || p.kind === "staff" ? p.username : p.email });
  }
  return json({ error: "Unknown action" }, 400);
});
