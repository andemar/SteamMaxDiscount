/**
 * Attach a MutationObserver to the wishlist container. Debounces bursts of
 * DOM mutations using requestAnimationFrame to avoid redundant work.
 */
export function attachWishlistObserver(container, onAdded) {
    let pending = [];
    let scheduled = false;
    const flush = () => {
        scheduled = false;
        const batch = pending;
        pending = [];
        if (batch.length > 0)
            onAdded(batch);
    };
    const observer = new MutationObserver((records) => {
        for (const r of records) {
            r.addedNodes.forEach((n) => {
                if (n instanceof HTMLElement)
                    pending.push(n);
            });
        }
        if (!scheduled && pending.length > 0) {
            scheduled = true;
            requestAnimationFrame(flush);
        }
    });
    observer.observe(container, { childList: true, subtree: true });
    return observer;
}
