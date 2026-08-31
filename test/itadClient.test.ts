import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOverviewResponse } from "../src/core/itadClient";

test("parseOverviewResponse parses current/lowest fields", () => {
  const payload = {
    prices: [
      {
        id: "game-1",
        current: {
          cut: 40,
          timestamp: "2026-08-10T12:00:00Z",
          price: { amount: 11.99 },
          regular: { amount: 19.99 },
        },
        lowest: {
          cut: 60,
          timestamp: "2025-12-01T08:00:00Z",
          price: { amount: 7.99 },
          regular: { amount: 19.99 },
        },
      },
    ],
  };

  const parsed = parseOverviewResponse(payload);
  const one = parsed.get("game-1");
  assert.ok(one);
  assert.equal(one.currentCut, 40);
  assert.equal(one.lowestCut, 60);
  assert.equal(one.currentPrice, 11.99);
  assert.equal(one.lowestPrice, 7.99);
});

test("parseOverviewResponse tolerates malformed entries", () => {
  const parsed = parseOverviewResponse({
    prices: [{ id: "ok-1", current: null, lowest: null }, { bad: true }],
  });
  assert.equal(parsed.size, 1);
  assert.ok(parsed.get("ok-1"));
});
