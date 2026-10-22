import { describe, expect, it } from "vitest";
import { canApproveValue } from "./review";

describe("canApproveValue", () => {
  it("requires explicit edits for low-confidence suggestions", () => {
    expect(canApproveValue(0.4, "Suggested", "Suggested")).toBe(false);
    expect(canApproveValue(0.4, "Suggested", "Manually verified")).toBe(true);
  });

  it("allows a non-empty suggestion at or above the confidence threshold", () => {
    expect(canApproveValue(0.65, "Suggested", "Suggested")).toBe(true);
  });

  it("never allows an empty value", () => {
    expect(canApproveValue(1, "Suggested", "   ")).toBe(false);
  });
});
