import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Background } from "../components/Background";
import { theme } from "../theme";
import { interFamily } from "../fonts";
import { OsIcon, OS_APPS } from "../components/OsIcons";

/**
 * Scene 5 — the payoff. A headline and three differentiator cards that
 * make the "best bookkeeping software" claim concrete.
 */
const CARDS = [
  {
    metric: "20+",
    label: "apps, one desktop",
    sub: "Ledgers, reports, clients, payroll & more in a single OS.",
    accent: theme.color.brand,
  },
  {
    metric: "0",
    label: "spreadsheets",
    sub: "A real double-entry core — balanced by design, not by luck.",
    accent: theme.color.green,
  },
  {
    metric: "1-click",
    label: "audit-ready exports",
    sub: "Branded PDF & signed Excel your clients and auditors trust.",
    accent: theme.color.amber,
  },
];

export const Scene5Why: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const head = spring({ frame, fps, config: { damping: 200 } });
  const outro = interpolate(frame, [210, 240], [1, 0], {
    extrapolateLeft: "clamp",
  });

  return (
    <AbsoluteFill style={{ fontFamily: interFamily }}>
      <Background glowIntensity={0.5} />
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: "0 120px",
          opacity: outro,
        }}
      >
        <div
          style={{
            opacity: head,
            transform: `translateY(${(1 - head) * 20}px)`,
            textAlign: "center",
            marginBottom: 40,
          }}
        >
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: theme.color.brand,
              marginBottom: 18,
            }}
          >
            Why it wins
          </div>
          <h2
            style={{
              fontSize: 56,
              fontWeight: 800,
              color: theme.color.text,
              margin: 0,
              lineHeight: 1.1,
            }}
          >
            The best books your firm has ever kept.
          </h2>
        </div>

        {/* real Apar OS app icons */}
        <div
          style={{
            display: "flex",
            gap: 14,
            marginBottom: 52,
          }}
        >
          {OS_APPS.map((app, i) => {
            const start = 10 + i * 4;
            const pop = spring({
              frame: frame - start,
              fps,
              config: { damping: 180 },
            });
            return (
              <div
                key={app.id}
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  background:
                    app.id === "admin_console"
                      ? theme.color.brand
                      : "rgba(255,255,255,0.94)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pop,
                  transform: `translateY(${(1 - pop) * 24}px) scale(${pop})`,
                  boxShadow: "0 10px 24px rgba(0,0,0,0.4)",
                }}
              >
                <OsIcon
                  name={app.icon}
                  size={28}
                  stroke={1.7}
                  color={app.id === "admin_console" ? "#fff" : theme.color.brand}
                />
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 30, width: "100%", maxWidth: 1400 }}>
          {CARDS.map((c, i) => {
            const start = 18 + i * 14;
            const pop = spring({
              frame: frame - start,
              fps,
              config: { damping: 160 },
            });
            return (
              <div
                key={c.label}
                style={{
                  flex: 1,
                  background: theme.color.surface,
                  border: `1px solid ${theme.color.stroke}`,
                  borderRadius: theme.radius.lg,
                  padding: "40px 36px",
                  opacity: pop,
                  transform: `translateY(${(1 - pop) * 40}px) scale(${interpolate(
                    pop,
                    [0, 1],
                    [0.92, 1],
                  )})`,
                  boxShadow: "0 30px 80px rgba(0,0,0,0.45)",
                }}
              >
                <div
                  style={{
                    fontSize: 76,
                    fontWeight: 900,
                    color: c.accent,
                    lineHeight: 1,
                    letterSpacing: -2,
                  }}
                >
                  {c.metric}
                </div>
                <div
                  style={{
                    fontSize: 26,
                    fontWeight: 700,
                    color: theme.color.text,
                    marginTop: 14,
                  }}
                >
                  {c.label}
                </div>
                <div
                  style={{
                    fontSize: 19,
                    lineHeight: 1.5,
                    color: theme.color.textMuted,
                    marginTop: 14,
                  }}
                >
                  {c.sub}
                </div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
