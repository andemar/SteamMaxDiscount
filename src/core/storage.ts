import type { DiscountSummary } from "./types";

const SUMMARY_KEY_PREFIX = "discountMeta_";
const ITAD_MAP_KEY_PREFIX = "itadMap_";

function summaryKeyFor(appid: number): string {
  return `${SUMMARY_KEY_PREFIX}${appid}`;
}

function itadMapKeyFor(appid: number): string {
  return `${ITAD_MAP_KEY_PREFIX}${appid}`;
}

export async function getSummary(appid: number): Promise<DiscountSummary | null> {
  const k = summaryKeyFor(appid);
  const obj = await chrome.storage.local.get(k);
  return (obj[k] as DiscountSummary | undefined) ?? null;
}

export async function setSummary(summary: DiscountSummary): Promise<void> {
  await chrome.storage.local.set({ [summaryKeyFor(summary.appid)]: summary });
}

export async function getItadId(appid: number): Promise<string | null> {
  const k = itadMapKeyFor(appid);
  const obj = await chrome.storage.local.get(k);
  const v = obj[k];
  return typeof v === "string" && v.length > 0 ? v : null;
}

export async function setItadId(appid: number, itadId: string): Promise<void> {
  await chrome.storage.local.set({ [itadMapKeyFor(appid)]: itadId });
}

export async function clearAllSummaries(): Promise<number> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(
    (k) => k.startsWith(SUMMARY_KEY_PREFIX) || k.startsWith(ITAD_MAP_KEY_PREFIX)
  );
  if (keys.length === 0) return 0;
  await chrome.storage.local.remove(keys);
  return keys.length;
}
