import { describe, it, expect } from "vitest";

// 模拟 channel.ts 中的 normalizeXmppJid 函数
function normalizeXmppJid(target: string): string {
  return target
    .trim()
    .replace(/^xmpp:/i, "")
    .trim();
}

describe("JID Normalization", () => {
  it("should remove xmpp: prefix", () => {
    expect(normalizeXmppJid("xmpp:user@example.com")).toBe("user@example.com");
  });

  it("should be case insensitive for prefix", () => {
    expect(normalizeXmppJid("XMPP:user@example.com")).toBe("user@example.com");
  });

  it("should handle JID without prefix", () => {
    expect(normalizeXmppJid("user@example.com")).toBe("user@example.com");
  });

  it("should trim whitespace", () => {
    expect(normalizeXmppJid(" xmpp:user@example.com ")).toBe("user@example.com");
  });

  it("should handle full JID with resource", () => {
    expect(normalizeXmppJid("xmpp:user@example.com/resource")).toBe("user@example.com/resource");
  });
});
