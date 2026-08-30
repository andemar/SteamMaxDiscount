/**
 * Pure: maps (current discount, history summary, error flag) -> icon state.
 *  - none  : no current discount -> skip
 *  - green : current == max AND it has happened only once before
 *  - yellow: current == max AND it has happened multiple times
 *  - red   : current > 0 but < max
 *  - orange: error or no history available
 */
export function decideState(input) {
    const { currentDiscountPercent, summary, hadError } = input;
    if (hadError || !summary) {
        return {
            state: "orange",
            tooltip: "Could not retrieve discount history from SteamDB. " +
                "Click 'Clear discount cache' and reload to retry.",
        };
    }
    if (currentDiscountPercent === null || currentDiscountPercent <= 0) {
        return { state: "none", tooltip: "" };
    }
    if (currentDiscountPercent === summary.allTimeMaxPercent) {
        if (summary.timesAtMax <= 1) {
            return {
                state: "green",
                tooltip: `All-time maximum discount (${summary.allTimeMaxPercent}%), first time at this level.`,
            };
        }
        return {
            state: "yellow",
            tooltip: `All-time maximum discount (${summary.allTimeMaxPercent}%), seen ${summary.timesAtMax} times historically.`,
        };
    }
    if (currentDiscountPercent < summary.allTimeMaxPercent) {
        return {
            state: "red",
            tooltip: `Current ${currentDiscountPercent}% is below the all-time max of ${summary.allTimeMaxPercent}%.`,
        };
    }
    return {
        state: "red",
        tooltip: `Current ${currentDiscountPercent}% is at or above the recorded max of ${summary.allTimeMaxPercent}%.`,
    };
}
