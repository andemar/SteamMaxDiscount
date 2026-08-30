import type { DiscountState, DiscountSummary } from "./types";

export interface DecisionInput {
  currentDiscountPercent: number | null;
  summary: DiscountSummary | null;
  hadError: boolean;
}

export interface Decision {
  state: DiscountState;
  tooltip: string;
}

/**
 * Pure: maps (current discount, history summary, error flag) -> icon state.
 *  - none  : no current discount -> skip
 *  - green : current == max AND it has happened only once before
 *  - yellow: current == max AND it has happened multiple times
 *  - red   : current > 0 but < max
 *  - orange: error or no history available
 */
export function decideState(input: DecisionInput): Decision {
  const { currentDiscountPercent, summary, hadError } = input;

  // 1. No icon: If the game currently has no discount, skip adding an icon
  if (currentDiscountPercent === null || currentDiscountPercent <= 0) {
    return { state: "none", tooltip: "" };
  }

  // 2. Orange (🟠): Error / unavailable cases (fetch failed or no historical records found)
  if (hadError || !summary) {
    return {
      state: "orange",
      tooltip:
        "Could not retrieve historical discount records. " +
        "Click 'Clear discount cache' and reload to retry.",
    };
  }

  // 3. Green (🟢): Current discount equals allTimeMaxPercent, and timesAtMax <= 1 (first and only time at this max)
  if (currentDiscountPercent === summary.allTimeMaxPercent && summary.timesAtMax <= 1) {
    return {
      state: "green",
      tooltip: `All-time maximum discount (${summary.allTimeMaxPercent}%), first time at this level.`,
    };
  }

  // 4. Yellow (🟡): Current discount equals allTimeMaxPercent, and timesAtMax > 1 (max discount occurred before)
  if (currentDiscountPercent === summary.allTimeMaxPercent && summary.timesAtMax > 1) {
    return {
      state: "yellow",
      tooltip: `All-time maximum discount (${summary.allTimeMaxPercent}%), seen ${summary.timesAtMax} times historically.`,
    };
  }

  // If current discount beats the recorded historical max, it's a new all-time record -> Green
  if (currentDiscountPercent > summary.allTimeMaxPercent) {
    return {
      state: "green",
      tooltip: `New all-time maximum discount (${currentDiscountPercent}%), beats recorded max of ${summary.allTimeMaxPercent}%.`,
    };
  }

  // 5. Red (🔴): Current discount is greater than 0 but strictly less than allTimeMaxPercent
  if (currentDiscountPercent < summary.allTimeMaxPercent) {
    return {
      state: "red",
      tooltip: `Current ${currentDiscountPercent}% is below the all-time max of ${summary.allTimeMaxPercent}%.`,
    };
  }

  return {
    state: "none",
    tooltip: "",
  };
}
