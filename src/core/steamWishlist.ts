import type { WishlistRowInfo } from "./types";

/**
 * Centralized selectors. Steam frequently tweaks class names, so we keep
 * these in one place and provide fallbacks.
 */
const SELECTORS = {
  containerCandidates: [
    "#wishlist_ctn",
    ".wishlist_ctn",
    "div.wishlist_rows",
    "div[data-feature-target='wishlist']",
    "div._wishlist_rows_",
  ],
  rowCandidates: [
    "div.wishlist_row",
    "div.Row",
    "div[data-app-id]",
  ],
  appLinkSelector: "a[href*='/app/']",
  titleCandidates: [
    "div.wishlist_row_title",
    "h2.title",
    "div.title",
    "a.title",
    "h2",
    "h3",
    "[class*='title']",
    "a[href*='/app/']",
  ],
  discountCandidates: [
    ".discount_pct",
    ".discount-percentage",
    "div.discount_block .discount_pct",
    "span.discount_pct",
    "[class*='discount']",
  ],
};

/** Locate the wishlist container; may be null if the user is logged out. */
export function findWishlistContainer(doc: Document): HTMLElement | null {
  for (const sel of SELECTORS.containerCandidates) {
    const el = doc.querySelector(sel);
    if (el instanceof HTMLElement) return el;
  }
  return null;
}

/**
 * Find the root element for each wishlist row. Prefers stable class-based
 * selectors; falls back to walking up from each `/app/` anchor to its outer
 * card so we still match Steam's modern SPA where class names are hashed.
 */
export function findRowElements(container: HTMLElement): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (const sel of SELECTORS.rowCandidates) {
    container.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      if (el !== container && !rows.includes(el)) rows.push(el);
    });
  }
  for (const a of Array.from(
    container.querySelectorAll<HTMLAnchorElement>(SELECTORS.appLinkSelector)
  )) {
    const card = findOuterCard(a, container);
    if (card && card !== container && !rows.includes(card)) rows.push(card);
  }
  return rows;
}

/** Walk up from an app link to the smallest ancestor that still contains
 *  the discount block (or, lacking that, more than just the link itself). */
function findOuterCard(
  link: HTMLElement,
  stopAt: HTMLElement
): HTMLElement | null {
  let cur: HTMLElement | null = link.parentElement;
  let best: HTMLElement | null = null;
  let depth = 0;
  while (cur && cur !== stopAt && depth < 8) {
    if (cur.querySelector(SELECTORS.discountCandidates.join(","))) {
      best = cur;
      break;
    }
    cur = cur.parentElement;
    depth++;
  }
  return best ?? link.parentElement ?? null;
}

function parseAppid(href: string): number | null {
  const m = href.match(/\/app\/(\d+)\b/);
  return m ? Number(m[1]) : null;
}

function parseDiscountText(text: string): number | null {
  const m = text.match(/(-?\d{1,3})\s*%/);
  if (!m) return null;
  const n = Math.abs(parseInt(m[1], 10));
  if (!Number.isFinite(n)) return null;
  return n;
}

export function extractRowInfo(rowEl: HTMLElement): WishlistRowInfo | null {
  let titleEl: HTMLElement | null = null;
  let href = "";
  for (const sel of SELECTORS.titleCandidates) {
    const cand = rowEl.querySelector<HTMLElement>(sel);
    if (cand) {
      titleEl = cand;
      href =
        cand instanceof HTMLAnchorElement
          ? cand.href
          : cand.querySelector<HTMLAnchorElement>("a")?.href ?? "";
      if (href) break;
    }
  }
  if (!href) {
    const anchor = rowEl.querySelector<HTMLAnchorElement>(
      SELECTORS.appLinkSelector
    );
    if (anchor) href = anchor.href;
  }
  if (!href) {
    const dataAttr = rowEl.getAttribute("data-app-id");
    if (dataAttr) href = `https://store.steampowered.com/app/${dataAttr}/`;
  }
  if (!titleEl || !href) return null;

  const appid = parseAppid(href);
  if (!appid) return null;

  let currentDiscountPercent: number | null = null;
  for (const sel of SELECTORS.discountCandidates) {
    const cand = rowEl.querySelector<HTMLElement>(sel);
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
    href,
  };
}
