export type DiscountState =
  | "green"
  | "yellow"
  | "red"
  | "orange"
  | "none";

export interface DiscountSummary {
  appid: number;
  allTimeMaxPercent: number;
  timesAtMax: number;
  lastUpdatedAt: number;
}

export interface WishlistRowInfo {
  rowEl: HTMLElement;
  titleEl: HTMLElement;
  appid: number;
  currentDiscountPercent: number | null;
  href: string;
}

export type SwdMessage =
  | { type: "getDiscountSummary"; appid: number }
  | { type: "clearCache" };

export type SwdResponse =
  | { ok: true; summary: DiscountSummary | null }
  | { ok: false; error: string };
