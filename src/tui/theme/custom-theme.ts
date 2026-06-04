import type { Palette } from "./theme.js";

/**
 * Shallow-merge a custom palette partial onto the base palette.
 * For T01 this does a simple key-level merge.
 * T04 enhances with deep merge via mergePalette().
 *
 * @param base - The base palette (darkPalette or lightPalette).
 * @param custom - User-provided partial palette overrides.
 * @returns A new Palette with custom values merged over base.
 */
export function mergeCustomTheme(base: Palette, custom: Partial<Palette>): Palette {
  const result: Palette = { ...base };
  const keys = Object.keys(custom) as (keyof Palette)[];
  for (const key of keys) {
    const value = custom[key];
    if (typeof value === "string" && value.length > 0) {
      (result as Record<string, string>)[key] = value;
    }
  }
  return result;
}

/**
 * Deep-merge a partial palette onto a base palette (T04).
 *
 * Unlike mergeCustomTheme (shallow), this performs field-level merging
 * so that any nested future palette extensions are properly combined.
 * For the current flat Palette structure this is equivalent to shallow merge,
 * but the function is designed to support future nested palette structures.
 *
 * @param base - The base palette.
 * @param custom - Partial overrides to merge in.
 * @returns A new Palette with custom values deep-merged over base.
 */
export function mergePalette(base: Palette, custom: Partial<Palette>): Palette {
  const result: Palette = { ...base };
  const keys = Object.keys(custom) as (keyof Palette)[];
  for (const key of keys) {
    const value = custom[key];
    if (typeof value === "string" && value.length > 0) {
      // For flat string values, shallow assignment is sufficient.
      // Future nested structures would use recursive merge here.
      (result as Record<string, string>)[key] = value;
    }
  }
  return result;
}

/**
 * Validate that a string is a valid 6-character hex color.
 * Accepts leading `#` followed by exactly 6 hex digits.
 *
 * @param s - The string to validate.
 * @returns true if the string is a valid hex color.
 */
export function validateHexColor(s: string): boolean {
  if (typeof s !== "string") {
    return false;
  }
  return /^#[0-9a-fA-F]{6}$/.test(s);
}

/**
 * Validate all color values in a partial palette.
 * Returns an array of invalid keys (empty if all valid).
 *
 * @param custom - The partial palette to validate.
 * @returns Array of keys with invalid hex values.
 */
export function validateCustomPalette(custom: Partial<Palette>): string[] {
  const invalid: string[] = [];
  const keys = Object.keys(custom) as (keyof Palette)[];
  for (const key of keys) {
    const value = custom[key];
    if (typeof value === "string" && !validateHexColor(value)) {
      invalid.push(key);
    }
  }
  return invalid;
}

/**
 * Extract TUI-level config flags from a CustomThemeConfig.
 * These are non-palette settings that affect TUI behavior.
 */
export function extractCustomTuiFlags(custom?: {
  darkPalette?: Partial<Palette>;
  lightPalette?: Partial<Palette>;
  shortcutBarVisible?: boolean;
  waitingMode?: "static" | "shimmer";
} | null): {
  shortcutBarVisible?: boolean;
  waitingMode?: "static" | "shimmer";
} {
  if (!custom) {
    return {};
  }
  return {
    shortcutBarVisible: custom.shortcutBarVisible,
    waitingMode: custom.waitingMode,
  };
}
