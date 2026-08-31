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
        tooltip: "ITAD API error: could not retrieve historical prices."
      };
    }
    if (summary.lowestCut === null) {
      return {
        state: "orange",
        tooltip: "ITAD API returned incomplete historical low data."
      };
    }
    const currentCut = summary.currentCut !== null && summary.currentCut > 0 ? summary.currentCut : currentDiscountPercent;
    const allTimeMaxPercent = summary.lowestCut;
    if (currentCut > allTimeMaxPercent) {
      return {
        state: "green",
        tooltip: `New all-time maximum discount (${currentCut}%), beats recorded max of ${allTimeMaxPercent}%.`
      };
    }
    if (currentCut === allTimeMaxPercent) {
      const currentTs = summary.currentTimestamp ? Date.parse(summary.currentTimestamp) : NaN;
      const lowestTs = summary.lowestTimestamp ? Date.parse(summary.lowestTimestamp) : NaN;
      if (Number.isFinite(currentTs) && Number.isFinite(lowestTs)) {
        if (Math.abs(currentTs - lowestTs) <= 6e4) {
          return {
            state: "green",
            tooltip: `Current discount matches all-time max (${allTimeMaxPercent}%) and appears to be the first occurrence.`
          };
        }
        if (lowestTs < currentTs) {
          return {
            state: "yellow",
            tooltip: `Current discount matches all-time max (${allTimeMaxPercent}%), but this max was seen before.`
          };
        }
        return {
          state: "green",
          tooltip: `Current discount matches all-time max (${allTimeMaxPercent}%).`
        };
      }
      return {
        state: "yellow",
        tooltip: `Current discount matches all-time max (${allTimeMaxPercent}%), timestamp comparison unavailable.`
      };
    }
    if (currentCut < allTimeMaxPercent) {
      return {
        state: "red",
        tooltip: `Current ${currentCut}% is below the all-time max of ${allTimeMaxPercent}%.`
      };
    }
    return {
      state: "orange",
      tooltip: "ITAD API data could not be interpreted."
    };
  }

  // src/core/steamWishlist.ts
  var SELECTORS = {
    containerCandidates: [
      /* legacy / classic layout */
      "#wishlist_ctn",
      ".wishlist_ctn",
      "div.wishlist_rows",
      "div[data-feature-target='wishlist']",
      "div._wishlist_rows_",
      /* 2026 redesign: broader selectors */
      "#wishlist_items",
      ".wishlist_items",
      "[class*='wishlistItems']",
      "[class*='WishlistItems']",
      "[class*='wishlist_row']",
      /* parent of rows */
      "[id*='wishlist']"
    ],
    rowCandidates: [
      /* legacy */
      "div.wishlist_row",
      "div.Row",
      "div[data-app-id]",
      /* 2026 redesign */
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
    const appLinks = Array.from(
      doc.querySelectorAll(SELECTORS.appLinkSelector)
    );
    if (appLinks.length > 0) {
      const totalUniqueAppids = /* @__PURE__ */ new Set();
      appLinks.forEach((a) => {
        const id = parseAppid(a.href);
        if (id) totalUniqueAppids.add(id);
      });
      let candidate = appLinks[0].parentElement;
      let bestContainer = null;
      let depth = 0;
      while (candidate && candidate !== doc.body && depth < 15) {
        const distinctInCandidate = /* @__PURE__ */ new Set();
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
        console.log(
          "[swd] container found holding",
          totalUniqueAppids.size,
          "games:",
          bestContainer.tagName,
          bestContainer.className
        );
        return bestContainer;
      }
    }
    return doc.body;
  }
  function findRowElements(container) {
    const appLinks = Array.from(
      container.querySelectorAll(SELECTORS.appLinkSelector)
    );
    const seenAppids = /* @__PURE__ */ new Set();
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
      const anchors = rowEl.querySelectorAll(
        SELECTORS.appLinkSelector
      );
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
      const anchor = rowEl.querySelector(
        SELECTORS.appLinkSelector
      );
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
      title: titleEl.textContent?.trim() ?? "",
      appid,
      currentDiscountPercent,
      href
    };
  }

  // src/core/storage.ts
  var SUMMARY_KEY_PREFIX = "discountMeta_";
  var ITAD_MAP_KEY_PREFIX = "itadMap_";
  function summaryKeyFor(appid) {
    return `${SUMMARY_KEY_PREFIX}${appid}`;
  }
  function itadMapKeyFor(appid) {
    return `${ITAD_MAP_KEY_PREFIX}${appid}`;
  }
  async function getSummary(appid) {
    const k = summaryKeyFor(appid);
    const obj = await chrome.storage.local.get(k);
    return obj[k] ?? null;
  }
  async function setSummary(summary) {
    await chrome.storage.local.set({ [summaryKeyFor(summary.appid)]: summary });
  }
  async function getItadId(appid) {
    const k = itadMapKeyFor(appid);
    const obj = await chrome.storage.local.get(k);
    const v = obj[k];
    return typeof v === "string" && v.length > 0 ? v : null;
  }
  async function setItadId(appid, itadId) {
    await chrome.storage.local.set({ [itadMapKeyFor(appid)]: itadId });
  }
  async function clearAllSummaries() {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter(
      (k) => k.startsWith(SUMMARY_KEY_PREFIX) || k.startsWith(ITAD_MAP_KEY_PREFIX)
    );
    if (keys.length === 0) return 0;
    await chrome.storage.local.remove(keys);
    return keys.length;
  }

  // src/content/content.ts
  var STYLE_ID = "swd-styles";
  var SWD_STATE_ATTR = "data-swd-state";
  var SWD_TOOLTIP_ATTR = "data-swd-tooltip";
  var decisionCache = /* @__PURE__ */ new Map();
  var fetchCache = /* @__PURE__ */ new Map();
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
  function requestSummary(appid, title, itadId) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "getDiscountSummary", appid, title, itadId: itadId ?? void 0 },
        (resp) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message ?? "runtime error" });
            return;
          }
          if (resp?.ok) {
            resolve({ ok: true, summary: resp.summary ?? null });
            return;
          }
          resolve({ ok: false, error: resp?.error ?? "unknown" });
        }
      );
    });
  }
  async function fetchSummaryForAppid(appid, title) {
    let summary = await getSummary(appid);
    if (!summary) {
      const cachedItadId = await getItadId(appid);
      const resp = await limited(() => requestSummary(appid, title, cachedItadId));
      if (resp.ok) {
        summary = resp.summary;
        if (summary) {
          await setSummary(summary);
          if (summary.itadId) await setItadId(summary.appid, summary.itadId);
        }
      } else {
        return { summary: null, hadError: true };
      }
    }
    return { summary: summary ?? null, hadError: !summary };
  }
  function getOrFetch(appid, title) {
    let p = fetchCache.get(appid);
    if (!p) {
      p = fetchSummaryForAppid(appid, title);
      fetchCache.set(appid, p);
    }
    return p;
  }
  function stampDecision(info, decision) {
    const target = info.rowEl;
    if (decision.state === "none") {
      if (target.hasAttribute(SWD_STATE_ATTR)) {
        target.removeAttribute(SWD_STATE_ATTR);
        target.removeAttribute(SWD_TOOLTIP_ATTR);
      }
      return;
    }
    if (target.getAttribute(SWD_STATE_ATTR) === decision.state) {
      return;
    }
    target.setAttribute(SWD_STATE_ATTR, decision.state);
    target.setAttribute(SWD_TOOLTIP_ATTR, decision.tooltip);
  }
  function processRow(info) {
    const { appid, title } = info;
    const cached = decisionCache.get(appid);
    if (cached) {
      stampDecision(info, cached);
      return;
    }
    void getOrFetch(appid, title).then((result) => {
      const decision = decideState({
        currentDiscountPercent: info.currentDiscountPercent,
        summary: result.summary,
        hadError: result.hadError
      });
      decisionCache.set(appid, decision);
      stampDecision(info, decision);
    });
  }
  function emojiFor(state) {
    switch (state) {
      case "green":
        return "\\1F7E2";
      // CSS content escape for 🟢
      case "yellow":
        return "\\1F7E1";
      // 🟡
      case "red":
        return "\\1F534";
      // 🔴
      case "orange":
        return "\\1F7E0";
      // 🟠
      case "none":
        return "";
    }
  }
  function injectStylesOnce() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    const states = ["green", "yellow", "red", "orange"];
    const afterRules = states.map(
      (state) => `
    [${SWD_STATE_ATTR}="${state}"]::before {
      content: "${emojiFor(state)}";
      position: absolute;
      top: 8px;
      right: 220px;
      font-size: 1.2em;
      line-height: 1;
      cursor: help;
      z-index: 100;
      pointer-events: auto;
    }`
    ).join("\n");
    const positionRule = `
    [${SWD_STATE_ATTR}] {
      position: relative !important;
    }
  `;
    s.textContent = `
    ${positionRule}
    ${afterRules}

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
      decisionCache.clear();
      fetchCache.clear();
      const n = await clearAllSummaries();
      btn.textContent = n > 0 ? `Cleared ${n} entries \u2014 reload to refresh` : "Nothing to clear";
      setTimeout(() => btn.textContent = "Clear discount cache", 4e3);
      scanAll();
    });
    document.body.appendChild(btn);
  }
  function isWishlistPage() {
    const path = window.location.pathname.toLowerCase();
    return path === "/wishlist" || path.startsWith("/wishlist/");
  }
  function stampIcons() {
    if (!isWishlistPage()) return;
    const container = findWishlistContainer(document) || document.body;
    const rows = findRowElements(container);
    for (const row of rows) {
      const info = extractRowInfo(row);
      if (!info) continue;
      const cached = decisionCache.get(info.appid);
      if (cached) stampDecision(info, cached);
    }
  }
  function scanAll() {
    if (!isWishlistPage()) return;
    const container = findWishlistContainer(document) || document.body;
    const rows = findRowElements(container);
    for (const row of rows) {
      const info = extractRowInfo(row);
      if (!info) continue;
      processRow(info);
    }
  }
  function bootstrap() {
    if (!isWishlistPage()) return;
    injectStylesOnce();
    injectClearCacheButton();
    scanAll();
    setTimeout(scanAll, 500);
    setTimeout(scanAll, 1500);
    let scrollTick = 0;
    window.addEventListener("scroll", () => {
      if (scrollTick) return;
      scrollTick = requestAnimationFrame(() => {
        scrollTick = 0;
        stampIcons();
      });
    }, { passive: true });
    setInterval(stampIcons, 300);
    setInterval(scanAll, 3e3);
  }
  if (document.readyState === "complete" || document.readyState === "interactive") {
    bootstrap();
  } else {
    window.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  }
})();
//# sourceMappingURL=content.js.map
