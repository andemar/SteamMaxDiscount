const SUMMARY_KEY_PREFIX = "discountMeta_";
const ITAD_MAP_KEY_PREFIX = "itadMap_";
function summaryKeyFor(appid) {
    return `${SUMMARY_KEY_PREFIX}${appid}`;
}
function itadMapKeyFor(appid) {
    return `${ITAD_MAP_KEY_PREFIX}${appid}`;
}
export async function getSummary(appid) {
    const k = summaryKeyFor(appid);
    const obj = await chrome.storage.local.get(k);
    return obj[k] ?? null;
}
export async function setSummary(summary) {
    await chrome.storage.local.set({ [summaryKeyFor(summary.appid)]: summary });
}
export async function getItadId(appid) {
    const k = itadMapKeyFor(appid);
    const obj = await chrome.storage.local.get(k);
    const v = obj[k];
    return typeof v === "string" && v.length > 0 ? v : null;
}
export async function setItadId(appid, itadId) {
    await chrome.storage.local.set({ [itadMapKeyFor(appid)]: itadId });
}
export async function clearAllSummaries() {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith(SUMMARY_KEY_PREFIX) || k.startsWith(ITAD_MAP_KEY_PREFIX));
    if (keys.length === 0)
        return 0;
    await chrome.storage.local.remove(keys);
    return keys.length;
}
