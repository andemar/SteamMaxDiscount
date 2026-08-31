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

export function decideState(input: DecisionInput): Decision {
  const { currentDiscountPercent, summary, hadError } = input;
  if (currentDiscountPercent === null || currentDiscountPercent <= 0) {
    return { state: "none", tooltip: "" };
  }

  if (hadError || !summary) {
    return {
      state: "orange",
      tooltip: "ITAD API error: could not retrieve historical prices.",
    };
  }

  if (summary.lowestCut === null) {
    return {
      state: "orange",
      tooltip: "ITAD API returned incomplete historical low data.",
    };
  }

  const currentCut =
    summary.currentCut !== null && summary.currentCut > 0
      ? summary.currentCut
      : currentDiscountPercent;
  const allTimeMaxPercent = summary.lowestCut;

  if (currentCut > allTimeMaxPercent) {
    return {
      state: "green",
      tooltip: `New all-time maximum discount (${currentCut}%), beats recorded max of ${allTimeMaxPercent}%.`,
    };
  }

  if (currentCut === allTimeMaxPercent) {
    const currentTs = summary.currentTimestamp ? Date.parse(summary.currentTimestamp) : NaN;
    const lowestTs = summary.lowestTimestamp ? Date.parse(summary.lowestTimestamp) : NaN;

    if (Number.isFinite(currentTs) && Number.isFinite(lowestTs)) {
      if (Math.abs(currentTs - lowestTs) <= 60_000) {
        return {
          state: "green",
          tooltip: `Current discount matches all-time max (${allTimeMaxPercent}%) and appears to be the first occurrence.`,
        };
      }
      if (lowestTs < currentTs) {
        return {
          state: "yellow",
          tooltip: `Current discount matches all-time max (${allTimeMaxPercent}%), but this max was seen before.`,
        };
      }
      return {
        state: "green",
        tooltip: `Current discount matches all-time max (${allTimeMaxPercent}%).`,
      };
    }

    return {
      state: "yellow",
      tooltip: `Current discount matches all-time max (${allTimeMaxPercent}%), timestamp comparison unavailable.`,
    };
  }

  if (currentCut < allTimeMaxPercent) {
    return {
      state: "red",
      tooltip: `Current ${currentCut}% is below the all-time max of ${allTimeMaxPercent}%.`,
    };
  }

  return {
    state: "orange",
    tooltip: "ITAD API data could not be interpreted.",
  };
}
