import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("package metadata", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    name: string;
    bin: Record<string, string>;
    engines: Record<string, string>;
  };

  it("publishes switch-acc-ai with only the sacc binary", () => {
    expect(pkg.name).toBe("switch-acc-ai");
    expect(pkg.bin).toEqual({ sacc: "dist/bin/sacc.js" });
  });

  it("requires Node 20 or newer", () => {
    expect(pkg.engines.node).toBe(">=20");
  });
});
