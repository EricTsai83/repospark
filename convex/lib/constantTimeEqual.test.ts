/// <reference types="vite/client" />

import { describe, expect, test } from "vitest";
import { constantTimeEqual } from "./constantTimeEqual";

describe("constantTimeEqual", () => {
  test("returns true for equal strings", () => {
    expect(constantTimeEqual("secret-value", "secret-value")).toBe(true);
  });

  test("returns false for same-length strings with different content", () => {
    expect(constantTimeEqual("secret-value", "secret-valun")).toBe(false);
  });

  test("returns false for different-length strings", () => {
    expect(constantTimeEqual("short", "much-longer-string")).toBe(false);
  });

  test("returns true for empty strings", () => {
    expect(constantTimeEqual("", "")).toBe(true);
  });

  test("compares unicode content by code unit consistently", () => {
    expect(constantTimeEqual("Auth 流程說明", "Auth 流程說明")).toBe(true);
    expect(constantTimeEqual("Auth 流程說明", "Auth 流程说明")).toBe(false);
  });
});
