// Green Travel: account management (runs on the server with the service key).
// Only the owner can create/edit staff; the owner or staff with "agents_manage" can create/edit B2B agent logins
// (pricing and credit limit stay owner-only). Creating the owner needs the one-time setup code saved as the
// OWNER_SETUP_CODE secret in Supabase, and only works while no owner exists.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const PERMS = ["bookings_all", "bookings_create", "bookings_issue", "bookings_cancel", "payments", "customers", "agents", "agents_manage", "export", "corporate", "ai_office"];
const STAFF_DOMAIN = "staff.greentravel.us";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (msg: string, status = 400) => json({ error: msg }, status);
const str = (v: unknown, max = 160) => String(v ?? "").trim().slice(0, max);
const BAN = "876000h";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("POST only", 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return fail("Bad JSON"); }
  const action = body.action;

  // ---------- First-time setup: create the owner (only while no owner exists, with the setup code) ----------
  if (action === "bootstrap") {
    const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("kind", "owner");
    if (count) return fail("Owner already exists", 409);
    const code = Deno.env.get("OWNER_SETUP_CODE") || "";
    if (code.length < 6) return fail("Setup code is not configured yet. Add the OWNER_SETUP_CODE secret in Supabase.", 403);
    if (String(body.setupCode || "") !== code) return fail("Wrong setup code", 403);
    const username = str(body.username, 40).toLowerCase();
    if (!/^[a-z0-9._-]{3,}$/.test(username) || String(body.password || "").length < 8) return fail("Username (3+ English letters) and a password of 8+ characters are required");
    const email = `${username}@${STAFF_DOMAIN}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: body.password, email_confirm: true });
    if (error) return fail(error.message);
    const { error: e2 } = await admin.from("profiles").insert({ id: data.user.id, kind: "owner", username, email: str(body.email) || null, name: str(body.name, 120) || "Owner", title: str(body.title, 120) });
    if (e2) { await admin.auth.admin.deleteUser(data.user.id); return fail(e2.message); }
    await admin.from("activity_log").insert({ who: data.user.id, action: "Owner account created", ref: username });
    return json({ ok: true, login: email });
  }

  // ---------- Everything else needs a signed-in staff member ----------
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who } = await admin.auth.getUser(token);
  if (!who?.user) return fail("Not signed in", 401);
  const { data: me } = await admin.from("profiles").select("*").eq("id", who.user.id).single();
  if (!me || me.status !== "active" || !(me.kind === "owner" || me.kind === "staff")) return fail("Not allowed", 403);
  const isOwner = me.kind === "owner";
  const canManageAgents = isOwner || (me.perms || []).includes("agents_manage");
  const canCorporate = isOwner || (me.perms || []).includes("corporate");
  const log = (a: string, ref = "") => admin.from("activity_log").insert({ who: me.id, action: a, ref });

  // ---------- Staff ----------
  if (action === "save_staff") {
    if (!isOwner) return fail("Only the owner can manage staff", 403);
    const id = body.id ? str(body.id, 60) : null;
    const username = str(body.username, 40).toLowerCase();
    if (!str(body.name) || !/^[a-z0-9._-]{3,}$/.test(username)) return fail("Name and an English username (3+ characters) are required");
    if (body.password && String(body.password).length < 8) return fail("Password must be 8+ characters");
    if (!id && !body.password) return fail("Password is required");
    const { data: clash } = await admin.from("profiles").select("id").eq("username", username).neq("id", id || "00000000-0000-0000-0000-000000000000").maybeSingle();
    if (clash) return fail("Username already in use");
    const loginEmail = `${username}@${STAFF_DOMAIN}`;
    const row: Record<string, unknown> = { username, email: str(body.email) || null, name: str(body.name, 120), title: str(body.title, 120), phone: str(body.phone, 40) };
    if (id) {
      const { data: target } = await admin.from("profiles").select("*").eq("id", id).single();
      if (!target || target.kind === "partner") return fail("Not found", 404);
      if (target.kind === "staff") {
        row.status = body.status === "suspended" ? "suspended" : "active";
        row.perms = (body.perms || []).filter((p: string) => PERMS.includes(p));
      }
      const upd: Record<string, unknown> = { email: loginEmail };
      if (body.password) upd.password = body.password;
      if (target.kind === "staff") upd.ban_duration = row.status === "suspended" ? BAN : "none";
      const { error } = await admin.auth.admin.updateUserById(id, upd);
      if (error) return fail(error.message);
      const { error: e2 } = await admin.from("profiles").update(row).eq("id", id);
      if (e2) return fail(e2.message);
      await log("Edited employee / permissions", String(row.name));
      return json({ ok: true, id });
    }
    const { data, error } = await admin.auth.admin.createUser({ email: loginEmail, password: body.password, email_confirm: true });
    if (error) return fail(error.message);
    row.status = body.status === "suspended" ? "suspended" : "active";
    row.perms = (body.perms || []).filter((p: string) => PERMS.includes(p));
    const { error: e2 } = await admin.from("profiles").insert({ id: data.user.id, kind: "staff", ...row });
    if (e2) { await admin.auth.admin.deleteUser(data.user.id); return fail(e2.message); }
    if (row.status === "suspended") await admin.auth.admin.updateUserById(data.user.id, { ban_duration: BAN });
    await log("Added employee", String(row.name));
    return json({ ok: true, id: data.user.id });
  }
  if (action === "delete_staff") {
    if (!isOwner) return fail("Only the owner can manage staff", 403);
    const { data: target } = await admin.from("profiles").select("*").eq("id", body.id).single();
    if (!target || target.kind !== "staff") return fail("Not found", 404);
    await admin.from("bookings").update({ assigned_to: null }).eq("assigned_to", target.id);
    const { error } = await admin.auth.admin.deleteUser(target.id);
    if (error) return fail(error.message);
    await log("Deleted employee", target.name);
    return json({ ok: true });
  }

  // ---------- B2B agents ----------
  if (action === "save_partner") {
    if (!canManageAgents) return fail("Not allowed", 403);
    const id = body.id ? str(body.id, 60) : null;
    const email = str(body.email).toLowerCase();
    if (!str(body.agency) || !/^\S+@\S+\.\S+$/.test(email)) return fail("Agency name and a valid email are required");
    if (body.password && String(body.password).length < 8) return fail("Password must be 8+ characters");
    if (!id && !body.password) return fail("Password is required");
    const status = ["active", "pending", "suspended"].includes(body.status) ? body.status : "active";
    const row: Record<string, unknown> = { email, agency: str(body.agency, 120), contact: str(body.contact, 120), phone: str(body.phone, 40), status };
    if (isOwner && body.creditLimit != null) row.credit_limit = Math.max(0, Number(body.creditLimit) || 0);
    let pid = id;
    if (id) {
      const { data: target } = await admin.from("partners").select("id").eq("id", id).single();
      if (!target) return fail("Not found", 404);
      const upd: Record<string, unknown> = { email, ban_duration: status === "active" ? "none" : BAN };
      if (body.password) upd.password = body.password;
      const { error } = await admin.auth.admin.updateUserById(id, upd);
      if (error) return fail(error.message);
      await admin.from("profiles").update({ status, name: row.agency, email }).eq("id", id);
      const { error: e2 } = await admin.from("partners").update(row).eq("id", id);
      if (e2) return fail(e2.message);
    } else {
      const { data, error } = await admin.auth.admin.createUser({ email, password: body.password, email_confirm: true });
      if (error) return fail(error.message);
      pid = data.user.id;
      const { error: e1 } = await admin.from("profiles").insert({ id: pid, kind: "partner", name: row.agency, email, status });
      const { error: e2 } = e1 ? { error: e1 } : await admin.from("partners").insert({ id: pid, contact_email: email, ...row });
      if (e2) { await admin.auth.admin.deleteUser(pid!); return fail(e2.message); }
      await admin.from("partner_pricing").insert({ partner_id: pid });
      if (status !== "active") await admin.auth.admin.updateUserById(pid!, { ban_duration: BAN });
    }
    if (isOwner && body.pricing) {
      const p = body.pricing, n = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : d);
      await admin.from("partner_pricing").upsert({ partner_id: pid, mode: ["flat", "percent", "hybrid"].includes(p.mode) ? p.mode : "hybrid", flat_all: n(p.flatAll, 20), pct_all: n(p.pctAll, 0.02), flat: n(p.flat, 20), threshold: n(p.threshold, 1000), pct: n(p.pct, 0.02), public_markup: n(p.publicMarkup, 0.08) });
    }
    await log(id ? "Edited agent account" : "Opened agent account", String(row.agency));
    return json({ ok: true, id: pid });
  }

  // ---------- Company portal logins (TMC): coordinator, approver or traveler of a client company ----------
  if (action === "save_company_user") {
    if (!canCorporate) return fail("Not allowed", 403);
    const id = body.id ? str(body.id, 60) : null;
    const email = str(body.email).toLowerCase();
    const role = ["coordinator", "approver", "traveler"].includes(body.role) ? body.role : "traveler";
    const { data: company } = await admin.from("companies").select("id, name").eq("id", str(body.companyId, 60)).maybeSingle();
    if (!company) return fail("Company not found", 404);
    if (!/^\S+@\S+\.\S+$/.test(email) || !str(body.name)) return fail("Name and a valid email are required");
    if (body.password && String(body.password).length < 8) return fail("Password must be 8+ characters");
    if (!id && !body.password) return fail("Password is required");
    const status = body.status === "suspended" ? "suspended" : "active";
    let traveler = body.travelerId ? str(body.travelerId, 60) : null;
    if (traveler) { const { data: t } = await admin.from("travelers").select("id").eq("id", traveler).eq("company_id", company.id).maybeSingle(); if (!t) traveler = null; }
    let uid = id;
    if (id) {
      const { data: cu } = await admin.from("company_users").select("user_id").eq("user_id", id).maybeSingle();
      if (!cu) return fail("Not found", 404);
      const upd: Record<string, unknown> = { email, ban_duration: status === "active" ? "none" : BAN };
      if (body.password) upd.password = body.password;
      const { error } = await admin.auth.admin.updateUserById(id, upd);
      if (error) return fail(error.message);
      await admin.from("profiles").update({ name: str(body.name, 120), email, status }).eq("id", id);
      await admin.from("company_users").update({ role, traveler_id: traveler, name: str(body.name, 120), email }).eq("user_id", id);
    } else {
      const { data, error } = await admin.auth.admin.createUser({ email, password: body.password, email_confirm: true });
      if (error) return fail(error.message);
      uid = data.user.id;
      const { error: e1 } = await admin.from("profiles").insert({ id: uid, kind: "company", name: str(body.name, 120), email, status });
      const { error: e2 } = e1 ? { error: e1 } : await admin.from("company_users").insert({ user_id: uid, company_id: company.id, role, traveler_id: traveler, name: str(body.name, 120), email });
      if (e2) { await admin.auth.admin.deleteUser(uid!); return fail(e2.message); }
      if (status !== "active") await admin.auth.admin.updateUserById(uid!, { ban_duration: BAN });
    }
    await log(id ? "Edited company portal user" : "Added company portal user", `${company.name} · ${email}`);
    return json({ ok: true, id: uid });
  }
  if (action === "delete_company_user") {
    if (!canCorporate) return fail("Not allowed", 403);
    const { data: cu } = await admin.from("company_users").select("user_id, email").eq("user_id", str(body.id, 60)).maybeSingle();
    if (!cu) return fail("Not found", 404);
    const { error } = await admin.auth.admin.deleteUser(cu.user_id);
    if (error) return fail(error.message);
    await log("Deleted company portal user", cu.email);
    return json({ ok: true });
  }

  return fail("Unknown action");
});
