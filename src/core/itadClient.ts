import { ITAD_API_KEY } from "../config";
import type { ItadOverview } from "./types";

const ITAD_API_BASE = "https://api.isthereanydeal.com";

interface SearchCandidate {
  id: string;
  title: string;
}

interface OverviewOptions {
  country?: string;
  shops?: number[];
}

function ensureApiKey(): void {
  if (!ITAD_API_KEY || ITAD_API_KEY === "YOUR_ITAD_API_KEY") {
    throw new Error("ITAD API key is not configured.");
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

async function itadFetch<T>(url: string, init: RequestInit): Promise<T> {
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
    return (await res.json()) as T;
  } catch {
    throw new Error("ITAD API returned invalid JSON.");
  }
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function parseSearchResults(raw: unknown): SearchCandidate[] {
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray(asRecord(raw)?.results)
      ? (asRecord(raw)?.results as unknown[])
      : Array.isArray(asRecord(raw)?.data)
        ? (asRecord(raw)?.data as unknown[])
        : [];

  const out: SearchCandidate[] = [];
  for (const row of rows) {
    const rec = asRecord(row);
    if (!rec) continue;
    const id = typeof rec.id === "string" ? rec.id : null;
    const title =
      typeof rec.title === "string"
        ? rec.title
        : typeof rec.name === "string"
          ? rec.name
          : null;
    if (!id || !title) continue;
    out.push({ id, title });
  }
  return out;
}

function pickBestMatch(title: string, candidates: SearchCandidate[]): SearchCandidate | null {
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

export async function resolveItadId(input: {
  appid: number;
  title: string;
}): Promise<string | null> {
  const byAppidUrl = `${ITAD_API_BASE}/games/search/v1?appid=${encodeURIComponent(
    String(input.appid)
  )}`;
  const byAppidRaw = await itadFetch<unknown>(byAppidUrl, { method: "GET" });
  const byAppid = parseSearchResults(byAppidRaw);
  if (byAppid.length > 0) return byAppid[0].id;

  const byTitleUrl = `${ITAD_API_BASE}/games/search/v1?title=${encodeURIComponent(input.title)}`;
  const byTitleRaw = await itadFetch<unknown>(byTitleUrl, { method: "GET" });
  const byTitle = parseSearchResults(byTitleRaw);
  const best = pickBestMatch(input.title, byTitle);
  return best?.id ?? null;
}

function parseOverviewEntry(row: unknown): ItadOverview | null {
  const rec = asRecord(row);
  if (!rec || typeof rec.id !== "string") return null;

  const current = asRecord(rec.current);
  const lowest = asRecord(rec.lowest);

  const currentPrice = toNumber(asRecord(current?.price)?.amount ?? null);
  const currentRegular = toNumber(asRecord(current?.regular)?.amount ?? null);
  const currentCut = toNumber(current?.cut ?? null);
  const currentTimestamp =
    typeof current?.timestamp === "string" ? (current.timestamp as string) : null;

  const lowestPrice = toNumber(asRecord(lowest?.price)?.amount ?? null);
  const lowestRegular = toNumber(asRecord(lowest?.regular)?.amount ?? null);
  const lowestCut = toNumber(lowest?.cut ?? null);
  const lowestTimestamp =
    typeof lowest?.timestamp === "string" ? (lowest.timestamp as string) : null;

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

export function parseOverviewResponse(raw: unknown): Map<string, ItadOverview> {
  const prices = Array.isArray(asRecord(raw)?.prices)
    ? ((asRecord(raw)?.prices as unknown[]) ?? [])
    : [];

  const out = new Map<string, ItadOverview>();
  for (const row of prices) {
    const parsed = parseOverviewEntry(row);
    if (parsed) out.set(parsed.id, parsed);
  }
  return out;
}

export async function getPriceOverviews(
  itadIds: string[],
  options: OverviewOptions = {}
): Promise<Map<string, ItadOverview>> {
  if (itadIds.length === 0) return new Map();

  const unique = Array.from(new Set(itadIds.filter(Boolean)));
  const country = options.country ?? "US";
  const shops = (options.shops ?? [61]).join(",");
  const url = `${ITAD_API_BASE}/games/overview/v2?country=${encodeURIComponent(
    country
  )}&shops=${encodeURIComponent(shops)}`;

  const raw = await itadFetch<unknown>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(unique),
  });

  return parseOverviewResponse(raw);
}

export async function getPriceOverview(
  itadId: string,
  options: OverviewOptions = {}
): Promise<ItadOverview | null> {
  const map = await getPriceOverviews([itadId], options);
  return map.get(itadId) ?? null;
}
