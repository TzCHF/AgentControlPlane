import assert from "node:assert/strict";
import test from "node:test";
import { finalReportSchema } from "../src/core/brief.js";

test("strict final report schema requires every declared object property", () => {
  const testItem = finalReportSchema.properties.tests.items;
  assert.deepEqual(
    [...testItem.required].sort(),
    Object.keys(testItem.properties).sort(),
  );
});
