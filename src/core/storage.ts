import type { DiscountSummary } from "./types";

const KEY_PREFIX = "discountMeta_";

function keyFor(appid: number): string {
  return `${KEY_PREFIX}${appid}`;
}

export async function getSummary(appid: number): Promise<DiscountSummary | null> {
  const k = keyFor(appid);
  const obj = await chrome.storage.local.get(k);
  return (obj[k] as DiscountSummary | undefined) ?? null;
}

export async function setSummary(summary: DiscountSummary): Promise<void> {
  await chrome.storage.local.set({ [keyFor(summary.appid)]: summary });
}

export async function clearAllSummaries(): Promise<number> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(KEY_PREFIX));
  if (keys.length === 0) return 0;
  await chrome.storage.local.remove(keys);
  return keys.length;
}
