import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Background } from "../components/Background";
import { MenuBar, Dock, Window } from "../components/OsChrome";
import { StatementTable } from "../components/Mockups";
import { theme } from "../theme";
import { interFamily } from "../fonts";

/**
 * Scene 3 — the desktop reveal. Menu bar drops in, a Statement of Account
 * window springs up, the dock rises. Sells the "it's an operating system"
 * idea literally.
 */
export const Scene3Desktop: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const menu = spring({ frame, fps, config: { damping: 200 } });
  const win = spring({ frame: frame - 14, fps, config: { damping: 180 } });
  const winScale = interpolate(win, [0, 1], [0.9, 1]);
  const rows = interpolate(frame, [44, 130], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const dock = spring({ frame: frame - 34, fps, config: { damping: 200 } });
  const caption = spring({ frame: frame - 74, fps, config: { damping: 200 } });
  const outro = interpolate(frame, [270, 300], [1, 0], {
    extrapolateLeft: "clamp",
  });

  return (
    <AbsoluteFill style={{ fontFamily: interFamily }}>
      <Background glowIntensity={0.4} grid />
      <AbsoluteFill style={{ opacity: outro }}>
        {/* menu bar */}
        <div style={{ transform: `translateY(${(menu - 1) * 40}px)`, opacity: menu }}>
          <MenuBar />
        </div>

        {/* window */}
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            paddingBottom: 80,
          }}
        >
          <div
            style={{
              opacity: win,
              transform: `scale(${winScale}) translateY(${(1 - win) * 40}px)`,
            }}
          >
            <Window
              title="Statement of Account — Nykaa"
              subtitle="Chronological ledger · running balance · FY 25-26"
              width={1180}
            >
              <StatementTable reveal={rows} />
            </Window>
          </div>
        </AbsoluteFill>

        {/* caption */}
        <AbsoluteFill
          style={{
            justifyContent: "flex-end",
            alignItems: "center",
            paddingBottom: 132,
          }}
        >
          <div
            style={{
              opacity: caption,
              transform: `translateY(${(1 - caption) * 20}px)`,
              fontSize: 34,
              fontWeight: 700,
              color: theme.color.text,
              textShadow: "0 4px 24px rgba(0,0,0,0.8)",
            }}
          >
            One workspace.{" "}
            <span style={{ color: theme.color.textMuted, fontWeight: 500 }}>
              Every ledger, statement & report.
            </span>
          </div>
        </AbsoluteFill>

        {/* dock */}
        <AbsoluteFill
          style={{ justifyContent: "flex-end", alignItems: "center" }}
        >
          <div
            style={{
              marginBottom: 26,
              opacity: dock,
              transform: `translateY(${(1 - dock) * 80}px)`,
            }}
          >
            <Dock activeIndex={3} />
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
