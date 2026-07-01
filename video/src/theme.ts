/**
 * Apar brand tokens for the OS intro video.
 * Primary brand color (#ee3a24) is pulled straight from public/brand/apar-orange.svg.
 */
export const theme = {
  color: {
    // Brand
    brand: "#ee3a24",
    brandBright: "#ff5a41",
    brandDeep: "#c22a17",
    brandGlow: "rgba(238, 58, 36, 0.55)",

    // Dark cinematic backdrop
    bg: "#0a0b0d",
    bgDeep: "#050506",
    surface: "#14161a",
    surfaceRaised: "#1b1e24",
    stroke: "rgba(255, 255, 255, 0.08)",
    strokeStrong: "rgba(255, 255, 255, 0.14)",

    // Text
    text: "#f5f6f7",
    textMuted: "#9aa0a8",
    textFaint: "#5b616b",

    // Accents used in mock UI / charts
    green: "#3ecf8e",
    greenSoft: "rgba(62, 207, 142, 0.16)",
    amber: "#f5b942",
  },
  font: {
    // Loaded via @remotion/google-fonts (Inter) in fonts.ts
    sans: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono: "'SF Mono', 'JetBrains Mono', ui-monospace, monospace",
  },
  radius: {
    sm: 10,
    md: 16,
    lg: 24,
    xl: 32,
  },
} as const;

export type Theme = typeof theme;
