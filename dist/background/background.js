import { getPriceOverview, resolveItadId } from "../core/itadClient";
let queuePromise = Promise.resolve();
const REQUEST_DELAY_MS = 250;
function rateLimited(fn) {
    const next = queuePromise.then(async () => {
        const result = await fn();
        await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
        return result;
    });
    queuePromise = next.catch(() => new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS)));
    return next;
}
async function fetchDiscountSummary(appid, title, cachedItadId) {
    const itadId = cachedItadId && cachedItadId.length > 0
        ? cachedItadId
        : await rateLimited(() => resolveItadId({ appid, title }));
    if (!itadId) {
        return null;
    }
    const overview = await rateLimited(() => getPriceOverview(itadId, { country: "US", shops: [61] }));
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
        lastUpdatedAt: Date.now(),
    };
}
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== "object")
        return false;
    if (msg.type === "getDiscountSummary") {
        (async () => {
            try {
                const summary = await fetchDiscountSummary(msg.appid, msg.title, msg.itadId);
                sendResponse({ ok: true, summary });
            }
            catch (err) {
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
});
