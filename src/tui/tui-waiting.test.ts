import { describe, expect, it } from "vitest";
import { buildWaitingStatusMessage, pickWaitingPhrase } from "./tui-waiting.js";

const theme = {
  dim: (s: string) => `<d>${s}</d>`,
  bold: (s: string) => `<b>${s}</b>`,
  accentSoft: (s: string) => `<a>${s}</a>`,
} as any;

describe("tui-waiting", () => {
  it("pickWaitingPhrase rotates every 10 ticks", () => {
    const phrases = ["a", "b", "c"];
    expect(pickWaitingPhrase(0, phrases)).toBe("a");
    expect(pickWaitingPhrase(9, phrases)).toBe("a");
    expect(pickWaitingPhrase(10, phrases)).toBe("b");
    expect(pickWaitingPhrase(20, phrases)).toBe("c");
    expect(pickWaitingPhrase(30, phrases)).toBe("a");
  });

  it("buildWaitingStatusMessage includes shimmer markup and metadata", () => {
    const msg = buildWaitingStatusMessage({
      theme,
      tick: 1,
      elapsed: "3s",
      connectionStatus: "connected",
      phrases: ["hello"],
    });

    expect(msg).toBe(
      "<b><a>h</a></b><b><a>e</a></b><d>l</d><d>l</d><d>o</d><d>…</d> • 3s | connected",
    );
  });

  // P1-5: Static waiting mode displays "模型思考中…" without shimmer animation.
  it("buildWaitingStatusMessage returns static text when waitingMode is static (P1-5)", () => {
    const msg = buildWaitingStatusMessage({
      theme,
      tick: 1,
      elapsed: "5s",
      connectionStatus: "connected",
      waitingMode: "static",
    });

    expect(msg).toBe("<d>模型思考中…</d> • 5s | connected");
  });

  it("buildWaitingStatusMessage static mode ignores tick for animation", () => {
    const msg1 = buildWaitingStatusMessage({
      theme,
      tick: 0,
      elapsed: "1s",
      connectionStatus: "connected",
      waitingMode: "static",
    });
    const msg2 = buildWaitingStatusMessage({
      theme,
      tick: 999,
      elapsed: "1s",
      connectionStatus: "connected",
      waitingMode: "static",
    });

    // Static mode should produce the same message regardless of tick.
    expect(msg1).toBe(msg2);
  });

  it("buildWaitingStatusMessage defaults to shimmer when waitingMode is not specified", () => {
    const msg = buildWaitingStatusMessage({
      theme,
      tick: 0,
      elapsed: "3s",
      connectionStatus: "connected",
      phrases: ["test"],
    });

    // Should use shimmer (not static) when no waitingMode specified.
    expect(msg).not.toContain("模型思考中…");
    expect(msg).toContain("<b>");
  });
});
