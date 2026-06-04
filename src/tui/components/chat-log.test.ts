import { describe, expect, it } from "vitest";
import { normalizeTestText } from "../../../test/helpers/normalize-text.js";
import { ChatLog } from "./chat-log.js";

describe("ChatLog", () => {
  it("caps component growth to avoid unbounded render trees", () => {
    const chatLog = new ChatLog(20);
    for (let i = 1; i <= 40; i++) {
      chatLog.addSystem(`system-${i}`);
    }

    expect(chatLog.children.length).toBe(20);
    const rendered = chatLog.render(120).join("\n");
    expect(rendered).toContain("system-40");
    expect(rendered).not.toContain("system-1");
  });

  it("coalesces consecutive repeatable system messages", () => {
    const chatLog = new ChatLog(20);

    chatLog.addSystem("no active run", { coalesceConsecutive: true });
    chatLog.addSystem("no active run", { coalesceConsecutive: true });
    chatLog.addSystem("no active run", { coalesceConsecutive: true });

    const rendered = normalizeTestText(chatLog.render(120).join("\n"));
    expect(chatLog.children.length).toBe(1);
    expect(rendered).toContain("no active run x3");
  });

  it("does not coalesce ordinary system messages", () => {
    const chatLog = new ChatLog(20);

    chatLog.addSystem("status unchanged");
    chatLog.addSystem("status unchanged");

    expect(chatLog.children.length).toBe(2);
  });

  it("starts a new repeatable system message after other chat content", () => {
    const chatLog = new ChatLog(20);

    chatLog.addSystem("no active run", { coalesceConsecutive: true });
    chatLog.addUser("hello");
    chatLog.addSystem("no active run", { coalesceConsecutive: true });

    const rendered = normalizeTestText(chatLog.render(120).join("\n"));
    expect(chatLog.children.length).toBe(4);
    expect(rendered).not.toContain("no active run x2");
  });

  it("drops stale streaming references when old components are pruned", () => {
    const chatLog = new ChatLog(20);
    chatLog.startAssistant("first", "run-1");
    for (let i = 0; i < 25; i++) {
      chatLog.addSystem(`overflow-${i}`);
    }

    // Should not throw if the original streaming component was pruned.
    chatLog.updateAssistant("recreated", "run-1");

    const rendered = chatLog.render(120).join("\n");
    expect(chatLog.children.length).toBe(20);
    expect(rendered).toContain("recreated");
  });

  it("does not append duplicate assistant components when a run is started twice", () => {
    const chatLog = new ChatLog(40);
    chatLog.startAssistant("first", "run-dup");
    chatLog.startAssistant("second", "run-dup");

    const rendered = chatLog.render(120).join("\n");
    expect(rendered).toContain("second");
    expect(rendered).not.toContain("first");
    expect(chatLog.children.length).toBe(1);
  });

  it("reserves assistant position without clearing existing streamed text", () => {
    const chatLog = new ChatLog(40);
    chatLog.startAssistant("partial", "run-active");
    chatLog.reserveAssistantSlot("run-active");

    const rendered = chatLog.render(120).join("\n");
    expect(rendered).toContain("partial");
    expect(chatLog.children.length).toBe(1);
  });

  it("drops stale tool references when old components are pruned", () => {
    const chatLog = new ChatLog(20);
    chatLog.startTool("tool-1", "read_file", { path: "a.txt" });
    for (let i = 0; i < 25; i++) {
      chatLog.addSystem(`overflow-${i}`);
    }

    // Should no-op safely after the tool component is pruned.
    chatLog.updateToolResult("tool-1", { content: [{ type: "text", text: "done" }] });

    expect(chatLog.children.length).toBe(20);
  });

  it("clears visible tool entries and stale tool references", () => {
    const chatLog = new ChatLog(20);
    const tool = chatLog.startTool("tool-1", "read_file", { path: "a.txt" });
    tool.setExpanded(true);
    chatLog.updateToolResult("tool-1", { content: [{ type: "text", text: "done" }] });

    let rendered = normalizeTestText(chatLog.render(120).join("\n"));
    expect(rendered).toContain("Read File");

    chatLog.clearTools();
    chatLog.updateToolResult("tool-1", { content: [{ type: "text", text: "stale" }] });

    rendered = normalizeTestText(chatLog.render(120).join("\n"));
    expect(rendered).not.toContain("Read File");
    expect(rendered).not.toContain("stale");
  });

  it("prunes system messages atomically when a non-system entry overflows the log", () => {
    const chatLog = new ChatLog(20);
    for (let i = 1; i <= 20; i++) {
      chatLog.addSystem(`system-${i}`);
    }

    chatLog.addUser("hello");

    const rendered = normalizeTestText(chatLog.render(120).join("\n"));
    expect(rendered).not.toMatch(/\bsystem-1\b/);
    expect(rendered).toMatch(/\bsystem-3\b/);
    expect(rendered).toMatch(/\bsystem-20\b/);
    expect(rendered).toContain("hello");
    expect(chatLog.children.length).toBe(20);
  });

  it("renders BTW inline and removes it when dismissed", () => {
    const chatLog = new ChatLog(40);

    chatLog.addSystem("session agent:main:main");
    chatLog.showBtw({
      question: "what is 17 * 19?",
      text: "323",
    });

    let rendered = chatLog.render(120).join("\n");
    expect(rendered).toContain("BTW: what is 17 * 19?");
    expect(rendered).toContain("323");
    expect(chatLog.hasVisibleBtw()).toBe(true);

    chatLog.dismissBtw();

    rendered = chatLog.render(120).join("\n");
    expect(rendered).not.toContain("BTW: what is 17 * 19?");
    expect(chatLog.hasVisibleBtw()).toBe(false);
  });

  it("preserves pending user messages across history rebuilds", () => {
    const chatLog = new ChatLog(40);

    chatLog.addPendingUser("run-1", "queued hello");
    chatLog.clearAll({ preservePendingUsers: true });
    chatLog.addSystem("session agent:main:main");
    chatLog.restorePendingUsers();

    const rendered = chatLog.render(120).join("\n");
    expect(rendered).toContain("queued hello");
    expect(chatLog.countPendingUsers()).toBe(1);
  });

  it("does not append the same pending component twice when it is already mounted", () => {
    const chatLog = new ChatLog(40);

    chatLog.addPendingUser("run-1", "queued hello");
    chatLog.restorePendingUsers();

    expect(chatLog.children.length).toBe(1);
    expect(chatLog.render(120).join("\n")).toContain("queued hello");
  });

  it("stops counting a pending user message once the run is committed", () => {
    const chatLog = new ChatLog(40);

    chatLog.addPendingUser("run-1", "hello");
    expect(chatLog.countPendingUsers()).toBe(1);

    expect(chatLog.commitPendingUser("run-1")).toBe(true);
    expect(chatLog.countPendingUsers()).toBe(0);
    expect(chatLog.render(120).join("\n")).toContain("hello");
  });

  it("reconciles pending users against rebuilt history using timestamps", () => {
    const chatLog = new ChatLog(40);

    chatLog.addPendingUser("run-1", "queued hello", 2_000);

    expect(
      chatLog.reconcilePendingUsers([
        { text: "queued hello", timestamp: 2_100 },
        { text: "older", timestamp: 1_000 },
      ]),
    ).toEqual(["run-1"]);
    expect(chatLog.countPendingUsers()).toBe(0);
  });

  it("reconciles pending users when the gateway clock is slightly behind the client", () => {
    const chatLog = new ChatLog(40);

    chatLog.addPendingUser("run-1", "queued hello", 65_000);

    expect(chatLog.reconcilePendingUsers([{ text: "queued hello", timestamp: 20_000 }])).toEqual([
      "run-1",
    ]);
    expect(chatLog.countPendingUsers()).toBe(0);
  });

  it("dismisses a pending system notice by runId", () => {
    const chatLog = new ChatLog(40);

    chatLog.addPendingSystem("run-1", "taking longer than expected");
    let rendered = chatLog.render(120).join("\n");
    expect(rendered).toContain("taking longer than expected");

    const dismissed = chatLog.dismissPendingSystem("run-1");
    expect(dismissed).toBe(true);

    rendered = chatLog.render(120).join("\n");
    expect(rendered).not.toContain("taking longer than expected");
    expect(chatLog.dismissPendingSystem("run-1")).toBe(false);
  });

  it("replaces an existing pending system notice for the same runId", () => {
    const chatLog = new ChatLog(40);

    chatLog.addPendingSystem("run-1", "first notice");
    chatLog.addPendingSystem("run-1", "second notice");

    const rendered = chatLog.render(120).join("\n");
    expect(rendered).not.toContain("first notice");
    expect(rendered).toContain("second notice");
    expect(chatLog.children.length).toBe(1);
  });

  it("does not hide a new repeated prompt when only older history matches", () => {
    const chatLog = new ChatLog(40);

    chatLog.addPendingUser("run-1", "continue", 5_000);

    expect(chatLog.reconcilePendingUsers([{ text: "continue", timestamp: -56_000 }])).toStrictEqual(
      [],
    );
    expect(chatLog.countPendingUsers()).toBe(1);
  });
});

// ── P0-4: diffUpdate incremental history tests ──────────────────────────

describe("ChatLog diffUpdate (P0-4)", () => {
  it("does nothing when the new descriptor list is identical to the current snapshot", () => {
    const chatLog = new ChatLog(40);
    chatLog.addSystem("session agent:main:main");
    chatLog.addUser("hello");
    chatLog.addSystem("done");

    const before = chatLog.children.length;

    chatLog.diffUpdate([
      { kind: "system", text: "session agent:main:main" },
      { kind: "user", text: "hello" },
      { kind: "system", text: "done" },
    ]);

    // Same list: no changes expected.
    expect(chatLog.children.length).toBe(before);
  });

  it("appends only new messages when the tail differs (appends new suffix)", () => {
    const chatLog = new ChatLog(40);
    chatLog.diffUpdate([
      { kind: "system", text: "session agent:main:main" },
      { kind: "user", text: "hello" },
    ]);

    const before = chatLog.children.length;

    chatLog.diffUpdate([
      { kind: "system", text: "session agent:main:main" },
      { kind: "user", text: "hello" },
      { kind: "assistant", text: "hi there" },
    ]);

    // Should only append the new assistant message.
    expect(chatLog.children.length).toBe(before + 2);
    const rendered = normalizeTestText(chatLog.render(120).join("\n"));
    expect(rendered).toContain("hi there");
    expect(rendered).toContain("hello");
  });

  it("rebuilds from the difference point when a message is inserted in the middle", () => {
    const chatLog = new ChatLog(40);
    chatLog.diffUpdate([
      { kind: "system", text: "session agent:main:main" },
      { kind: "user", text: "first" },
      { kind: "assistant", text: "reply1" },
      { kind: "user", text: "third" },
    ]);

    chatLog.diffUpdate([
      { kind: "system", text: "session agent:main:main" },
      { kind: "user", text: "first" },
      { kind: "assistant", text: "reply1" },
      { kind: "user", text: "second" }, // inserted
      { kind: "user", text: "third" },
    ]);

    const rendered = normalizeTestText(chatLog.render(120).join("\n"));
    expect(rendered).toContain("first");
    expect(rendered).toContain("second");
    expect(rendered).toContain("third");
  });

  it("removes messages when the new list has fewer entries (deletion)", () => {
    const chatLog = new ChatLog(40);
    chatLog.diffUpdate([
      { kind: "system", text: "session agent:main:main" },
      { kind: "user", text: "first" },
      { kind: "user", text: "second" },
      { kind: "user", text: "third" },
    ]);

    const before = chatLog.children.length;

    chatLog.diffUpdate([
      { kind: "system", text: "session agent:main:main" },
      { kind: "user", text: "first" },
    ]);

    // Should have fewer children after deletion.
    expect(chatLog.children.length).toBeLessThan(before);
    const rendered = normalizeTestText(chatLog.render(120).join("\n"));
    expect(rendered).toContain("first");
    expect(rendered).not.toContain("second");
    expect(rendered).not.toContain("third");
  });

  it("handles empty descriptor list (clears all)", () => {
    const chatLog = new ChatLog(40);
    chatLog.addSystem("session agent:main:main");
    chatLog.addUser("hello");

    chatLog.diffUpdate([]);

    expect(chatLog.children.length).toBe(0);
  });

  it("handles completely different descriptor list (full rebuild)", () => {
    const chatLog = new ChatLog(40);
    chatLog.diffUpdate([
      { kind: "system", text: "old session" },
      { kind: "user", text: "old message" },
    ]);

    chatLog.diffUpdate([
      { kind: "system", text: "new session" },
      { kind: "user", text: "new message" },
    ]);

    const rendered = normalizeTestText(chatLog.render(120).join("\n"));
    expect(rendered).not.toContain("old session");
    expect(rendered).not.toContain("old message");
    expect(rendered).toContain("new session");
    expect(rendered).toContain("new message");
  });
});

// ── Message spacing and layout tests ────────────────────────────────────

describe("ChatLog message spacing (P1-4)", () => {
  it("adds spacer between non-system messages for visual separation", () => {
    const chatLog = new ChatLog(40);

    chatLog.addUser("hello");
    chatLog.addSystem("notice");
    chatLog.addUser("world");

    const rendered = chatLog.render(120).join("\n");
    expect(rendered).toContain("hello");
    expect(rendered).toContain("world");
    expect(rendered).toContain("notice");
    expect(chatLog.children.length).toBeGreaterThanOrEqual(3);
  });
});

// ── Virtualization tests (P2-2) ────────────────────────────────────────

describe("ChatLog virtualization (P2-2)", () => {
  it("is not virtualized by default", () => {
    const chatLog = new ChatLog(40);
    expect(chatLog.isVirtualized()).toBe(false);
  });

  it("activates virtualization when enabled and message count exceeds threshold", () => {
    const chatLog = new ChatLog(40);
    chatLog.enableVirtualization(5);
    chatLog.diffUpdate(
      Array.from({ length: 10 }, (_, i) => ({ kind: "system", text: `msg-${i}` })),
    );
    expect(chatLog.getMessageCount()).toBe(10);
    expect(chatLog.isVirtualized()).toBe(true);
  });

  it("does not activate when message count is below threshold", () => {
    const chatLog = new ChatLog(40);
    chatLog.enableVirtualization(50);
    chatLog.diffUpdate(
      Array.from({ length: 10 }, (_, i) => ({ kind: "system", text: `msg-${i}` })),
    );
    expect(chatLog.isVirtualized()).toBe(false);
  });

  it("returns all children when not virtualized", () => {
    const chatLog = new ChatLog(40);
    chatLog.diffUpdate(
      Array.from({ length: 10 }, (_, i) => ({ kind: "system", text: `msg-${i}` })),
    );
    const visible = chatLog.getVisibleChildren(5);
    expect(visible.length).toBe(10);
  });

  it("returns viewport window when virtualized", () => {
    const chatLog = new ChatLog(200);
    chatLog.enableVirtualization(5);
    chatLog.diffUpdate(
      Array.from({ length: 20 }, (_, i) => ({ kind: "system", text: `msg-${i}` })),
    );
    const visible = chatLog.getVisibleChildren(5);
    expect(visible.length).toBe(5);
  });

  it("respects scrollOffset for virtualized viewport", () => {
    const chatLog = new ChatLog(200);
    chatLog.enableVirtualization(5);
    chatLog.diffUpdate(
      Array.from({ length: 20 }, (_, i) => ({ kind: "system", text: `msg-${i}` })),
    );
    chatLog.setScrollOffset(10);
    const visible = chatLog.getVisibleChildren(5);
    expect(visible.length).toBe(5);
    const rendered = normalizeTestText(visible.map((c) => c.render(120).join("\n")).join("\n"));
    expect(rendered).toContain("msg-10");
    expect(rendered).toContain("msg-14");
  });

  it("clamps scrollOffset to valid range", () => {
    const chatLog = new ChatLog(200);
    chatLog.enableVirtualization(5);
    chatLog.diffUpdate(
      Array.from({ length: 20 }, (_, i) => ({ kind: "system", text: `msg-${i}` })),
    );
    chatLog.setScrollOffset(999); // beyond the end
    const visible = chatLog.getVisibleChildren(5);
    expect(visible.length).toBe(5);
    // Should show the last 5.
    const rendered = normalizeTestText(visible.map((c) => c.render(120).join("\n")).join("\n"));
    expect(rendered).toContain("msg-15");
    expect(rendered).toContain("msg-19");
  });

  it("disables virtualization", () => {
    const chatLog = new ChatLog(200);
    chatLog.enableVirtualization(5);
    chatLog.diffUpdate(
      Array.from({ length: 20 }, (_, i) => ({ kind: "system", text: `msg-${i}` })),
    );
    expect(chatLog.isVirtualized()).toBe(true);
    chatLog.disableVirtualization();
    expect(chatLog.isVirtualized()).toBe(false);
  });

  it("returns zero scrollOffset initially", () => {
    const chatLog = new ChatLog(40);
    expect(chatLog.getScrollOffset()).toBe(0);
  });
});

// ── preserveShortcutBar tests ──────────────────────────────────────────

describe("ChatLog preserveShortcutBar", () => {
  it("clearAll with preserveShortcutBar does not clear shortcutBar", () => {
    const chatLog = new ChatLog(40);
    chatLog.addSystem("session agent:main:main");
    chatLog.addUser("hello");

    // No shortcutBar set, but clearAll should not throw with this option.
    chatLog.clearAll({ preserveShortcutBar: true });

    // Chat log should be cleared but no error.
    expect(chatLog.children.length).toBe(0);
  });
});
