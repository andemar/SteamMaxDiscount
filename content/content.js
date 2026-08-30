"use strict";
(() => {
  // src/core/discountLogic.ts
  function decideState(input) {
    const { currentDiscountPercent, summary, hadError } = input;
    if (currentDiscountPercent === null || currentDiscountPercent <= 0) {
      return { state: "none", tooltip: "" };
    }
    if (hadError || !summary) {
      return {
        state: "orange",
        tooltip: "Could not retrieve historical discount records. Click 'Clear discount cache' and reload to retry."
      };
    }
    if (currentDiscountPercent === summary.allTimeMaxPercent && summary.timesAtMax <= 1) {
      return {
        state: "green",
        tooltip: `All-time maximum discount (${summary.allTimeMaxPercent}%), first time at this level.`
      };
    }
    if (currentDiscountPercent === summary.allTimeMaxPercent && summary.timesAtMax > 1) {
      return {
        state: "yellow",
        tooltip: `All-time maximum discount (${summary.allTimeMaxPercent}%), seen ${summary.timesAtMax} times historically.`
      };
    }
    if (currentDiscountPercent > summary.allTimeMaxPercent) {
      return {
        state: "green",
        tooltip: `New all-time maximum discount (${currentDiscountPercent}%), beats recorded max of ${summary.allTimeMaxPercent}%.`
      };
    }
    if (currentDiscountPercent < summary.allTimeMaxPercent) {
      return {
        state: "red",
        tooltip: `Current ${currentDiscountPercent}% is below the all-time max of ${summary.allTimeMaxPercent}%.`
      };
    }
    return {
      state: "none",
      tooltip: ""
    };
  }

  // src/core/steamWishlist.ts
  var SELECTORS = {
    containerCandidates: [
      "#wishlist_ctn",
      ".wishlist_ctn",
      "div.wishlist_rows",
      "div[data-feature-target='wishlist']",
      "div._wishlist_rows_",
      "#wishlist_items",
      ".wishlist_items",
      "[class*='wishlistItems']",
      "[class*='WishlistItems']",
      "[class*='wishlist_row']",
      "[id*='wishlist']"
    ],
    rowCandidates: [
      "div.wishlist_row",
      "div.Row",
      "div[data-app-id]",
      "div[data-ds-appid]",
      "a[data-ds-appid]",
      ".search_result_row",
      "[class*='wishlistRow']",
      "[class*='WishlistRow']",
      "[class*='wishlist_row']"
    ],
    appLinkSelector: "a[href*='/app/']",
    titleCandidates: [
      "div.wishlist_row_title",
      "h2.title",
      "div.title",
      "a.title",
      ".game_name",
      "[class*='gameName']",
      "[class*='GameName']",
      "[class*='game_name']",
      "[class*='title']",
      "h2",
      "h3",
      "a[href*='/app/']"
    ],
    discountCandidates: [
      ".discount_pct",
      ".discount-percentage",
      "div.discount_block .discount_pct",
      "span.discount_pct",
      "[class*='discountPct']",
      "[class*='DiscountPct']",
      "[class*='discount_pct']",
      "[class*='discount']"
    ]
  };
  function findWishlistContainer(doc) {
    for (const sel of SELECTORS.containerCandidates) {
      try {
        const el = doc.querySelector(sel);
        if (el instanceof HTMLElement) {
          console.log("[swd] container matched selector:", sel);
          return el;
        }
      } catch {
      }
    }
    const appLinks = Array.from(doc.querySelectorAll(SELECTORS.appLinkSelector));
    if (appLinks.length > 0) {
      const totalUniqueAppids = new Set();
      appLinks.forEach((a) => {
        const id = parseAppid(a.href);
        if (id) totalUniqueAppids.add(id);
      });
      let candidate = appLinks[0].parentElement;
      let bestContainer = null;
      let depth = 0;
      while (candidate && candidate !== doc.body && depth < 15) {
        const distinctInCandidate = new Set();
        candidate.querySelectorAll(SELECTORS.appLinkSelector).forEach((a) => {
          const id = parseAppid(a.href);
          if (id) distinctInCandidate.add(id);
        });
        if (distinctInCandidate.size >= Math.min(2, totalUniqueAppids.size) && distinctInCandidate.size > 0) {
          bestContainer = candidate;
        }
        candidate = candidate.parentElement;
        depth++;
      }
      if (bestContainer) {
        console.log("[swd] container found holding", totalUniqueAppids.size, "games:", bestContainer.tagName, bestContainer.className);
        return bestContainer;
      }
    }
    return doc.body;
  }
  function findRowElements(container) {
    const appLinks = Array.from(
      container.querySelectorAll(SELECTORS.appLinkSelector)
    );
    const seenAppids = new Set();
    const rows = [];
    for (const a of appLinks) {
      const appid = parseAppid(a.href);
      if (!appid || seenAppids.has(appid)) continue;
      const card = findOuterCard(a, container);
      if (card && card !== container) {
        seenAppids.add(appid);
        rows.push(card);
      }
    }
    return rows;
  }
  function findOuterCard(link, container) {
    let cur = link.parentElement;
    let best = link.parentElement;
    let depth = 0;
    while (cur && cur !== container && depth < 10) {
      if (cur.parentElement === container) {
        return cur;
      }
      if (cur.querySelector(SELECTORS.discountCandidates.join(",")) && cur.querySelector(SELECTORS.appLinkSelector)) {
        best = cur;
      }
      cur = cur.parentElement;
      depth++;
    }
    return best ?? link.parentElement ?? null;
  }
  function parseAppid(href) {
    const m = href.match(/\/app\/(\d+)\b/);
    return m ? Number(m[1]) : null;
  }
  function parseDiscountText(text) {
    const m = text.match(/(-?\d{1,3})\s*%/);
    if (!m) return null;
    const n = Math.abs(parseInt(m[1], 10));
    if (!Number.isFinite(n)) return null;
    return n;
  }
  function extractRowInfo(rowEl) {
    let titleEl = null;
    let href = "";
    for (const sel of SELECTORS.titleCandidates) {
      try {
        const candidates = rowEl.querySelectorAll(sel);
        for (const cand of Array.from(candidates)) {
          const text = cand.textContent?.trim();
          if (text && text.length > 0 && !text.endsWith("%")) {
            titleEl = cand;
            href = cand instanceof HTMLAnchorElement ? cand.href : cand.querySelector("a")?.href ?? "";
            if (href) break;
          }
        }
        if (titleEl && href) break;
      } catch {
      }
    }
    if (!href) {
      const anchors = rowEl.querySelectorAll(SELECTORS.appLinkSelector);
      for (const a of Array.from(anchors)) {
        if (a.href) {
          href = a.href;
          if (!titleEl && a.textContent?.trim()) {
            titleEl = a;
          }
          break;
        }
      }
    }
    if (!href) {
      const dsAppid = rowEl.getAttribute("data-ds-appid");
      if (dsAppid) href = `https://store.steampowered.com/app/${dsAppid}/`;
    }
    if (!href) {
      const dataAttr = rowEl.getAttribute("data-app-id");
      if (dataAttr) href = `https://store.steampowered.com/app/${dataAttr}/`;
    }
    if (!titleEl && href) {
      const anchor = rowEl.querySelector(SELECTORS.appLinkSelector);
      titleEl = anchor ?? rowEl;
    }
    if (!titleEl || !href) return null;
    const appid = parseAppid(href);
    if (!appid) return null;
    let currentDiscountPercent = null;
    for (const sel of SELECTORS.discountCandidates) {
      try {
        const cand = rowEl.querySelector(sel);
        if (cand?.textContent) {
          currentDiscountPercent = parseDiscountText(cand.textContent);
          if (currentDiscountPercent !== null) break;
        }
      } catch {
      }
    }
    if (currentDiscountPercent === null) {
      currentDiscountPercent = parseDiscountText(rowEl.textContent ?? "");
    }
    return {
      rowEl,
      titleEl,
      appid,
      currentDiscountPercent,
      href
    };
  }

  // src/core/observer.ts
  function attachWishlistObserver(container, onAdded) {
    let pending = [];
    let scheduled = false;
    const flush = () => {
      scheduled = false;
      const batch = pending;
      pending = [];
      if (batch.length > 0) onAdded(batch);
    };
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => {
          if (n instanceof HTMLElement) pending.push(n);
        });
      }
      if (!scheduled && pending.length > 0) {
        scheduled = true;
        requestAnimationFrame(flush);
      }
    });
    observer.observe(container, { childList: true, subtree: true });
    return observer;
  }

  // src/core/storage.ts
  var KEY_PREFIX = "discountMeta_";
  function keyFor(appid) {
    return `${KEY_PREFIX}${appid}`;
  }
  async function getSummary(appid) {
    const k = keyFor(appid);
    const obj = await chrome.storage.local.get(k);
    return obj[k] ?? null;
  }
  async function setSummary(summary) {
    await chrome.storage.local.set({ [keyFor(summary.appid)]: summary });
  }
  async function clearAllSummaries() {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith(KEY_PREFIX));
    if (keys.length === 0) return 0;
    await chrome.storage.local.remove(keys);
    return keys.length;
  }

  // src/content/content.ts
  var PROCESSED_ATTR = "data-swd-processed";
  var ICON_CLASS = "swd-discount-circle";
  var STYLE_ID = "swd-styles";
  var inFlight = /* @__PURE__ */ new Map();
  function pLimit(concurrency) {
    const queue = [];
    let active = 0;
    return async (fn) => {
      if (active >= concurrency) {
        await new Promise((resolve) => queue.push(resolve));
      }
      active++;
      try {
        return await fn();
      } finally {
        active--;
        queue.shift()?.();
      }
    };
  }
  var limited = pLimit(4);
  async function requestSummary(appid) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "getDiscountSummary", appid },
        (resp) => {
          if (resp && resp.ok) {
            const r = resp;
            resolve({ ok: true, summary: r.summary ?? null });
          } else {
            const r = resp;
            resolve({ ok: false, error: r?.error ?? "unknown" });
          }
        }
      );
    });
  }
  async function fetchSummaryForAppid(appid) {
    let summary = await getSummary(appid);
    if (!summary) {
      const resp = await limited(() => requestSummary(appid));
      if (resp.ok) {
        summary = resp.summary;
        if (summary) await setSummary(summary);
      } else {
        return { summary: null, hadError: true };
      }
    }
    if (!summary) {
      return { summary: null, hadError: true };
    }
    return { summary, hadError: false };
  }
  async function processRow(info) {
    if (info.rowEl.hasAttribute(PROCESSED_ATTR)) return;
    info.rowEl.setAttribute(PROCESSED_ATTR, "1");
    let fetchPromise = inFlight.get(info.appid);
    if (!fetchPromise) {
      fetchPromise = fetchSummaryForAppid(info.appid);
      inFlight.set(info.appid, fetchPromise);
    }
    try {
      const result = await fetchPromise;
      renderDecision(
        info,
        decideState({
          currentDiscountPercent: info.currentDiscountPercent,
          summary: result.summary,
          hadError: result.hadError
        })
      );
    } finally {
      inFlight.delete(info.appid);
    }
  }
  function renderDecision(info, decision) {
    info.titleEl.querySelectorAll(`.${ICON_CLASS}`).forEach((n) => n.remove());
    info.rowEl.querySelectorAll(`.${ICON_CLASS}`).forEach((n) => n.remove());
    if (decision.state === "none") return;
    const span = document.createElement("span");
    span.className = ICON_CLASS;
    span.setAttribute("data-swd-state", decision.state);
    span.setAttribute("title", decision.tooltip);
    span.textContent = emojiFor(decision.state);
    if (info.titleEl.parentElement) {
      info.titleEl.parentElement.insertBefore(span, info.titleEl.nextSibling);
    } else {
      info.titleEl.appendChild(span);
    }
  }
  function emojiFor(state) {
    switch (state) {
      case "green":
        return "\u{1F7E2}";
      case "yellow":
        return "\u{1F7E1}";
      case "red":
        return "\u{1F534}";
      case "orange":
        return "\u{1F7E0}";
      case "none":
        return "";
    }
  }
  function injectStylesOnce() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = `
    .${ICON_CLASS} {
      display: inline-block !important;
      visibility: visible !important;
      opacity: 1 !important;
      overflow: visible !important;
      position: relative !important;
      z-index: 100 !important;
      margin-left: 6px;
      font-size: 1.1em;
      line-height: 1;
      vertical-align: middle;
      cursor: help;
      flex-shrink: 0;
    }
    #swd-clear-cache-btn {
      position: fixed; right: 16px; bottom: 16px;
      background: #1b2838; color: #c7d5e0;
      border: 1px solid #66c0f4; border-radius: 4px;
      padding: 6px 10px; font-size: 12px;
      cursor: pointer; z-index: 9999;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    }
    #swd-clear-cache-btn:hover { background: #2a475e; }
  `;
    document.head.appendChild(s);
  }
  function injectClearCacheButton() {
    if (document.getElementById("swd-clear-cache-btn")) return;
    const btn = document.createElement("button");
    btn.id = "swd-clear-cache-btn";
    btn.textContent = "Clear discount cache";
    btn.addEventListener("click", async () => {
      const n = await clearAllSummaries();
      btn.textContent = n > 0 ? `Cleared ${n} entries \u2014 reload to refresh` : "Nothing to clear";
      setTimeout(() => btn.textContent = "Clear discount cache", 4e3);
      const container = findWishlistContainer(document) || document.body;
      for (const row of findRowElements(container)) {
        row.removeAttribute(PROCESSED_ATTR);
        const info = extractRowInfo(row);
        if (info) void processRow(info);
      }
    });
    document.body.appendChild(btn);
  }
  function isWishlistPage() {
    const path = window.location.pathname.toLowerCase();
    return path === "/wishlist" || path.startsWith("/wishlist/");
  }
  function scanAll() {
    if (!isWishlistPage()) return;
    const container = findWishlistContainer(document) || document.body;
    const rows = findRowElements(container);
    for (const row of rows) {
      const needsProcessing = !row.hasAttribute(PROCESSED_ATTR);
      const hasIcon = !!row.querySelector(`.${ICON_CLASS}`) || !!row.parentElement?.querySelector(`.${ICON_CLASS}`);
      if (needsProcessing || !hasIcon) {
        row.removeAttribute(PROCESSED_ATTR);
        const info = extractRowInfo(row);
        if (info) void processRow(info);
      }
    }
  }
  function bootstrap() {
    if (!isWishlistPage()) return;
    injectStylesOnce();
    injectClearCacheButton();
    scanAll();
    setTimeout(scanAll, 500);
    setTimeout(scanAll, 1500);
    let scanScheduled = false;
    const debouncedScan = () => {
      if (!isWishlistPage()) return;
      if (!scanScheduled) {
        scanScheduled = true;
        requestAnimationFrame(() => {
          scanScheduled = false;
          scanAll();
        });
      }
    };
    const rootObserver = new MutationObserver(debouncedScan);
    rootObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("scroll", debouncedScan, { passive: true });
  }
  if (document.readyState === "complete" || document.readyState === "interactive") {
    bootstrap();
  } else {
    window.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  }
})();
//# sourceMappingURL=content.js.map
