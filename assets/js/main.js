/* =========================================================
   أجنحة للسفر والسياحة — Interactions
   عدّل بيانات التواصل من الكائن CONFIG أدناه فقط.
   ========================================================= */
const CONFIG = {
  phone: "+000000000000",          // رقم الهاتف بالصيغة الدولية بدون مسافات
  phoneDisplay: "+000 000 000 000",
  whatsapp: "000000000000",        // رقم واتساب بالصيغة الدولية بدون + أو أصفار بادئة
  email: "info@example.com",
  address: "الشارع الرئيسي، المدينة",
};

const AIRPORTS = [
  // الخليج والشرق الأوسط
  "الرياض (RUH)", "جدة (JED)", "الدمام (DMM)", "المدينة المنورة (MED)", "أبها (AHB)", "الطائف (TIF)", "تبوك (TUU)", "القصيم (ELQ)", "حائل (HAS)", "جازان (GIZ)", "العُلا (ULH)", "نيوم (NUM)",
  "دبي (DXB)", "أبوظبي (AUH)", "الشارقة (SHJ)", "الدوحة (DOH)", "الكويت (KWI)", "البحرين (BAH)", "مسقط (MCT)", "صلالة (SLL)",
  "عمّان (AMM)", "بيروت (BEY)", "القاهرة (CAI)", "الإسكندرية (HBE)", "شرم الشيخ (SSH)", "الغردقة (HRG)", "بغداد (BGW)", "أربيل (EBL)", "الخرطوم (KRT)", "الدار البيضاء (CMN)", "مراكش (RAK)", "تونس (TUN)", "الجزائر (ALG)",
  // أوروبا وتركيا
  "إسطنبول (IST)", "إسطنبول صبيحة (SAW)", "أنطاليا (AYT)", "طرابزون (TZX)", "لندن (LHR)", "مانشستر (MAN)", "باريس (CDG)", "نيس (NCE)", "فرانكفورت (FRA)", "ميونخ (MUC)", "أمستردام (AMS)", "روما (FCO)", "ميلانو (MXP)", "مدريد (MAD)", "برشلونة (BCN)", "فيينا (VIE)", "زيورخ (ZRH)", "جنيف (GVA)", "تبليسي (TBS)", "باكو (GYD)", "سراييفو (SJJ)",
  // آسيا
  "كوالالمبور (KUL)", "جاكرتا (CGK)", "دنباسار - بالي (DPS)", "بانكوك (BKK)", "بوكيت (HKT)", "سنغافورة (SIN)", "ماليه (MLE)", "طوكيو (HND)", "سيول (ICN)", "كولومبو (CMB)", "دلهي (DEL)", "مومباي (BOM)", "إسلام آباد (ISB)", "كراتشي (KHI)", "مانيلا (MNL)",
  // الأمريكتان وأستراليا وأفريقيا
  "نيويورك (JFK)", "واشنطن (IAD)", "لوس أنجلوس (LAX)", "شيكاغو (ORD)", "هيوستن (IAH)", "تورونتو (YYZ)", "مونتريال (YUL)", "سيدني (SYD)", "ملبورن (MEL)", "جوهانسبرغ (JNB)", "نيروبي (NBO)", "زنجبار (ZNZ)", "أديس أبابا (ADD)",
];

const $ = (s, ctx = document) => ctx.querySelector(s);
const $$ = (s, ctx = document) => [...ctx.querySelectorAll(s)];
const waLink = (text) => `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(text)}`;
const toArabicDate = (v) => {
  if (!v) return "";
  const d = new Date(v.length === 7 ? v + "-01" : v);
  if (isNaN(d)) return v;
  const opts = v.length === 7 ? { year: "numeric", month: "long" } : { weekday: "short", day: "numeric", month: "long", year: "numeric" };
  return d.toLocaleDateString("ar", opts);
};

document.documentElement.classList.remove("no-js");

/* ---------- Config injection ---------- */
function applyConfig() {
  $$('[data-config="phone"]').forEach((el) => (el.textContent = CONFIG.phoneDisplay));
  $$('[data-config="whatsapp-display"]').forEach((el) => (el.textContent = CONFIG.phoneDisplay));
  $$('[data-config="email"]').forEach((el) => (el.textContent = CONFIG.email));
  $$('[data-config="address"]').forEach((el) => (el.textContent = CONFIG.address));
  $$('[data-config="phone-link"]').forEach((el) => (el.href = `tel:${CONFIG.phone}`));
  $$('[data-config="email-link"]').forEach((el) => (el.href = `mailto:${CONFIG.email}`));
  $$("[data-whatsapp]").forEach((el) => {
    el.href = waLink(el.dataset.whatsapp);
    el.target = "_blank";
    el.rel = "noopener";
  });
  $("#year").textContent = new Date().getFullYear();
}

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("is-visible"), 3200);
}

/* ---------- Header / nav ---------- */
function initHeader() {
  const header = $("#header");
  const toTop = $("#toTop");
  const burger = $("#burger");
  const nav = $("#nav");

  const onScroll = () => {
    const y = window.scrollY;
    header.classList.toggle("is-scrolled", y > 10);
    toTop.classList.toggle("is-visible", y > 700);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  toTop.addEventListener("click", () => window.scrollTo({ top: 0 }));

  const closeNav = () => {
    nav.classList.remove("is-open");
    burger.setAttribute("aria-expanded", "false");
    burger.setAttribute("aria-label", "فتح القائمة");
  };
  burger.addEventListener("click", () => {
    const open = nav.classList.toggle("is-open");
    burger.setAttribute("aria-expanded", String(open));
    burger.setAttribute("aria-label", open ? "إغلاق القائمة" : "فتح القائمة");
  });
  $$("a", nav).forEach((a) => a.addEventListener("click", closeNav));
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeNav());

  // Active section highlight
  const links = $$(".nav ul a");
  const sections = links.map((a) => $(a.getAttribute("href"))).filter(Boolean);
  const spy = new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          links.forEach((l) => l.classList.toggle("is-active", l.getAttribute("href") === "#" + en.target.id));
        }
      });
    },
    { rootMargin: "-45% 0px -50% 0px" }
  );
  sections.forEach((s) => spy.observe(s));
}

/* ---------- Search widget ---------- */
function initSearch() {
  // Airports datalist
  $("#airports").innerHTML = AIRPORTS.map((a) => `<option value="${a}">`).join("");

  // Tabs
  const tabs = $$(".search__tab");
  const panels = $$(".search__panel");
  const openTab = (name) => {
    tabs.forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", String(on));
    });
    panels.forEach((p) => p.classList.toggle("is-active", p.dataset.panel === name));
  };
  tabs.forEach((t) => t.addEventListener("click", () => openTab(t.dataset.tab)));
  $$("[data-open-tab]").forEach((a) => a.addEventListener("click", () => openTab(a.dataset.openTab)));

  // Dates: min today, return >= depart
  const today = new Date();
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const todayIso = iso(today);
  $$('input[type="date"]').forEach((i) => (i.min = todayIso));
  $("#pmonth").min = todayIso.slice(0, 7);
  const linkDates = (a, b) => {
    a.addEventListener("change", () => {
      b.min = a.value || todayIso;
      if (b.value && b.value < a.value) b.value = a.value;
    });
  };
  linkDates($("#depart"), $("#return"));
  linkDates($("#hin"), $("#hout"));

  // Trip type
  const returnField = $("#returnField");
  $$('input[name="trip"]').forEach((r) =>
    r.addEventListener("change", () => {
      const oneway = r.value === "oneway" && r.checked;
      returnField.classList.toggle("is-disabled", oneway);
      $("#return").disabled = oneway;
      if (r.value === "multi" && r.checked) toast("للوجهات المتعددة أدخل الوجهة الأولى وسيكمل معك المستشار باقي المسارات");
    })
  );

  // Swap
  $("#swap").addEventListener("click", () => {
    const f = $("#from"), t = $("#to");
    [f.value, t.value] = [t.value, f.value];
  });

  // Passengers
  const paxBtn = $("#paxBtn"), panel = $("#paxPanel");
  const pax = { adults: 1, children: 0, infants: 0 };
  const renderPax = () => {
    const parts = [`${pax.adults} ${pax.adults === 1 ? "بالغ" : "بالغين"}`];
    if (pax.children) parts.push(`${pax.children} ${pax.children === 1 ? "طفل" : "أطفال"}`);
    if (pax.infants) parts.push(`${pax.infants} ${pax.infants === 1 ? "رضيع" : "رضّع"}`);
    $("#paxLabel").textContent = parts.join("، ");
    $$(".pax__row", panel).forEach((row) => {
      const type = row.dataset.type;
      $("output", row).textContent = pax[type];
      const total = pax.adults + pax.children;
      $('[data-op="-"]', row).disabled = type === "adults" ? pax.adults <= 1 : pax[type] <= 0;
      $('[data-op="+"]', row).disabled = type === "infants" ? pax.infants >= pax.adults : total >= 9;
    });
  };
  const togglePax = (open) => {
    panel.hidden = !open;
    paxBtn.setAttribute("aria-expanded", String(open));
  };
  paxBtn.addEventListener("click", () => togglePax(panel.hidden));
  $("#paxDone").addEventListener("click", () => togglePax(false));
  document.addEventListener("click", (e) => {
    if (!panel.hidden && !e.target.closest(".field--pax")) togglePax(false);
  });
  panel.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-op]");
    if (!btn) return;
    const type = btn.closest(".pax__row").dataset.type;
    pax[type] += btn.dataset.op === "+" ? 1 : -1;
    if (pax.infants > pax.adults) pax.infants = pax.adults;
    renderPax();
  });
  renderPax();

  // Destination cards prefill "to"
  $$(".dest[data-to]").forEach((card) =>
    card.addEventListener("click", () => {
      openTab("flights");
      $("#to").value = card.dataset.to;
      setTimeout(() => $("#from").focus({ preventScroll: true }), 600);
    })
  );

  // Submit handlers
  const cabinNames = { economy: "الدرجة السياحية", premium: "السياحية الممتازة", business: "رجال الأعمال", first: "الدرجة الأولى" };
  const tripNames = { round: "ذهاب وعودة", oneway: "ذهاب فقط", multi: "وجهات متعددة" };

  panels.forEach((form) =>
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!validate(form)) return toast("يرجى تعبئة الحقول المطلوبة");
      const d = Object.fromEntries(new FormData(form));
      let title, rows;
      switch (form.dataset.panel) {
        case "flights":
          if (d.from && d.from === d.to) return toast("مدينة المغادرة والوصول متطابقتان");
          title = "طلب حجز طيران";
          rows = [
            ["المسار", `${d.from} ← ${d.to}`],
            ["نوع الرحلة", `${tripNames[d.trip]} · ${d.scope === "domestic" ? "داخلي" : "دولي"}`],
            ["المغادرة", toArabicDate(d.depart)],
            d.trip !== "oneway" && d.return ? ["العودة", toArabicDate(d.return)] : null,
            ["المسافرون", $("#paxLabel").textContent],
            ["الدرجة", cabinNames[d.cabin]],
          ];
          break;
        case "hotels":
          title = "طلب حجز فندق";
          rows = [["الوجهة", d.city], ["الوصول", toArabicDate(d.checkin)], ["المغادرة", toArabicDate(d.checkout)], ["الغرف", d.rooms]];
          break;
        case "packages":
          title = "طلب باقة سياحية";
          rows = [["الوجهة", d.destination], ["الموعد", toArabicDate(d.month)], ["المدة", d.duration], ["الميزانية", d.budget]];
          break;
        case "visa":
          title = "طلب تأشيرة";
          rows = [["الدولة", d.country], ["النوع", d.type], ["الجنسية", d.nationality], ["عدد المتقدمين", d.applicants]];
          break;
      }
      openModal(title, rows.filter(Boolean));
    })
  );
}

/* ---------- Validation ---------- */
function validate(form) {
  let ok = true;
  $$("[required]", form).forEach((el) => {
    const wrap = el.closest(".field") || el.closest(".consent");
    let valid = el.type === "checkbox" ? el.checked : el.value.trim() !== "";
    if (valid && el.type === "email" && el.value) valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value);
    if (valid && el.type === "tel") valid = /^[+\d\s()-]{7,}$/.test(el.value);
    wrap && wrap.classList.toggle("is-invalid", !valid);
    if (!valid && ok) el.focus();
    ok = ok && valid;
  });
  return ok;
}
document.addEventListener("input", (e) => {
  const wrap = e.target.closest(".is-invalid");
  if (wrap) wrap.classList.remove("is-invalid");
});

/* ---------- Modal ---------- */
let lastFocus;
function openModal(title, rows) {
  const modal = $("#modal");
  lastFocus = document.activeElement;
  $("#modalTitle").textContent = title;
  $("#modalSummary").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v || "—")}</dd>`).join("");
  const msg = `مرحباً، أرغب في ${title}:\n` + rows.map(([k, v]) => `• ${k}: ${v}`).join("\n");
  $("#modalWa").href = waLink(msg);
  $("#modalForm").onclick = () => {
    $("#cMsg").value = rows.map(([k, v]) => `${k}: ${v}`).join("\n");
  };
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  $(".modal__close", modal).focus();
}
function closeModal() {
  $("#modal").hidden = true;
  document.body.style.overflow = "";
  lastFocus && lastFocus.focus({ preventScroll: true });
}
function initModal() {
  $$("#modal [data-close]").forEach((el) => el.addEventListener("click", closeModal));
  document.addEventListener("keydown", (e) => e.key === "Escape" && !$("#modal").hidden && closeModal());

  // "Book" buttons on offers
  $$("[data-book]").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const card = btn.closest(".offer");
      const price = card ? $(".price b", card)?.textContent + " " + ($(".price span", card)?.textContent || "") : "";
      openModal("حجز عرض", [["العرض", btn.dataset.book], price ? ["السعر", price.trim()] : null].filter(Boolean));
    })
  );
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- Offers filter ---------- */
function initFilters() {
  const chips = $$(".chip");
  const offers = $$(".offer");
  chips.forEach((chip) =>
    chip.addEventListener("click", () => {
      chips.forEach((c) => c.classList.toggle("is-active", c === chip));
      const f = chip.dataset.filter;
      offers.forEach((o) => {
        const show = f === "all" || o.dataset.cat.split(" ").includes(f);
        o.classList.toggle("is-hidden", !show);
        if (show) o.classList.add("is-in");
      });
    })
  );
}

/* ---------- Destinations slider ---------- */
function initSlider() {
  const track = $("#destTrack");
  const step = () => track.querySelector(".dest").getBoundingClientRect().width + 20;
  // In RTL, "next" visually moves toward the left (negative scrollLeft)
  $$("[data-slide]").forEach((b) =>
    b.addEventListener("click", () => {
      const dir = b.dataset.slide === "next" ? -1 : 1;
      track.scrollBy({ left: dir * step(), behavior: "smooth" });
    })
  );
}

/* ---------- Counters ---------- */
function initCounters() {
  const fmt = new Intl.NumberFormat("en-US");
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const el = en.target;
        const target = +el.dataset.count;
        const start = performance.now();
        const dur = 1600;
        const tick = (now) => {
          const p = Math.min((now - start) / dur, 1);
          el.textContent = fmt.format(Math.round(target * (1 - Math.pow(1 - p, 3))));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        io.unobserve(el);
      }),
    { threshold: 0.5 }
  );
  $$("[data-count]").forEach((el) => io.observe(el));
}

/* ---------- Reveal ---------- */
function initReveal() {
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((en) => {
        if (en.isIntersecting) {
          en.target.classList.add("is-in");
          io.unobserve(en.target);
        }
      }),
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );
  $$(".reveal").forEach((el, i) => {
    el.style.transitionDelay = `${(i % 4) * 70}ms`;
    io.observe(el);
  });
}

/* ---------- Marquee duplicate for seamless loop ---------- */
function initMarquee() {
  const track = $(".marquee__track");
  track.innerHTML += track.innerHTML;
  $$("span", track).slice(track.children.length / 2).forEach((s) => s.setAttribute("aria-hidden", "true"));
}

/* ---------- Contact & newsletter ---------- */
function initForms() {
  const form = $("#contactForm");
  const status = $(".form-status", form);
  const summary = () => {
    const d = Object.fromEntries(new FormData(form));
    return `مرحباً، أنا ${d.name}\nالجوال: ${d.phone}${d.email ? `\nالبريد: ${d.email}` : ""}\nالخدمة: ${d.service}\n${d.message || ""}`.trim();
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.className = "form-status";
    if (!validate(form)) {
      status.textContent = "يرجى التحقق من الحقول المطلوبة.";
      status.classList.add("err");
      return;
    }
    const btn = $('button[type="submit"]', form);
    btn.disabled = true;
    btn.textContent = "جارٍ الإرسال…";
    // ربط النموذج بخدمة استقبال (Formspree/Netlify Forms/خادمكم) عبر data-endpoint على الوسم <form>
    const endpoint = form.dataset.endpoint;
    try {
      if (endpoint) {
        const res = await fetch(endpoint, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error();
      } else {
        await new Promise((r) => setTimeout(r, 700));
      }
      status.textContent = "تم استلام طلبك بنجاح! سيتواصل معك مستشار السفر قريباً.";
      status.classList.add("ok");
      form.reset();
    } catch {
      status.textContent = "تعذر الإرسال، يرجى المحاولة مجدداً أو التواصل عبر واتساب.";
      status.classList.add("err");
    } finally {
      btn.disabled = false;
      btn.textContent = "إرسال الطلب";
    }
  });

  $("#sendWa").addEventListener("click", () => {
    const name = $("#cName"), phone = $("#cPhone");
    if (!name.value.trim() || !phone.value.trim()) {
      validate(form);
      return toast("أدخل اسمك ورقم جوالك أولاً");
    }
    window.open(waLink(summary()), "_blank", "noopener");
  });

  $("#newsletter").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#nlEmail");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value)) {
      input.focus();
      return toast("يرجى إدخال بريد إلكتروني صحيح");
    }
    input.value = "";
    toast("شكراً لاشتراكك! ستصلك أحدث العروض قريباً ✈️");
  });
}

/* ---------- Boot ---------- */
document.addEventListener("DOMContentLoaded", () => {
  applyConfig();
  initHeader();
  initSearch();
  initModal();
  initFilters();
  initSlider();
  initCounters();
  initReveal();
  initMarquee();
  initForms();
});
