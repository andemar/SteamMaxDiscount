"use strict";
(() => {
  // src/config.ts
  var ITAD_API_KEY = "4d7aa36cb69db488d60fe1f70a8221af2ff6fa8c";

  // src/core/itadClient.ts
  var ITAD_API_BASE = "https://api.isthereanydeal.com";
  function ensureApiKey() {
    if (!ITAD_API_KEY || ITAD_API_KEY === "YOUR_ITAD_API_KEY") {
      throw new Error("ITAD API key is not configured.");
    }
  }
  function toNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }
  function asRecord(value) {
    return value && typeof value === "object" ? value : null;
  }
  async function itadFetch(url, init) {
    ensureApiKey();
    const res = await fetch(url, {
      ...init,
      headers: {
        "ITAD-API-Key": ITAD_API_KEY,
        ...init.headers ?? {}
      }
    });
    if (!res.ok) {
      throw new Error(`ITAD API error ${res.status} ${res.statusText}`);
    }
    try {
      return await res.json();
    } catch {
      throw new Error("ITAD API returned invalid JSON.");
    }
  }
  function normalize(text) {
    return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  }
  function parseSearchResults(raw) {
    const rows = Array.isArray(raw) ? raw : Array.isArray(asRecord(raw)?.results) ? asRecord(raw)?.results : Array.isArray(asRecord(raw)?.data) ? asRecord(raw)?.data : [];
    const out = [];
    for (const row of rows) {
      const rec = asRecord(row);
      if (!rec) continue;
      const id = typeof rec.id === "string" ? rec.id : null;
      const title = typeof rec.title === "string" ? rec.title : typeof rec.name === "string" ? rec.name : null;
      if (!id || !title) continue;
      out.push({ id, title });
    }
    return out;
  }
  function pickBestMatch(title, candidates) {
    if (candidates.length === 0) return null;
    const wanted = normalize(title);
    const exact = candidates.find((c) => normalize(c.title) === wanted);
    if (exact) return exact;
    const contained = candidates.find(
      (c) => normalize(c.title).includes(wanted) || wanted.includes(normalize(c.title))
    );
    if (contained) return contained;
    return candidates[0];
  }
  async function resolveItadId(input) {
    try {
      const lookupUrl = `${ITAD_API_BASE}/games/lookup/v1?appid=${encodeURIComponent(
        String(input.appid)
      )}`;
      const lookupRaw = await itadFetch(lookupUrl, { method: "GET" });
      const rec = asRecord(lookupRaw);
      if (rec?.found === true) {
        const game = asRecord(rec.game);
        if (game && typeof game.id === "string") {
          return game.id;
        }
      }
    } catch {
    }
    const byTitleUrl = `${ITAD_API_BASE}/games/search/v1?title=${encodeURIComponent(input.title)}`;
    const byTitleRaw = await itadFetch(byTitleUrl, { method: "GET" });
    const byTitle = parseSearchResults(byTitleRaw);
    const best = pickBestMatch(input.title, byTitle);
    return best?.id ?? null;
  }
  function parseOverviewEntry(row) {
    const rec = asRecord(row);
    if (!rec || typeof rec.id !== "string") return null;
    const current = asRecord(rec.current);
    const lowest = asRecord(rec.lowest);
    const currentPrice = toNumber(asRecord(current?.price)?.amount ?? null);
    const currentRegular = toNumber(asRecord(current?.regular)?.amount ?? null);
    const currentCut = toNumber(current?.cut ?? null);
    const currentTimestamp = typeof current?.timestamp === "string" ? current.timestamp : null;
    const lowestPrice = toNumber(asRecord(lowest?.price)?.amount ?? null);
    const lowestRegular = toNumber(asRecord(lowest?.regular)?.amount ?? null);
    const lowestCut = toNumber(lowest?.cut ?? null);
    const lowestTimestamp = typeof lowest?.timestamp === "string" ? lowest.timestamp : null;
    return {
      id: rec.id,
      currentPrice,
      currentRegular,
      currentCut,
      currentTimestamp,
      lowestPrice,
      lowestRegular,
      lowestCut,
      lowestTimestamp
    };
  }
  function parseOverviewResponse(raw) {
    const prices = Array.isArray(asRecord(raw)?.prices) ? asRecord(raw)?.prices ?? [] : [];
    const out = /* @__PURE__ */ new Map();
    for (const row of prices) {
      const parsed = parseOverviewEntry(row);
      if (parsed) out.set(parsed.id, parsed);
    }
    return out;
  }
  async function getPriceOverviews(itadIds, options = {}) {
    if (itadIds.length === 0) return /* @__PURE__ */ new Map();
    const unique = Array.from(new Set(itadIds.filter(Boolean)));
    const country = options.country ?? "US";
    const shops = (options.shops ?? [61]).join(",");
    const url = `${ITAD_API_BASE}/games/overview/v2?country=${encodeURIComponent(
      country
    )}&shops=${encodeURIComponent(shops)}`;
    const raw = await itadFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(unique)
    });
    return parseOverviewResponse(raw);
  }
  async function getPriceOverview(itadId, options = {}) {
    const map = await getPriceOverviews([itadId], options);
    return map.get(itadId) ?? null;
  }

  // src/background/background.ts
  var queuePromise = Promise.resolve();
  var REQUEST_DELAY_MS = 250;
  function rateLimited(fn) {
    const next = queuePromise.then(async () => {
      const result = await fn();
      await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
      return result;
    });
    queuePromise = next.catch(
      () => new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS))
    );
    return next;
  }
  async function fetchDiscountSummary(appid, title, cachedItadId) {
    const itadId = cachedItadId && cachedItadId.length > 0 ? cachedItadId : await rateLimited(() => resolveItadId({ appid, title }));
    if (!itadId) {
      return null;
    }
    const overview = await rateLimited(
      () => getPriceOverview(itadId, { country: "US", shops: [61] })
    );
    if (!overview) {
      return null;
    }
    return {
      appid,
      itadId,
      currentCut: overview.currentCut,
      currentTimestamp: overview.currentTimestamp,
      lowestCut: overview.lowestCut,
      lowestTimestamp: overview.lowestTimestamp,
      overview,
      lastUpdatedAt: Date.now()
    };
  }
  chrome.runtime.onMessage.addListener(
    (msg, _sender, sendResponse) => {
      if (!msg || typeof msg !== "object") return false;
      if (msg.type === "getDiscountSummary") {
        (async () => {
          try {
            const summary = await fetchDiscountSummary(msg.appid, msg.title, msg.itadId);
            sendResponse({ ok: true, summary });
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            console.error("[swd-bg] ITAD fetch error:", error);
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
})();
//# sourceMappingURL=background.js.map
