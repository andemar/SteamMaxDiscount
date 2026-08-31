export type DiscountState =
  | "green"
  | "yellow"
  | "red"
  | "orange"
  | "none";

export interface ItadOverview {
  id: string;
  currentPrice: number | null;
  currentRegular: number | null;
  currentCut: number | null;
  currentTimestamp: string | null;
  lowestPrice: number | null;
  lowestRegular: number | null;
  lowestCut: number | null;
  lowestTimestamp: string | null;
}

export interface DiscountSummary {
  appid: number;
  itadId: string;
  currentCut: number | null;
  currentTimestamp: string | null;
  lowestCut: number | null;
  lowestTimestamp: string | null;
  overview: ItadOverview;
  lastUpdatedAt: number;
}

export interface WishlistRowInfo {
  rowEl: HTMLElement;
  titleEl: HTMLElement;
  title: string;
  appid: number;
  currentDiscountPercent: number | null;
  href: string;
}

export type SwdMessage =
  | { type: "getDiscountSummary"; appid: number; title: string; itadId?: string }
  | { type: "clearCache" };

export type SwdResponse =
  | { ok: true; summary: DiscountSummary | null }
  | { ok: false; error: string };
