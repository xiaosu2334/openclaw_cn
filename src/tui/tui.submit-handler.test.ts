import type { TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { CustomEditor } from "./components/custom-editor.js";
import { editorTheme } from "./theme/theme.js";
import { createSubmitHarness } from "./tui-submit-test-helpers.js";
import {
  createEditorSubmitHandler,
  createSubmitBurstCoalescer,
  shouldEnableWindowsGitBashPasteFallback,
} from "./tui-submit.js";

describe("createEditorSubmitHandler", () => {
  it("routes lines starting with ! to handleBangLine", () => {
    const { handleCommand, sendMessage, handleBangLine, onSubmit } = createSubmitHarness();

    onSubmit("!ls");

    expect(handleBangLine).toHaveBeenCalledTimes(1);
    expect(handleBangLine).toHaveBeenCalledWith("!ls");
    expect(sendMessage).not.toHaveBeenCalled();
    expect(handleCommand).not.toHaveBeenCalled();
  });

  it("treats a lone ! as a normal message", () => {
    const { sendMessage, handleBangLine, onSubmit } = createSubmitHarness();

    onSubmit("!");

    expect(handleBangLine).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith("!");
  });

  it("does not treat leading whitespace before ! as a bang command", () => {
    const { editor, sendMessage, handleBangLine, onSubmit } = createSubmitHarness();

    onSubmit("  !ls");

    expect(handleBangLine).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith("!ls");
    expect(editor.addToHistory).toHaveBeenCalledWith("!ls");
  });

  it("trims normal messages before sending and adding to history", () => {
    const { editor, sendMessage, onSubmit } = createSubmitHarness();

    onSubmit("  hello  ");

    expect(sendMessage).toHaveBeenCalledWith("hello");
    expect(editor.addToHistory).toHaveBeenCalledWith("hello");
  });

  it("preserves normal message drafts when chat is busy", () => {
    const { editor, sendMessage, handleCommand, handleBangLine, onBlockedMessageSubmit, onSubmit } =
      createSubmitHarness({
        canSubmitMessage: () => false,
      });

    onSubmit("  wait, use c++ instead  ");

    expect(editor.setText).toHaveBeenCalledWith("wait, use c++ instead");
    expect(editor.addToHistory).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(handleCommand).not.toHaveBeenCalled();
    expect(handleBangLine).not.toHaveBeenCalled();
    expect(onBlockedMessageSubmit).toHaveBeenCalledWith("wait, use c++ instead");
  });

  it("passes the submitted text to the busy gate", () => {
    const canSubmitMessage = vi.fn((value: string) => value === "please stop");
    const { sendMessage, onSubmit } = createSubmitHarness({ canSubmitMessage });

    onSubmit("please stop");

    expect(canSubmitMessage).toHaveBeenCalledWith("please stop");
    expect(sendMessage).toHaveBeenCalledWith("please stop");
  });

  it("restores the real editor value after pi-tui clears a busy submit", () => {
    const tui = { requestRender: vi.fn() } as unknown as TUI;
    const editor = new CustomEditor(tui, editorTheme);
    const sendMessage = vi.fn();
    const onBlockedMessageSubmit = vi.fn();
    editor.setText("wait, use c++ instead");
    editor.onSubmit = createEditorSubmitHandler({
      editor,
      handleCommand: vi.fn(),
      sendMessage,
      handleBangLine: vi.fn(),
      canSubmitMessage: () => false,
      onBlockedMessageSubmit,
    });

    editor.handleInput("\r");

    expect(editor.getText()).toBe("wait, use c++ instead");
    expect(sendMessage).not.toHaveBeenCalled();
    expect(onBlockedMessageSubmit).toHaveBeenCalledWith("wait, use c++ instead");
  });

  it("continues to route slash commands while chat is busy", () => {
    const { editor, handleCommand, sendMessage, onBlockedMessageSubmit, onSubmit } =
      createSubmitHarness({
        canSubmitMessage: () => false,
      });

    onSubmit("/abort");

    expect(editor.setText).toHaveBeenCalledWith("");
    expect(handleCommand).toHaveBeenCalledWith("/abort");
    expect(sendMessage).not.toHaveBeenCalled();
    expect(onBlockedMessageSubmit).not.toHaveBeenCalled();
  });

  it("preserves internal newlines for multiline messages", () => {
    const { editor, handleCommand, sendMessage, handleBangLine, onSubmit } = createSubmitHarness();

    onSubmit("Line 1\nLine 2\nLine 3");

    expect(sendMessage).toHaveBeenCalledWith("Line 1\nLine 2\nLine 3");
    expect(editor.addToHistory).toHaveBeenCalledWith("Line 1\nLine 2\nLine 3");
    expect(handleCommand).not.toHaveBeenCalled();
    expect(handleBangLine).not.toHaveBeenCalled();
  });
});

describe("createSubmitBurstCoalescer", () => {
  // P0-1: Single-line submissions (no "\n") bypass the burst coalescer entirely
  // and are submitted immediately. Only multi-line text goes through coalescing.
  it("submits single-line text immediately without burst when enabled (P0-1)", () => {
    const submit = vi.fn();
    const onSubmit = createSubmitBurstCoalescer({
      submit,
      enabled: true,
      burstWindowMs: 50,
    });

    onSubmit("Line 1");
    onSubmit("Line 2");
    onSubmit("Line 3");

    // Each single-line submit goes through immediately.
    expect(submit).toHaveBeenCalledTimes(3);
    expect(submit).toHaveBeenNthCalledWith(1, "Line 1");
    expect(submit).toHaveBeenNthCalledWith(2, "Line 2");
    expect(submit).toHaveBeenNthCalledWith(3, "Line 3");
  });

  it("submits single-line text immediately without burst when disabled (P0-1)", () => {
    const submit = vi.fn();
    const onSubmit = createSubmitBurstCoalescer({
      submit,
      enabled: false,
    });

    onSubmit("Line 1");
    onSubmit("Line 2");

    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenNthCalledWith(1, "Line 1");
    expect(submit).toHaveBeenNthCalledWith(2, "Line 2");
  });

  it("submits multi-line text (with \\n) immediately without burst window (P0-1)", () => {
    const submit = vi.fn();
    const onSubmit = createSubmitBurstCoalescer({
      submit,
      enabled: true,
      burstWindowMs: 50,
    });

    onSubmit("Line 1\nLine 2\nLine 3");

    // Multi-line text (pasted blocks) goes through immediately.
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith("Line 1\nLine 2\nLine 3");
  });

  it("flushes pending burst before submitting single-line when enabled (P0-1)", () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    let now = 1_000;
    const onSubmit = createSubmitBurstCoalescer({
      submit,
      enabled: true,
      burstWindowMs: 50,
      now: () => now,
    });

    // Multi-line first (goes into burst but immediately flushed in new logic).
    onSubmit("Multi\nLine");
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenNthCalledWith(1, "Multi\nLine");

    // Single-line after.
    onSubmit("Single");
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenNthCalledWith(2, "Single");

    vi.useRealTimers();
  });

  it("flushes any pending burst when a single-line arrives mid-burst (P0-1)", () => {
    const submit = vi.fn();
    const onSubmit = createSubmitBurstCoalescer({
      submit,
      enabled: true,
    });

    onSubmit("Pasted\nBlock");
    onSubmit("Single");

    // Both go through immediately in new P0-1 logic.
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenNthCalledWith(1, "Pasted\nBlock");
    expect(submit).toHaveBeenNthCalledWith(2, "Single");
  });

  it("submits immediately when enabled is false regardless of content (P0-1)", () => {
    const submit = vi.fn();
    const onSubmit = createSubmitBurstCoalescer({
      submit,
      enabled: false,
    });

    onSubmit("Single");
    onSubmit("Multi\nLine");
    onSubmit("Another single");

    expect(submit).toHaveBeenCalledTimes(3);
    expect(submit).toHaveBeenNthCalledWith(1, "Single");
    expect(submit).toHaveBeenNthCalledWith(2, "Multi\nLine");
    expect(submit).toHaveBeenNthCalledWith(3, "Another single");
  });
});

describe("shouldEnableWindowsGitBashPasteFallback", () => {
  it("enables fallback on Windows Git Bash env", () => {
    expect(
      shouldEnableWindowsGitBashPasteFallback({
        platform: "win32",
        env: {
          MSYSTEM: "MINGW64",
        } as NodeJS.ProcessEnv,
      }),
    ).toBe(true);
  });

  it("enables fallback on macOS iTerm", () => {
    expect(
      shouldEnableWindowsGitBashPasteFallback({
        platform: "darwin",
        env: {
          TERM_PROGRAM: "iTerm.app",
        } as NodeJS.ProcessEnv,
      }),
    ).toBe(true);
  });

  it("enables fallback on macOS Terminal.app", () => {
    expect(
      shouldEnableWindowsGitBashPasteFallback({
        platform: "darwin",
        env: {
          TERM_PROGRAM: "Apple_Terminal",
        } as NodeJS.ProcessEnv,
      }),
    ).toBe(true);
  });

  it("disables fallback outside Windows", () => {
    expect(
      shouldEnableWindowsGitBashPasteFallback({
        platform: "linux",
        env: {
          MSYSTEM: "MINGW64",
        } as NodeJS.ProcessEnv,
      }),
    ).toBe(false);
  });
});
