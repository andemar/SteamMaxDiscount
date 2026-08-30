const STEAMDB_APP_URL = (appid) => `https://steamdb.info/app/${appid}/`;
const CHEAPSHARK_API = (appid) => `https://www.cheapshark.com/api/1.0/games?steamAppID=${appid}`;

// 2-second rate-limiting queue to avoid triggering bot / rate-limit protections
let queuePromise = Promise.resolve();
const REQUEST_DELAY_MS = 2000;

function rateLimitedFetch(fn) {
    const next = queuePromise.then(async () => {
        const result = await fn();
        await new Promise((res) => setTimeout(res, REQUEST_DELAY_MS));
        return result;
    });
    // Update queuePromise so subsequent requests chain after this one
    queuePromise = next.catch(() => new Promise((res) => setTimeout(res, REQUEST_DELAY_MS)));
    return next;
}

async function fetchText(url, extraHeaders = {}) {
    const res = await fetch(url, {
        method: "GET",
        headers: {
            ...extraHeaders,
        },
    });
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} (${res.statusText}) for ${url}`);
    }
    return await res.text();
}

async function fetchCheapSharkSummary(appid) {
    try {
        const text = await fetchText(CHEAPSHARK_API(appid), { Accept: "application/json" });
        const data = JSON.parse(text);
        if (!data || !data.cheapestPriceEver || !data.deals || data.deals.length === 0) {
            return null;
        }
        const retailPrice = parseFloat(data.deals[0].retailPrice);
        const cheapestPrice = parseFloat(data.cheapestPriceEver.price);
        if (Number.isFinite(retailPrice) && retailPrice > 0 && Number.isFinite(cheapestPrice)) {
            const maxDiscount = Math.round(((retailPrice - cheapestPrice) / retailPrice) * 100);
            if (maxDiscount > 0) {
                console.log(`[swd-bg] CheapShark success for appid=${appid}: allTimeMaxPercent=${maxDiscount}%`);
                return {
                    appid,
                    allTimeMaxPercent: maxDiscount,
                    timesAtMax: 1,
                    lastUpdatedAt: Date.now(),
                };
            }
        }
    } catch (e) {
        console.warn(`[swd-bg] CheapShark API error for appid=${appid}:`, e);
    }
    return null;
}

async function fetchDiscountSummary(appid) {
    return rateLimitedFetch(async () => {
        console.log(`[swd-bg] Fetching price history for appid=${appid}...`);

        // 1. Primary: CheapShark API (instant public API, no Cloudflare challenges)
        const csSummary = await fetchCheapSharkSummary(appid);
        if (csSummary) {
            return csSummary;
        }

        // 2. Secondary: SteamDB App Page HTML scraping
        try {
            const html = await fetchText(STEAMDB_APP_URL(appid), {
                Accept: "text/html,application/xhtml+xml",
            });

            if (
                html.includes("Please do not scrape") ||
                html.includes("Cloudflare") ||
                html.includes("Checking your browser")
            ) {
                console.warn(`[swd-bg] SteamDB blocked with Cloudflare challenge for appid=${appid}`);
            } else {
                const summary = parseSteamdbHtml(html, appid);
                if (summary) {
                    console.log(`[swd-bg] SteamDB HTML scraping success for appid=${appid}:`, summary);
                    return summary;
                }
            }
        } catch (err) {
            console.warn(`[swd-bg] SteamDB fetch failed for appid=${appid}:`, err.message);
        }

        console.warn(`[swd-bg] No discount history found for appid=${appid}`);
        return null;
    });
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

    // 1. Look in table rows
    for (let i = 0; i < tables.length; i++) {
        const table = tables[i];
        const head = table.querySelector("thead");
        const headText = (head?.textContent ?? "").toLowerCase();
        if (!/discount|price\s*change|history/.test(headText))
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

    // 2. Look for SteamDB's "Lowest recorded price" or discount tags: e.g. -XX%
    if (discounts.length === 0) {
        // Matches explicit discounts like -31%, -50%, -75%
        const matches = html.match(/-\d{1,3}\s*%/g);
        if (matches) {
            for (const m of matches) {
                const pct = parseDiscount(m);
                if (pct !== null && pct > 0 && pct <= 100)
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
