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
    ],
    rowCandidates: [
        "div.wishlist_row",
        "div.Row",
        "div[data-app-id]",
        "a[href*='/app/']",
    ],
    titleCandidates: [
        "div.wishlist_row_title",
        "h2.title",
        "div.title",
        "a.title",
        "a[href*='/app/']",
    ],
    discountCandidates: [
        ".discount_pct",
        ".discount-percentage",
        "div.discount_block .discount_pct",
        "span.discount_pct",
    ],
};
/** Locate the wishlist container; may be null if the user is logged out. */
export function findWishlistContainer(doc) {
    for (const sel of SELECTORS.containerCandidates) {
        const el = doc.querySelector(sel);
        if (el instanceof HTMLElement)
            return el;
    }
    return null;
}
/** Find the root element for each wishlist row. */
export function findRowElements(container) {
    const rows = [];
    for (const sel of SELECTORS.rowCandidates) {
        container.querySelectorAll(sel).forEach((el) => {
            if (el !== container && !rows.includes(el))
                rows.push(el);
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
    if (!m)
        return null;
    const n = Math.abs(parseInt(m[1], 10));
    if (!Number.isFinite(n))
        return null;
    return n;
}
export function extractRowInfo(rowEl) {
    let titleEl = null;
    let href = "";
    for (const sel of SELECTORS.titleCandidates) {
        const cand = rowEl.querySelector(sel);
        if (cand) {
            titleEl = cand;
            href =
                cand instanceof HTMLAnchorElement
                    ? cand.href
                    : cand.querySelector("a")?.href ?? "";
            break;
        }
    }
    if (!href) {
        const dataAttr = rowEl.getAttribute("data-app-id");
        if (dataAttr)
            href = `https://store.steampowered.com/app/${dataAttr}/`;
    }
    if (!titleEl || !href)
        return null;
    const appid = parseAppid(href);
    if (!appid)
        return null;
    let currentDiscountPercent = null;
    for (const sel of SELECTORS.discountCandidates) {
        const cand = rowEl.querySelector(sel);
        if (cand?.textContent) {
            currentDiscountPercent = parseDiscountText(cand.textContent);
            if (currentDiscountPercent !== null)
                break;
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
