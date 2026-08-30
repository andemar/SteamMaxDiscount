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

const inFlight = new Map<number, Promise<void>>();

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

async function requestSummary(appid: number): Promise<SummaryResp> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "getDiscountSummary", appid },
      (resp: SwdRawResponse | undefined) => {
        if (resp && (resp as SwdRawResponse).ok) {
          const r = resp as { ok: true; summary: DiscountSummary | null };
          resolve({ ok: true, summary: r.summary ?? null });
        } else {
          const r = resp as { ok?: false; error?: string };
          resolve({ ok: false, error: r?.error ?? "unknown" });
        }
      }
    );
  });
}

type SwdRawResponse =
  | { ok: true; summary: DiscountSummary | null }
  | { ok: false; error: string };

async function processRow(info: WishlistRowInfo): Promise<void> {
  if (info.rowEl.hasAttribute(PROCESSED_ATTR)) return;
  info.rowEl.setAttribute(PROCESSED_ATTR, "1");

  const existing = inFlight.get(info.appid);
  if (existing) {
    await existing;
    return;
  }

  const task = (async () => {
    let summary = await storage.getSummary(info.appid);

    if (!summary) {
      const resp = await limited(() => requestSummary(info.appid));
      if (resp.ok) {
        summary = resp.summary;
        if (summary) await storage.setSummary(summary);
      } else {
        renderDecision(
          info,
          decideState({
            currentDiscountPercent: info.currentDiscountPercent,
            summary: null,
            hadError: true,
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
          hadError: true,
        })
      );
      return;
    }

    renderDecision(
      info,
      decideState({
        currentDiscountPercent: info.currentDiscountPercent,
        summary,
        hadError: false,
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

function renderDecision(info: WishlistRowInfo, decision: Decision): void {
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
  for (const row of findRowElements(container)) {
    const info = extractRowInfo(row);
    if (info) void processRow(info);
  }
}

function bootstrap(): void {
  injectStylesOnce();

  const container = findWishlistContainer(document);
  if (!container) return;

  injectClearCacheButton();
  scanInitial(container);

  attachWishlistObserver(container, (added) => {
    for (const node of added) {
      const nodeMatches =
        typeof node.matches === "function" &&
        (node as HTMLElement).matches("[href*='/app/']");
      const hasChild = !!node.querySelector?.("[href*='/app/']");

      if (nodeMatches || hasChild) {
        const parent =
          (nodeMatches
            ? node
            : (node as HTMLElement).querySelector(
                "[data-app-id], div.wishlist_row, div.Row"
              )) as HTMLElement | null;
        if (parent) {
          const info = extractRowInfo(parent);
          if (info) void processRow(info);
        }
      }
    }
  });
}

if (document.readyState === "complete" || document.readyState === "interactive") {
  bootstrap();
} else {
  window.addEventListener("DOMContentLoaded", bootstrap, { once: true });
}
