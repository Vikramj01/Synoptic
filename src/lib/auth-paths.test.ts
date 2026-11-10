import { describe, expect, it } from "vitest";
import { isPublicPath } from "./auth-paths";

describe("isPublicPath", () => {
  it("allows the login page and auth handlers", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/auth/callback")).toBe(true);
    expect(isPublicPath("/auth/signout")).toBe(true);
  });

  it("protects everything else, including look-alikes", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/api/scans")).toBe(false);
    expect(isPublicPath("/login/extra")).toBe(false);
    expect(isPublicPath("/loginx")).toBe(false);
    expect(isPublicPath("/authors")).toBe(false);
    expect(isPublicPath("/auth")).toBe(false);
  });
});
