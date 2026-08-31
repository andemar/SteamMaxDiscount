import { decideState, type Decision } from "../core/discountLogic";
import {
  extractRowInfo,
  findRowElements,
  findWishlistContainer,
} from "../core/steamWishlist";
import * as storage from "../core/storage";
import type {
  DiscountState,
  DiscountSummary,
  WishlistRowInfo,
} from "../core/types";

const STYLE_ID = "swd-styles";

/**
 * Instead of injecting <span> elements that React's virtual DOM destroys
 * on scroll, we set a `data-swd-state` attribute on the title anchor
 * and use CSS `::after` to render the emoji. This survives React
 * re-renders because we re-stamp attributes every 300ms and on scroll.
 */
const SWD_STATE_ATTR = "data-swd-state";
const SWD_TOOLTIP_ATTR = "data-swd-tooltip";

type SummaryResp =
  | { ok: true; summary: DiscountSummary | null }
  | { ok: false; error: string };

interface FetchSummaryResult {
  summary: DiscountSummary | null;
  hadError: boolean;
}

/* ------------------------------------------------------------------ */
/*  In-memory caches (survive DOM recycling, keyed by appid)          */
/* ------------------------------------------------------------------ */
const decisionCache = new Map<number, Decision>();
const fetchCache = new Map<number, Promise<FetchSummaryResult>>();

function pLimit(concurrency: number) {
  const queue: Array<() => void> = [];
  let active = 0;

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
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

const limited = pLimit(4);

function requestSummary(appid: number, title: string, itadId?: string | null): Promise<SummaryResp> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "getDiscountSummary", appid, title, itadId: itadId ?? undefined },
      (resp: SummaryResp | undefined) => {
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

async function fetchSummaryForAppid(appid: number, title: string): Promise<FetchSummaryResult> {
  let summary = await storage.getSummary(appid);
  if (!summary) {
    const cachedItadId = await storage.getItadId(appid);
    const resp = await limited(() => requestSummary(appid, title, cachedItadId));
    if (resp.ok) {
      summary = resp.summary;
      if (summary) {
        await storage.setSummary(summary);
        if (summary.itadId) await storage.setItadId(summary.appid, summary.itadId);
      }
    } else {
      return { summary: null, hadError: true };
    }
  }
  return { summary: summary ?? null, hadError: !summary };
}

function getOrFetch(appid: number, title: string): Promise<FetchSummaryResult> {
  let p = fetchCache.get(appid);
  if (!p) {
    p = fetchSummaryForAppid(appid, title);
    fetchCache.set(appid, p);
  }
  return p;
}

/**
 * Apply the decision to a row by setting data attributes on the ROW
 * element. CSS ::before on the row renders the emoji as an overlay
 * positioned in the top-right area, next to the "Added on" date.
 * This is a no-op if the correct attribute is already present.
 */
function stampDecision(info: WishlistRowInfo, decision: Decision): void {
  const target = info.rowEl;

  if (decision.state === "none") {
    if (target.hasAttribute(SWD_STATE_ATTR)) {
      target.removeAttribute(SWD_STATE_ATTR);
      target.removeAttribute(SWD_TOOLTIP_ATTR);
    }
    return;
  }

  // No-op if already correct
  if (target.getAttribute(SWD_STATE_ATTR) === decision.state) {
    return;
  }

  target.setAttribute(SWD_STATE_ATTR, decision.state);
  target.setAttribute(SWD_TOOLTIP_ATTR, decision.tooltip);
}

function processRow(info: WishlistRowInfo): void {
  const { appid, title } = info;

  // Synchronous fast-path
  const cached = decisionCache.get(appid);
  if (cached) {
    stampDecision(info, cached);
    return;
  }

  // Async path — deduplicated via fetchCache
  void getOrFetch(appid, title).then((result) => {
    const decision = decideState({
      currentDiscountPercent: info.currentDiscountPercent,
      summary: result.summary,
      hadError: result.hadError,
    });
    decisionCache.set(appid, decision);
    stampDecision(info, decision);
  });
}

function emojiFor(state: DiscountState): string {
  switch (state) {
    case "green":  return "\\1F7E2";  // CSS content escape for 🟢
    case "yellow": return "\\1F7E1";  // 🟡
    case "red":    return "\\1F534";  // 🔴
    case "orange": return "\\1F7E0";  // 🟠
    case "none":   return "";
  }
}

function injectStylesOnce(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;

  // Generate ::before rules for each state — positioned top-right of the row
  const states: DiscountState[] = ["green", "yellow", "red", "orange"];
  const afterRules = states
    .map(
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
    )
    .join("\n");

  // Ensure row has position:relative so ::before is anchored to it
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

function injectClearCacheButton(): void {
  if (document.getElementById("swd-clear-cache-btn")) return;
  const btn = document.createElement("button");
  btn.id = "swd-clear-cache-btn";
  btn.textContent = "Clear discount cache";
  btn.addEventListener("click", async () => {
    decisionCache.clear();
    fetchCache.clear();
    const n = await storage.clearAllSummaries();
    btn.textContent =
      n > 0 ? `Cleared ${n} entries \u2014 reload to refresh` : "Nothing to clear";
    setTimeout(() => (btn.textContent = "Clear discount cache"), 4000);
    scanAll();
  });
  document.body.appendChild(btn);
}

function isWishlistPage(): boolean {
  const path = window.location.pathname.toLowerCase();
  return path === "/wishlist" || path.startsWith("/wishlist/");
}

/**
 * Fast re-stamp: set data attributes on visible rows from memory cache.
 * No DOM insertion, no API calls — just attribute writes (which are
 * effectively no-ops when the value is already correct).
 */
function stampIcons(): void {
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

/**
 * Full scan: re-stamps cached + kicks off fetches for uncached games.
 */
function scanAll(): void {
  if (!isWishlistPage()) return;
  const container = findWishlistContainer(document) || document.body;
  const rows = findRowElements(container);
  for (const row of rows) {
    const info = extractRowInfo(row);
    if (!info) continue;
    processRow(info);
  }
}

function bootstrap(): void {
  if (!isWishlistPage()) return;

  injectStylesOnce();
  injectClearCacheButton();

  // Initial scans
  scanAll();
  setTimeout(scanAll, 500);
  setTimeout(scanAll, 1500);

  // Throttled scroll handler
  let scrollTick = 0;
  window.addEventListener("scroll", () => {
    if (scrollTick) return;
    scrollTick = requestAnimationFrame(() => {
      scrollTick = 0;
      stampIcons();
    });
  }, { passive: true });

  // Fast attribute re-stamp every 300ms
  setInterval(stampIcons, 300);

  // Full scan every 3s for new/uncached games
  setInterval(scanAll, 3000);
}

if (document.readyState === "complete" || document.readyState === "interactive") {
  bootstrap();
} else {
  window.addEventListener("DOMContentLoaded", bootstrap, { once: true });
}
