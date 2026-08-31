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

function requestSummary(info: WishlistRowInfo, itadId?: string | null): Promise<SummaryResp> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "getDiscountSummary", appid: info.appid, title: info.title, itadId: itadId ?? undefined },
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

async function fetchSummaryForInfo(info: WishlistRowInfo): Promise<FetchSummaryResult> {
  const appid = info.appid;
  let summary = await storage.getSummary(appid);
  if (!summary) {
    const cachedItadId = await storage.getItadId(appid);
    const resp = await limited(() => requestSummary(info, cachedItadId));
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
    fetchPromise = fetchSummaryForInfo(info);
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

function isWishlistPage(): boolean {
  const path = window.location.pathname.toLowerCase();
  return path === "/wishlist" || path.startsWith("/wishlist/");
}

function scanAll(): void {
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

function bootstrap(): void {
  if (!isWishlistPage()) return;

  injectStylesOnce();
  injectClearCacheButton();

  // Initial scans (immediate and delayed to catch post-hydration state)
  scanAll();
  setTimeout(scanAll, 500);
  setTimeout(scanAll, 1500);

  // Debounced mutation observer to instantly handle React DOM updates & hydration
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

  // Rescan on scroll to handle Steam's virtualized infinite wishlist list
  window.addEventListener("scroll", debouncedScan, { passive: true });
}

if (document.readyState === "complete" || document.readyState === "interactive") {
  bootstrap();
} else {
  window.addEventListener("DOMContentLoaded", bootstrap, { once: true });
}
