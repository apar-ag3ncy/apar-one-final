import React from "react";
import { theme } from "../theme";
import { AparLogo } from "./AparLogo";

/**
 * macOS-style desktop chrome pieces used to sell the "bookkeeping OS" idea.
 */

export const MenuBar: React.FC<{ title?: string }> = ({
  title = "Apar One",
}) => (
  <div
    style={{
      height: 34,
      display: "flex",
      alignItems: "center",
      gap: 22,
      padding: "0 18px",
      background: "rgba(20,16,14,0.66)",
      backdropFilter: "blur(20px)",
      borderBottom: `1px solid ${theme.color.stroke}`,
      color: theme.color.text,
      fontSize: 14,
      fontWeight: 600,
    }}
  >
    <AparLogo color={theme.color.brand} width={54} />
    <span style={{ fontWeight: 700 }}>{title}</span>
    {["File", "Ledger", "Reports", "Window", "Help"].map((m) => (
      <span key={m} style={{ color: theme.color.textMuted, fontWeight: 500 }}>
        {m}
      </span>
    ))}
    <div style={{ flex: 1 }} />
    <span style={{ color: theme.color.textMuted, fontWeight: 500 }}>
      100% · FY 25-26
    </span>
    <span style={{ color: theme.color.textMuted, fontWeight: 500 }}>
      Mon 9:41
    </span>
  </div>
);

export const TrafficLights: React.FC = () => (
  <div style={{ display: "flex", gap: 8 }}>
    {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
      <div
        key={c}
        style={{ width: 13, height: 13, borderRadius: 999, background: c }}
      />
    ))}
  </div>
);

export const Window: React.FC<{
  title: string;
  subtitle?: string;
  accent?: string;
  width?: number | string;
  height?: number | string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({
  title,
  subtitle,
  accent = theme.color.brand,
  width = 900,
  height,
  children,
  style,
}) => (
  <div
    style={{
      width,
      height,
      background: theme.color.surface,
      borderRadius: theme.radius.lg,
      border: `1px solid ${theme.color.strokeStrong}`,
      boxShadow:
        "0 40px 120px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.02) inset",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      ...style,
    }}
  >
    {/* title bar */}
    <div
      style={{
        height: 52,
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "0 18px",
        background: theme.color.surfaceRaised,
        borderBottom: `1px solid ${theme.color.stroke}`,
      }}
    >
      <TrafficLights />
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
        <span
          style={{ color: theme.color.text, fontSize: 16, fontWeight: 700 }}
        >
          {title}
        </span>
        {subtitle && (
          <span style={{ color: theme.color.textFaint, fontSize: 12 }}>
            {subtitle}
          </span>
        )}
      </div>
      <div style={{ flex: 1 }} />
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: accent,
          boxShadow: `0 0 12px ${accent}`,
        }}
      />
    </div>
    <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
  </div>
);

export const Dock: React.FC<{ activeIndex?: number }> = ({
  activeIndex = -1,
}) => {
  const icons: { label: string; color: string; glyph: string }[] = [
    { label: "Ledger", color: "#ee3a24", glyph: "≣" },
    { label: "Trial Balance", color: "#3f4e8e", glyph: "⚖" },
    { label: "P&L", color: "#2e8f5a", glyph: "%" },
    { label: "Statements", color: "#d08a1e", glyph: "▤" },
    { label: "Clients", color: "#7a2d4e", glyph: "◍" },
    { label: "Reports", color: "#5b6677", glyph: "◫" },
    { label: "Inbox", color: "#c46a28", glyph: "✉" },
  ];
  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        padding: "12px 18px",
        background: "rgba(20,16,14,0.5)",
        backdropFilter: "blur(24px)",
        borderRadius: 22,
        border: `1px solid ${theme.color.strokeStrong}`,
        boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
      }}
    >
      {icons.map((ic, i) => (
        <div
          key={ic.label}
          style={{
            width: 58,
            height: 58,
            borderRadius: 16,
            background: `linear-gradient(160deg, ${ic.color}, ${ic.color}bb)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 26,
            color: "#fff",
            transform: i === activeIndex ? "translateY(-14px) scale(1.12)" : "none",
            transition: "transform 0.2s",
            boxShadow:
              i === activeIndex
                ? `0 16px 30px ${ic.color}88`
                : "0 6px 16px rgba(0,0,0,0.4)",
          }}
        >
          {ic.glyph}
        </div>
      ))}
    </div>
  );
};
