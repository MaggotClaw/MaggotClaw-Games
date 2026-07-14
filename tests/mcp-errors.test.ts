import { describe, expect, it } from "vitest";
import { projectSafeError } from "../src/mcp";

describe("projectSafeError", () => {
  it("turns an expired Dropbox token into a plain-language recovery message", () => {
    const message = projectSafeError("Dropbox request failed (HTTP 401, category expired_access_token).");
    expect(message).toContain("Dropbox connection has expired");
    expect(message).toContain("No work was deleted or changed");
    expect(message).not.toContain("expired_access_token");
  });

  it("does not expose unknown technical failures", () => {
    const message = projectSafeError("Tool invocation failed schema validation: secret detail");
    expect(message).toContain("Nothing was changed");
    expect(message).not.toContain("schema validation");
    expect(message).not.toContain("secret detail");
  });
});
