import { ITAD_API_KEY } from "../config";
const ITAD_API_BASE = "https://api.isthereanydeal.com";
function ensureApiKey() {
    if (!ITAD_API_KEY || ITAD_API_KEY === "YOUR_ITAD_API_KEY") {
        throw new Error("ITAD API key is not configured.");
    }
}
function toNumber(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "string") {
        const n = Number(value);
        if (Number.isFinite(n))
            return n;
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
            ...(init.headers ?? {}),
        },
    });
    if (!res.ok) {
        throw new Error(`ITAD API error ${res.status} ${res.statusText}`);
    }
    try {
        return (await res.json());
    }
    catch {
        throw new Error("ITAD API returned invalid JSON.");
    }
}
function normalize(text) {
    return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function parseSearchResults(raw) {
    const rows = Array.isArray(raw)
        ? raw
        : Array.isArray(asRecord(raw)?.results)
            ? asRecord(raw)?.results
            : Array.isArray(asRecord(raw)?.data)
                ? asRecord(raw)?.data
                : [];
    const out = [];
    for (const row of rows) {
        const rec = asRecord(row);
        if (!rec)
            continue;
        const id = typeof rec.id === "string" ? rec.id : null;
        const title = typeof rec.title === "string"
            ? rec.title
            : typeof rec.name === "string"
                ? rec.name
                : null;
        if (!id || !title)
            continue;
        out.push({ id, title });
    }
    return out;
}
function pickBestMatch(title, candidates) {
    if (candidates.length === 0)
        return null;
    const wanted = normalize(title);
    const exact = candidates.find((c) => normalize(c.title) === wanted);
    if (exact)
        return exact;
    const contained = candidates.find((c) => normalize(c.title).includes(wanted) || wanted.includes(normalize(c.title)));
    if (contained)
        return contained;
    return candidates[0];
}
/**
 * Resolve a Steam appid (and optional title) to an ITAD game UUID.
 *
 * 1. Primary: GET /games/lookup/v1?appid=<appid>  (exact Steam appid lookup)
 * 2. Fallback: GET /games/search/v1?title=<title>  (fuzzy title search)
 */
export async function resolveItadId(input) {
    // 1. Try exact lookup by Steam appid
    try {
        const lookupUrl = `${ITAD_API_BASE}/games/lookup/v1?appid=${encodeURIComponent(String(input.appid))}`;
        const lookupRaw = await itadFetch(lookupUrl, { method: "GET" });
        const rec = asRecord(lookupRaw);
        if (rec?.found === true) {
            const game = asRecord(rec.game);
            if (game && typeof game.id === "string") {
                return game.id;
            }
        }
    }
    catch {
        // lookup failed — fall through to title search
    }
    // 2. Fallback: search by title
    const byTitleUrl = `${ITAD_API_BASE}/games/search/v1?title=${encodeURIComponent(input.title)}`;
    const byTitleRaw = await itadFetch(byTitleUrl, { method: "GET" });
    const byTitle = parseSearchResults(byTitleRaw);
    const best = pickBestMatch(input.title, byTitle);
    return best?.id ?? null;
}
function parseOverviewEntry(row) {
    const rec = asRecord(row);
    if (!rec || typeof rec.id !== "string")
        return null;
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
        lowestTimestamp,
    };
}
export function parseOverviewResponse(raw) {
    const prices = Array.isArray(asRecord(raw)?.prices)
        ? (asRecord(raw)?.prices ?? [])
        : [];
    const out = new Map();
    for (const row of prices) {
        const parsed = parseOverviewEntry(row);
        if (parsed)
            out.set(parsed.id, parsed);
    }
    return out;
}
export async function getPriceOverviews(itadIds, options = {}) {
    if (itadIds.length === 0)
        return new Map();
    const unique = Array.from(new Set(itadIds.filter(Boolean)));
    const country = options.country ?? "US";
    const shops = (options.shops ?? [61]).join(",");
    const url = `${ITAD_API_BASE}/games/overview/v2?country=${encodeURIComponent(country)}&shops=${encodeURIComponent(shops)}`;
    const raw = await itadFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(unique),
    });
    return parseOverviewResponse(raw);
}
export async function getPriceOverview(itadId, options = {}) {
    const map = await getPriceOverviews([itadId], options);
    return map.get(itadId) ?? null;
}
