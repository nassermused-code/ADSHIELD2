/* =========================================================
   Green Travel — Arabic / English
   - Arabic is the source language of index.html.
   - English comes from assets/js/i18n-en.js (static text) and T("ar", "en") calls in the scripts.
   - The choice is kept in localStorage ("gt-lang") and can be forced with ?lang=en / ?lang=ar.
   Loaded before the other scripts so they can use T() and I18N.locale.
   ========================================================= */
(() => {
  const KEY = "gt-lang";
  let lang = "ar";
  try {
    const q = new URLSearchParams(location.search).get("lang");
    if (q === "en" || q === "ar") { lang = q; localStorage.setItem(KEY, q); }
    else lang = localStorage.getItem(KEY) === "en" ? "en" : "ar";
  } catch (e) {}
  const en = lang === "en";

  window.I18N = { lang, en, locale: en ? "en-US" : "ar" };
  window.T = (ar, eng) => (en ? eng : ar);

  const root = document.documentElement;
  root.lang = lang;
  root.dir = en ? "ltr" : "rtl";

  function translatePage() {
    const dict = window.I18N_EN || {};
    const AR = /[؀-ۿ]/;
    const tr = (s) => dict[s.replace(/\s+/g, " ").trim()];
    // Text nodes
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentNode && /^(SCRIPT|STYLE)$/.test(n.parentNode.nodeName)) || !AR.test(n.nodeValue) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((n) => {
      const v = tr(n.nodeValue);
      if (v) {
        const lead = n.nodeValue.match(/^\s*/)[0], trail = n.nodeValue.match(/\s*$/)[0];
        n.nodeValue = lead + v + trail;
      }
    });
    // Attributes
    ["placeholder", "aria-label", "alt", "title", "data-whatsapp", "data-book", "content"].forEach((attr) => {
      document.querySelectorAll(`[${attr}]`).forEach((el) => {
        const val = el.getAttribute(attr);
        if (val && AR.test(val)) { const v = tr(val); if (v) el.setAttribute(attr, v); }
      });
    });
    const t = tr(document.title);
    if (t) document.title = t;
    const og = document.querySelector('meta[property="og:locale"]');
    if (og) og.setAttribute("content", "en_US");
  }

  function setupToggle() {
    document.querySelectorAll("[data-lang-toggle]").forEach((btn) => {
      btn.textContent = en ? "عربي" : "English";
      btn.setAttribute("lang", en ? "ar" : "en");
      btn.setAttribute("aria-label", en ? "التبديل إلى العربية" : "Switch to English");
      btn.addEventListener("click", () => {
        const next = en ? "ar" : "en";
        try { localStorage.setItem(KEY, next); } catch (e) {}
        try {
          const url = new URL(location.href);
          if (url.searchParams.has("lang")) { url.searchParams.set("lang", next); history.replaceState(null, "", url); }
        } catch (e) {}
        location.reload();
      });
    });
  }

  if (en) translatePage();
  setupToggle();
  root.classList.remove("i18n-pending");
})();
