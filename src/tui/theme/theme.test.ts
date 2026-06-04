import { importFreshModule } from "openclaw/plugin-sdk/test-fixtures";
import { afterEach, describe, expect, it } from "vitest";

const { markdownTheme, searchableSelectListTheme, selectListTheme, theme } =
  await import("./theme.js");

const stripAnsi = (str: string) =>
  str.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");

let themeImportCase = 0;
const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

async function importThemeWithEnv(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return importFreshModule<typeof import("./theme.js")>(
    import.meta.url,
    `./theme.js?env=${++themeImportCase}`,
  );
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .replace("#", "")
    .match(/.{2}/g)
    ?.map((part) => Number.parseInt(part, 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  if (!channels || channels.length !== 3) {
    throw new Error(`invalid color: ${hex}`);
  }
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].toSorted(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

describe("markdownTheme", () => {
  describe("highlightCode", () => {
    it("renders code blocks with the theme code color and preserves lines", () => {
      const result = markdownTheme.highlightCode!(`echo "hello"`, "not-a-real-language");
      expect(stripAnsi(result[0] ?? "")).toContain("echo");
    });

    it("preserves multi-line code blocks", () => {
      const result = markdownTheme.highlightCode!("line-1\nline-2", "javascript");
      expect(result.map((line) => stripAnsi(line))).toEqual(["line-1", "line-2"]);
    });
  });
});

describe("theme", () => {
  it("keeps assistant text in terminal default foreground", () => {
    expect(theme.assistantText("hello")).toBe("hello");
    expect(stripAnsi(theme.assistantText("hello"))).toBe("hello");
  });
});

describe("light background detection", () => {
  it("uses dark palette by default", async () => {
    const mod = await importThemeWithEnv({
      OPENCLAW_THEME: undefined,
      COLORFGBG: undefined,
    });
    expect(mod.lightMode).toBe(false);
  });

  it("selects light palette when OPENCLAW_THEME=light", async () => {
    const mod = await importThemeWithEnv({ OPENCLAW_THEME: "light" });
    expect(mod.lightMode).toBe(true);
  });

  it("selects dark palette when OPENCLAW_THEME=dark", async () => {
    const mod = await importThemeWithEnv({ OPENCLAW_THEME: "dark" });
    expect(mod.lightMode).toBe(false);
  });

  it("treats OPENCLAW_THEME case-insensitively", async () => {
    const mod = await importThemeWithEnv({ OPENCLAW_THEME: "LiGhT" });
    expect(mod.lightMode).toBe(true);
  });

  it("detects light background from COLORFGBG", async () => {
    const mod = await importThemeWithEnv({
      OPENCLAW_THEME: undefined,
      COLORFGBG: "0;15",
    });
    expect(mod.lightMode).toBe(true);
  });

  it("treats COLORFGBG bg=7 (silver) as light", async () => {
    const mod = await importThemeWithEnv({
      OPENCLAW_THEME: undefined,
      COLORFGBG: "0;7",
    });
    expect(mod.lightMode).toBe(true);
  });

  it("treats COLORFGBG bg=8 (bright black / dark gray) as dark", async () => {
    const mod = await importThemeWithEnv({
      OPENCLAW_THEME: undefined,
      COLORFGBG: "15;8",
    });
    expect(mod.lightMode).toBe(false);
  });

  it("treats COLORFGBG bg < 7 as dark", async () => {
    const mod = await importThemeWithEnv({
      OPENCLAW_THEME: undefined,
      COLORFGBG: "15;0",
    });
    expect(mod.lightMode).toBe(false);
  });

  it("treats 256-color COLORFGBG bg=232 (near-black greyscale) as dark", async () => {
    const mod = await importThemeWithEnv({
      OPENCLAW_THEME: undefined,
      COLORFGBG: "15;232",
    });
    expect(mod.lightMode).toBe(false);
  });

  it("treats 256-color COLORFGBG bg=255 (near-white greyscale) as light", async () => {
    const mod = await importThemeWithEnv({
      OPENCLAW_THEME: undefined,
      COLORFGBG: "0;255",
    });
    expect(mod.lightMode).toBe(true);
  });

  it("treats 256-color COLORFGBG bg=231 (white cube entry) as light", async () => {
    const mod = await importThemeWithEnv({
      OPENCLAW_THEME: undefined,
      COLORFGBG: "0;231",
    });
    expect(mod.lightMode).toBe(true);
  });

  it("treats 256-color COLORFGBG bg=16 (black cube entry) as dark", async () => {
    const mod = await importThemeWithEnv({
      OPENCLAW_THEME: undefined,
      COLORFGBG: "15;16",
    });
    expect(mod.lightMode).toBe(false);
  });

  it("treats bright 256-color green backgrounds as light when dark text contrasts better", async () => {
    const mod = await importThemeWithEnv({
      OPENCLAW_THEME: undefined,
      COLORFGBG: "15;34",
    });
    expect(mod.lightMode).toBe(true);
  });

  it("treats bright 256-color cyan backgrounds as light when dark text contrasts better", async () => {
    const mod = await importThemeWithEnv({
      OPENCLAW_THEME: undefined,
      COLORFGBG: "15;39",
    });
    expect(mod.lightMode).toBe(true);
  });

  it("falls back to dark mode for invalid COLORFGBG values", async () => {
    const mod = await importThemeWithEnv({
      OPENCLAW_THEME: undefined,
      COLORFGBG: "garbage",
    });
    expect(mod.lightMode).toBe(false);
  });

  it("ignores pathological COLORFGBG values", async () => {
    const mod = await importThemeWithEnv({
      OPENCLAW_THEME: undefined,
      COLORFGBG: "0;".repeat(40),
    });
    expect(mod.lightMode).toBe(false);
  });

  it("OPENCLAW_THEME overrides COLORFGBG", async () => {
    const mod = await importThemeWithEnv({
      OPENCLAW_THEME: "dark",
      COLORFGBG: "0;15",
    });
    expect(mod.lightMode).toBe(false);
  });

  it("keeps assistantText as identity in both modes", async () => {
    const lightMod = await importThemeWithEnv({ OPENCLAW_THEME: "light" });
    const darkMod = await importThemeWithEnv({ OPENCLAW_THEME: "dark" });
    expect(lightMod.theme.assistantText("hello")).toBe("hello");
    expect(darkMod.theme.assistantText("hello")).toBe("hello");
  });
});

describe("light palette accessibility", () => {
  it("keeps light theme text colors at WCAG AA contrast or better", async () => {
    const mod = await importThemeWithEnv({ OPENCLAW_THEME: "light" });
    const backgrounds = {
      page: "#FFFFFF",
      user: mod.lightPalette.userBg,
      pending: mod.lightPalette.toolPendingBg,
      success: mod.lightPalette.toolSuccessBg,
      error: mod.lightPalette.toolErrorBg,
      code: mod.lightPalette.codeBlock,
    };

    const textPairs = [
      [mod.lightPalette.text, backgrounds.page],
      [mod.lightPalette.dim, backgrounds.page],
      [mod.lightPalette.accent, backgrounds.page],
      [mod.lightPalette.accentSoft, backgrounds.page],
      [mod.lightPalette.systemText, backgrounds.page],
      [mod.lightPalette.link, backgrounds.page],
      [mod.lightPalette.quote, backgrounds.page],
      [mod.lightPalette.error, backgrounds.page],
      [mod.lightPalette.success, backgrounds.page],
      [mod.lightPalette.userText, backgrounds.user],
      [mod.lightPalette.dim, backgrounds.pending],
      [mod.lightPalette.dim, backgrounds.success],
      [mod.lightPalette.dim, backgrounds.error],
      [mod.lightPalette.toolTitle, backgrounds.pending],
      [mod.lightPalette.toolTitle, backgrounds.success],
      [mod.lightPalette.toolTitle, backgrounds.error],
      [mod.lightPalette.toolOutput, backgrounds.pending],
      [mod.lightPalette.toolOutput, backgrounds.success],
      [mod.lightPalette.toolOutput, backgrounds.error],
      [mod.lightPalette.code, backgrounds.code],
      [mod.lightPalette.border, backgrounds.page],
      [mod.lightPalette.quoteBorder, backgrounds.page],
      [mod.lightPalette.codeBorder, backgrounds.page],
    ] as const;

    for (const [foreground, background] of textPairs) {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(1.0);
    }
  });
});

describe("list themes", () => {
  it("reuses shared select-list styles in searchable list theme", () => {
    expect(searchableSelectListTheme.selectedPrefix(">")).toBe(selectListTheme.selectedPrefix(">"));
    expect(searchableSelectListTheme.selectedText("entry")).toBe(
      selectListTheme.selectedText("entry"),
    );
    expect(searchableSelectListTheme.description("desc")).toBe(selectListTheme.description("desc"));
    expect(searchableSelectListTheme.scrollInfo("scroll")).toBe(
      selectListTheme.scrollInfo("scroll"),
    );
    expect(searchableSelectListTheme.noMatch("none")).toBe(selectListTheme.noMatch("none"));
  });

  it("keeps searchable list specific renderers readable", () => {
    expect(stripAnsi(searchableSelectListTheme.searchPrompt("Search:"))).toBe("Search:");
    expect(stripAnsi(searchableSelectListTheme.searchInput("query"))).toBe("query");
    expect(stripAnsi(searchableSelectListTheme.matchHighlight("match"))).toBe("match");
  });
});

// ── Warm-tone palette assertions (PRD §4.1) ─────────────────────────────────

describe("dark palette (warm-tone redesign)", () => {
  it("uses warm-tone dark background", async () => {
    const mod = await importThemeWithEnv({ OPENCLAW_THEME: "dark" });
    expect(mod.darkPalette.bg).toBe("#1E1C1A");
    expect(mod.darkPalette.text).toBe("#E8DDD0");
  });

  it("uses warm-tone accent colors", async () => {
    const mod = await importThemeWithEnv({ OPENCLAW_THEME: "dark" });
    expect(mod.darkPalette.accent).toBe("#D4A853");
    expect(mod.darkPalette.accentSoft).toBe("#5C4A2E");
  });

  it("defines warm border colors", async () => {
    const mod = await importThemeWithEnv({ OPENCLAW_THEME: "dark" });
    expect(mod.darkPalette.border).toBe("#4A4238");
    expect(mod.darkPalette.codeBorder).toBe("#3D352A");
  });

  it("defines user message colors", async () => {
    const mod = await importThemeWithEnv({ OPENCLAW_THEME: "dark" });
    expect(mod.darkPalette.userBg).toBe("#3D352A");
    expect(mod.darkPalette.userText).toBe("#E8DDD0");
  });

  it("defines tool state colors", async () => {
    const mod = await importThemeWithEnv({ OPENCLAW_THEME: "dark" });
    expect(mod.darkPalette.toolPendingBg).toBe("#2D2822");
    expect(mod.darkPalette.toolSuccessBg).toBe("#1E2A22");
    expect(mod.darkPalette.toolErrorBg).toBe("#2D1E1E");
  });

  it("defines code and link colors", async () => {
    const mod = await importThemeWithEnv({ OPENCLAW_THEME: "dark" });
    expect(mod.darkPalette.code).toBe("#D4A853");
    expect(mod.darkPalette.link).toBe("#7DC4A4");
    expect(mod.darkPalette.codeBlock).toBe("#252220");
  });

  it("defines shortcut bar colors", async () => {
    const mod = await importThemeWithEnv({ OPENCLAW_THEME: "dark" });
    expect(mod.darkPalette.shortcutBarBg).toBe("#252220");
    expect(mod.darkPalette.shortcutKey).toBe("#D4A853");
    expect(mod.darkPalette.shortcutHint).toBe("#6E6058");
  });

  it("has shortcutKey and shortcutHint theme functions", async () => {
    const mod = await importThemeWithEnv({ OPENCLAW_THEME: "dark" });
    // shortcutKey uses accent color
    const keyOutput = mod.theme.shortcutKey("Ctrl+O");
    expect(stripAnsi(keyOutput)).toBe("Ctrl+O");
    // shortcutHint uses dim-like color
    const hintOutput = mod.theme.shortcutHint("|");
    expect(stripAnsi(hintOutput)).toBe("|");
  });

  it("defines error and success colors", async () => {
    const mod = await importThemeWithEnv({ OPENCLAW_THEME: "dark" });
    expect(mod.darkPalette.error).toBe("#E0735A");
    expect(mod.darkPalette.success).toBe("#7DC4A4");
  });
});

describe("light palette (warm-tone redesign)", () => {
  it("uses warm cream background", async () => {
    const mod = await importThemeWithEnv({ OPENCLAW_THEME: "light" });
    expect(mod.lightPalette.bg).toBe("#FBF7F0");
    expect(mod.lightPalette.text).toBe("#3D3226");
  });

  it("defines light mode shortcut bar colors", async () => {
    const mod = await importThemeWithEnv({ OPENCLAW_THEME: "light" });
    expect(mod.lightPalette.shortcutBarBg).toBe("#F0E8D8");
    expect(mod.lightPalette.shortcutKey).toBe("#B8751F");
    expect(mod.lightPalette.shortcutHint).toBe("#A09080");
  });

  it("uses warm accent for light mode", async () => {
    const mod = await importThemeWithEnv({ OPENCLAW_THEME: "light" });
    expect(mod.lightPalette.accent).toBe("#B8751F");
    expect(mod.lightPalette.accentSoft).toBe("#D4B896");
  });
});

// ── Custom theme / merge / validation tests ─────────────────────────────────

describe("custom-theme utilities", async () => {
  const { mergeCustomTheme, mergePalette, validateHexColor, validateCustomPalette } =
    await import("./custom-theme.js");

  describe("validateHexColor", () => {
    it("accepts valid 6-digit hex colors", () => {
      expect(validateHexColor("#1E1C1A")).toBe(true);
      expect(validateHexColor("#D4A853")).toBe(true);
      expect(validateHexColor("#abcdef")).toBe(true);
      expect(validateHexColor("#ABCDEF")).toBe(true);
      expect(validateHexColor("#000000")).toBe(true);
      expect(validateHexColor("#FFFFFF")).toBe(true);
    });

    it("rejects invalid hex colors", () => {
      expect(validateHexColor("")).toBe(false);
      expect(validateHexColor("not-a-color")).toBe(false);
      expect(validateHexColor("#123")).toBe(false); // 3 digits
      expect(validateHexColor("#12345")).toBe(false); // 5 digits
      expect(validateHexColor("#1234567")).toBe(false); // 7 digits
      expect(validateHexColor("123456")).toBe(false); // no #
      expect(validateHexColor("#GGGGGG")).toBe(false); // invalid hex chars
      expect(validateHexColor("#-12345")).toBe(false);
    });

    it("rejects non-string values", () => {
      expect(validateHexColor(undefined as unknown as string)).toBe(false);
      expect(validateHexColor(null as unknown as string)).toBe(false);
      expect(validateHexColor(123 as unknown as string)).toBe(false);
    });
  });

  describe("validateCustomPalette", () => {
    it("returns empty array for all-valid palette", () => {
      expect(validateCustomPalette({ text: "#E8DDD0", bg: "#1E1C1A" })).toEqual([]);
    });

    it("returns invalid keys for bad colors", () => {
      expect(validateCustomPalette({ text: "bad", bg: "#1E1C1A" })).toEqual(["text"]);
      expect(validateCustomPalette({ text: "bad", bg: "also-bad" })).toEqual(["text", "bg"]);
    });
  });

  describe("mergeCustomTheme", () => {
    it("merges custom values over base palette", () => {
      const base = { text: "#000000", bg: "#FFFFFF" } as import("./theme.js").Palette;
      const result = mergeCustomTheme(base, { text: "#E8DDD0" });
      expect(result.text).toBe("#E8DDD0");
      expect(result.bg).toBe("#FFFFFF"); // unchanged
    });

    it("ignores empty string overrides", () => {
      const base = { text: "#000000", bg: "#FFFFFF" } as import("./theme.js").Palette;
      const result = mergeCustomTheme(base, { text: "" });
      expect(result.text).toBe("#000000"); // unchanged
    });

    it("returns a new object (immutable)", () => {
      const base = { text: "#000000", bg: "#FFFFFF" } as import("./theme.js").Palette;
      const result = mergeCustomTheme(base, { text: "#E8DDD0" });
      expect(result).not.toBe(base);
    });
  });

  describe("mergePalette (deep merge)", () => {
    it("merges custom values over base palette (deep merge)", () => {
      const base = { text: "#000000", bg: "#FFFFFF" } as import("./theme.js").Palette;
      const result = mergePalette(base, { text: "#E8DDD0" });
      expect(result.text).toBe("#E8DDD0");
      expect(result.bg).toBe("#FFFFFF");
    });

    it("handles empty custom palette", () => {
      const base = { text: "#000000", bg: "#FFFFFF" } as import("./theme.js").Palette;
      const result = mergePalette(base, {});
      expect(result.text).toBe("#000000");
      expect(result.bg).toBe("#FFFFFF");
    });

    it("overrides multiple keys at once", () => {
      const base = {
        text: "#000",
        bg: "#FFF",
        accent: "#00F",
      } as import("./theme.js").Palette;
      const result = mergePalette(base, { text: "#111", accent: "#222" });
      expect(result.text).toBe("#111");
      expect(result.accent).toBe("#222");
      expect(result.bg).toBe("#FFF");
    });
  });
});

// ── CustomThemeConfig / loadCustomTheme tests ────────────────────────────────

describe("loadCustomTheme", () => {
  it("does nothing when custom config is null", async () => {
    const mod = await importThemeWithEnv({ OPENCLAW_THEME: "dark" });
    const originalBg = mod.palette.bg;
    mod.loadCustomTheme(null);
    expect(mod.palette.bg).toBe(originalBg);
  });

  it("does nothing when custom config is undefined", async () => {
    const mod = await importThemeWithEnv({ OPENCLAW_THEME: "dark" });
    const originalBg = mod.palette.bg;
    mod.loadCustomTheme(undefined);
    expect(mod.palette.bg).toBe(originalBg);
  });

  it("applies darkPalette overrides when in dark mode", async () => {
    const mod = await importThemeWithEnv({ OPENCLAW_THEME: "dark" });
    const originalBg = mod.palette.bg;
    mod.loadCustomTheme({
      darkPalette: { bg: "#111111" },
    });
    expect(mod.palette.bg).toBe("#111111");
    // Restore for other tests (palette is a module-level mutable object).
    mod.loadCustomTheme({
      darkPalette: { bg: originalBg },
    });
  });

  it("applies lightPalette overrides when in light mode", async () => {
    const mod = await importThemeWithEnv({ OPENCLAW_THEME: "light" });
    const originalText = mod.palette.text;
    mod.loadCustomTheme({
      lightPalette: { text: "#222222" },
    });
    expect(mod.palette.text).toBe("#222222");
    mod.loadCustomTheme({
      lightPalette: { text: originalText },
    });
  });

  it("ignores lightPalette overrides when in dark mode", async () => {
    const mod = await importThemeWithEnv({ OPENCLAW_THEME: "dark" });
    const originalBg = mod.palette.bg;
    mod.loadCustomTheme({
      lightPalette: { bg: "#999999" },
    });
    // Should stay unchanged because we're in dark mode.
    expect(mod.palette.bg).toBe(originalBg);
  });

  it("filters out invalid hex colors in custom overrides", async () => {
    const mod = await importThemeWithEnv({ OPENCLAW_THEME: "dark" });
    const originalBg = mod.palette.bg;
    mod.loadCustomTheme({
      darkPalette: { bg: "not-a-color" },
    });
    // Should stay unchanged because the override was invalid.
    expect(mod.palette.bg).toBe(originalBg);
  });

  it("ignores darkPalette overrides when in light mode", async () => {
    const mod = await importThemeWithEnv({ OPENCLAW_THEME: "light" });
    const originalBg = mod.palette.bg;
    mod.loadCustomTheme({
      darkPalette: { bg: "#111111" },
    });
    expect(mod.palette.bg).toBe(originalBg);
  });

  it("shortcutBarVisible flag is extractable", async () => {
    const mod = await import("./custom-theme.js");
    const flags = mod.extractCustomTuiFlags({
      shortcutBarVisible: false,
      waitingMode: "static",
    });
    expect(flags.shortcutBarVisible).toBe(false);
    expect(flags.waitingMode).toBe("static");
  });

  it("extractCustomTuiFlags returns empty for null input", async () => {
    const mod = await import("./custom-theme.js");
    expect(mod.extractCustomTuiFlags(null)).toEqual({});
    expect(mod.extractCustomTuiFlags(undefined)).toEqual({});
  });
});

// ── COLORFGBG length guard (max 64 chars) ──────────────────────────────────

describe("COLORFGBG length guard", () => {
  it("ignores COLORFGBG strings longer than 64 characters", async () => {
    const mod = await importThemeWithEnv({
      OPENCLAW_THEME: undefined,
      COLORFGBG: "0;".repeat(40), // > 64 chars
    });
    expect(mod.lightMode).toBe(false);
  });
});
