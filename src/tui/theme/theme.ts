import type {
  EditorTheme,
  MarkdownTheme,
  SelectListTheme,
  SettingsListTheme,
} from "@earendil-works/pi-tui";
import { normalizeOptionalLowercaseString } from "@openclaw/normalization-core/string-coerce";
import chalk from "chalk";
import { mergePalette, validateHexColor } from "./custom-theme.js";
import type { SearchableSelectListTheme } from "../components/searchable-select-list.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface Palette {
  text: string;
  bg: string;
  dim: string;
  accent: string;
  accentSoft: string;
  border: string;
  userBg: string;
  userText: string;
  systemText: string;
  toolPendingBg: string;
  toolSuccessBg: string;
  toolErrorBg: string;
  toolTitle: string;
  toolOutput: string;
  quote: string;
  quoteBorder: string;
  code: string;
  codeBlock: string;
  codeBorder: string;
  link: string;
  error: string;
  success: string;
  shortcutBarBg: string;
  shortcutKey: string;
  shortcutHint: string;
}

export interface CustomThemeConfig {
  darkPalette?: Partial<Palette>;
  lightPalette?: Partial<Palette>;
  shortcutBarVisible?: boolean;
  waitingMode?: "static" | "shimmer";
}

// ── Luminance helpers ──────────────────────────────────────────────────────

const DARK_TEXT = "#E8DDD0";
const LIGHT_TEXT = "#3D3226";
const XTERM_LEVELS = [0, 95, 135, 175, 215, 255] as const;

function channelToSrgb(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminanceRgb(r: number, g: number, b: number): number {
  const red = channelToSrgb(r);
  const green = channelToSrgb(g);
  const blue = channelToSrgb(b);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function relativeLuminanceHex(hex: string): number {
  return relativeLuminanceRgb(
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  );
}

function contrastRatio(background: number, foregroundHex: string): number {
  const foreground = relativeLuminanceHex(foregroundHex);
  const lighter = Math.max(background, foreground);
  const darker = Math.min(background, foreground);
  return (lighter + 0.05) / (darker + 0.05);
}

function pickHigherContrastText(r: number, g: number, b: number): boolean {
  const background = relativeLuminanceRgb(r, g, b);
  return contrastRatio(background, LIGHT_TEXT) >= contrastRatio(background, DARK_TEXT);
}

function isLightBackground(): boolean {
  const explicit = normalizeOptionalLowercaseString(process.env.OPENCLAW_THEME);
  if (explicit === "light") {
    return true;
  }
  if (explicit === "dark") {
    return false;
  }

  const colorfgbg = process.env.COLORFGBG;
  if (colorfgbg && colorfgbg.length <= 64) {
    const sep = colorfgbg.lastIndexOf(";");
    const bg = Number.parseInt(sep >= 0 ? colorfgbg.slice(sep + 1) : colorfgbg, 10);
    if (bg >= 0 && bg <= 255) {
      if (bg <= 15) {
        return bg === 7 || bg === 15;
      }
      if (bg >= 232) {
        return bg >= 244;
      }
      const cubeIndex = bg - 16;
      const bVal = XTERM_LEVELS[cubeIndex % 6];
      const gVal = XTERM_LEVELS[Math.floor(cubeIndex / 6) % 6];
      const rVal = XTERM_LEVELS[Math.floor(cubeIndex / 36)];
      return pickHigherContrastText(rVal, gVal, bVal);
    }
  }
  return false;
}

/** Whether the terminal has a light background. Exported for testing only. */
export const lightMode = isLightBackground();

// ── Base Palettes (warm-tone redesign per PRD §4.1) ────────────────────────

export const darkPalette: Palette = {
  text: "#E8DDD0",
  bg: "#1E1C1A",
  dim: "#A09888",
  accent: "#D4A853",
  accentSoft: "#5C4A2E",
  border: "#4A4238",
  userBg: "#3D352A",
  userText: "#E8DDD0",
  systemText: "#A09888",
  toolPendingBg: "#2D2822",
  toolSuccessBg: "#1E2A22",
  toolErrorBg: "#2D1E1E",
  toolTitle: "#C8A44E",
  toolOutput: "#C8C0B8",
  quote: "#A09888",
  quoteBorder: "#4A4238",
  code: "#D4A853",
  codeBlock: "#252220",
  codeBorder: "#3D352A",
  link: "#7DC4A4",
  error: "#E0735A",
  success: "#7DC4A4",
  shortcutBarBg: "#252220",
  shortcutKey: "#D4A853",
  shortcutHint: "#6E6058",
};

export const lightPalette: Palette = {
  text: "#3D3226",
  bg: "#FBF7F0",
  dim: "#8C7E6E",
  accent: "#B8751F",
  accentSoft: "#D4B896",
  border: "#D4C8B0",
  userBg: "#F0E8D8",
  userText: "#3D3226",
  systemText: "#6E6058",
  toolPendingBg: "#F5EEE0",
  toolSuccessBg: "#EDF5EE",
  toolErrorBg: "#F5E8E8",
  toolTitle: "#B8751F",
  toolOutput: "#5C4A3A",
  quote: "#6E6058",
  quoteBorder: "#D4C8B0",
  code: "#B8751F",
  codeBlock: "#F5F0E8",
  codeBorder: "#E0D5C0",
  link: "#3D8C6A",
  error: "#C04A3A",
  success: "#3D8C6A",
  shortcutBarBg: "#F0E8D8",
  shortcutKey: "#B8751F",
  shortcutHint: "#A09080",
};

// ── Active palette (mutable, so loadCustomTheme can merge overrides) ────────

/** Active palette. Mutated by loadCustomTheme() to apply user overrides. */
export const palette: Palette = { ...(lightMode ? lightPalette : darkPalette) };

// ── Custom theme loading ───────────────────────────────────────────────────

/**
 * Apply custom theme overrides from openclaw.json's `tui` field.
 * Called once during TUI initialization, before any rendering.
 *
 * Uses deep merge (mergePalette) so nested palette values are properly
 * combined with user-provided overrides. Also validates hex colors.
 *
 * @param custom - The `config.tui` object from runtime config.
 */
export function loadCustomTheme(custom?: CustomThemeConfig | null): void {
  if (!custom) {
    return;
  }
  const source = lightMode ? custom.lightPalette : custom.darkPalette;
  if (!source) {
    return;
  }
  // T04: Deep merge with validation via mergePalette.
  // Filter out invalid hex values before merging.
  const validated: Partial<Palette> = {};
  const keys = Object.keys(source) as (keyof Palette)[];
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) {
      if (validateHexColor(value)) {
        validated[key] = value;
      }
    }
  }
  const merged = mergePalette(palette, validated);
  // Update the active palette in-place to preserve all references.
  const paletteKeys = Object.keys(palette) as (keyof Palette)[];
  for (const key of paletteKeys) {
    (palette as Record<string, string>)[key] = merged[key];
  }
}

/**
 * Resolve the final palette after custom overrides.
 * In T04 this will call mergePalette for deep merge support;
 * for T01 it returns the already-merged palette.
 */
export function resolveCustomPalette(): Palette {
  return palette;
}

// ── Theme functions ────────────────────────────────────────────────────────

const fg = (hex: string) => (text: string) => chalk.hex(hex)(text);
const bg = (hex: string) => (text: string) => chalk.bgHex(hex)(text);

/**
 * Render code blocks with the theme code color without pulling a parser into the base TUI path.
 * Returns an array of lines with ANSI escape codes.
 */
function highlightCode(code: string): string[] {
  return code.split("\n").map((line) => fg(palette.code)(line));
}

export const theme = {
  fg: fg(palette.text),
  assistantText: (text: string) => text,
  dim: fg(palette.dim),
  accent: fg(palette.accent),
  accentSoft: fg(palette.accentSoft),
  success: fg(palette.success),
  error: fg(palette.error),
  header: (text: string) => chalk.bold(fg(palette.accent)(text)),
  system: fg(palette.systemText),
  userBg: bg(palette.userBg),
  userText: fg(palette.userText),
  toolTitle: fg(palette.toolTitle),
  toolOutput: fg(palette.toolOutput),
  toolPendingBg: bg(palette.toolPendingBg),
  toolSuccessBg: bg(palette.toolSuccessBg),
  toolErrorBg: bg(palette.toolErrorBg),
  border: fg(palette.border),
  bold: (text: string) => chalk.bold(text),
  italic: (text: string) => chalk.italic(text),
  shortcutKey: fg(palette.shortcutKey),
  shortcutHint: fg(palette.shortcutHint),
  shortcutBarBg: bg(palette.shortcutBarBg),
};

// ── Sub-themes ─────────────────────────────────────────────────────────────

export const markdownTheme: MarkdownTheme = {
  heading: (text) => chalk.bold(fg(palette.accent)(text)),
  link: (text) => fg(palette.link)(text),
  linkUrl: (text) => chalk.dim(text),
  code: (text) => fg(palette.code)(text),
  codeBlock: (text) => fg(palette.code)(text),
  codeBlockBorder: (text) => fg(palette.codeBorder)(text),
  quote: (text) => fg(palette.quote)(text),
  quoteBorder: (text) => fg(palette.quoteBorder)(text),
  hr: (text) => fg(palette.border)(text),
  listBullet: (text) => fg(palette.accentSoft)(text),
  bold: (text) => chalk.bold(text),
  italic: (text) => chalk.italic(text),
  strikethrough: (text) => chalk.strikethrough(text),
  underline: (text) => chalk.underline(text),
  highlightCode,
};

const baseSelectListTheme: SelectListTheme = {
  selectedPrefix: (text) => fg(palette.accent)(text),
  selectedText: (text) => chalk.bold(fg(palette.accent)(text)),
  description: (text) => fg(palette.dim)(text),
  scrollInfo: (text) => fg(palette.dim)(text),
  noMatch: (text) => fg(palette.dim)(text),
};

export const selectListTheme: SelectListTheme = baseSelectListTheme;

export const filterableSelectListTheme = {
  ...baseSelectListTheme,
  filterLabel: (text: string) => fg(palette.dim)(text),
};

export const settingsListTheme: SettingsListTheme = {
  label: (text, selected) =>
    selected ? chalk.bold(fg(palette.accent)(text)) : fg(palette.text)(text),
  value: (text, selected) => (selected ? fg(palette.accentSoft)(text) : fg(palette.dim)(text)),
  description: (text) => fg(palette.systemText)(text),
  cursor: fg(palette.accent)("→ "),
  hint: (text) => fg(palette.dim)(text),
};

export const editorTheme: EditorTheme = {
  borderColor: (text) => fg(palette.border)(text),
  selectList: selectListTheme,
};

export const searchableSelectListTheme: SearchableSelectListTheme = {
  ...baseSelectListTheme,
  searchPrompt: (text) => fg(palette.accentSoft)(text),
  searchInput: (text) => fg(palette.text)(text),
  matchHighlight: (text) => chalk.bold(fg(palette.accent)(text)),
};
