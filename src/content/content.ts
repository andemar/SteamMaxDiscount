import { decideState, type Decision } from "../core/discountLogic";
import {
  extractRowInfo,
  findRowElements,
  findWishlistContainer,
} from "../core/steamWishlist";
import { attachWishlistObserver } from "../core/observer";
import * as storage from "../core/storage";
import type {
  DiscountState,
  DiscountSummary,
  WishlistRowInfo,
} from "../core/types";

const PROCESSED_ATTR = "data-swd-processed";
const ICON_CLASS = "swd-discount-circle";
const STYLE_ID = "swd-styles";

type SummaryResp =
  | { ok: true; summary: DiscountSummary | null }
  | { ok: false; error: string };

interface FetchSummaryResult {
  summary: DiscountSummary | null;
  hadError: boolean;
}

const inFlight = new Map<number, Promise<FetchSummaryResult>>();

async function fetchSummaryForAppid(appid: number): Promise<FetchSummaryResult> {
  let summary = await storage.getSummary(appid);
  if (!summary) {
    const resp = await limited(() => requestSummary(appid));
    if (resp.ok) {
      summary = resp.summary;
      if (summary) await storage.setSummary(summary);
    } else {
      return { summary: null, hadError: true };
    }
  }
  if (!summary) {
    return { summary: null, hadError: true };
  }
  return { summary, hadError: false };
}

async function processRow(info: WishlistRowInfo): Promise<void> {
  if (info.rowEl.hasAttribute(PROCESSED_ATTR)) return;
  info.rowEl.setAttribute(PROCESSED_ATTR, "1");

  let fetchPromise = inFlight.get(info.appid);
  if (!fetchPromise) {
    fetchPromise = fetchSummaryForAppid(info.appid);
    inFlight.set(info.appid, fetchPromise);
  }

  try {
    const result = await fetchPromise;
    console.log(
      "[swd] rendering appid=",
      info.appid,
      "discount=",
      info.currentDiscountPercent,
      "result=",
      result
    );
    renderDecision(
      info,
      decideState({
        currentDiscountPercent: info.currentDiscountPercent,
        summary: result.summary,
        hadError: result.hadError,
      })
    );
  } finally {
    inFlight.delete(info.appid);
  }
}

function renderDecision(info: WishlistRowInfo, decision: Decision): void {
  info.titleEl.querySelectorAll(`.${ICON_CLASS}`).forEach((n) => n.remove());
  info.rowEl.querySelectorAll(`.${ICON_CLASS}`).forEach((n) => n.remove());

  console.log("[swd] renderDecision state=", decision.state, "for", info.titleEl);
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

function emojiFor(state: DiscountState): string {
  switch (state) {
    case "green":
      return "\uD83D\uDFE2";
    case "yellow":
      return "\uD83D\uDFE1";
    case "red":
      return "\uD83D\uDD34";
    case "orange":
      return "\uD83D\uDFE0";
    case "none":
      return "";
  }
}

function injectStylesOnce(): void {
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

function injectClearCacheButton(): void {
  if (document.getElementById("swd-clear-cache-btn")) return;
  const btn = document.createElement("button");
  btn.id = "swd-clear-cache-btn";
  btn.textContent = "Clear discount cache";
  btn.addEventListener("click", async () => {
    const n = await storage.clearAllSummaries();
    btn.textContent =
      n > 0 ? `Cleared ${n} entries \u2014 reload to refresh` : "Nothing to clear";
    setTimeout(() => (btn.textContent = "Clear discount cache"), 4000);
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

function scanInitial(container: HTMLElement): void {
  const rows = findRowElements(container);
  console.log("[swd] container found, rows:", rows.length, container);
  let processed = 0;
  let skipped = 0;
  for (const row of rows) {
    const info = extractRowInfo(row);
    if (info) {
      processed++;
      console.log("[swd] row appid=", info.appid, "discount=", info.currentDiscountPercent, info.rowEl);
      void processRow(info);
    } else {
      skipped++;
    }
  }
  console.log(`[swd] processed=${processed} skipped=${skipped}`);
}

function bootstrap(): void {
  injectStylesOnce();
  injectClearCacheButton();

  const tryInit = (): boolean => {
    const container = findWishlistContainer(document);
    if (!container || container.hasAttribute("data-swd-bound")) return false;
    container.setAttribute("data-swd-bound", "1");

    scanInitial(container);

    attachWishlistObserver(container, (added) => {
      for (const node of added) {
        const nodeMatches =
          typeof node.matches === "function" &&
          (node as HTMLElement).matches("[href*='/app/']");
        const hasChild = !!node.querySelector?.("[href*='/app/']");

        if (nodeMatches || hasChild) {
          /* Try to find the row element from the added node */
          const parent =
            (nodeMatches
              ? node
              : (node as HTMLElement).querySelector(
                  "[data-app-id], [data-ds-appid], div.wishlist_row, div.Row, .search_result_row, [class*='wishlistRow']"
                )) as HTMLElement | null;
          if (parent) {
            const info = extractRowInfo(parent);
            if (info) void processRow(info);
          } else {
            /* Fallback: the added node itself may be the row */
            const info = extractRowInfo(node as HTMLElement);
            if (info) void processRow(info);
          }
        } else if (
          node instanceof HTMLElement &&
          (node.hasAttribute("data-ds-appid") ||
            node.hasAttribute("data-app-id") ||
            node.classList?.contains("search_result_row"))
        ) {
          /* The added node IS a row */
          const info = extractRowInfo(node);
          if (info) void processRow(info);
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
