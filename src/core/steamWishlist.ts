import type { WishlistRowInfo } from "./types";

/**
 * Centralized selectors. Steam frequently tweaks class names, so we keep
 * these in one place and provide fallbacks.
 *
 * Updated August 2026 to support Steam's wishlist redesign which uses
 * data-ds-appid, search_result_row, and React-rendered containers.
 */
const SELECTORS = {
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
    "[class*='wishlist_row']",       /* parent of rows */
    "[id*='wishlist']",
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
    "[class*='wishlist_row']",
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
    "a[href*='/app/']",
  ],
  discountCandidates: [
    ".discount_pct",
    ".discount-percentage",
    "div.discount_block .discount_pct",
    "span.discount_pct",
    "[class*='discountPct']",
    "[class*='DiscountPct']",
    "[class*='discount_pct']",
    "[class*='discount']",
  ],
};

/**
 * Locate the wishlist container. Tries known selectors first, then falls
 * back to dynamically finding the common ancestor of app links on the page.
 */
export function findWishlistContainer(doc: Document): HTMLElement | null {
  for (const sel of SELECTORS.containerCandidates) {
    try {
      const el = doc.querySelector(sel);
      if (el instanceof HTMLElement) {
        console.log("[swd] container matched selector:", sel);
        return el;
      }
    } catch {
      /* invalid selector – skip */
    }
  }

  /* Dynamic fallback: find the first app link and walk up to a reasonable
     ancestor that contains multiple app links (i.e. the wishlist container). */
  const appLinks = doc.querySelectorAll<HTMLAnchorElement>(
    SELECTORS.appLinkSelector
  );
  if (appLinks.length > 0) {
    let candidate: HTMLElement | null = appLinks[0].parentElement;
    let depth = 0;
    while (candidate && candidate !== doc.body && depth < 12) {
      const linksInside = candidate.querySelectorAll(
        SELECTORS.appLinkSelector
      ).length;
      if (linksInside >= 2) {
        console.log(
          "[swd] container found via dynamic fallback at depth",
          depth,
          candidate.tagName,
          candidate.className
        );
        return candidate;
      }
      candidate = candidate.parentElement;
      depth++;
    }
    /* Last resort: if there's only one app link, use its grandparent */
    if (appLinks.length === 1 && appLinks[0].parentElement?.parentElement) {
      const fallback = appLinks[0].parentElement.parentElement;
      console.log("[swd] container: single-link fallback", fallback.tagName);
      return fallback;
    }
  }

  console.warn("[swd] could not find wishlist container");
  return null;
}

/**
 * Find the root element for each wishlist row.
 * Walks up from each `/app/` anchor to its top-level card (direct child or main card inside container),
 * ensuring each game in the wishlist is treated as a single unified row.
 */
export function findRowElements(container: HTMLElement): HTMLElement[] {
  const rows: HTMLElement[] = [];
  const appLinks = Array.from(
    container.querySelectorAll<HTMLAnchorElement>(SELECTORS.appLinkSelector)
  );

  for (const a of appLinks) {
    const card = findOuterCard(a, container);
    if (card && card !== container && !rows.includes(card)) {
      rows.push(card);
    }
  }

  // Fallback to rowCandidates if no appLinks cards were found
  if (rows.length === 0) {
    for (const sel of SELECTORS.rowCandidates) {
      try {
        container.querySelectorAll<HTMLElement>(sel).forEach((el) => {
          if (el !== container && !rows.includes(el)) rows.push(el);
        });
      } catch {
        /* invalid selector – skip */
      }
    }
  }

  return rows;
}

/**
 * Walk up from an app link to find its outer game card in the container.
 * Prefers the highest ancestor before the container so that title and discount
 * are in the same element.
 */
function findOuterCard(
  link: HTMLElement,
  container: HTMLElement
): HTMLElement | null {
  let cur: HTMLElement | null = link.parentElement;
  let best: HTMLElement | null = link.parentElement;
  let depth = 0;

  while (cur && cur !== container && depth < 10) {
    // If cur is a direct child of container, it's the game row/card
    if (cur.parentElement === container) {
      return cur;
    }
    // Or if cur contains a discount percentage and a title
    if (
      cur.querySelector(SELECTORS.discountCandidates.join(",")) &&
      cur.querySelector(SELECTORS.appLinkSelector)
    ) {
      best = cur;
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

  // 1. Try finding title candidate elements with actual non-empty text
  for (const sel of SELECTORS.titleCandidates) {
    try {
      const candidates = rowEl.querySelectorAll<HTMLElement>(sel);
      for (const cand of Array.from(candidates)) {
        const text = cand.textContent?.trim();
        // Make sure it's not a discount badge or purely whitespace
        if (text && text.length > 0 && !text.endsWith("%")) {
          titleEl = cand;
          href =
            cand instanceof HTMLAnchorElement
              ? cand.href
              : cand.querySelector<HTMLAnchorElement>("a")?.href ?? "";
          if (href) break;
        }
      }
      if (titleEl && href) break;
    } catch {
      /* invalid selector – skip */
    }
  }

  // 2. If no href from title, find any app link in row
  if (!href) {
    const anchors = rowEl.querySelectorAll<HTMLAnchorElement>(
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

  // 3. Check data attributes for appid
  if (!href) {
    const dsAppid = rowEl.getAttribute("data-ds-appid");
    if (dsAppid) href = `https://store.steampowered.com/app/${dsAppid}/`;
  }
  if (!href) {
    const dataAttr = rowEl.getAttribute("data-app-id");
    if (dataAttr) href = `https://store.steampowered.com/app/${dataAttr}/`;
  }

  if (!titleEl && href) {
    const anchor = rowEl.querySelector<HTMLAnchorElement>(
      SELECTORS.appLinkSelector
    );
    titleEl = anchor ?? rowEl;
  }
  if (!titleEl || !href) return null;

  const appid = parseAppid(href);
  if (!appid) return null;

  // 4. Extract current discount percent from anywhere in the card
  let currentDiscountPercent: number | null = null;
  for (const sel of SELECTORS.discountCandidates) {
    try {
      const cand = rowEl.querySelector<HTMLElement>(sel);
      if (cand?.textContent) {
        currentDiscountPercent = parseDiscountText(cand.textContent);
        if (currentDiscountPercent !== null) break;
      }
    } catch {
      /* invalid selector – skip */
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
