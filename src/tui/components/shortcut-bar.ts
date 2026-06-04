import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.js";

/** A single shortcut entry in the bar. */
type ShortcutEntry = {
  key: string;
  label: string;
};

const DEFAULT_SHORTCUTS: ShortcutEntry[] = [
  { key: "Ctrl+O", label: "展开工具" },
  { key: "Esc", label: "中止" },
  { key: "Ctrl+C", label: "退出" },
  { key: "Ctrl+L", label: "模型" },
  { key: "Ctrl+G", label: "智能体" },
];

/**
 * Bottom shortcut bar component. Renders a single line showing keyboard
 * shortcuts with color-coded keys and hint labels.
 *
 * Inherits from Container per the component inheritance model.
 */
export class ShortcutBar extends Container {
  private visible: boolean;
  private textNode: Text | null = null;
  private entries: ShortcutEntry[];

  constructor(entries?: ShortcutEntry[]) {
    super();
    this.visible = true;
    this.entries = entries ?? DEFAULT_SHORTCUTS;
    this.renderContent();
  }

  /**
   * Show or hide the shortcut bar.
   */
  setVisible(visible: boolean): void {
    if (this.visible === visible) {
      return;
    }
    this.visible = visible;
    this.clear();
    this.textNode = null;
    if (visible) {
      this.renderContent();
    }
  }

  /**
   * Update the shortcut entries.
   */
  setEntries(entries: ShortcutEntry[]): void {
    this.entries = entries;
    if (this.visible) {
      this.clear();
      this.textNode = null;
      this.renderContent();
    }
  }

  /**
   * Returns whether the shortcut bar is currently visible.
   */
  isVisible(): boolean {
    return this.visible;
  }

  private renderContent(): void {
    if (!this.visible) {
      return;
    }

    const parts: string[] = [];
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      const coloredKey = theme.shortcutKey(entry.key);
      const coloredLabel = theme.shortcutHint(entry.label);
      parts.push(`${coloredKey} ${coloredLabel}`);
    }

    const barText = parts.join(` ${theme.shortcutHint("|")} `);

    // Add top border spacer and the bar text.
    this.addChild(new Spacer(0));
    const container = new Container();
    const bgLine = theme.shortcutBarBg(" ");
    this.textNode = new Text(`${bgLine}${barText}`, 1, 0);
    container.addChild(this.textNode);
    this.addChild(container);
  }
}
