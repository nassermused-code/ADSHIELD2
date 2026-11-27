// Green Travel — the AI office ("المكتب الإلكتروني").
// A team of AI employees (general manager, secretary, accountant, legal, operations, customer service,
// marketing, HR) who work on the company's real data in Supabase.
//
// - The owner uses all of it (it spends Anthropic API credit); staff get a limited part (see below).
// - Each job is one employee working on one request. The general manager can delegate parts of a request
//   to other employees: each delegation becomes a child job, and the manager continues once they finish.
// - Safe actions run at once: reading data, writing documents, creating tasks for the human team, notes.
// - Actions that change money or reach customers (sending an email, recording an expense or a journal entry,
//   changing a booking) are saved as "waiting for approval"; they run only when the owner approves them.
// - The conversation of every job is saved after each step, so a job that is cut off resumes where it stopped.
// - Staff with the "ai_office" permission can also ask the AI employees from the back office; their jobs never
//   see costs, profit or expenses, and anything that needs approval still waits for the owner.
// - Always on: a worker (pg_cron, every minute) runs waiting jobs, starts schedules, reviews new bookings and
//   expiring held seats, and has the internal auditor review the human team's work every few hours.
// - Teamwork: when a person finishes a task an AI employee gave them, that employee follows up automatically.
// - Learning and growth: the owner rates each report (lessons are kept per employee), employees propose ideas
//   and improvements to their own instructions (the owner decides), and growth goals guide the whole team.
//
// Secrets (Supabase → Edge Functions → Secrets): ANTHROPIC_API_KEY (required), AI_MODEL (optional,
// default claude-opus-5-5), AI_EFFORT (optional: low | medium | high, default medium).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

// Sends like the back office: the company's cPanel mail server when SMTP_HOST/SMTP_USER/SMTP_PASS are set
// (SSL, port 465 by default), otherwise Resend (RESEND_API_KEY; EMAIL_FROM optional).
async function sendEmail(to: string, msg: { subject: string; html: string; text: string }) {
  const host = Deno.env.get("SMTP_HOST"), user = Deno.env.get("SMTP_USER"), pass = Deno.env.get("SMTP_PASS");
  if (host && user && pass) {
    const client = new SMTPClient({ connection: { hostname: host, port: Number(Deno.env.get("SMTP_PORT") || 465), tls: true, auth: { username: user, password: pass } } });
    try {
      await client.send({ from: `Green Travel <${user}>`, to, replyTo: "info@greentravel.us", subject: msg.subject, content: msg.text, html: msg.html });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: "send_failed: " + String((e as Error)?.message || e).slice(0, 300) };
    } finally {
      try { await client.close(); } catch { /* already closed */ }
    }
  }
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { ok: false, error: "email_not_configured" };
  const from = Deno.env.get("EMAIL_FROM") || "Green Travel <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], reply_to: "info@greentravel.us", subject: msg.subject, html: msg.html, text: msg.text }),
  });
  if (!res.ok) return { ok: false, error: "send_failed: " + (await res.text()).slice(0, 300) };
  return { ok: true };
}

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (msg: string, status = 400) => json({ error: msg }, status);
const str = (v: unknown, max = 400) => String(v ?? "").trim().slice(0, max);
const num = (v: unknown) => (Number.isFinite(+(v as number)) ? +(v as number) : 0);
const r2 = (n: number) => Math.round(n * 100) / 100;
const isDate = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);

const MODEL = Deno.env.get("AI_MODEL") || "claude-opus-5-5";
const EFFORT = ["low", "medium", "high", "xhigh"].includes(Deno.env.get("AI_EFFORT") || "") ? Deno.env.get("AI_EFFORT")! : "medium";
const TIME_BUDGET_MS = 75_000;   // do not start a new model call after this (edge functions stop at ~150 s)
const MAX_TURNS = 24;            // model calls per job, in total
const EXP_CATS = ["rent", "salaries", "marketing", "software", "utilities", "other"];
const METHODS = ["card", "cash", "bank", "zelle", "check"];
const ACCOUNTS: Record<string, string> = {
  "1010": "Cash on hand", "1020": "Bank", "1030": "Card receipts", "1100": "Receivable: customers", "1110": "Receivable: B2B agents",
  "1120": "Receivable: corporate clients", "1200": "Other assets", "2010": "Payable: airlines / suppliers", "2020": "Loans and other liabilities",
  "3010": "Owner's capital", "3020": "Owner's drawings", "3030": "Retained earnings (opening)", "4010": "Ticket sales", "4020": "Other income",
  "4030": "Corporate service fees", "5010": "Cost of tickets", "6010": "Rent", "6020": "Salaries", "6030": "Marketing", "6040": "Software",
  "6050": "Utilities", "6090": "Other expenses",
};

/* ------------------------------------------------------------------ */
/* The employees                                                        */
/* ------------------------------------------------------------------ */
const ROLES: Record<string, { duty: string; tools: string[] }> = {
  gm: {
    duty: `You are the General Manager. The owner gives you goals and requests. Plan the work, split it into clear assignments and
delegate each part to the right department with the delegate tool (you may delegate several parts at once). When the reports come back,
check them, combine them and give the owner one clear executive answer: what was done, the key numbers, decisions that need the owner,
and next steps. Do small things yourself when delegating would be slower. Departments: secretary, accountant, legal, operations,
customer_service, marketing, hr, auditor, innovation. Keep the company's growth goals in view (business_snapshot shows them).`,
    tools: ["delegate", "create_task", "save_document", "send_email"],
  },
  secretary: {
    duty: `You are the Secretary / front office. You write official letters, emails, memos, meeting agendas and minutes, organise the
owner's follow-ups as tasks with due dates, assign tasks to the human staff, and keep the office organised.`,
    tools: ["create_task", "save_document", "send_email"],
  },
  accountant: {
    duty: `You are the Accountant. You produce financial reports (income, expenses, profit, cash in/out), follow up receivables from
customers, B2B agents and companies, review expenses, prepare invoices and statements as documents, and propose bookkeeping entries.
Always compute from the data tools; never estimate numbers. Amounts are in USD.`,
    tools: ["financial_report", "receivables", "list_payments", "list_expenses", "record_expense", "journal_entry", "save_document", "create_task", "send_email"],
  },
  legal: {
    duty: `You are the Legal Affairs officer. You draft and review contracts (B2B agent agreements, corporate travel agreements,
employment contracts, supplier agreements), terms and conditions, refund and cancellation policies, privacy notices and formal notices.
You check compliance (passport validity of travelers, company credit terms, the US DOT 24-hour cancellation rule) and flag risks.
You are not a substitute for a licensed attorney: say so at the end of any contract, and mark points that need a lawyer's review.`,
    tools: ["compliance_check", "list_companies", "save_document", "create_task", "send_email"],
  },
  operations: {
    duty: `You are the Operations / reservations manager. You watch new and unconfirmed bookings, holds that are about to expire,
bookings without an assigned employee, upcoming departures and missing ticket numbers. You assign work to staff, update bookings,
and create follow-up tasks so that nothing is late.`,
    tools: ["upcoming_departures", "update_booking", "create_task", "save_document", "send_email"],
  },
  customer_service: {
    duty: `You are Customer Service. You write replies to customers (Arabic or English, as the customer wrote), follow up bookings,
send travel reminders and confirmations, handle complaints politely and propose solutions, and escalate to the right person as a task.`,
    tools: ["upcoming_departures", "update_booking", "create_task", "save_document", "send_email"],
  },
  marketing: {
    duty: `You are Sales & Marketing. You analyse which routes, airlines and customers bring the most business, write offers,
social-media posts, newsletters and campaign plans for Green Travel, find customers to contact again, and propose sales actions.`,
    tools: ["sales_stats", "save_document", "create_task", "send_email"],
  },
  hr: {
    duty: `You are Human Resources. You write job descriptions, job ads, employment and onboarding documents, staff policies,
leave and attendance procedures, and performance reviews. You look at the staff list and the workload of each employee (open tasks)
and propose a fair distribution of work.`,
    tools: ["staff_workload", "save_document", "create_task", "send_email"],
  },
  auditor: {
    duty: `You are the Internal Auditor. You review the work of the human team: bookings, tickets, payments, refunds and tasks.
Use audit_review to get the facts for the period, then check them: missing ticket numbers, tickets issued without payment,
sales below cost, bookings left new or unassigned, departures without tickets, refunds and payments that do not match,
duplicate payments, overdue tasks, and unusual actions in the activity log. Be fair and precise: separate real errors from
risks and from normal work, name the booking or task and the staff member, and never accuse without evidence.
For each real problem create a correction task for the responsible staff member (specific and polite, with a due date).
Save an audit report as a document, with a short score per staff member and what went well, and tell the owner clearly
about anything involving money.`,
    tools: ["audit_review", "staff_workload", "upcoming_departures", "financial_report", "receivables", "list_payments", "create_task", "save_document"],
  },
  innovation: {
    duty: `You are the Development & Innovation Manager. Your job is growth: find what makes Green Travel sell more, earn more and
serve better. Study the numbers (sales_stats, financial_report, business_snapshot with the goals), customers and the team's results,
then propose concrete ideas with propose_idea: new routes and markets, B2B and corporate partnerships, packages (Umrah, hotels,
insurance, car rental), pricing and margins, marketing, service quality and automation. Every idea needs a small, cheap experiment
and a clear way to measure it. Follow up on approved ideas: check their results with the data and record what was learned.
Think big (the owner's goal is to take the company to the top) but stay honest about numbers and risks.`,
    tools: ["propose_idea", "list_ideas", "sales_stats", "financial_report", "receivables", "staff_workload", "save_document", "create_task"],
  },
};
// Every employee can read the business data and keep notes.
const COMMON = ["business_snapshot", "search_bookings", "get_booking", "list_customers", "list_staff", "list_tasks", "remember", "recall", "propose_idea", "improve_my_work"];

const T = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): Anthropic.Beta.BetaTool =>
  ({ name, description, input_schema: { type: "object", properties, required } } as Anthropic.Beta.BetaTool);
const S = (d: string) => ({ type: "string", description: d });
const N = (d: string) => ({ type: "number", description: d });

const TOOLS: Record<string, Anthropic.Beta.BetaTool> = {
  business_snapshot: T("business_snapshot", "Overview of the company now: bookings by status, departures in the next 14 days, open tasks, pending approvals, this month's sales and collections."),
  search_bookings: T("search_bookings", "Search bookings. All filters are optional.", {
    query: S("Text to find in booking id, PNR, route, airline or customer name/phone/email"),
    status: S("new | quoted | confirmed | ticketed | cancelled | refunded"),
    from: S("Created on or after (YYYY-MM-DD)"), to: S("Created on or before (YYYY-MM-DD)"),
    limit: N("Max rows, default 30, max 100"),
  }),
  get_booking: T("get_booking", "Full details of one booking, including its payments.", { id: S("Booking id") }, ["id"]),
  list_customers: T("list_customers", "Customers built from bookings: name, phone, email, number of bookings, total spent, last booking date.", { query: S("Optional text filter"), limit: N("Max rows, default 50") }),
  list_staff: T("list_staff", "The human staff of the company (username, name, title, status). Use the username to assign tasks."),
  list_tasks: T("list_tasks", "Tasks of the human team.", { status: S("open | done (default open)"), limit: N("Max rows, default 50") }),
  remember: T("remember", "Save a note to the office memory (company facts, the owner's preferences, decisions). All employees see it later.", { topic: S("Short topic"), note: S("The note") }, ["topic", "note"]),
  recall: T("recall", "Search the office memory.", { query: S("Optional text to search") }),

  delegate: T("delegate", "Assign part of the work to a department. The department works on it and you receive its report as the result of this call.", {
    employee: { type: "string", enum: ["secretary", "accountant", "legal", "operations", "customer_service", "marketing", "hr", "auditor", "innovation"] },
    title: S("Short title of the assignment (Arabic)"),
    instructions: S("Complete instructions: what to do, what to deliver, any data or limits. The department sees only this text."),
  }, ["employee", "title", "instructions"]),
  create_task: T("create_task", "Create a task for the human team in the back office (runs at once).", {
    title: S("Task title"), details: S("Details"), assignee_username: S("Staff username (optional; without it the task goes to the owner)"),
    due: S("Due date YYYY-MM-DD (optional)"), priority: { type: "string", enum: ["high", "normal", "low"] }, booking_id: S("Related booking id (optional)"),
  }, ["title"]),
  save_document: T("save_document", "Save a finished document (letter, contract, report, email draft, policy, offer, invoice…) to the office documents. Write the body in Markdown. Runs at once.", {
    kind: { type: "string", enum: ["letter", "contract", "report", "memo", "email", "policy", "offer", "invoice", "minutes", "other"] },
    title: S("Document title"), body: S("Full document in Markdown"),
  }, ["kind", "title", "body"]),
  send_email: T("send_email", "Send an email. It is NOT sent immediately: it waits for the owner's approval in the AI office, then is sent.", {
    to: S("Recipient email"), subject: S("Subject"), body: S("Plain-text body"),
  }, ["to", "subject", "body"]),

  financial_report: T("financial_report", "Income statement for a period: ticket sales (by ticketing date), cost of tickets, B2B fees, corporate service fees, gross profit, expenses by category, net profit, cash received / paid / refunded, and breakdowns by source and airline.", {
    from: S("YYYY-MM-DD (default: first day of this month)"), to: S("YYYY-MM-DD (default: today)"),
  }),
  receivables: T("receivables", "Money not yet collected: per booking (sell minus payments received), grouped by customer, B2B agent and company, with days outstanding."),
  list_payments: T("list_payments", "Payments in a period.", { from: S("YYYY-MM-DD"), to: S("YYYY-MM-DD"), dir: S("in | out | refund (optional)") }),
  list_expenses: T("list_expenses", "Expenses in a period.", { from: S("YYYY-MM-DD"), to: S("YYYY-MM-DD") }),
  record_expense: T("record_expense", "Record an expense. Waits for the owner's approval.", {
    date: S("YYYY-MM-DD"), category: { type: "string", enum: EXP_CATS }, amount: N("Amount in USD"), method: { type: "string", enum: METHODS }, note: S("Note"),
  }, ["date", "category", "amount"]),
  journal_entry: T("journal_entry", `Propose a manual double-entry journal entry (capital, loans, opening balances, adjustments). Debits must equal credits. Waits for the owner's approval. Accounts: ${Object.entries(ACCOUNTS).map(([c, n]) => `${c} ${n}`).join("; ")}.`, {
    date: S("YYYY-MM-DD"), memo: S("Description"),
    lines: { type: "array", items: { type: "object", properties: { account: S("Account code"), debit: N("Debit"), credit: N("Credit"), note: S("Line note") }, required: ["account"] } },
  }, ["date", "memo", "lines"]),

  compliance_check: T("compliance_check", "Compliance checks: traveler passports expiring within 6 months, bookings departing soon without ticket numbers, companies over their credit limit, B2B agents over their credit limit."),
  list_companies: T("list_companies", "Corporate clients with credit limit, payment terms, service fee and status."),
  upcoming_departures: T("upcoming_departures", "Bookings departing in the next N days, plus new bookings not handled yet and holds that expire soon.", { days: N("Days ahead, default 14") }),
  update_booking: T("update_booking", "Change a booking: status, assigned employee, or add a note. Waits for the owner's approval.", {
    id: S("Booking id"), status: S("new | quoted | confirmed | cancelled (ticketing is done in the back office)"),
    assignee_username: S("Staff username to assign"), note: S("Text to add to the booking notes"),
  }, ["id"]),
  sales_stats: T("sales_stats", "Sales analysis for a period: by route, airline, source, month; top customers; customers who have not booked for 6+ months.", { from: S("YYYY-MM-DD (default: 12 months ago)"), to: S("YYYY-MM-DD (default: today)") }),
  staff_workload: T("staff_workload", "Each staff member with permissions, last login, open and overdue tasks, and bookings assigned."),
  audit_review: T("audit_review", "Facts for auditing the human team since a date: their actions from the activity log, booking problems, payment problems, overdue tasks, tasks finished, and a summary per staff member.", {
    since: S("Start of the period, YYYY-MM-DD or an ISO time (default: 24 hours ago)"),
  }),
};

Object.assign(TOOLS, {
  propose_idea: T("propose_idea", "Propose an idea to improve or grow the business. The owner approves or rejects it in the AI office; an approved idea is planned and carried out by the general manager.", {
    title: S("Short title (Arabic)"), problem: S("What problem or opportunity, with the numbers that show it"), idea: S("The idea, concretely"),
    impact: S("Expected impact (sales, profit, time saved, customer satisfaction), honest estimate"), effort: { type: "string", enum: ["low", "medium", "high"] },
    experiment: S("A small, cheap test and how its success will be measured"),
  }, ["title", "idea"]),
  list_ideas: T("list_ideas", "Ideas proposed so far, with the owner's decisions and recorded results.", { status: S("proposed | approved | rejected | done (optional)") }),
  improve_my_work: T("improve_my_work", "Propose a better version of your own standing instructions, based on what you learned (lessons, the owner's feedback, results). The owner approves it before it applies.", {
    instructions: S("The full new instructions for you (Arabic or English), replacing the current ones"), reason: S("What you learned that makes this better"),
  }, ["instructions", "reason"]),
});

// What a staff member's request may not see (costs, profit and expenses are owner-only)
const OWNER_ONLY_TOOLS = ["financial_report", "receivables", "list_expenses", "record_expense", "journal_entry", "audit_review", "improve_my_work", "list_ideas"];

function systemPrompt(code: string, staff: Record<string, any>, all: Record<string, any>[]) {
  const role = ROLES[code];
  const team = all.filter((s) => s.enabled).map((s) => `- ${s.code}: ${s.name} — ${s.title}`).join("\n");
  return `You are ${staff.name}, ${staff.title} (${code}) in the AI office of Green Travel (جرين ترافيل), a travel agency in Chicago, USA:
flights (domestic and international), hotels, visas, Umrah packages, B2B agents and corporate travel (TMC). Currency: USD.
Phones: +1 (708) 963-2552, +1 (708) 940-2929, +1 (331) 213-3768, +1 (708) 953-2244. Email info@greentravel.us. Site greentravel.us.

${role.duty}

The AI office team:
${team}

How you work:
- Write to the owner in clear Arabic (documents for customers or partners may be in English when that fits the recipient).
- Get facts from the tools. Never invent bookings, names, amounts or dates. If data is missing, say so and say what is needed.
- Do the work, do not only describe it: save finished documents with save_document, create tasks with create_task.
- Emails, expenses, journal entries and booking changes wait for the owner's approval; tell the owner they are waiting.
- Keep personal data (passports, phones) inside the company.
- Learn: follow the lessons in your memory, and save new lessons with remember when something works or fails.
- Improve the business: when you see a real opportunity, propose it with propose_idea (with a small test and a measure).
- When you finish, end with a short report: what you did, the results, and anything that needs the owner's decision.
${staff.instructions ? `\nInstructions from the owner for you:\n${staff.instructions}\n` : ""}`;
}

function volatileContext(memory: Record<string, any>[], code: string) {
  const general = memory.filter((m) => !m.scope || m.scope === "all").map((m) => `- [${m.topic}] ${m.note}`).join("\n");
  const mine = memory.filter((m) => m.scope === code).map((m) => `- [${m.topic}] ${m.note}`).join("\n");
  return `Today is ${today()}.${general ? `\nOffice memory (notes saved earlier):\n${general}` : ""}${mine ? `\nLessons for you from the owner's feedback and your past work:\n${mine}` : ""}`;
}

/* ------------------------------------------------------------------ */
/* Tools                                                                */
/* ------------------------------------------------------------------ */
type Ctx = { db: any; job: Record<string, any>; me: Record<string, any>; restricted?: boolean };

const pickBooking = (b: Record<string, any>) => ({
  id: b.id, created: b.created, source: b.source, status: b.status, customer: b.customer, route: b.route, airline: b.airline, cabin: b.cabin,
  depart: b.depart, ret: b.ret, pax: b.pax, pnr: b.pnr || "", tickets: b.tickets || [], sell: num(b.sell), assigned_to: b.assigned_to,
  ticketed_at: b.ticketed_at, notes: b.notes || "", company_id: b.company_id, partner_id: b.partner_id, hold_expires: b.hold_expires,
});

async function staffMap(db: any) {
  const { data } = await db.from("profiles").select("id,username,name,title,kind,status,perms,last_login").in("kind", ["owner", "staff"]);
  return (data || []) as Record<string, any>[];
}
async function allRows(db: any, table: string, sel = "*") {
  const { data, error } = await db.from(table).select(sel).range(0, 9999);
  if (error) throw new Error(error.message);
  return (data || []) as Record<string, any>[];
}
const period = (i: Record<string, any>, defFrom: string) => ({ from: isDate(i.from) ? i.from : defFrom, to: isDate(i.to) ? i.to : today() });
const inRange = (d: string | null, p: { from: string; to: string }) => !!d && d.slice(0, 10) >= p.from && d.slice(0, 10) <= p.to;

// Progress of this month against the owner's growth goals
async function goalProgress(db: any) {
  const { data: goals } = await db.from("ai_goals").select("*").eq("enabled", true);
  if (!goals?.length) return [];
  const month = today().slice(0, 7);
  const [bk, costs] = await Promise.all([allRows(db, "bookings"), allRows(db, "booking_costs")]);
  const cost = new Map(costs.map((c) => [c.booking_id, num(c.cost)]));
  const sold = bk.filter((b) => b.status === "ticketed" && (b.ticketed_at || "").startsWith(month));
  const firstSeen = new Map<string, string>();
  bk.forEach((b) => { const k = String(b.customer?.email || b.customer?.phone || "").toLowerCase(); if (k && (!firstSeen.has(k) || b.created < firstSeen.get(k)!)) firstSeen.set(k, b.created); });
  const values: Record<string, number> = {
    monthly_sales: r2(sold.reduce((s, b) => s + num(b.sell) + num(b.service_fee), 0)),
    monthly_profit: r2(sold.reduce((s, b) => s + num(b.sell) + num(b.service_fee) - (cost.get(b.id) || 0), 0)),
    monthly_tickets: sold.length,
    monthly_new_customers: [...firstSeen.values()].filter((d) => (d || "").startsWith(month)).length,
  };
  const day = new Date().getUTCDate(), days = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
  return goals.map((g: any) => ({ goal: g.title, metric: g.metric, target: num(g.target), this_month: values[g.metric] ?? 0,
    percent: Math.round(((values[g.metric] ?? 0) / num(g.target)) * 100), month_elapsed_percent: Math.round((day / days) * 100) }));
}

async function propose(ctx: Ctx, kind: string, summary: string, payload: Record<string, unknown>) {
  const { data, error } = await ctx.db.from("ai_actions").insert({ job_id: ctx.job.id, employee: ctx.job.employee, kind, summary, payload }).select("id").single();
  if (error) throw new Error(error.message);
  return { status: "waiting_for_owner_approval", action_id: data.id, note: "Saved. It will run when the owner approves it in the AI office." };
}

async function runTool(name: string, i: Record<string, any>, ctx: Ctx): Promise<unknown> {
  const { db } = ctx;
  switch (name) {
    case "business_snapshot": {
      const [bk, tk, pay, act] = await Promise.all([allRows(db, "bookings"), allRows(db, "tasks"), allRows(db, "payments"), db.from("ai_actions").select("id", { count: "exact", head: true }).eq("status", "pending")]);
      const month = today().slice(0, 7);
      const by: Record<string, number> = {};
      bk.forEach((b) => (by[b.status] = (by[b.status] || 0) + 1));
      const soon = addDays(today(), 14);
      return {
        goals: await goalProgress(db),
        bookings_total: bk.length, bookings_by_status: by,
        departing_next_14_days: bk.filter((b) => b.depart && b.depart >= today() && b.depart <= soon && !["cancelled", "refunded"].includes(b.status)).length,
        new_unhandled: bk.filter((b) => b.status === "new").length,
        tasks_open: tk.filter((t) => t.status === "open").length,
        tasks_overdue: tk.filter((t) => t.status === "open" && t.due && t.due < today()).length,
        ai_actions_waiting_approval: act.count || 0,
        this_month: {
          tickets_issued: bk.filter((b) => b.status === "ticketed" && (b.ticketed_at || "").startsWith(month)).length,
          sales: r2(bk.filter((b) => b.status === "ticketed" && (b.ticketed_at || "").startsWith(month)).reduce((s, b) => s + num(b.sell), 0)),
          collected: r2(pay.filter((p) => p.dir === "in" && (p.date || "").startsWith(month)).reduce((s, p) => s + num(p.amount), 0)),
        },
      };
    }
    case "search_bookings": {
      let q = db.from("bookings").select("*").order("created_at", { ascending: false }).limit(Math.min(num(i.limit) || 30, 100));
      if (i.status) q = q.eq("status", str(i.status, 20));
      if (isDate(i.from)) q = q.gte("created", i.from);
      if (isDate(i.to)) q = q.lte("created", i.to);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const t = str(i.query, 80).toLowerCase();
      const rows = (data || []).filter((b: any) => !t || JSON.stringify([b.id, b.pnr, b.route, b.airline, b.customer]).toLowerCase().includes(t));
      return { count: rows.length, bookings: rows.map(pickBooking) };
    }
    case "get_booking": {
      const id = str(i.id, 60);
      const { data: b } = await db.from("bookings").select("*").eq("id", id).maybeSingle();
      if (!b) return { error: "Booking not found" };
      const [{ data: pays }, { data: cost }] = await Promise.all([db.from("payments").select("date,dir,amount,method,ref,note").eq("booking_id", id), db.from("booking_costs").select("cost,fee").eq("booking_id", id).maybeSingle()]);
      const full = { ...pickBooking(b), travelers: b.travelers, segments: b.segments, baggage: b.baggage, cost: cost ? num(cost.cost) : null, b2b_fee: cost ? num(cost.fee) : null, payments: pays || [] };
      if (ctx.restricted) { delete (full as any).cost; delete (full as any).b2b_fee; }
      return full;
    }
    case "list_customers": {
      const bk = await allRows(db, "bookings", "customer,sell,status,created");
      const m = new Map<string, any>();
      bk.forEach((b) => {
        const c = b.customer || {};
        const key = (c.email || c.phone || c.name || "").toLowerCase();
        if (!key) return;
        const x = m.get(key) || { name: c.name, phone: c.phone, email: c.email, bookings: 0, spent: 0, last: "" };
        x.bookings++; if (b.status === "ticketed") x.spent = r2(x.spent + num(b.sell)); if (b.created > x.last) x.last = b.created;
        m.set(key, x);
      });
      const t = str(i.query, 80).toLowerCase();
      const rows = [...m.values()].filter((c) => !t || JSON.stringify(c).toLowerCase().includes(t)).sort((a, b) => b.spent - a.spent);
      return { count: rows.length, customers: rows.slice(0, Math.min(num(i.limit) || 50, 200)) };
    }
    case "list_staff":
      return (await staffMap(db)).map((s) => ({ username: s.username, name: s.name, title: s.title, kind: s.kind, status: s.status }));
    case "list_tasks": {
      const st = i.status === "done" ? "done" : "open";
      const [{ data }, staff] = await Promise.all([db.from("tasks").select("*").eq("status", st).order("created", { ascending: false }).limit(Math.min(num(i.limit) || 50, 200)), staffMap(db)]);
      const who = new Map(staff.map((s) => [s.id, s.username]));
      return (data || []).map((t: any) => ({ title: t.title, details: t.details, assignee: who.get(t.assignee) || "", due: t.due, priority: t.priority, status: t.status, booking_id: t.booking_id }));
    }
    case "remember": {
      await db.from("ai_memory").insert({ topic: str(i.topic, 80), note: str(i.note, 2000), employee: ctx.job.employee, scope: "all" });
      return { saved: true };
    }
    case "recall": {
      const { data } = await db.from("ai_memory").select("topic,note,employee,created_at").order("created_at", { ascending: false }).limit(200);
      const t = str(i.query, 80).toLowerCase();
      return (data || []).filter((m: any) => !t || (m.topic + " " + m.note).toLowerCase().includes(t)).slice(0, 50);
    }
    case "create_task": {
      const staff = await staffMap(db);
      const u = str(i.assignee_username, 40).toLowerCase();
      const assignee = (u && staff.find((s) => s.username === u)) || staff.find((s) => s.kind === "owner");
      if (u && assignee?.username !== u) return { error: `No staff member with username "${u}". Use list_staff.` };
      const row = { title: str(i.title, 200), details: `${str(i.details, 4000)}\n\n— ${ctx.job.employee} (AI office)`.trim(), assignee: assignee?.id || null, due: isDate(i.due) ? i.due : null,
        priority: ["high", "normal", "low"].includes(i.priority) ? i.priority : "normal", status: "open", booking_id: str(i.booking_id, 60) || null, created_by: ctx.me.id, ai_job_id: ctx.job.id };
      const { error } = await db.from("tasks").insert(row);
      if (error) return { error: error.message };
      return { created: true, assigned_to: assignee?.username || "" };
    }
    case "save_document": {
      const { data, error } = await db.from("ai_documents").insert({ job_id: ctx.job.id, employee: ctx.job.employee, kind: str(i.kind, 20) || "other", title: str(i.title, 200), body: String(i.body || "").slice(0, 100000) }).select("id").single();
      if (error) return { error: error.message };
      return { saved: true, document_id: data.id };
    }
    case "send_email": {
      const to = str(i.to, 200);
      if (!/^\S+@\S+\.\S+$/.test(to)) return { error: "Invalid email address" };
      return propose(ctx, "send_email", `إرسال بريد إلى ${to}: ${str(i.subject, 150)}`, { to, subject: str(i.subject, 200), body: String(i.body || "").slice(0, 20000) });
    }
    case "financial_report": {
      const p = period(i, today().slice(0, 8) + "01");
      const [bk, costs, pay, exp] = await Promise.all([allRows(db, "bookings"), allRows(db, "booking_costs"), allRows(db, "payments"), allRows(db, "expenses")]);
      const cost = new Map(costs.map((c) => [c.booking_id, c]));
      const sold = bk.filter((b) => b.status === "ticketed" && inRange(b.ticketed_at, p));
      const sales = sold.reduce((s, b) => s + num(b.sell), 0);
      const cogs = sold.reduce((s, b) => s + num(cost.get(b.id)?.cost), 0);
      const svc = sold.reduce((s, b) => s + num(b.service_fee), 0);
      const ex = exp.filter((x) => inRange(x.date, p));
      const expBy: Record<string, number> = {};
      ex.forEach((x) => (expBy[x.category] = r2((expBy[x.category] || 0) + num(x.amount))));
      const expenses = ex.reduce((s, x) => s + num(x.amount), 0);
      const group = (k: string) => { const o: Record<string, { tickets: number; sales: number; profit: number }> = {}; sold.forEach((b) => { const g = b[k] || "-"; o[g] = o[g] || { tickets: 0, sales: 0, profit: 0 }; o[g].tickets++; o[g].sales = r2(o[g].sales + num(b.sell)); o[g].profit = r2(o[g].profit + num(b.sell) - num(cost.get(b.id)?.cost)); }); return o; };
      const pp = pay.filter((x) => inRange(x.date, p));
      const sum = (d: string) => r2(pp.filter((x) => x.dir === d).reduce((s, x) => s + num(x.amount), 0));
      return { period: p, tickets_issued: sold.length, ticket_sales: r2(sales), corporate_service_fees: r2(svc), cost_of_tickets: r2(cogs), gross_profit: r2(sales + svc - cogs),
        expenses_total: r2(expenses), expenses_by_category: expBy, net_profit: r2(sales + svc - cogs - expenses),
        cash: { received_from_customers: sum("in"), paid_to_suppliers: sum("out"), refunded: sum("refund") }, by_source: group("source"), by_airline: group("airline") };
    }
    case "receivables": {
      const [bk, pay, partners, companies] = await Promise.all([allRows(db, "bookings"), allRows(db, "payments"), allRows(db, "partners", "id,agency,credit_limit"), allRows(db, "companies", "id,name,credit_limit,payment_terms")]);
      const paid = new Map<string, number>();
      pay.forEach((x) => { if (!x.booking_id) return; const v = x.dir === "in" ? num(x.amount) : x.dir === "refund" ? -num(x.amount) : 0; paid.set(x.booking_id, (paid.get(x.booking_id) || 0) + v); });
      const open = bk.filter((b) => b.status === "ticketed").map((b) => ({ id: b.id, customer: b.customer?.name || "", partner_id: b.partner_id, company_id: b.company_id, ticketed_at: b.ticketed_at, sell: num(b.sell), paid: r2(paid.get(b.id) || 0), due: r2(num(b.sell) + num(b.service_fee) - (paid.get(b.id) || 0)), days: b.ticketed_at ? Math.floor((Date.now() - Date.parse(b.ticketed_at)) / 864e5) : null })).filter((x) => x.due > 0.009);
      const pn = new Map(partners.map((x) => [x.id, x])), cn = new Map(companies.map((x) => [x.id, x]));
      const groups: Record<string, { type: string; name: string; due: number; bookings: number; oldest_days: number }> = {};
      open.forEach((x) => {
        const [type, key, name] = x.partner_id ? ["b2b_agent", x.partner_id, pn.get(x.partner_id)?.agency] : x.company_id ? ["company", x.company_id, cn.get(x.company_id)?.name] : ["customer", x.customer, x.customer];
        const g = (groups[type + key] = groups[type + key] || { type, name: name || "-", due: 0, bookings: 0, oldest_days: 0 });
        g.due = r2(g.due + x.due); g.bookings++; g.oldest_days = Math.max(g.oldest_days, x.days || 0);
      });
      // Payments not tied to a booking (agent / company account payments) reduce their balance
      pay.filter((x) => x.dir === "in" && !x.booking_id).forEach((x) => { const k = x.partner_id ? "b2b_agent" + x.partner_id : x.company_id ? "company" + x.company_id : ""; if (groups[k]) groups[k].due = r2(groups[k].due - num(x.amount)); });
      const list = Object.values(groups).filter((g) => g.due > 0.009).sort((a, b) => b.due - a.due);
      return { total_due: r2(list.reduce((s, g) => s + g.due, 0)), by_account: list, open_bookings: open.slice(0, 100) };
    }
    case "list_payments": {
      const p = period(i, addDays(today(), -30));
      let q = db.from("payments").select("date,dir,amount,method,booking_id,ref,note").gte("date", p.from).lte("date", p.to).order("date", { ascending: false }).limit(500);
      if (["in", "out", "refund"].includes(i.dir)) q = q.eq("dir", i.dir);
      const { data } = await q;
      return { period: p, payments: data || [] };
    }
    case "list_expenses": {
      const p = period(i, addDays(today(), -30));
      const { data } = await db.from("expenses").select("date,category,amount,method,note").gte("date", p.from).lte("date", p.to).order("date", { ascending: false }).limit(500);
      return { period: p, expenses: data || [] };
    }
    case "record_expense": {
      const amount = r2(num(i.amount));
      if (amount <= 0) return { error: "Amount must be more than 0" };
      const row = { date: isDate(i.date) ? i.date : today(), category: EXP_CATS.includes(i.category) ? i.category : "other", amount, method: METHODS.includes(i.method) ? i.method : "bank", note: str(i.note, 300) };
      return propose(ctx, "record_expense", `تسجيل مصروف ${row.category} بمبلغ $${amount} بتاريخ ${row.date}`, row);
    }
    case "journal_entry": {
      const lines = (Array.isArray(i.lines) ? i.lines : []).map((l: any) => ({ account: str(l.account, 10), debit: r2(num(l.debit)), credit: r2(num(l.credit)), note: str(l.note, 200) }));
      if (lines.length < 2 || lines.some((l: any) => !ACCOUNTS[l.account])) return { error: "Need 2+ lines with valid account codes" };
      const d = lines.reduce((s: number, l: any) => s + l.debit, 0), c = lines.reduce((s: number, l: any) => s + l.credit, 0);
      if (Math.abs(d - c) > 0.005 || d <= 0) return { error: `Debits (${d}) must equal credits (${c})` };
      const row = { date: isDate(i.date) ? i.date : today(), memo: str(i.memo, 300), lines };
      return propose(ctx, "journal_entry", `قيد يومية: ${row.memo} ($${r2(d)})`, row);
    }
    case "compliance_check": {
      const [tv, bk, co, pa, pay] = await Promise.all([allRows(db, "travelers", "first_name,last_name,company_id,passport_expiry,status"), allRows(db, "bookings"), allRows(db, "companies", "id,name,credit_limit,status"), allRows(db, "partners", "id,agency,credit_limit,status"), allRows(db, "payments")]);
      const six = addDays(today(), 183);
      const soon = addDays(today(), 7);
      const owed = (pred: (b: any) => boolean, payPred: (p: any) => boolean) => r2(bk.filter((b) => b.status === "ticketed" && pred(b)).reduce((s, b) => s + num(b.sell) + num(b.service_fee), 0) - pay.filter((p) => p.dir === "in" && payPred(p)).reduce((s, p) => s + num(p.amount), 0));
      return {
        passports_expiring_within_6_months: tv.filter((t) => t.status !== "inactive" && t.passport_expiry && t.passport_expiry <= six).map((t) => ({ name: `${t.first_name} ${t.last_name}`, expiry: t.passport_expiry })),
        departing_within_7_days_without_tickets: bk.filter((b) => b.depart && b.depart >= today() && b.depart <= soon && !["ticketed", "cancelled", "refunded"].includes(b.status)).map(pickBooking),
        companies_over_credit: co.map((c) => ({ name: c.name, limit: num(c.credit_limit), balance: owed((b) => b.company_id === c.id, (p) => p.company_id === c.id) })).filter((c) => c.limit > 0 && c.balance > c.limit),
        agents_over_credit: pa.map((a) => ({ agency: a.agency, limit: num(a.credit_limit), balance: owed((b) => b.partner_id === a.id, (p) => p.partner_id === a.id) })).filter((a) => a.limit > 0 && a.balance > a.limit),
      };
    }
    case "list_companies":
      return (await allRows(db, "companies", "name,legal_name,tax_id,email,credit_limit,payment_terms,service_fee,status,notes"));
    case "upcoming_departures": {
      const days = Math.min(Math.max(num(i.days) || 14, 1), 120);
      const [bk, staff] = await Promise.all([allRows(db, "bookings"), staffMap(db)]);
      const who = new Map(staff.map((s) => [s.id, s.username]));
      const end = addDays(today(), days);
      const live = (b: any) => !["cancelled", "refunded"].includes(b.status);
      const view = (b: any) => ({ ...pickBooking(b), assigned_to: who.get(b.assigned_to) || "" });
      return {
        departing: bk.filter((b) => live(b) && b.depart && b.depart >= today() && b.depart <= end).sort((a, b) => a.depart.localeCompare(b.depart)).map(view),
        new_not_handled: bk.filter((b) => b.status === "new").map(view),
        unassigned: bk.filter((b) => live(b) && b.status !== "ticketed" && !b.assigned_to).map(view),
        holds_expiring_48h: bk.filter((b) => live(b) && b.hold_expires && Date.parse(b.hold_expires) < Date.now() + 48 * 36e5 && b.status !== "ticketed").map(view),
      };
    }
    case "update_booking": {
      const id = str(i.id, 60);
      const { data: b } = await db.from("bookings").select("id,status,notes").eq("id", id).maybeSingle();
      if (!b) return { error: "Booking not found" };
      const change: Record<string, unknown> = { id };
      const parts: string[] = [];
      if (i.status) { if (!["new", "quoted", "confirmed", "cancelled"].includes(i.status)) return { error: "Status must be new, quoted, confirmed or cancelled" }; change.status = i.status; parts.push(`الحالة ← ${i.status}`); }
      if (i.assignee_username) { const s = (await staffMap(db)).find((x) => x.username === str(i.assignee_username, 40).toLowerCase()); if (!s) return { error: "No such staff username" }; change.assigned_to = s.id; parts.push(`إسناد إلى ${s.username}`); }
      if (i.note) { change.note = str(i.note, 1000); parts.push("إضافة ملاحظة"); }
      if (parts.length === 0) return { error: "Nothing to change" };
      return propose(ctx, "update_booking", `تعديل الحجز ${id}: ${parts.join("، ")}`, change);
    }
    case "sales_stats": {
      const p = period(i, addDays(today(), -365));
      const bk = (await allRows(db, "bookings")).filter((b) => b.status === "ticketed" && inRange(b.ticketed_at || b.created, p));
      const agg = (f: (b: any) => string) => { const o: Record<string, { tickets: number; sales: number }> = {}; bk.forEach((b) => { const k = f(b) || "-"; o[k] = o[k] || { tickets: 0, sales: 0 }; o[k].tickets++; o[k].sales = r2(o[k].sales + num(b.sell)); }); return Object.fromEntries(Object.entries(o).sort((a, b) => b[1].sales - a[1].sales).slice(0, 25)); };
      const all = await allRows(db, "bookings", "customer,created");
      const last = new Map<string, any>();
      all.forEach((b) => { const c = b.customer || {}; const k = (c.email || c.phone || "").toLowerCase(); if (!k) return; const x = last.get(k); if (!x || b.created > x.last) last.set(k, { name: c.name, phone: c.phone, email: c.email, last: b.created }); });
      const old = addDays(today(), -183);
      return { period: p, tickets: bk.length, sales: r2(bk.reduce((s, b) => s + num(b.sell), 0)), by_route: agg((b) => b.route), by_airline: agg((b) => b.airline), by_source: agg((b) => b.source), by_month: agg((b) => (b.ticketed_at || b.created || "").slice(0, 7)), top_customers: agg((b) => b.customer?.name), lapsed_customers: [...last.values()].filter((c) => c.last < old).slice(0, 100) };
    }
    case "staff_workload": {
      const [staff, tk, bk] = await Promise.all([staffMap(db), allRows(db, "tasks"), allRows(db, "bookings", "assigned_to,status")]);
      return staff.map((s) => ({ username: s.username, name: s.name, title: s.title, kind: s.kind, status: s.status, permissions: s.perms, last_login: s.last_login,
        open_tasks: tk.filter((t) => t.assignee === s.id && t.status === "open").length, overdue_tasks: tk.filter((t) => t.assignee === s.id && t.status === "open" && t.due && t.due < today()).length,
        active_bookings: bk.filter((b) => b.assigned_to === s.id && !["ticketed", "cancelled", "refunded"].includes(b.status)).length }));
    }
    case "propose_idea": {
      const effort = ["low", "medium", "high"].includes(i.effort) ? i.effort : "medium";
      const { data, error } = await db.from("ai_ideas").insert({ job_id: ctx.job.id, employee: ctx.job.employee, title: str(i.title, 200), problem: str(i.problem, 3000), idea: str(i.idea, 6000), impact: str(i.impact, 2000), effort, experiment: str(i.experiment, 3000) }).select("id").single();
      if (error) return { error: error.message };
      return { status: "waiting_for_owner_decision", idea_id: data.id };
    }
    case "list_ideas": {
      let q = db.from("ai_ideas").select("title,employee,idea,impact,effort,experiment,status,owner_note,result,created_at").order("created_at", { ascending: false }).limit(50);
      if (["proposed", "approved", "rejected", "done"].includes(i.status)) q = q.eq("status", i.status);
      const { data } = await q;
      return data || [];
    }
    case "improve_my_work": {
      const code = ctx.job.employee;
      return propose(ctx, "update_instructions", `تحسين تعليمات ${code}: ${str(i.reason, 140)}`, { employee: code, instructions: String(i.instructions || "").slice(0, 6000), reason: str(i.reason, 1000) });
    }
    case "audit_review": {
      const since = /^\d{4}-\d{2}-\d{2}/.test(String(i.since || "")) ? new Date(String(i.since)).toISOString() : new Date(Date.now() - 864e5).toISOString();
      const [staff, logRes, bk, costs, pay, tk] = await Promise.all([staffMap(db), db.from("activity_log").select("at,who,action,ref").gte("at", since).not("action", "like", "AI office%").order("at").limit(1000),
        allRows(db, "bookings"), allRows(db, "booking_costs"), allRows(db, "payments"), allRows(db, "tasks")]);
      const log: any[] = logRes.data || [];
      const who = new Map(staff.map((s) => [s.id, s.username || s.name]));
      const name = (id: string) => who.get(id) || (id ? "unknown" : "system/website");
      const cost = new Map(costs.map((c) => [c.booking_id, num(c.cost)]));
      const paidIn = new Map<string, number>(), refunded = new Map<string, number>();
      pay.forEach((x) => { if (!x.booking_id) return; if (x.dir === "in") paidIn.set(x.booking_id, (paidIn.get(x.booking_id) || 0) + num(x.amount)); if (x.dir === "refund") refunded.set(x.booking_id, (refunded.get(x.booking_id) || 0) + num(x.amount)); });
      const issues: any[] = [];
      const add = (b: any, problem: string, severity: "high" | "medium" | "low") => issues.push({ booking: b.id, assigned_to: name(b.assigned_to), status: b.status, problem, severity });
      const t0 = today(), soon = addDays(t0, 3);
      for (const b of bk) {
        const pax = num(b.pax) || 1;
        if (b.status === "ticketed") {
          if (!b.pnr) add(b, "ticketed without a PNR", "high");
          if ((b.tickets || []).filter(Boolean).length < pax) add(b, `ticketed with ${(b.tickets || []).filter(Boolean).length} ticket numbers for ${pax} travelers`, "high");
          if (cost.has(b.id) && num(b.sell) + num(b.service_fee) < cost.get(b.id)!) add(b, `sold below cost (sell ${num(b.sell)}, cost ${cost.get(b.id)})`, "high");
          const due = num(b.sell) + num(b.service_fee) - (paidIn.get(b.id) || 0);
          const days = b.ticketed_at ? Math.floor((Date.now() - Date.parse(b.ticketed_at)) / 864e5) : 0;
          if (due > 0.009 && days > 7 && !b.partner_id && !b.company_id) add(b, `customer still owes ${r2(due)} after ${days} days`, "medium");
        }
        if (b.status === "new" && b.created_at && Date.now() - Date.parse(b.created_at) > 24 * 36e5) add(b, "left as new for more than 24 hours", "medium");
        if (!["ticketed", "cancelled", "refunded"].includes(b.status) && !b.assigned_to) add(b, "not assigned to anyone", "low");
        if (!["ticketed", "cancelled", "refunded"].includes(b.status) && b.depart && b.depart >= t0 && b.depart <= soon) add(b, `departs ${b.depart} and is not ticketed`, "high");
        if (["cancelled", "refunded"].includes(b.status) && (paidIn.get(b.id) || 0) > (refunded.get(b.id) || 0) + 0.009) add(b, `cancelled but ${r2((paidIn.get(b.id) || 0) - (refunded.get(b.id) || 0))} received and not refunded`, "medium");
        if ((refunded.get(b.id) || 0) > (paidIn.get(b.id) || 0) + 0.009) add(b, "refunded more than was received", "high");
        if (b.assigned_to && staff.find((s) => s.id === b.assigned_to && s.status !== "active")) add(b, "assigned to an inactive staff member", "medium");
      }
      const recentPay = pay.filter((x) => (x.created_at || x.date) >= since);
      const payIssues: any[] = [];
      const seen = new Map<string, any>();
      recentPay.forEach((x) => {
        if (!x.booking_id && !x.partner_id && !x.company_id && x.dir === "in") payIssues.push({ date: x.date, amount: num(x.amount), by: name(x.created_by), problem: "payment not linked to a booking, agent or company" });
        const k = `${x.booking_id}|${x.dir}|${num(x.amount)}|${x.date}`;
        if (x.booking_id && seen.has(k)) payIssues.push({ date: x.date, amount: num(x.amount), booking: x.booking_id, by: name(x.created_by), problem: "possible duplicate payment (same booking, amount and day)" });
        seen.set(k, x);
      });
      const open = tk.filter((t) => t.status === "open");
      const overdue = open.filter((t) => t.due && t.due < t0).map((t) => ({ title: t.title, assignee: name(t.assignee), due: t.due, priority: t.priority, from_ai: /\(AI office\)/.test(t.details || "") }));
      const finished = tk.filter((t) => t.status === "done" && t.done_at && t.done_at >= since.slice(0, 10)).map((t) => ({ title: t.title, assignee: name(t.assignee), done_at: t.done_at }));
      const per: Record<string, any> = {};
      const P = (u: string) => (per[u] = per[u] || { actions: 0, tasks_done: 0, tasks_overdue: 0, booking_issues: 0, payments_recorded: 0 });
      log.forEach((l: any) => P(name(l.who)).actions++);
      finished.forEach((t) => P(t.assignee).tasks_done++);
      overdue.forEach((t) => P(t.assignee).tasks_overdue++);
      issues.forEach((x) => P(x.assigned_to).booking_issues++);
      recentPay.forEach((x) => P(name(x.created_by)).payments_recorded++);
      const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
      issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
      return { since, activity: log.slice(-300).map((l: any) => ({ at: l.at, by: name(l.who), action: l.action, ref: l.ref })), booking_issues: issues.slice(0, 200), payment_issues: payIssues, overdue_tasks: overdue, tasks_finished: finished, per_staff: per };
    }
  }
  return { error: `Unknown tool ${name}` };
}

/* ------------------------------------------------------------------ */
/* Running a job                                                        */
/* ------------------------------------------------------------------ */
const step = (kind: string, text: string) => ({ at: new Date().toISOString(), kind, text: text.slice(0, 600) });
const TOOL_LABEL: Record<string, string> = {
  business_snapshot: "اطّلع على الوضع العام للشركة", search_bookings: "بحث في الحجوزات", get_booking: "فتح ملف حجز", list_customers: "راجع قائمة العملاء",
  list_staff: "راجع قائمة الموظفين", list_tasks: "راجع المهام", remember: "حفظ ملاحظة في الذاكرة", recall: "راجع ذاكرة المكتب", delegate: "أسند مهمة",
  create_task: "أنشأ مهمة للفريق", save_document: "حفظ مستنداً", send_email: "جهّز بريداً (بانتظار موافقتك)", financial_report: "أعدّ تقريراً مالياً",
  receivables: "راجع الذمم والمستحقات", list_payments: "راجع المدفوعات", list_expenses: "راجع المصروفات", record_expense: "سجّل مصروفاً (بانتظار موافقتك)",
  journal_entry: "جهّز قيد يومية (بانتظار موافقتك)", compliance_check: "فحص الامتثال", list_companies: "راجع الشركات العميلة", upcoming_departures: "راجع الرحلات القادمة",
  update_booking: "جهّز تعديل حجز (بانتظار موافقتك)", sales_stats: "حلّل المبيعات", staff_workload: "راجع عبء العمل", audit_review: "دقّق في عمل الفريق",
  propose_idea: "اقترح فكرة (بانتظار قرارك)", list_ideas: "راجع الأفكار", improve_my_work: "اقترح تحسين طريقة عمله (بانتظار موافقتك)",
};

async function runJob(db: any, anthropic: Anthropic, me: Record<string, any>, job: Record<string, any>, started: number) {
  const save = (patch: Record<string, unknown>) => db.from("ai_jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", job.id);
  let messages: any[] = job.messages || [];
  let steps: any[] = job.steps || [];
  const usage = { input: num(job.usage?.input), output: num(job.usage?.output), cache_read: num(job.usage?.cache_read), turns: num(job.usage?.turns) };

  // Resume after delegated work: all children must be finished
  const pend = job.pending || {};
  if (pend.waits && Object.keys(pend.waits).length) {
    const ids = Object.values(pend.waits) as string[];
    const { data: kids } = await db.from("ai_jobs").select("id,employee,title,status,result,error").in("id", ids);
    const open = (kids || []).filter((k: any) => !["done", "failed", "cancelled"].includes(k.status));
    if (open.length) { await save({ status: "waiting" }); return { status: "waiting", children: open.map((k: any) => k.id) }; }
    const byId = new Map((kids || []).map((k: any) => [k.id, k]));
    const results = [...(pend.results || [])];
    for (const [toolId, kidId] of Object.entries(pend.waits)) {
      const k: any = byId.get(kidId as string);
      results.push({ type: "tool_result", tool_use_id: toolId, content: k?.status === "done" ? `Report from ${k.employee}:\n${k.result || "(no report)"}` : `The ${k?.employee || "department"} could not finish: ${k?.error || k?.status}`, is_error: k?.status !== "done" });
    }
    const order: string[] = pend.order || [];
    results.sort((a, b) => order.indexOf(a.tool_use_id) - order.indexOf(b.tool_use_id));
    messages = [...messages, { role: "user", content: results }];
    steps = [...steps, step("info", "وصلت تقارير الأقسام، يتابع المدير العمل")];
    await save({ messages, pending: {}, steps });
  }

  const [{ data: staffAll }, { data: memory }] = await Promise.all([db.from("ai_staff").select("*").order("sort"), db.from("ai_memory").select("topic,note,scope").or(`scope.eq.all,scope.eq.${job.employee}`).order("created_at", { ascending: false }).limit(60)]);
  const staff = (staffAll || []).find((s: any) => s.code === job.employee);
  if (!staff || !ROLES[job.employee]) { await save({ status: "failed", error: "Unknown employee" }); return { status: "failed" }; }
  const restricted = job.source === "staff";
  const names = [...new Set([...COMMON, ...ROLES[job.employee].tools])].filter((n) => !restricted || !OWNER_ONLY_TOOLS.includes(n));
  const tools = names.map((n) => TOOLS[n]);
  const system: any[] = [
    { type: "text", text: systemPrompt(job.employee, staff, staffAll || []), cache_control: { type: "ephemeral" } },
    { type: "text", text: volatileContext(memory || [], job.employee) },
  ];
  if (restricted) {
    const { data: asker } = await db.from("profiles").select("name,username,title").eq("id", job.requested_by).maybeSingle();
    system.push({ type: "text", text: `This request comes from a staff member, not the owner: ${asker?.name || "staff"} (${asker?.username || ""}${asker?.title ? ", " + asker.title : ""}). Help them with their work. Never reveal costs, profit, margins, supplier payments, expenses or other staff members' performance. Anything that needs approval still goes to the owner.` });
  } else if (job.source === "watch") {
    system.push({ type: "text", text: "This job was started automatically by the office's 24/7 monitoring, not by a person. Act on what needs action, keep the report short, and do not create duplicate tasks: check list_tasks first." });
  }
  if (messages.length === 0) messages = [{ role: "user", content: job.request }];

  while (true) {
    if (usage.turns >= MAX_TURNS) { await save({ status: "failed", error: "Too many steps", steps: [...steps, step("error", "توقف: تجاوز الحد الأقصى للخطوات")] }); return { status: "failed" }; }
    if (Date.now() - started > TIME_BUDGET_MS) { await save({ status: "queued", messages, steps, usage }); return { status: "queued", continue: true }; }

    let res: any;
    try {
      res = await anthropic.beta.messages.create({
        model: MODEL, max_tokens: 16000, system, tools, messages,
        output_config: { effort: EFFORT },
        cache_control: { type: "ephemeral" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      } as any);
    } catch (e) {
      const msg = e instanceof Anthropic.AuthenticationError ? "مفتاح Anthropic غير صحيح (ANTHROPIC_API_KEY)"
        : e instanceof Anthropic.RateLimitError ? "تم تجاوز حد الاستخدام مؤقتاً، أعد المحاولة بعد دقيقة"
        : e instanceof Anthropic.APIError ? `Anthropic API ${e.status}: ${e.message}` : String((e as Error)?.message || e);
      const retry = e instanceof Anthropic.RateLimitError || (e instanceof Anthropic.APIError && (e.status ?? 0) >= 500);
      await save({ status: retry ? "queued" : "failed", error: msg, steps: [...steps, step("error", msg)] });
      return { status: retry ? "queued" : "failed", error: msg };
    }
    usage.turns++;
    usage.input += num(res.usage?.input_tokens); usage.output += num(res.usage?.output_tokens); usage.cache_read += num(res.usage?.cache_read_input_tokens);

    if (res.stop_reason === "refusal") {
      await save({ status: "failed", error: "refusal", steps: [...steps, step("error", "اعتذر الموظف عن تنفيذ هذا الطلب")], usage });
      return { status: "failed" };
    }
    messages = [...messages, { role: "assistant", content: res.content }];
    const text = res.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
    const calls = res.content.filter((b: any) => b.type === "tool_use");

    if (res.stop_reason === "pause_turn") { await save({ messages, usage }); continue; }
    if (calls.length === 0) {
      const done = res.stop_reason !== "max_tokens";
      await save({ status: done ? "done" : "failed", result: text || "(لا يوجد تقرير)", messages, usage, done_at: new Date().toISOString(), error: done ? null : "max_tokens",
        steps: [...steps, step(done ? "done" : "error", done ? "أنهى العمل وسلّم التقرير" : "انقطع الرد لطوله")] });
      if (done && job.schedule_id && !job.parent_id) await emailReport(db, job, text);
      return { status: done ? "done" : "failed" };
    }
    if (text) steps = [...steps, step("note", text)];

    const ctx: Ctx = { db, job, me, restricted };
    const results: any[] = [];
    const waits: Record<string, string> = {};
    for (const c of calls) {
      const input = (c.input && typeof c.input === "object") ? c.input : {};
      if (c.name === "delegate" && job.employee === "gm") {
        const emp = str(input.employee, 30);
        if (!ROLES[emp] || emp === "gm" || !(staffAll || []).find((s: any) => s.code === emp && s.enabled)) { results.push({ type: "tool_result", tool_use_id: c.id, content: `Unknown or disabled department "${emp}"`, is_error: true }); continue; }
        const { data: kid, error } = await db.from("ai_jobs").insert({ parent_id: job.id, employee: emp, title: str(input.title, 200) || "مهمة", request: String(input.instructions || "").slice(0, 20000), created_by: me.id, source: job.source, requested_by: job.requested_by || null }).select("id").single();
        if (error) { results.push({ type: "tool_result", tool_use_id: c.id, content: error.message, is_error: true }); continue; }
        waits[c.id] = kid.id;
        const nm = (staffAll || []).find((s: any) => s.code === emp);
        steps = [...steps, step("delegate", `أسند إلى ${nm?.name} (${nm?.title}): ${str(input.title, 200)}`)];
        continue;
      }
      if (!names.includes(c.name)) { results.push({ type: "tool_result", tool_use_id: c.id, content: `Tool ${c.name} is not available to you`, is_error: true }); continue; }
      try {
        const out = await runTool(c.name, input, ctx);
        const isErr = !!(out && typeof out === "object" && "error" in (out as any));
        results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(out).slice(0, 60000), ...(isErr ? { is_error: true } : {}) });
        const label = TOOL_LABEL[c.name] || c.name;
        const extra = c.name === "save_document" ? `: ${str(input.title, 120)}` : c.name === "create_task" ? `: ${str(input.title, 120)}` : "";
        steps = [...steps, step(isErr ? "error" : "tool", `${label}${extra}${isErr ? ` — ${(out as any).error}` : ""}`)];
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: c.id, content: `Error: ${(e as Error).message}`, is_error: true });
        steps = [...steps, step("error", `${TOOL_LABEL[c.name] || c.name} — ${(e as Error).message}`)];
      }
    }
    if (Object.keys(waits).length) {
      await save({ status: "waiting", messages, pending: { results, waits, order: calls.map((c: any) => c.id) }, steps, usage });
      return { status: "waiting", children: Object.values(waits) };
    }
    messages = [...messages, { role: "user", content: results }];
    await save({ messages, steps, usage });
  }
}

/* ------------------------------------------------------------------ */
/* Approvals                                                            */
/* ------------------------------------------------------------------ */
async function execute(db: any, me: Record<string, any>, a: Record<string, any>): Promise<string> {
  const p = a.payload || {};
  if (a.kind === "send_email") {
    const esc = (s: string) => s.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]!));
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;white-space:pre-wrap" dir="auto">${esc(p.body)}</div><p style="color:#667;font-size:13px">Green Travel · greentravel.us · +1 (708) 963-2552</p>`;
    const r = await sendEmail(p.to, { subject: p.subject, html, text: p.body });
    if (!r.ok) throw new Error(r.error === "email_not_configured" ? "البريد غير مفعّل بعد (إعدادات SMTP أو RESEND_API_KEY)" : r.error);
    return `أُرسل إلى ${p.to}`;
  }
  if (a.kind === "record_expense") {
    const { error } = await db.from("expenses").insert(p);
    if (error) throw new Error(error.message);
    return "سُجّل المصروف";
  }
  if (a.kind === "journal_entry") {
    const { error } = await db.from("journal_entries").insert({ ...p, created_by: me.id });
    if (error) throw new Error(error.message);
    return "سُجّل القيد";
  }
  if (a.kind === "update_booking") {
    const patch: Record<string, unknown> = {};
    if (p.status) patch.status = p.status;
    if (p.assigned_to) patch.assigned_to = p.assigned_to;
    if (p.note) {
      const { data: b } = await db.from("bookings").select("notes").eq("id", p.id).single();
      patch.notes = `${b?.notes ? b.notes + "\n" : ""}[${today()}] ${p.note}`;
    }
    const { error } = await db.from("bookings").update(patch).eq("id", p.id);
    if (error) throw new Error(error.message);
    return "عُدّل الحجز";
  }
  if (a.kind === "update_instructions") {
    const { error } = await db.from("ai_staff").update({ instructions: String(p.instructions || "").slice(0, 6000) }).eq("code", p.employee);
    if (error) throw new Error(error.message);
    return "حُدّثت تعليمات الموظف";
  }
  throw new Error("Unknown action");
}

/* ------------------------------------------------------------------ */
/* Background worker and schedules                                      */
/* ------------------------------------------------------------------ */
// A scheduled job's report goes by email to the address the owner chose for that schedule.
async function emailReport(db: any, job: Record<string, any>, text: string) {
  try {
    const { data: s } = await db.from("ai_schedules").select("email_to,title").eq("id", job.schedule_id).maybeSingle();
    const to = str(s?.email_to, 200);
    if (!/^\S+@\S+\.\S+$/.test(to)) return;
    const esc = (x: string) => x.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]!));
    const html = `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.8;white-space:pre-wrap">${esc(text)}</div><p style="color:#667;font-size:13px">المكتب الإلكتروني · Green Travel</p>`;
    await sendEmail(to, { subject: `${job.title} · ${today()}`, html, text });
  } catch (_) { /* the report stays in the AI office either way */ }
}

// Runs every minute from pg_cron, so the work goes on with no browser open:
// starts due schedules, then continues up to 3 jobs that are waiting to run.
async function tick(db: any, started: number) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  const { data: owner } = await db.from("profiles").select("*").eq("kind", "owner").eq("status", "active").limit(1).maybeSingle();
  if (!owner) return { idle: "no owner" };
  const created: string[] = [];
  const { data: due } = await db.from("ai_schedules").select("*").eq("enabled", true).lte("next_run", new Date().toISOString());
  for (const s of due || []) {
    // Move the schedule forward first, so a slow tick never starts it twice
    const { data: took } = await db.rpc("ai_schedule_take", { p_id: s.id, p_expected: s.next_run });
    if (took !== true) continue;
    if (!key) continue;
    const { data: j } = await db.from("ai_jobs").insert({ employee: s.employee, title: s.title, request: s.request, schedule_id: s.id, created_by: owner.id, steps: [step("info", "بدأ تلقائياً حسب الجدول")] }).select("id").single();
    if (j) created.push(j.id);
  }
  if (!key) return { idle: "no ANTHROPIC_API_KEY", schedules: (due || []).length };
  created.push(...(await watch(db, owner)));
  const anthropic = new Anthropic({ apiKey: key, maxRetries: 2, timeout: 120_000 });
  const ran: unknown[] = [];
  // Several short rounds while time allows: departments first, then the manager who waits for them
  for (let round = 0; round < 4 && Date.now() - started < 45_000; round++) {
    const r = await tickRound(db, anthropic, owner, started);
    ran.push(...r);
    if (!r.length) break;
  }
  return { created, ran };
}

// Always-on monitoring. It costs nothing while nothing happens: an AI job starts only when there is something to do.
async function watch(db: any, owner: Record<string, any>) {
  const { data: cfg } = await db.from("ai_settings").select("*").eq("id", 1).maybeSingle();
  if (!cfg) return [];
  const started: string[] = [];
  const claim = async (keys: string[]) => {
    if (!keys.length) return [];
    const { data } = await db.from("ai_watch").upsert(keys.map((key) => ({ key })), { onConflict: "key", ignoreDuplicates: true }).select("key");
    return (data || []).map((r: any) => r.key as string);
  };
  const newJob = async (employee: string, title: string, request: string) => {
    const { data } = await db.from("ai_jobs").insert({ employee, title, request, source: "watch", created_by: owner.id, steps: [step("info", "بدأ تلقائياً من المراقبة الدائمة")] }).select("id").single();
    if (data) started.push(data.id);
  };
  const { data: staffOn } = await db.from("ai_staff").select("code").eq("enabled", true);
  const on = (code: string) => (staffOn || []).some((x: any) => x.code === code);

  // 1) New bookings from the website, agents or staff: review them a few minutes after they arrive
  if (cfg.watch_bookings && on("operations")) {
    const { data: fresh } = await db.from("bookings").select("id").eq("status", "new").lt("created_at", new Date(Date.now() - 3 * 6e4).toISOString()).gt("created_at", new Date(Date.now() - 3 * 864e5).toISOString()).limit(30);
    const ids = (await claim((fresh || []).map((b: any) => "booking:" + b.id))).map((k: string) => k.slice(8));
    if (ids.length) await newJob("operations", `مراجعة ${ids.length === 1 ? "حجز جديد" : ids.length + " حجوزات جديدة"}`,
      `وصلت حجوزات جديدة: ${ids.join("، ")}.\nافتح كل حجز وتأكد من اكتمال البيانات (أسماء المسافرين كما في الجواز، التواريخ، وسيلة التواصل). إن لم يكن الحجز مسنداً لموظف فاقترح إسناده لموظف مناسب حسب عبء العمل، وأنشئ مهمة متابعة واضحة للموظف المسؤول. اكتب ملخصاً قصيراً.`);
  }
  // 2) Held seats that expire within 6 hours and are not ticketed: urgent follow-up
  if (cfg.watch_holds && on("operations")) {
    const { data: holds } = await db.from("bookings").select("id,hold_expires").not("status", "in", "(ticketed,cancelled,refunded)").gt("hold_expires", new Date().toISOString()).lt("hold_expires", new Date(Date.now() + 6 * 36e5).toISOString()).limit(30);
    const ids = (await claim((holds || []).map((b: any) => "hold:" + b.id))).map((k: string) => k.slice(5));
    if (ids.length) await newJob("operations", `عاجل: حجوزات مؤقتة تنتهي قريباً (${ids.length})`,
      `هذه الحجوزات المؤقتة تنتهي خلال 6 ساعات ولم تُصدر تذاكرها: ${ids.join("، ")}.\nلكل حجز: أنشئ مهمة عاجلة (priority high) للموظف المسند إليه، أو للمالك إن لم يكن مسنداً، تذكر موعد الانتهاء وما يلزم (الدفع ثم الإصدار، أو التواصل مع العميل).`);
  }
  // 3) Teamwork: a person finished a task that an AI employee gave them, so that employee follows up
  if (cfg.watch_tasks) {
    const { data: done } = await db.from("tasks").select("id,title,details,assignee,booking_id,ai_job_id,done_at").eq("status", "done").not("ai_job_id", "is", null).gte("done_at", addDays(today(), -2)).limit(50);
    const keys = await claim((done || []).map((t: any) => "taskdone:" + t.id));
    const fresh = (done || []).filter((t: any) => keys.includes("taskdone:" + t.id));
    if (fresh.length) {
      const { data: srcJobs } = await db.from("ai_jobs").select("id,employee,title,parent_id").in("id", [...new Set(fresh.map((t: any) => t.ai_job_id))]);
      const { data: people } = await db.from("profiles").select("id,name,username").in("id", [...new Set(fresh.map((t: any) => t.assignee).filter(Boolean))]);
      const by = new Map<string, any[]>();
      for (const t of fresh) {
        const j = (srcJobs || []).find((x: any) => x.id === t.ai_job_id);
        if (!j || !on(j.employee)) continue;
        const list = by.get(j.employee) || [];
        const who = (people || []).find((x: any) => x.id === t.assignee);
        list.push(`- «${t.title}» — أنجزها ${who?.name || "موظف"} (${who?.username || ""})${t.booking_id ? ` — الحجز ${t.booking_id}` : ""} — من عملك: «${j.title}»`);
        by.set(j.employee, list);
      }
      for (const [emp, lines] of by) await newJob(emp, `متابعة ما أنجزه الفريق (${lines.length})`,
        `أنجز موظفو الفريق هذه المهام التي كلّفتهم بها:\n${lines.join("\n")}\nتحقق من النتيجة في البيانات (الحجز، المدفوعات…). إن اكتملت فسجّل ذلك باختصار، وإن بقيت خطوة تالية فنفّذها أو كلّف بها الموظف المناسب. احفظ أي درس مفيد.`);
    }
  }
  // 4) The internal auditor reviews the human team's work every N hours, when there was work to review
  if (cfg.audit_hours > 0 && on("auditor")) {
    const last = cfg.last_audit ? Date.parse(cfg.last_audit) : 0;
    if (Date.now() - last >= cfg.audit_hours * 36e5) {
      const since = new Date(last || Date.now() - 864e5).toISOString();
      const [{ count: acts }, { count: pays }] = await Promise.all([
        db.from("activity_log").select("id", { count: "exact", head: true }).gte("at", since).not("who", "is", null).not("action", "like", "AI office%"),
        db.from("payments").select("id", { count: "exact", head: true }).gte("created_at", since)]);
      // The clock moves only when an audit starts: a quiet period does not delay the next one
      if ((acts || 0) + (pays || 0) > 0 && (await claim(["audit:" + since])).length) {
        await db.from("ai_settings").update({ last_audit: new Date().toISOString() }).eq("id", 1);
        await newJob("auditor", `تدقيق عمل الفريق منذ ${since.slice(0, 16).replace("T", " ")}`,
        `دقّق في عمل الفريق البشري منذ ${since}. استخدم audit_review بهذا التاريخ. أنشئ مهام تصحيح للمسؤولين عن الأخطاء الحقيقية، واحفظ تقرير التدقيق كمستند، وأعطني الخلاصة.`);
      }
    }
  }
  return started;
}

async function tickRound(db: any, anthropic: Anthropic, owner: Record<string, any>, started: number) {
  const stale = new Date(Date.now() - 170_000).toISOString();
  const { data: cand } = await db.from("ai_jobs").select("id,status,pending,updated_at").or(`status.eq.queued,status.eq.waiting,and(status.eq.running,updated_at.lt.${stale})`).order("created_at").limit(30);
  const ready: string[] = [];
  for (const j of cand || []) {
    if (j.status === "waiting") {
      const kids = Object.values(j.pending?.waits || {}) as string[];
      if (kids.length) {
        const { data: k } = await db.from("ai_jobs").select("status").in("id", kids);
        if ((k || []).some((x: any) => !["done", "failed", "cancelled"].includes(x.status))) continue;
      }
    }
    ready.push(j.id);
    if (ready.length >= 3) break;
  }
  const results = await Promise.all(ready.map(async (id) => {
    const { data: claimed } = await db.rpc("ai_claim_job", { p_id: id });
    const job = (claimed || [])[0];
    if (!job) return { id, skipped: true };
    try { return { id, ...(await runJob(db, anthropic, owner, job, started)) }; }
    catch (e) { await db.from("ai_jobs").update({ status: "failed", error: String((e as Error).message || e), updated_at: new Date().toISOString() }).eq("id", id); return { id, status: "failed" }; }
  }));
  return results.filter((x: any) => !x.skipped);
}

// Two-step verification: the session's level (aal) comes from the signed token that getUser just checked
const tokenAal = (t: string) => { try { const p = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); return String(JSON.parse(atob(p + "=".repeat((4 - p.length % 4) % 4))).aal || ""); } catch { return ""; } };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("POST only", 405);
  const started = Date.now();
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const workerKey = req.headers.get("x-worker-key");
  if (workerKey) {
    const { data: ok } = await db.rpc("ai_worker_check", { p_key: workerKey });
    if (ok !== true) return fail("Bad worker key", 403);
    return json(await tick(db, started));
  }
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who } = await db.auth.getUser(token);
  if (!who?.user) return fail("Not signed in", 401);
  const { data: me } = await db.from("profiles").select("*").eq("id", who.user.id).single();
  const isOwner = me?.kind === "owner";
  if (!me || me.status !== "active" || !(isOwner || (me.kind === "staff" && (me.perms || []).includes("ai_office")))) return fail("Not allowed", 403);
  { const { data: mfa } = await db.rpc("mfa_ok_for", { p_uid: who.user.id, p_aal: tokenAal(token) }); if (mfa !== true) return fail("Two-step verification needed", 403); }
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return fail("Bad JSON"); }
  // A staff member works only with the jobs they asked for (and the departments' parts of those jobs)
  const mine = async (id: string) => {
    if (isOwner) return true;
    const { data: j } = await db.from("ai_jobs").select("requested_by,parent_id").eq("id", id).maybeSingle();
    if (!j) return false;
    if (j.requested_by === me.id) return true;
    if (!j.parent_id) return false;
    const { data: p } = await db.from("ai_jobs").select("requested_by").eq("id", j.parent_id).maybeSingle();
    return p?.requested_by === me.id;
  };
  if (!isOwner && !["status", "staff_list", "create", "run", "my_jobs", "followup", "cancel"].includes(body.action)) return fail("Only the owner can do this", 403);
  if (["run", "followup", "cancel"].includes(body.action) && !(await mine(str(body.id, 60)))) return fail("Not your request", 403);
  const log = (action: string, ref = "") => db.from("activity_log").insert({ who: me.id, action, ref });

  if (body.action === "status") return json({ configured: !!Deno.env.get("ANTHROPIC_API_KEY"), model: MODEL, effort: EFFORT, email: !!((Deno.env.get("SMTP_HOST") && Deno.env.get("SMTP_USER") && Deno.env.get("SMTP_PASS")) || Deno.env.get("RESEND_API_KEY")), background: true });

  if (body.action === "staff_list") {
    const { data } = await db.from("ai_staff").select("code,name,title").eq("enabled", true).order("sort");
    return json({ staff: (data || []).filter((s: any) => isOwner || !["auditor", "innovation"].includes(s.code)) });
  }

  if (body.action === "my_jobs") {
    // For the back office: a staff member's own requests, their results and documents
    const { data: jobs } = await db.from("ai_jobs").select("id,employee,title,request,status,result,error,created_at,done_at").eq("requested_by", me.id).is("parent_id", null).order("created_at", { ascending: false }).limit(50);
    const ids = (jobs || []).map((j: any) => j.id);
    const { data: kids } = ids.length ? await db.from("ai_jobs").select("id,parent_id").in("parent_id", ids) : { data: [] };
    const all = [...ids, ...(kids || []).map((k: any) => k.id)];
    const { data: docs } = all.length ? await db.from("ai_documents").select("id,job_id,kind,title,body,created_at").in("job_id", all) : { data: [] };
    const top = new Map((kids || []).map((k: any) => [k.id, k.parent_id]));
    return json({ jobs: (jobs || []).map((j: any) => ({ ...j, documents: (docs || []).filter((d: any) => (top.get(d.job_id) || d.job_id) === j.id) })) });
  }

  if (body.action === "run_schedule") {
    const { data: s } = await db.from("ai_schedules").select("*").eq("id", str(body.id, 60)).maybeSingle();
    if (!s) return fail("Schedule not found", 404);
    const { data, error } = await db.from("ai_jobs").insert({ employee: s.employee, title: s.title, request: s.request, schedule_id: s.id, created_by: me.id, steps: [step("info", "بدأ يدوياً من الجدول")] }).select("id").single();
    if (error) return fail(error.message);
    await db.from("ai_schedules").update({ last_run: new Date().toISOString() }).eq("id", s.id);
    return json({ ok: true, id: data.id });
  }

  if (body.action === "create") {
    const employee = str(body.employee, 30) || "gm";
    if (!ROLES[employee] || (!isOwner && ["auditor", "innovation"].includes(employee))) return fail("Unknown employee");
    const request = String(body.request || "").trim().slice(0, 20000);
    if (request.length < 2) return fail("Write the request");
    const title = str(body.title, 200) || request.split("\n")[0].slice(0, 90);
    const { data, error } = await db.from("ai_jobs").insert({ employee, title, request, created_by: me.id, requested_by: me.id, source: isOwner ? "owner" : "staff", steps: [step("info", isOwner ? "استلم الطلب" : `استلم الطلب من ${me.name}`)] }).select("id").single();
    if (error) return fail(error.message);
    await log("AI office: new request", `${employee}: ${title}`);
    return json({ ok: true, id: data.id });
  }

  if (body.action === "run") {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return fail("ANTHROPIC_API_KEY is not set in Supabase secrets", 412);
    const { data: claimed, error } = await db.rpc("ai_claim_job", { p_id: str(body.id, 60) });
    if (error) return fail(error.message, 500);
    const job = (claimed || [])[0];
    if (!job) {
      const { data: j } = await db.from("ai_jobs").select("id,status").eq("id", str(body.id, 60)).maybeSingle();
      return j ? json({ status: j.status, busy: j.status === "running" }) : fail("Job not found", 404);
    }
    try {
      return json(await runJob(db, new Anthropic({ apiKey: key, maxRetries: 2, timeout: 120_000 }), me, job, started));
    } catch (e) {
      await db.from("ai_jobs").update({ status: "failed", error: String((e as Error).message || e), updated_at: new Date().toISOString() }).eq("id", job.id);
      return fail(String((e as Error).message || e), 500);
    }
  }

  if (body.action === "cancel") {
    const id = str(body.id, 60);
    await db.from("ai_jobs").update({ status: "cancelled", updated_at: new Date().toISOString() }).or(`id.eq.${id},parent_id.eq.${id}`).in("status", ["queued", "waiting", "running"]);
    return json({ ok: true });
  }

  if (body.action === "retry") {
    const id = str(body.id, 60);
    const { data: j } = await db.from("ai_jobs").select("id,status,messages,pending").eq("id", id).maybeSingle();
    if (!j || !["failed", "cancelled"].includes(j.status)) return fail("Only failed or cancelled jobs can be retried");
    const msgs = j.messages || [];
    const waiting = j.pending?.waits && Object.keys(j.pending.waits).length;
    // A conversation must not end with the assistant's turn (unless it is waiting for delegated reports)
    if (!waiting && msgs.length && msgs[msgs.length - 1].role === "assistant") msgs.push({ role: "user", content: "تابع من حيث توقفت، واختصر." });
    if (waiting) await db.from("ai_jobs").update({ status: "queued" }).eq("parent_id", id).in("status", ["failed", "cancelled"]);
    await db.from("ai_jobs").update({ status: "queued", error: null, messages: msgs, updated_at: new Date().toISOString() }).eq("id", id);
    return json({ ok: true });
  }

  if (body.action === "followup") {
    // Continue a finished job with a new instruction from the owner, keeping its context
    const id = str(body.id, 60);
    const text = String(body.text || "").trim().slice(0, 20000);
    const { data: j } = await db.from("ai_jobs").select("*").eq("id", id).maybeSingle();
    if (!j || j.status !== "done" || !text) return fail("The job must be finished, and the message not empty");
    await db.from("ai_jobs").update({ status: "queued", messages: [...(j.messages || []), { role: "user", content: text }], steps: [...(j.steps || []), step("info", `تعليمات إضافية: ${text}`)], done_at: null, updated_at: new Date().toISOString() }).eq("id", id);
    return json({ ok: true });
  }

  if (body.action === "goals") return json({ goals: await goalProgress(db) });

  if (body.action === "feedback") {
    // The owner rates a report; the lesson is kept for that employee
    const id = str(body.id, 60);
    const rating = body.rating === "up" ? "up" : "down";
    const note = str(body.note, 2000);
    const { data: j } = await db.from("ai_jobs").select("id,employee,title").eq("id", id).maybeSingle();
    if (!j) return fail("Job not found", 404);
    await db.from("ai_jobs").update({ feedback: { rating, note, at: new Date().toISOString() } }).eq("id", id);
    if (note || rating === "down") {
      await db.from("ai_memory").insert({ topic: rating === "up" ? "ما أعجب المالك" : "ما لم يعجب المالك", note: `${j.title}: ${note || "لم يكن العمل بالمستوى المطلوب"}`, employee: j.employee, scope: j.employee });
    }
    return json({ ok: true });
  }

  if (body.action === "decide_idea") {
    const id = str(body.id, 60);
    const approve = body.approve === true;
    const { data: idea } = await db.from("ai_ideas").select("*").eq("id", id).eq("status", "proposed").maybeSingle();
    if (!idea) return fail("Idea not found or already decided", 404);
    const note = str(body.note, 2000);
    await db.from("ai_ideas").update({ status: approve ? "approved" : "rejected", owner_note: note || null, decided_at: new Date().toISOString() }).eq("id", id);
    await db.from("ai_memory").insert({ topic: approve ? "فكرة اعتمدها المالك" : "فكرة رفضها المالك", note: `${idea.title}${note ? " — " + note : ""}`, employee: idea.employee, scope: "all" });
    if (!approve) return json({ ok: true, status: "rejected" });
    const { data: j } = await db.from("ai_jobs").insert({ employee: "gm", title: `تنفيذ فكرة: ${idea.title}`, created_by: me.id, requested_by: me.id, source: "owner",
      request: `اعتمد المالك هذه الفكرة. خطط لتنفيذها ووزّع العمل على الأقسام والموظفين البشر، وابدأ بالتجربة الصغيرة.\nالفكرة: ${idea.idea}\nالمشكلة/الفرصة: ${idea.problem}\nالأثر المتوقع: ${idea.impact}\nالتجربة وطريقة القياس: ${idea.experiment}${note ? `\nملاحظة المالك: ${note}` : ""}`,
      steps: [step("info", "بدأ من فكرة اعتمدها المالك")] }).select("id").single();
    return json({ ok: true, status: "approved", job_id: j?.id });
  }

  if (body.action === "decide") {
    const id = str(body.id, 60);
    const approve = body.approve === true;
    const { data: a } = await db.from("ai_actions").select("*").eq("id", id).eq("status", "pending").maybeSingle();
    if (!a) return fail("Action not found or already decided", 404);
    if (body.payload && typeof body.payload === "object" && a.kind === "send_email") {
      // The owner may edit the email before approving
      a.payload = { ...a.payload, subject: str(body.payload.subject ?? a.payload.subject, 200), body: String(body.payload.body ?? a.payload.body).slice(0, 20000), to: str(body.payload.to ?? a.payload.to, 200) };
    }
    if (!approve) {
      await db.from("ai_actions").update({ status: "rejected", decided_by: me.id, decided_at: new Date().toISOString(), payload: a.payload }).eq("id", id);
      return json({ ok: true, status: "rejected" });
    }
    try {
      const result = await execute(db, me, a);
      await db.from("ai_actions").update({ status: "approved", result, decided_by: me.id, decided_at: new Date().toISOString(), payload: a.payload }).eq("id", id);
      await log("AI office: approved action", a.summary);
      return json({ ok: true, status: "approved", result });
    } catch (e) {
      await db.from("ai_actions").update({ status: "failed", result: (e as Error).message, decided_by: me.id, decided_at: new Date().toISOString() }).eq("id", id);
      return fail((e as Error).message, 502);
    }
  }

  return fail("Unknown action");
});
