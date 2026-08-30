import { test } from "node:test";
import assert from "node:assert/strict";
import { decideState } from "../src/core/discountLogic";
import type { DiscountSummary } from "../src/core/types";

const baseSummary = (overrides: Partial<DiscountSummary> = {}): DiscountSummary => ({
  appid: 1,
  allTimeMaxPercent: 75,
  timesAtMax: 1,
  lastUpdatedAt: 0,
  ...overrides,
});

test("green: current equals unique max", () => {
  const d = decideState({
    currentDiscountPercent: 75,
    summary: baseSummary({ allTimeMaxPercent: 75, timesAtMax: 1 }),
    hadError: false,
  });
  assert.equal(d.state, "green");
});

test("yellow: current equals max, but max has happened before", () => {
  const d = decideState({
    currentDiscountPercent: 75,
    summary: baseSummary({ allTimeMaxPercent: 75, timesAtMax: 3 }),
    hadError: false,
  });
  assert.equal(d.state, "yellow");
});

test("red: current > 0 but < max", () => {
  const d = decideState({
    currentDiscountPercent: 40,
    summary: baseSummary({ allTimeMaxPercent: 75, timesAtMax: 1 }),
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

test("decideState is pure: same inputs -> same outputs", () => {
  const input = {
    currentDiscountPercent: 25,
    summary: baseSummary({ allTimeMaxPercent: 50, timesAtMax: 2 }),
    hadError: false,
  };
  const a = decideState(input);
  const b = decideState(input);
  assert.deepEqual(a, b);
});
