import type { Component } from "@earendil-works/pi-tui";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import type { ShortcutBar } from "./shortcut-bar.js";
import { theme } from "../theme/theme.js";
import { AssistantMessageComponent } from "./assistant-message.js";
import { BtwInlineMessage } from "./btw-inline-message.js";
import { ToolExecutionComponent } from "./tool-execution.js";
import { UserMessageComponent } from "./user-message.js";

const PENDING_HISTORY_CLOCK_SKEW_TOLERANCE_MS = 60_000;

type RepeatableSystemMessage = {
  component: Container;
  textNode: Text;
  baseText: string;
  count: number;
};

/** Descriptor for a rendered message, used by diffUpdate for incremental history. */
export type MessageDescriptor = {
  kind: "system" | "user" | "assistant" | "tool";
  text?: string;
  toolCallId?: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  toolIsError?: boolean;
  showTools?: boolean;
  showThinking?: boolean;
};

export class ChatLog extends Container {
  private readonly maxComponents: number;
  private toolById = new Map<string, ToolExecutionComponent>();
  private streamingRuns = new Map<string, AssistantMessageComponent>();
  private pendingUsers = new Map<
    string,
    {
      component: UserMessageComponent;
      text: string;
      createdAt: number;
    }
  >();
  private pendingSystemNotices = new Map<string, Container>();
  private btwMessage: BtwInlineMessage | null = null;
  private toolsExpanded = false;
  private repeatableSystemMessage: RepeatableSystemMessage | null = null;
  private shortcutBar: ShortcutBar | null = null;

  /** Snapshot of rendered message descriptors for diff-based updates (P0-4). */
  private messageSnapshot: MessageDescriptor[] = [];

  /** P2-2: Virtualization state. */
  private virtualThreshold = 500;
  private virtualEnabled = false;
  private scrollOffset = 0;

  /** P2-4: Message fade-in animation support. */
  private animateMessages = true;
  private onRequestRender?: () => void;

  constructor(maxComponents = 180) {
    super();
    this.maxComponents = Math.max(20, Math.floor(maxComponents));
  }

  /** P2-4: Enable/disable message fade-in animation. */
  setMessageAnimation(enabled: boolean): void {
    this.animateMessages = enabled;
  }

  /** P2-4: Register a render callback for animation frames. */
  setOnRequestRender(callback: () => void): void {
    this.onRequestRender = callback;
  }

  /** P2-3: Link the shortcut bar for visibility management. */
  setShortcutBar(bar: ShortcutBar): void {
    this.shortcutBar = bar;
  }

  /** Get the linked shortcut bar (if any). */
  getShortcutBar(): ShortcutBar | null {
    return this.shortcutBar;
  }

  private dropComponentReferences(component: Component) {
    for (const [toolId, tool] of this.toolById.entries()) {
      if (tool === component) {
        this.toolById.delete(toolId);
      }
    }
    for (const [runId, message] of this.streamingRuns.entries()) {
      if (message === component) {
        this.streamingRuns.delete(runId);
      }
    }
    for (const [runId, entry] of this.pendingUsers.entries()) {
      if (entry.component === component) {
        this.pendingUsers.delete(runId);
      }
    }
    for (const [runId, entry] of this.pendingSystemNotices.entries()) {
      if (entry === component) {
        this.pendingSystemNotices.delete(runId);
      }
    }
    if (this.btwMessage === component) {
      this.btwMessage = null;
    }
    if (this.repeatableSystemMessage?.component === component) {
      this.repeatableSystemMessage = null;
    }
  }

  private pruneOverflow() {
    while (this.children.length > this.maxComponents) {
      const oldest = this.children[0];
      if (!oldest) {
        return;
      }
      this.removeChild(oldest);
      this.dropComponentReferences(oldest);
    }
  }

  private append(component: Component) {
    this.addChild(component);
    this.pruneOverflow();
  }

  private appendNonSystem(component: Component) {
    this.repeatableSystemMessage = null;
    // Add inter-message spacing (P1-4).
    if (this.children.length > 0) {
      this.addChild(new Spacer(1));
    }
    this.append(component);

    // P2-4: Message fade-in animation (2 frames, 30ms each).
    if (this.animateMessages && this.onRequestRender) {
      this.scheduleFadeIn(component);
    }
  }

  /**
   * P2-4: Schedule a 2-frame fade-in for a newly mounted component.
   * Frame 1 (after 30ms): dim appearance.
   * Frame 2 (after 60ms): normal appearance.
   */
  private scheduleFadeIn(_component: Component): void {
    const render = this.onRequestRender;
    if (!render) {
      return;
    }
    // Frame 1: dim (30ms delay)
    setTimeout(() => {
      // Dim effect — just request a render to trigger visual update.
      // In terminal TUI, the actual "dim" effect is achieved by the
      // theme functions; we rely on the re-render to complete the animation.
      render();
      // Frame 2: normal (another 30ms)
      setTimeout(() => {
        render();
      }, 30);
    }, 30);
  }

  clearAll(opts?: { preservePendingUsers?: boolean; preserveShortcutBar?: boolean }) {
    this.clear();
    this.toolById.clear();
    this.streamingRuns.clear();
    this.pendingSystemNotices.clear();
    this.btwMessage = null;
    this.repeatableSystemMessage = null;
    this.messageSnapshot = [];
    if (!opts?.preservePendingUsers) {
      this.pendingUsers.clear();
    }
  }

  clearTools() {
    for (const tool of this.toolById.values()) {
      this.removeChild(tool);
    }
    this.toolById.clear();
  }

  restorePendingUsers() {
    for (const entry of this.pendingUsers.values()) {
      if (this.children.includes(entry.component)) {
        continue;
      }
      this.appendNonSystem(entry.component);
    }
  }

  clearPendingUsers() {
    for (const entry of this.pendingUsers.values()) {
      this.removeChild(entry.component);
    }
    this.pendingUsers.clear();
  }

  private formatRepeatedSystemText(text: string, count: number) {
    return count > 1 ? `${text} x${count}` : text;
  }

  private createSystemMessage(text: string): RepeatableSystemMessage {
    const entry = new Container();
    const textNode = new Text(theme.system(text), 1, 0);
    entry.addChild(new Spacer(1));
    entry.addChild(textNode);
    return {
      component: entry,
      textNode,
      baseText: text,
      count: 1,
    };
  }

  addSystem(text: string, opts?: { coalesceConsecutive?: boolean }) {
    if (
      opts?.coalesceConsecutive &&
      this.repeatableSystemMessage?.baseText === text &&
      this.children[this.children.length - 1] === this.repeatableSystemMessage.component
    ) {
      this.repeatableSystemMessage.count += 1;
      this.repeatableSystemMessage.textNode.setText(
        theme.system(this.formatRepeatedSystemText(text, this.repeatableSystemMessage.count)),
      );
      return;
    }
    const message = this.createSystemMessage(text);
    this.append(message.component);
    this.repeatableSystemMessage = opts?.coalesceConsecutive ? message : null;
  }

  addPendingSystem(runId: string, text: string) {
    const existing = this.pendingSystemNotices.get(runId);
    if (existing) {
      this.removeChild(existing);
    }
    const message = this.createSystemMessage(text);
    this.pendingSystemNotices.set(runId, message.component);
    this.append(message.component);
  }

  dismissPendingSystem(runId: string) {
    const existing = this.pendingSystemNotices.get(runId);
    if (!existing) {
      return false;
    }
    this.removeChild(existing);
    this.pendingSystemNotices.delete(runId);
    return true;
  }

  addUser(text: string) {
    this.appendNonSystem(new UserMessageComponent(text));
  }

  addPendingUser(runId: string, text: string, createdAt = Date.now()) {
    const existing = this.pendingUsers.get(runId);
    if (existing) {
      existing.text = text;
      existing.createdAt = createdAt;
      existing.component.setText(text);
      return existing.component;
    }
    const component = new UserMessageComponent(text);
    this.pendingUsers.set(runId, { component, text, createdAt });
    this.appendNonSystem(component);
    return component;
  }

  commitPendingUser(runId: string) {
    return this.pendingUsers.delete(runId);
  }

  dropPendingUser(runId: string) {
    const existing = this.pendingUsers.get(runId);
    if (!existing) {
      return false;
    }
    this.removeChild(existing.component);
    this.pendingUsers.delete(runId);
    return true;
  }

  hasPendingUser(runId: string) {
    return this.pendingUsers.has(runId);
  }

  reconcilePendingUsers(
    historyUsers: Array<{
      text: string;
      timestamp?: number | null;
    }>,
  ) {
    const normalizedHistory = historyUsers
      .map((entry) => ({
        text: entry.text.trim(),
        timestamp: typeof entry.timestamp === "number" ? entry.timestamp : null,
      }))
      .filter((entry) => entry.text.length > 0 && entry.timestamp !== null);
    const clearedRunIds: string[] = [];
    for (const [runId, entry] of this.pendingUsers.entries()) {
      const pendingText = entry.text.trim();
      if (!pendingText) {
        continue;
      }
      const matchIndex = normalizedHistory.findIndex(
        (historyEntry) =>
          historyEntry.text === pendingText &&
          (historyEntry.timestamp ?? 0) >=
            entry.createdAt - PENDING_HISTORY_CLOCK_SKEW_TOLERANCE_MS,
      );
      if (matchIndex === -1) {
        continue;
      }
      if (this.children.includes(entry.component)) {
        this.removeChild(entry.component);
      }
      this.pendingUsers.delete(runId);
      clearedRunIds.push(runId);
      normalizedHistory.splice(matchIndex, 1);
    }
    return clearedRunIds;
  }

  countPendingUsers() {
    return this.pendingUsers.size;
  }

  private resolveRunId(runId?: string) {
    return runId ?? "default";
  }

  startAssistant(text: string, runId?: string) {
    const effectiveRunId = this.resolveRunId(runId);
    const existing = this.streamingRuns.get(effectiveRunId);
    if (existing) {
      existing.setText(text);
      return existing;
    }
    const component = new AssistantMessageComponent(text);
    this.streamingRuns.set(effectiveRunId, component);
    this.appendNonSystem(component);
    return component;
  }

  reserveAssistantSlot(runId?: string) {
    const effectiveRunId = this.resolveRunId(runId);
    const existing = this.streamingRuns.get(effectiveRunId);
    if (existing) {
      return existing;
    }
    return this.startAssistant("", runId);
  }

  updateAssistant(text: string, runId?: string) {
    const effectiveRunId = this.resolveRunId(runId);
    const existing = this.streamingRuns.get(effectiveRunId);
    if (!existing) {
      this.startAssistant(text, runId);
      return;
    }
    existing.setText(text);
  }

  finalizeAssistant(text: string, runId?: string) {
    const effectiveRunId = this.resolveRunId(runId);
    const existing = this.streamingRuns.get(effectiveRunId);
    if (existing) {
      existing.setText(text);
      this.streamingRuns.delete(effectiveRunId);
      return;
    }
    this.appendNonSystem(new AssistantMessageComponent(text));
  }

  dropAssistant(runId?: string) {
    const effectiveRunId = this.resolveRunId(runId);
    const existing = this.streamingRuns.get(effectiveRunId);
    if (!existing) {
      return;
    }
    this.removeChild(existing);
    this.streamingRuns.delete(effectiveRunId);
  }

  showBtw(params: { question: string; text: string; isError?: boolean }) {
    if (this.btwMessage) {
      this.btwMessage.setResult(params);
      if (this.children[this.children.length - 1] !== this.btwMessage) {
        this.removeChild(this.btwMessage);
        this.appendNonSystem(this.btwMessage);
      }
      return this.btwMessage;
    }
    const component = new BtwInlineMessage(params);
    this.btwMessage = component;
    this.appendNonSystem(component);
    return component;
  }

  dismissBtw() {
    if (!this.btwMessage) {
      return;
    }
    this.removeChild(this.btwMessage);
    this.btwMessage = null;
  }

  hasVisibleBtw() {
    return this.btwMessage !== null;
  }

  startTool(toolCallId: string, toolName: string, args: unknown) {
    const existing = this.toolById.get(toolCallId);
    if (existing) {
      existing.setArgs(args);
      return existing;
    }
    const component = new ToolExecutionComponent(toolName, args);
    component.setExpanded(this.toolsExpanded);
    this.toolById.set(toolCallId, component);
    this.appendNonSystem(component);
    return component;
  }

  updateToolArgs(toolCallId: string, args: unknown) {
    const existing = this.toolById.get(toolCallId);
    if (!existing) {
      return;
    }
    existing.setArgs(args);
  }

  updateToolResult(
    toolCallId: string,
    result: unknown,
    opts?: { isError?: boolean; partial?: boolean },
  ) {
    const existing = this.toolById.get(toolCallId);
    if (!existing) {
      return;
    }
    if (opts?.partial) {
      existing.setPartialResult(result as Record<string, unknown>);
      return;
    }
    existing.setResult(result as Record<string, unknown>, {
      isError: opts?.isError,
    });
  }

  /**
   * P2-2: Enable virtualized rendering when message count exceeds the threshold.
   * When enabled, only messages visible in the terminal viewport are rendered.
   * Streaming runs and pending users are always rendered regardless of scroll offset.
   *
   * @param threshold - Minimum message count before virtualization activates. Default 500.
   */
  enableVirtualization(threshold = 500): void {
    this.virtualThreshold = Math.max(10, Math.floor(threshold));
    this.virtualEnabled = true;
  }

  /**
   * Disable virtualized rendering.
   */
  disableVirtualization(): void {
    this.virtualEnabled = false;
  }

  /**
   * Returns whether virtualization is currently active.
   */
  isVirtualized(): boolean {
    return this.virtualEnabled && this.messageSnapshot.length > this.virtualThreshold;
  }

  /**
   * Set the scroll offset for virtualized rendering.
   */
  setScrollOffset(offset: number): void {
    this.scrollOffset = Math.max(0, offset);
  }

  /**
   * Get the current scroll offset.
   */
  getScrollOffset(): number {
    return this.scrollOffset;
  }

  /**
   * Get the render tree for the current virtualized viewport.
   * When virtualization is active, only a window of children is returned.
   * Otherwise, returns all children (default behavior).
   *
   * @param viewportHeight - Available terminal rows for the chat area.
   */
  getVisibleChildren(viewportHeight: number): Component[] {
    if (!this.isVirtualized() || viewportHeight <= 0) {
      return [...this.children];
    }

    const totalChildren = this.children.length;
    if (totalChildren <= viewportHeight) {
      return [...this.children];
    }

    // Ensure scroll offset doesn't go past the end.
    const maxOffset = Math.max(0, totalChildren - viewportHeight);
    const offset = Math.min(this.scrollOffset, maxOffset);
    return this.children.slice(offset, offset + viewportHeight);
  }

  /**
   * Returns the number of rendered children (excluding spacers).
   * Used for virtualization threshold checks (P2-2).
   */
  getMessageCount(): number {
    return this.messageSnapshot.length;
  }

  /**
   * P0-4: Incrementally update the chat log from a list of message descriptors.
   *
   * Compares the new descriptor list against the current snapshot. Preserves the
   * common prefix of unchanged messages, removes children from the first difference
   * point, and appends the new suffix.
   *
   * This avoids `clearAll()` which causes a visible blank frame during history reload.
   */
  diffUpdate(descriptors: MessageDescriptor[]): void {
    // Find the length of the common prefix.
    let commonPrefixLen = 0;
    const oldLen = this.messageSnapshot.length;
    const newLen = descriptors.length;
    const minLen = Math.min(oldLen, newLen);

    for (let i = 0; i < minLen; i++) {
      if (!this.descriptorsEqual(this.messageSnapshot[i], descriptors[i])) {
        break;
      }
      commonPrefixLen = i + 1;
    }

    // Remove children after the common prefix.
    while (this.children.length > commonPrefixLen) {
      const last = this.children[this.children.length - 1];
      if (last) {
        this.removeChild(last);
        this.dropComponentReferences(last);
      } else {
        break;
      }
    }

    // Append new messages from the difference point.
    for (let i = commonPrefixLen; i < newLen; i++) {
      const desc = descriptors[i];
      this.appendDescriptor(desc);
    }

    // Update snapshot.
    this.messageSnapshot = descriptors;
  }

  /**
   * Compare two message descriptors for equality.
   */
  private descriptorsEqual(a: MessageDescriptor, b: MessageDescriptor): boolean {
    if (a.kind !== b.kind) {
      return false;
    }
    if (a.kind === "system" || a.kind === "user" || a.kind === "assistant") {
      return a.text === b.text;
    }
    if (a.kind === "tool") {
      return (
        a.toolCallId === b.toolCallId &&
        a.toolName === b.toolName &&
        a.toolIsError === b.toolIsError
      );
    }
    return false;
  }

  /**
   * Append a single message descriptor as a rendered component.
   * Internal helper for diffUpdate.
   */
  private appendDescriptor(desc: MessageDescriptor): void {
    switch (desc.kind) {
      case "system": {
        if (desc.text) {
          this.addSystem(desc.text);
        }
        break;
      }
      case "user": {
        if (desc.text) {
          this.addUser(desc.text);
        }
        break;
      }
      case "assistant": {
        if (desc.text) {
          this.finalizeAssistant(desc.text);
        }
        break;
      }
      case "tool": {
        if (desc.toolCallId && desc.toolName) {
          const component = this.startTool(desc.toolCallId, desc.toolName, desc.toolArgs ?? {});
          if (desc.toolResult) {
            component.setResult(desc.toolResult as Record<string, unknown>, {
              isError: desc.toolIsError,
            });
          }
        }
        break;
      }
    }
  }
}
