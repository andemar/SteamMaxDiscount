/**
 * Background service worker (self-contained — no relative imports).
 *
 * Receives `{ type: "getDiscountSummary", appid }` messages from the content
 * script, fetches the game's historical discounts from SteamDB, and returns a
 * DiscountSummary. Keeping the SW self-contained avoids Chrome's strict ESM
 * resolution for service workers (which rejects `..` imports in some versions).
 */

import type { DiscountState, DiscountSummary, SwdMessage, SwdResponse } from "../core/types";

const STEAMDB_APP_URL = (appid: number) => `https://steamdb.info/app/${appid}/`;
const STEAMDB_PRICE_HISTORY_API = (appid: number, cc = "us") =>
  `https://steamdb.info/api/GetPriceHistory/?appid=${appid}&cc=${cc}`;

async function fetchText(
  url: string,
  extraHeaders: Record<string, string>
): Promise<string> {
  const res = await fetch(url, {
    method: "GET",
    credentials: "omit",
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      ...extraHeaders,
    },
  });
  if (!res.ok) throw new Error(`SteamDB fetch failed: HTTP ${res.status}`);
  return await res.text();
}

async function fetchDiscountSummary(appid: number): Promise<DiscountSummary | null> {
  try {
    const json = await fetchText(STEAMDB_PRICE_HISTORY_API(appid), {
      Accept: "application/json",
    });
    const summary = parseSteamdbJson(json, appid);
    if (summary) return summary;
  } catch {
    // fall through to HTML
  }
  const html = await fetchText(STEAMDB_APP_URL(appid), {
    Accept: "text/html,application/xhtml+xml",
  });
  return parseSteamdbHtml(html, appid);
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
    if (!/discount|price\s*change/.test(headText)) continue;

    const trs = table.querySelectorAll("tbody tr");
    for (let j = 0; j < trs.length; j++) {
      const pct = extractDiscountFromRow(trs[j].textContent ?? "");
      if (pct !== null) discounts.push(pct);
    }
    if (discounts.length > 0) break;
  }

  if (discounts.length === 0) {
    const matches = html.match(/-?\d{1,3}\s*%/g);
    if (matches) {
      for (const m of matches) {
        const pct = parseDiscount(m);
        if (pct !== null && pct > 0) discounts.push(pct);
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
