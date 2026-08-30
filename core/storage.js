const KEY_PREFIX = "discountMeta_";
function keyFor(appid) {
    return `${KEY_PREFIX}${appid}`;
}
export async function getSummary(appid) {
    const k = keyFor(appid);
    const obj = await chrome.storage.local.get(k);
    return obj[k] ?? null;
}
export async function setSummary(summary) {
    await chrome.storage.local.set({ [keyFor(summary.appid)]: summary });
}
export async function clearAllSummaries() {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith(KEY_PREFIX));
    if (keys.length === 0)
        return 0;
    await chrome.storage.local.remove(keys);
    return keys.length;
}
