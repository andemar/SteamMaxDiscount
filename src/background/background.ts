/**
 * Background service worker (self-contained — no relative imports).
 *
 * Receives `{ type: "getDiscountSummary", appid }` messages from the content
 * script, fetches the game's historical discounts from SteamDB, and returns a
 * DiscountSummary. Keeping the SW self-contained avoids Chrome's strict ESM
 * resolution for service workers (which rejects `..` imports in some versions).
 */

import type { DiscountState, DiscountSummary, SwdMessage, SwdResponse } from "../core/types";

const CHEAPSHARK_APPID_API = (appid: number) =>
  `https://www.cheapshark.com/api/1.0/games?steamAppID=${appid}`;
const CHEAPSHARK_GAME_API = (gameId: string) =>
  `https://www.cheapshark.com/api/1.0/games?id=${gameId}`;
const STEAMDB_APP_URL = (appid: number) => `https://steamdb.info/app/${appid}/`;

// 10-second rate-limiting queue
let queuePromise = Promise.resolve();
const REQUEST_DELAY_MS = 10000;

function rateLimitedFetch<T>(fn: () => Promise<T>): Promise<T> {
  const next = queuePromise.then(async () => {
    const result = await fn();
    await new Promise((res) => setTimeout(res, REQUEST_DELAY_MS));
    return result;
  });
  queuePromise = next.catch(() => new Promise((res) => setTimeout(res, REQUEST_DELAY_MS)));
  return next;
}

async function fetchText(
  url: string,
  extraHeaders: Record<string, string> = {}
): Promise<string> {
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

async function fetchCheapSharkSummary(
  appid: number
): Promise<DiscountSummary | null> {
  try {
    const listText = await fetchText(CHEAPSHARK_APPID_API(appid), {
      Accept: "application/json",
    });
    const list = JSON.parse(listText);
    if (!Array.isArray(list) || list.length === 0 || !list[0].gameID) {
      return null;
    }

    const gameId = list[0].gameID;

    const gameText = await fetchText(CHEAPSHARK_GAME_API(gameId), {
      Accept: "application/json",
    });
    const data = JSON.parse(gameText);
    if (
      !data ||
      !data.cheapestPriceEver ||
      !data.deals ||
      data.deals.length === 0
    ) {
      return null;
    }

    const steamDeal =
      data.deals.find((d: any) => d.storeID === "1") || data.deals[0];
    const retailPrice = parseFloat(steamDeal.retailPrice);
    const cheapestPrice = parseFloat(data.cheapestPriceEver.price);

    if (
      Number.isFinite(retailPrice) &&
      retailPrice > 0 &&
      Number.isFinite(cheapestPrice)
    ) {
      const maxDiscount = Math.round(
        ((retailPrice - cheapestPrice) / retailPrice) * 100
      );
      if (maxDiscount > 0) {
        console.log(
          `[swd-bg] CheapShark historical max discount for appid=${appid} (${data.info?.title}): allTimeMaxPercent=${maxDiscount}% (lowest: $${cheapestPrice}, retail: $${retailPrice})`
        );
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

async function fetchDiscountSummary(appid: number): Promise<DiscountSummary | null> {
  return rateLimitedFetch(async () => {
    console.log(`[swd-bg] Fetching historical discount data for appid=${appid}...`);

    // 1. Primary: CheapShark API (all-time historical low lookup)
    const csSummary = await fetchCheapSharkSummary(appid);
    if (csSummary) {
      return csSummary;
    }

    // 2. Secondary: SteamDB HTML scraping
    try {
      const html = await fetchText(STEAMDB_APP_URL(appid), {
        Accept: "text/html,application/xhtml+xml",
      });

      if (
        !html.includes("Please do not scrape") &&
        !html.includes("Cloudflare") &&
        !html.includes("Checking your browser")
      ) {
        const summary = parseSteamdbHtml(html, appid);
        if (summary) {
          console.log(`[swd-bg] SteamDB HTML scraping success for appid=${appid}:`, summary);
          return summary;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[swd-bg] SteamDB fetch error for appid=${appid}:`, msg);
    }

    console.warn(`[swd-bg] No historical price records found for appid=${appid}`);
    return null;
  });
}


function parseSteamdbJson(text: string, appid: number): DiscountSummary | null {
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const rows: unknown = parsed?.data?.prices;
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const discounts: number[] = [];
  let lastBasePrice: number | null = null;

  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const price = Number(row[1]);
    if (!Number.isFinite(price) || price <= 0) continue;
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
      if (pct > 0) discounts.push(pct);
    }
  }
  return summarize(discounts, appid);
}

function parseSteamdbHtml(html: string, appid: number): DiscountSummary | null {
  const doc = parseHtmlDocument(html);
  const tables = doc.querySelectorAll("table");
  const discounts: number[] = [];

  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    const head = table.querySelector("thead");
    const headText = (head?.textContent ?? "").toLowerCase();
    if (!/discount|price\s*change|history/.test(headText)) continue;

    const trs = table.querySelectorAll("tbody tr");
    for (let j = 0; j < trs.length; j++) {
      const pct = extractDiscountFromRow(trs[j].textContent ?? "");
      if (pct !== null) discounts.push(pct);
    }
    if (discounts.length > 0) break;
  }

  if (discounts.length === 0) {
    const matches = html.match(/-\d{1,3}\s*%/g);
    if (matches) {
      for (const m of matches) {
        const pct = parseDiscount(m);
        if (pct !== null && pct > 0 && pct <= 100) discounts.push(pct);
      }
    }
  }
  return summarize(discounts, appid);
}

function extractDiscountFromRow(text: string): number | null {
  const m = text.match(/(-?\d{1,3})\s*%/);
  return m ? parseDiscount(m[0]) : null;
}

function parseDiscount(raw: string): number | null {
  const m = raw.match(/(-?\d{1,3})\s*%/);
  if (!m) return null;
  return Math.abs(parseInt(m[1], 10));
}

function summarize(discounts: number[], appid: number): DiscountSummary | null {
  if (discounts.length === 0) return null;
  const max = discounts.reduce((a, b) => (b > a ? b : a), 0);
  if (max <= 0) return null;
  const timesAtMax = discounts.filter((d) => d === max).length;
  return {
    appid,
    allTimeMaxPercent: max,
    timesAtMax,
    lastUpdatedAt: Date.now(),
  };
}

interface MinimalElement {
  textContent: string;
  querySelector(sel: string): MinimalElement | null;
  querySelectorAll(sel: string): MinimalElement[];
}
interface MinimalDoc {
  querySelectorAll(sel: string): MinimalElement[];
  querySelector(sel: string): MinimalElement | null;
}

function parseHtmlDocument(html: string): MinimalDoc {
  const noopEl: MinimalElement = {
    textContent: "",
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const noopDoc: MinimalDoc = {
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  if (typeof DOMParser === "undefined") return noopDoc;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const wrap = (el: Element): MinimalElement => ({
    textContent: (el as HTMLElement).textContent ?? "",
    querySelector: (sel: string) => {
      const sub = el.querySelector(sel);
      return sub ? wrap(sub) : null;
    },
    querySelectorAll: (sel: string) =>
      Array.from(el.querySelectorAll(sel)).map(wrap),
  });
  void noopEl;
  return {
    querySelectorAll: (sel: string) =>
      Array.from(doc.querySelectorAll(sel)).map(wrap),
    querySelector: (sel: string) => {
      const el = doc.querySelector(sel);
      return el ? wrap(el) : null;
    },
  };
}

chrome.runtime.onMessage.addListener(
  (
    msg: SwdMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (resp: SwdResponse) => void
  ) => {
    if (!msg || typeof msg !== "object") return false;

    if (msg.type === "getDiscountSummary") {
      (async () => {
        try {
          const summary = await fetchDiscountSummary(msg.appid);
          sendResponse({ ok: true, summary });
        } catch (err) {
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
  }
);
