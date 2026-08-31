const STEAMDB_APP_URL = (appid) => `https://steamdb.info/app/${appid}/`;
const STEAMDB_PRICE_HISTORY_API = (appid, cc = "us") => `https://steamdb.info/api/GetPriceHistory/?appid=${appid}&cc=${cc}`;
/**
 * Fetch the discount summary for an appid. Tries the JSON endpoint first;
 * if that fails, falls back to scraping the app page HTML.
 *
 * Always returns a DiscountSummary if data was found; returns null when
 * no historical discounts are present (treat as "orange" downstream).
 *
 * Throws on hard network failure so the SW can report an error state.
 */
export async function fetchDiscountSummary(appid) {
    try {
        const json = await fetchText(STEAMDB_PRICE_HISTORY_API(appid), {
            Accept: "application/json",
        });
        const summary = parseSteamdbJson(json, appid);
        if (summary)
            return summary;
    }
    catch {
        // fall through to HTML
    }
    const html = await fetchText(STEAMDB_APP_URL(appid), {
        Accept: "text/html,application/xhtml+xml",
    });
    return parseSteamdbHtml(html, appid);
}
async function fetchText(url, extraHeaders) {
    const res = await fetch(url, {
        method: "GET",
        credentials: "omit",
        redirect: "follow",
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
            ...extraHeaders,
        },
    });
    if (!res.ok)
        throw new Error(`SteamDB fetch failed: HTTP ${res.status}`);
    return await res.text();
}
/**
 * Parse SteamDB JSON price history into a DiscountSummary.
 * We compute discount by comparing each sale price to the most recent prior
 * "full price" (any row where the price is higher than the previous row).
 */
export function parseSteamdbJson(text, appid) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return null;
    }
    const rows = parsed?.data?.prices;
    if (!Array.isArray(rows) || rows.length === 0)
        return null;
    const discounts = [];
    let lastBasePrice = null;
    for (const row of rows) {
        const price = Number(row[1]);
        if (!Number.isFinite(price) || price <= 0)
            continue;
        if (lastBasePrice === null) {
            lastBasePrice = price;
            continue;
        }
        if (price > lastBasePrice) {
            lastBasePrice = price;
            continue;
        }
        if (price < lastBasePrice) {
            const pct = Math.round(((lastBasePrice - price) / lastBasePrice) * 100);
            if (pct > 0)
                discounts.push(pct);
        }
    }
    return summarize(discounts, appid);
}
/* -------------------------------------------------------------------------- */
/*                              HTML PARSING                                  */
/* -------------------------------------------------------------------------- */
/**
 * Parse the SteamDB app page HTML for historical discount data. We look for
 * a table of price changes (each row has a "discount" column). Falls back
 * to scanning any element text that looks like "-N%".
 */
export function parseSteamdbHtml(html, appid) {
    const doc = parseHtmlDocument(html);
    const tables = doc.querySelectorAll("table");
    const discounts = [];
    for (let i = 0; i < tables.length; i++) {
        const table = tables[i];
        const head = table.querySelector("thead");
        const headText = (head?.textContent ?? "").toLowerCase();
        if (!/discount|price\s*change/.test(headText))
            continue;
        const trs = table.querySelectorAll("tbody tr");
        for (let j = 0; j < trs.length; j++) {
            const row = trs[j];
            const pct = extractDiscountFromRow(row.textContent ?? "");
            if (pct !== null)
                discounts.push(pct);
        }
        if (discounts.length > 0)
            break;
    }
    if (discounts.length === 0) {
        const matches = html.match(/-?\d{1,3}\s*%/g);
        if (matches) {
            for (const m of matches) {
                const pct = parseDiscount(m);
                if (pct !== null && pct > 0)
                    discounts.push(pct);
            }
        }
    }
    return summarize(discounts, appid);
}
/* -------------------------------------------------------------------------- */
/*                                   UTILS                                    */
/* -------------------------------------------------------------------------- */
function extractDiscountFromRow(text) {
    const m = text.match(/(-?\d{1,3})\s*%/);
    return m ? parseDiscount(m[0]) : null;
}
function parseDiscount(raw) {
    const m = raw.match(/(-?\d{1,3})\s*%/);
    if (!m)
        return null;
    return Math.abs(parseInt(m[1], 10));
}
function summarize(discounts, appid) {
    if (discounts.length === 0)
        return null;
    const max = discounts.reduce((a, b) => (b > a ? b : a), 0);
    if (max <= 0)
        return null;
    return {
        appid,
        itadId: `deprecated-steamdb-${appid}`,
        currentCut: max,
        currentTimestamp: null,
        lowestCut: max,
        lowestTimestamp: null,
        overview: {
            id: `deprecated-steamdb-${appid}`,
            currentPrice: null,
            currentRegular: null,
            currentCut: max,
            currentTimestamp: null,
            lowestPrice: null,
            lowestRegular: null,
            lowestCut: max,
            lowestTimestamp: null,
        },
        lastUpdatedAt: Date.now(),
    };
}
/* -------------------------------------------------------------------------- */
/*                       BROWSER-FREE DOM PARSER (TINY)                       */
/* -------------------------------------------------------------------------- */
function parseHtmlDocument(html) {
    if (typeof DOMParser !== "undefined") {
        return new DOMParser().parseFromString(html, "text/html");
    }
    return new ShapedDoc();
}
/**
 * Minimal Document-like fallback used only when DOMParser is unavailable
 * (e.g., inside a service worker in some browsers). Returns empty matches
 * for any selector so the parser can degrade gracefully.
 */
class ShapedDoc {
    querySelectorAll(_sel) {
        return [];
    }
    querySelector(_sel) {
        return null;
    }
}
