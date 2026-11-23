// Green Travel: e-ticket / travel reminder email (Arabic + English).
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const CABIN: Record<string, [string, string]> = { economy: ["سياحية", "Economy"], premium: ["سياحية ممتازة", "Premium economy"], business: ["رجال أعمال", "Business"], first: ["أولى", "First"] };
const fmt = (iso: string) => (iso ? new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");

export type Kind = "ticket" | "week" | "day";

export function ticketEmail(b: Record<string, any>, kind: Kind) {
  const name = b.customer?.name || (b.travelers || [])[0] || "";
  const segs: any[] = Array.isArray(b.segments) && b.segments.length ? b.segments : [
    { from: (b.route || "").split("→")[0]?.trim(), to: (b.route || "").split("→")[1]?.trim(), date: b.depart || "" },
    ...(b.ret ? [{ from: (b.route || "").split("→")[1]?.trim(), to: (b.route || "").split("→")[0]?.trim(), date: b.ret }] : []),
  ];
  const first = segs[0] || {};
  const subject = kind === "ticket"
    ? `تذكرتك من جرين ترافيل · Your Green Travel e-ticket — ${b.pnr ? "PNR " + b.pnr : b.id}`
    : kind === "week"
    ? `تذكير: رحلتك بعد أسبوع · Reminder: your trip is in one week — ${first.from || ""} → ${first.to || ""}`
    : `رحلتك غداً · Your flight is tomorrow — ${first.from || ""} → ${first.to || ""}`;
  const intro = kind === "ticket"
    ? ["مرحباً " + name + "، هذه تفاصيل تذكرتك. نتمنى لك رحلة سعيدة.", "Hello " + name + ", here are your ticket details. Have a great trip."]
    : kind === "week"
    ? ["مرحباً " + name + "، نذكّرك بأن موعد رحلتك بعد أسبوع.", "Hello " + name + ", this is a reminder that your trip is one week away."]
    : ["مرحباً " + name + "، رحلتك غداً. نتمنى لك سفراً آمناً.", "Hello " + name + ", your flight is tomorrow. Safe travels."];
  const tips = kind === "ticket" ? [] : [
    ["تأكد من صلاحية جواز السفر (6 أشهر على الأقل) والتأشيرة إن لزمت.", "Make sure your passport is valid for at least 6 months, and your visa if needed."],
    ["احضر إلى المطار قبل 3 ساعات للرحلات الدولية وساعتين للداخلية.", "Arrive 3 hours early for international flights, 2 hours for domestic."],
    ["سجّل دخولك عبر موقع شركة الطيران قبل 24 ساعة من الإقلاع.", "Check in online with the airline 24 hours before departure."],
    ["لأي تغيير أو سؤال، تواصل معنا على الرقم أدناه أو واتساب.", "For any change or question, call or WhatsApp us on the number below."],
  ];
  const cell = "padding:8px 10px;border-bottom:1px solid #e5ece6;font-size:14px";
  const segRows = segs.map((s) => `<tr><td style="${cell};font-family:monospace">${esc(s.flight || "—")}</td><td style="${cell};font-family:monospace"><b>${esc(s.from)}</b> → <b>${esc(s.to)}</b>${s.via ? ` <small>(via ${esc(s.via)})</small>` : ""}</td><td style="${cell}">${esc(fmt(s.date))}</td><td style="${cell};font-family:monospace">${esc(s.dep || "")}${s.arr ? " → " + esc(s.arr) : ""}</td></tr>`).join("");
  const pax = (b.travelers || []).length ? b.travelers : [name];
  const paxRows = pax.map((t: string, i: number) => `<tr><td style="${cell}">${esc(t)}</td><td style="${cell};font-family:monospace">${esc((b.tickets || [])[i] || (b.tickets || [])[0] || "—")}</td></tr>`).join("");
  const cab = CABIN[b.cabin] || ["", ""];
  const html = `<!doctype html><html><body style="margin:0;background:#f3f6f3;font-family:Arial,Helvetica,sans-serif;color:#10231a">
  <div style="max-width:640px;margin:0 auto;padding:20px">
    <div style="background:#0b3d1f;color:#fff;border-radius:16px 16px 0 0;padding:18px 22px">
      <div style="font-size:20px;font-weight:bold">Green Travel · جرين ترافيل</div>
      <div style="font-size:12px;opacity:.8">World Services dba Green Travel · info@greentravel.us · +1 (708) 963-2552</div>
    </div>
    <div style="background:#fff;border-radius:0 0 16px 16px;padding:22px">
      <p dir="rtl" style="font-size:15px;margin:0 0 4px;text-align:right">${esc(intro[0])}</p>
      <p style="font-size:14px;margin:0 0 16px;color:#4a5a50">${esc(intro[1])}</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:14px;background:#f3f9f4;border-radius:10px">
        <tr><td style="${cell}">PNR / رقم الحجز</td><td style="${cell};font-family:monospace;font-size:18px"><b>${esc(b.pnr || "—")}</b></td></tr>
        <tr><td style="${cell}">Airline / الطيران</td><td style="${cell}">${esc(b.airline || "—")}</td></tr>
        <tr><td style="${cell}">Cabin / الدرجة</td><td style="${cell}">${esc(cab[1])} · ${esc(cab[0])}</td></tr>
        ${b.baggage ? `<tr><td style="${cell}">Baggage / الأمتعة</td><td style="${cell}">${esc(b.baggage)}</td></tr>` : ""}
        <tr><td style="${cell}">Booking / المرجع</td><td style="${cell};font-family:monospace">${esc(b.id)}</td></tr>
      </table>
      <h3 style="margin:16px 0 6px;font-size:15px">Flights · الرحلات</h3>
      <table style="width:100%;border-collapse:collapse"><tr style="background:#eef3ef"><th style="${cell};text-align:left">Flight</th><th style="${cell};text-align:left">Route</th><th style="${cell};text-align:left">Date</th><th style="${cell};text-align:left">Time</th></tr>${segRows}</table>
      <h3 style="margin:16px 0 6px;font-size:15px">Passengers · المسافرون</h3>
      <table style="width:100%;border-collapse:collapse"><tr style="background:#eef3ef"><th style="${cell};text-align:left">Name</th><th style="${cell};text-align:left">E-ticket</th></tr>${paxRows}</table>
      ${tips.length ? `<h3 style="margin:16px 0 6px;font-size:15px">Before you fly · قبل السفر</h3><ul style="padding-left:18px;margin:0">${tips.map((t) => `<li style="margin-bottom:6px;font-size:13px"><span dir="rtl">${esc(t[0])}</span><br><span style="color:#4a5a50">${esc(t[1])}</span></li>`).join("")}</ul>` : ""}
      <p style="font-size:12px;color:#6b7a70;margin-top:18px">Times are local. All bookings are subject to the airline's fare rules. · الأوقات بالتوقيت المحلي، وجميع الحجوزات تخضع لشروط شركة الطيران.</p>
    </div>
  </div></body></html>`;
  const text = `${intro[1]}\nPNR: ${b.pnr || "-"}\n${segs.map((s) => `${s.flight || ""} ${s.from} -> ${s.to} ${s.date} ${s.dep || ""}`).join("\n")}\nGreen Travel +1 (708) 963-2552`;
  return { subject, html, text };
}

// Sends through Resend (https://resend.com). Needs the RESEND_API_KEY secret; EMAIL_FROM is optional.
export async function sendEmail(to: string, msg: { subject: string; html: string; text: string }) {
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
