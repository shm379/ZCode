import { describe, expect, it } from "vitest";

import { desktopDirectServerModule } from "./module.js";
import {
  buildDesktopServerId,
  parseDirectServerTokenFile,
  pickListenPort,
} from "./directServerManager.js";

// 契约测试只 import contract 与 module，不知道实现是谁；同一份测试应同时跑真实现与跨进程代理。
describe("desktop-direct-server contract", () => {
  it("declares its module manifest", () => {
    expect(desktopDirectServerModule.id).toBe("desktop-direct-server");
  });
});

describe("parseDirectServerTokenFile", () => {
  it("accepts a well-formed v1 token file and fills the default port", () => {
    const parsed = parseDirectServerTokenFile(
      JSON.stringify({ version: 1, token: "a".repeat(64) }),
    );
    expect(parsed).toEqual({ version: 1, token: "a".repeat(64), port: 3030 });
  });

  it("keeps a persisted non-default port", () => {
    const parsed = parseDirectServerTokenFile(
      JSON.stringify({ version: 1, token: "b".repeat(32), port: 45123 }),
    );
    expect(parsed?.port).toBe(45123);
  });

  it("rejects malformed json, wrong versions, non-hex tokens and invalid ports", () => {
    expect(parseDirectServerTokenFile("not json")).toBeNull();
    expect(
      parseDirectServerTokenFile(JSON.stringify({ version: 2, token: "a".repeat(64) })),
    ).toBeNull();
    expect(
      parseDirectServerTokenFile(JSON.stringify({ version: 1, token: "zz".repeat(32) })),
    ).toBeNull();
    expect(
      parseDirectServerTokenFile(JSON.stringify({ version: 1, token: "a".repeat(8) })),
    ).toBeNull();
    expect(
      parseDirectServerTokenFile(
        JSON.stringify({ version: 1, token: "a".repeat(64), port: "3030" }),
      ),
    ).toBeNull();
    expect(
      parseDirectServerTokenFile(JSON.stringify({ version: 1, token: "a".repeat(64), port: -1 })),
    ).toBeNull();
  });
});

describe("pickListenPort", () => {
  it("uses the preferred port when it is free", async () => {
    const port = await pickListenPort({
      preferred: 3030,
      isPreferredFree: async () => true,
      allocateEphemeral: async () => {
        throw new Error("should not allocate when preferred port is free");
      },
    });
    expect(port).toBe(3030);
  });

  it("falls back to an ephemeral port when the preferred one is taken", async () => {
    const port = await pickListenPort({
      preferred: 3030,
      isPreferredFree: async () => false,
      allocateEphemeral: async () => 51234,
    });
    expect(port).toBe(51234);
  });

  it("skips invalid preferred ports", async () => {
    const port = await pickListenPort({
      preferred: 0,
      isPreferredFree: async () => {
        throw new Error("invalid ports must not be probed");
      },
      allocateEphemeral: async () => 50001,
    });
    expect(port).toBe(50001);
  });
});

describe("buildDesktopServerId", () => {
  it("is stable and identity-safe", () => {
    expect(buildDesktopServerId("My-Mac.local")).toBe("desktop-my-mac.local");
    expect(buildDesktopServerId("命中 主机!")).toBe("desktop-desktop");
    expect(buildDesktopServerId("  ")).toBe("desktop-desktop");
  });
});
