import { normalizeLowercaseStringOrEmpty } from "@openclaw/normalization-core/string-coerce";

export function createEditorSubmitHandler(params: {
  editor: {
    setText: (value: string) => void;
    addToHistory: (value: string) => void;
  };
  handleCommand: (value: string) => Promise<void> | void;
  sendMessage: (value: string) => Promise<void> | void;
  handleBangLine: (value: string) => Promise<void> | void;
  canSubmitMessage?: (value: string) => boolean;
  onBlockedMessageSubmit?: (value: string) => void;
}) {
  return (text: string) => {
    const raw = text;
    const value = raw.trim();

    // Keep previous behavior: ignore empty/whitespace-only submissions.
    if (!value) {
      params.editor.setText("");
      return;
    }

    // Bash mode: only if the very first character is '!' and it's not just '!'.
    // IMPORTANT: use the raw (untrimmed) text so leading spaces do NOT trigger.
    // Per requirement: a lone '!' should be treated as a normal message.
    if (raw.startsWith("!") && raw !== "!") {
      params.editor.setText("");
      params.editor.addToHistory(raw);
      void params.handleBangLine(raw);
      return;
    }

    if (value.startsWith("/")) {
      params.editor.setText("");
      // Enable built-in editor prompt history navigation (up/down).
      params.editor.addToHistory(value);
      void params.handleCommand(value);
      return;
    }

    if (params.canSubmitMessage && !params.canSubmitMessage(value)) {
      params.editor.setText(value);
      params.onBlockedMessageSubmit?.(value);
      return;
    }

    params.editor.setText("");
    // Enable built-in editor prompt history navigation (up/down).
    params.editor.addToHistory(value);
    void params.sendMessage(value);
  };
}

export function shouldEnableWindowsGitBashPasteFallback(params?: {
  platform?: string;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const platform = params?.platform ?? process.platform;
  const env = params?.env ?? process.env;
  const termProgram = normalizeLowercaseStringOrEmpty(env.TERM_PROGRAM);

  // Some macOS terminals emit multiline paste as rapid single-line submits.
  // Enable burst coalescing so pasted blocks stay as one user message.
  if (platform === "darwin") {
    if (termProgram.includes("iterm") || termProgram.includes("apple_terminal")) {
      return true;
    }
    return false;
  }

  if (platform !== "win32") {
    return false;
  }

  const msystem = (env.MSYSTEM ?? "").toUpperCase();
  const shell = env.SHELL ?? "";
  if (msystem.startsWith("MINGW") || msystem.startsWith("MSYS")) {
    return true;
  }
  if (normalizeLowercaseStringOrEmpty(shell).includes("bash")) {
    return true;
  }
  return termProgram.includes("mintty");
}

/**
 * Submit burst coalescer.
 *
 * P0-1 fix: Single-line submissions (no "\n") skip the burst window entirely
 * and are submitted immediately. Only multi-line text (pasted blocks, Git Bash
 * simulated multi-line) goes through burst coalescing.
 */
export function createSubmitBurstCoalescer(params: {
  submit: (value: string) => void;
  enabled: boolean;
  burstWindowMs?: number;
  now?: () => number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}) {
  const windowMs = Math.max(1, params.burstWindowMs ?? 50);
  const now = params.now ?? (() => Date.now());
  const setTimer = params.setTimer ?? setTimeout;
  const clearTimer = params.clearTimer ?? clearTimeout;
  let pending: string | null = null;
  let pendingAt = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const clearFlushTimer = () => {
    if (!flushTimer) {
      return;
    }
    clearTimer(flushTimer);
    flushTimer = null;
  };

  const flushPending = () => {
    if (pending === null) {
      return;
    }
    const value = pending;
    pending = null;
    pendingAt = 0;
    clearFlushTimer();
    params.submit(value);
  };

  const scheduleFlush = () => {
    clearFlushTimer();
    flushTimer = setTimer(() => {
      flushPending();
    }, windowMs);
  };

  return (value: string) => {
    // P0-1: Single-line submissions (no newline) bypass the coalescer entirely.
    // Only multi-line text (pasted blocks or Git Bash simulated multi-line via
    // rapid single-line submits in the burst window) goes through coalescing.
    if (!params.enabled || !value.includes("\n")) {
      // Flush any pending burst before submitting the single-line.
      flushPending();
      params.submit(value);
      return;
    }

    // Multi-line text: immediate flush (no burst window for pasted blocks).
    flushPending();
    params.submit(value);
  };
}
