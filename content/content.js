"use strict";
(() => {
  // src/core/discountLogic.ts
  function decideState(input) {
    const { currentDiscountPercent, summary, hadError } = input;
    if (hadError || !summary) {
      return {
        state: "orange",
        tooltip: "Could not retrieve discount history from SteamDB. Click 'Clear discount cache' and reload to retry."
      };
    }
    if (currentDiscountPercent === null || currentDiscountPercent <= 0) {
      return { state: "none", tooltip: "" };
    }
    if (currentDiscountPercent === summary.allTimeMaxPercent) {
      if (summary.timesAtMax <= 1) {
        return {
          state: "green",
          tooltip: `All-time maximum discount (${summary.allTimeMaxPercent}%), first time at this level.`
        };
      }
      return {
        state: "yellow",
        tooltip: `All-time maximum discount (${summary.allTimeMaxPercent}%), seen ${summary.timesAtMax} times historically.`
      };
    }
    if (currentDiscountPercent < summary.allTimeMaxPercent) {
      return {
        state: "red",
        tooltip: `Current ${currentDiscountPercent}% is below the all-time max of ${summary.allTimeMaxPercent}%.`
      };
    }
    return {
      state: "red",
      tooltip: `Current ${currentDiscountPercent}% is at or above the recorded max of ${summary.allTimeMaxPercent}%.`
    };
  }

  // src/core/steamWishlist.ts
  var SELECTORS = {
    containerCandidates: [
      "#wishlist_ctn",
      ".wishlist_ctn",
      "div.wishlist_rows",
      "div[data-feature-target='wishlist']"
    ],
    rowCandidates: [
      "div.wishlist_row",
      "div.Row",
      "div[data-app-id]",
      "a[href*='/app/']"
    ],
    titleCandidates: [
      "div.wishlist_row_title",
      "h2.title",
      "div.title",
      "a.title",
      "a[href*='/app/']"
    ],
    discountCandidates: [
      ".discount_pct",
      ".discount-percentage",
      "div.discount_block .discount_pct",
      "span.discount_pct"
    ]
  };
  function findWishlistContainer(doc) {
    for (const sel of SELECTORS.containerCandidates) {
      const el = doc.querySelector(sel);
      if (el instanceof HTMLElement) return el;
    }
    return null;
  }
  function findRowElements(container) {
    const rows = [];
    for (const sel of SELECTORS.rowCandidates) {
      container.querySelectorAll(sel).forEach((el) => {
        if (el !== container && !rows.includes(el)) rows.push(el);
      });
    }
    return rows;
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
      const cand = rowEl.querySelector(sel);
      if (cand) {
        titleEl = cand;
        href = cand instanceof HTMLAnchorElement ? cand.href : cand.querySelector("a")?.href ?? "";
        break;
      }
    }
    if (!href) {
      const dataAttr = rowEl.getAttribute("data-app-id");
      if (dataAttr) href = `https://store.steampowered.com/app/${dataAttr}/`;
    }
    if (!titleEl || !href) return null;
    const appid = parseAppid(href);
    if (!appid) return null;
    let currentDiscountPercent = null;
    for (const sel of SELECTORS.discountCandidates) {
      const cand = rowEl.querySelector(sel);
      if (cand?.textContent) {
        currentDiscountPercent = parseDiscountText(cand.textContent);
        if (currentDiscountPercent !== null) break;
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
  async function processRow(info) {
    if (info.rowEl.hasAttribute(PROCESSED_ATTR)) return;
    info.rowEl.setAttribute(PROCESSED_ATTR, "1");
    const existing = inFlight.get(info.appid);
    if (existing) {
      await existing;
      return;
    }
    const task = (async () => {
      let summary = await getSummary(info.appid);
      if (!summary) {
        const resp = await limited(() => requestSummary(info.appid));
        if (resp.ok) {
          summary = resp.summary;
          if (summary) await setSummary(summary);
        } else {
          renderDecision(
            info,
            decideState({
              currentDiscountPercent: info.currentDiscountPercent,
              summary: null,
              hadError: true
            })
          );
          return;
        }
      }
      if (!summary) {
        renderDecision(
          info,
          decideState({
            currentDiscountPercent: info.currentDiscountPercent,
            summary: null,
            hadError: true
          })
        );
        return;
      }
      renderDecision(
        info,
        decideState({
          currentDiscountPercent: info.currentDiscountPercent,
          summary,
          hadError: false
        })
      );
    })();
    inFlight.set(info.appid, task);
    try {
      await task;
    } finally {
      inFlight.delete(info.appid);
    }
  }
  function renderDecision(info, decision) {
    info.titleEl.querySelectorAll(`.${ICON_CLASS}`).forEach((n) => n.remove());
    if (decision.state === "none") return;
    const span = document.createElement("span");
    span.className = ICON_CLASS;
    span.setAttribute("data-swd-state", decision.state);
    span.setAttribute("title", decision.tooltip);
    span.textContent = emojiFor(decision.state);
    span.style.marginLeft = "6px";
    span.style.display = "inline-block";
    span.style.fontSize = "0.95em";
    span.style.verticalAlign = "middle";
    span.style.cursor = "help";
    info.titleEl.appendChild(span);
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
    .${ICON_CLASS} { line-height: 1; }
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
      const container = findWishlistContainer(document);
      if (container) {
        for (const row of findRowElements(container)) {
          row.removeAttribute(PROCESSED_ATTR);
          const info = extractRowInfo(row);
          if (info) void processRow(info);
        }
      }
    });
    document.body.appendChild(btn);
  }
  function scanInitial(container) {
    for (const row of findRowElements(container)) {
      const info = extractRowInfo(row);
      if (info) void processRow(info);
    }
  }
  function bootstrap() {
    injectStylesOnce();
    injectClearCacheButton();
    const tryInit = () => {
      const container = findWishlistContainer(document);
      if (!container || container.hasAttribute("data-swd-bound")) return false;
      container.setAttribute("data-swd-bound", "1");
      scanInitial(container);
      attachWishlistObserver(container, (added) => {
        for (const node of added) {
          const nodeMatches = typeof node.matches === "function" && node.matches("[href*='/app/']");
          const hasChild = !!node.querySelector?.("[href*='/app/']");
          if (nodeMatches || hasChild) {
            const parent = nodeMatches ? node : node.querySelector(
              "[data-app-id], div.wishlist_row, div.Row"
            );
            if (parent) {
              const info = extractRowInfo(parent);
              if (info) void processRow(info);
            }
          }
        }
      });
      return true;
    };
    if (tryInit()) return;
    const rootObserver = new MutationObserver(() => {
      if (tryInit()) rootObserver.disconnect();
    });
    rootObserver.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "complete" || document.readyState === "interactive") {
    bootstrap();
  } else {
    window.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  }
})();
//# sourceMappingURL=content.js.map
