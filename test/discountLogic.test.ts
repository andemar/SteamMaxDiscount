import { test } from "node:test";
import assert from "node:assert/strict";
import { decideState } from "../src/core/discountLogic";
import type { DiscountSummary, ItadOverview } from "../src/core/types";

const baseOverview = (overrides: Partial<ItadOverview> = {}): ItadOverview => ({
  id: "itad-1",
  currentPrice: 10,
  currentRegular: 40,
  currentCut: 75,
  currentTimestamp: "2026-08-01T00:00:00Z",
  lowestPrice: 10,
  lowestRegular: 40,
  lowestCut: 75,
  lowestTimestamp: "2026-08-01T00:00:00Z",
  ...overrides,
});

const baseSummary = (overrides: Partial<DiscountSummary> = {}): DiscountSummary => {
  const overview = baseOverview(
    (overrides.overview ? overrides.overview : {}) as Partial<ItadOverview>
  );
  return {
    appid: 1,
    itadId: "itad-1",
    currentCut: 75,
    currentTimestamp: "2026-08-01T00:00:00Z",
    lowestCut: 75,
    lowestTimestamp: "2026-08-01T00:00:00Z",
    overview,
    lastUpdatedAt: 0,
    ...overrides,
  };
};

test("green: current equals lowest and timestamps match", () => {
  const d = decideState({
    currentDiscountPercent: 75,
    summary: baseSummary({
      currentCut: 75,
      lowestCut: 75,
      currentTimestamp: "2026-08-01T00:00:00Z",
      lowestTimestamp: "2026-08-01T00:00:00Z",
    }),
    hadError: false,
  });
  assert.equal(d.state, "green");
});

test("yellow: current equals lowest but lowest was in the past", () => {
  const d = decideState({
    currentDiscountPercent: 75,
    summary: baseSummary({
      currentCut: 75,
      lowestCut: 75,
      currentTimestamp: "2026-08-05T00:00:00Z",
      lowestTimestamp: "2026-07-01T00:00:00Z",
    }),
    hadError: false,
  });
  assert.equal(d.state, "yellow");
});

test("yellow: fallback when equal cuts but timestamp missing", () => {
  const d = decideState({
    currentDiscountPercent: 75,
    summary: baseSummary({
      currentCut: 75,
      lowestCut: 75,
      currentTimestamp: null,
      lowestTimestamp: null,
    }),
    hadError: false,
  });
  assert.equal(d.state, "yellow");
});

test("red: current > 0 but < max", () => {
  const d = decideState({
    currentDiscountPercent: 40,
    summary: baseSummary({ currentCut: 40, lowestCut: 75 }),
    hadError: false,
  });
  assert.equal(d.state, "red");
});

test("none: no current discount", () => {
  const d = decideState({
    currentDiscountPercent: null,
    summary: baseSummary(),
    hadError: false,
  });
  assert.equal(d.state, "none");
});

test("none: current discount is zero", () => {
  const d = decideState({
    currentDiscountPercent: 0,
    summary: baseSummary(),
    hadError: false,
  });
  assert.equal(d.state, "none");
});

test("orange: error fetching history", () => {
  const d = decideState({
    currentDiscountPercent: 50,
    summary: null,
    hadError: true,
  });
  assert.equal(d.state, "orange");
});

test("orange: history present but null (no data)", () => {
  const d = decideState({
    currentDiscountPercent: 50,
    summary: null,
    hadError: false,
  });
  assert.equal(d.state, "orange");
});

test("orange: lowest cut missing", () => {
  const d = decideState({
    currentDiscountPercent: 50,
    summary: baseSummary({ lowestCut: null }),
    hadError: false,
  });
  assert.equal(d.state, "orange");
});

test("decideState is pure: same inputs -> same outputs", () => {
  const input = {
    currentDiscountPercent: 25,
    summary: baseSummary({ currentCut: 25, lowestCut: 50 }),
    hadError: false,
  };
  const a = decideState(input);
  const b = decideState(input);
  assert.deepEqual(a, b);
});
