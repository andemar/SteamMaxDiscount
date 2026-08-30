/**
 * Background service worker (self-contained — no relative imports).
 *
 * Receives `{ type: "getDiscountSummary", appid }` messages from the content
 * script, fetches the game's historical discounts from SteamDB, and returns a
 * DiscountSummary. Keeping the SW self-contained avoids Chrome's strict ESM
 * resolution for service workers (which rejects `..` imports in some versions).
 */
const STEAMDB_APP_URL = (appid) => `https://steamdb.info/app/${appid}/`;
const STEAMDB_PRICE_HISTORY_API = (appid, cc = "us") => `https://steamdb.info/api/GetPriceHistory/?appid=${appid}&cc=${cc}`;
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
async function fetchDiscountSummary(appid) {
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
function parseSteamdbJson(text, appid) {
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
        if (!Array.isArray(row))
            continue;
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
function parseSteamdbHtml(html, appid) {
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
            const pct = extractDiscountFromRow(trs[j].textContent ?? "");
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
    const timesAtMax = discounts.filter((d) => d === max).length;
    return {
        appid,
        allTimeMaxPercent: max,
        timesAtMax,
        lastUpdatedAt: Date.now(),
    };
}
function parseHtmlDocument(html) {
    const noopEl = {
        textContent: "",
        querySelector: () => null,
        querySelectorAll: () => [],
    };
    const noopDoc = {
        querySelectorAll: () => [],
        querySelector: () => null,
    };
    if (typeof DOMParser === "undefined")
        return noopDoc;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const wrap = (el) => ({
        textContent: el.textContent ?? "",
        querySelector: (sel) => {
            const sub = el.querySelector(sel);
            return sub ? wrap(sub) : null;
        },
        querySelectorAll: (sel) => Array.from(el.querySelectorAll(sel)).map(wrap),
    });
    void noopEl;
    return {
        querySelectorAll: (sel) => Array.from(doc.querySelectorAll(sel)).map(wrap),
        querySelector: (sel) => {
            const el = doc.querySelector(sel);
            return el ? wrap(el) : null;
        },
    };
}
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== "object")
        return false;
    if (msg.type === "getDiscountSummary") {
        (async () => {
            try {
                const summary = await fetchDiscountSummary(msg.appid);
                sendResponse({ ok: true, summary });
            }
            catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                sendResponse({ ok: false, error });
            }
        })();
        return true;
    }
    if (msg.type === "clearCache") {
        sendResponse({ ok: true, summary: null });
        return false;
    }
    return false;
});
export {};
