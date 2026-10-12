import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseAmount } from "../src/lib/amount.js";

describe("parseAmount", () => {
  it("converts to base units and refuses digits the token cannot hold", () => {
    assert.equal(parseAmount(" 1.5 ", 6), 1_500_000n);
    assert.equal(parseAmount(".000001", 6), 1n);
    assert.throws(() => parseAmount("1.9999999", 6), /at most 6 decimal places/);
    assert.throws(() => parseAmount("1e18", 18), /Enter an amount/);
  });
});
