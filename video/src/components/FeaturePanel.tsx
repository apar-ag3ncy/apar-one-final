import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { theme } from "../theme";
import { interFamily } from "../fonts";
import { Window } from "./OsChrome";

/**
 * Split feature slide: animated headline + benefit on the left, a live
 * product window on the right. Transparent bg so the parent scene keeps a
 * continuous backdrop across features.
 */
export const FeaturePanel: React.FC<{
  tag: string;
  title: React.ReactNode;
  benefit: string;
  bullets?: string[];
  accent: string;
  windowTitle: string;
  windowSubtitle?: string;
  windowWidth?: number;
  duration: number;
  renderMock: (reveal: number) => React.ReactNode;
}> = ({
  tag,
  title,
  benefit,
  bullets,
  accent,
  windowTitle,
  windowSubtitle,
  windowWidth = 760,
  duration,
  renderMock,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const inText = spring({ frame, fps, config: { damping: 200 } });
  const inWin = spring({ frame: frame - 8, fps, config: { damping: 180 } });
  const fadeOut = interpolate(
    frame,
    [duration - 15, duration],
    [1, 0],
    { extrapolateLeft: "clamp" },
  );
  const reveal = interpolate(frame, [16, 78], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        fontFamily: interFamily,
        flexDirection: "row",
        alignItems: "center",
        padding: "0 120px",
        gap: 70,
        opacity: fadeOut,
      }}
    >
      {/* left: copy */}
      <div
        style={{
          flex: "0 0 40%",
          opacity: inText,
          transform: `translateX(${(1 - inText) * -40}px)`,
        }}
      >
        <span
          style={{
            display: "inline-block",
            fontSize: 16,
            fontWeight: 800,
            letterSpacing: 3,
            textTransform: "uppercase",
            color: accent,
            padding: "7px 14px",
            borderRadius: 999,
            background: `${accent}1f`,
            marginBottom: 26,
          }}
        >
          {tag}
        </span>
        <h2
          style={{
            fontSize: 54,
            fontWeight: 800,
            lineHeight: 1.08,
            color: theme.color.text,
            margin: 0,
          }}
        >
          {title}
        </h2>
        <p
          style={{
            fontSize: 24,
            lineHeight: 1.5,
            color: theme.color.textMuted,
            marginTop: 24,
            fontWeight: 500,
          }}
        >
          {benefit}
        </p>
        {bullets && (
          <div style={{ marginTop: 26, display: "flex", flexDirection: "column", gap: 14 }}>
            {bullets.map((b) => (
              <div
                key={b}
                style={{ display: "flex", alignItems: "center", gap: 12 }}
              >
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 999,
                    background: `${accent}26`,
                    color: accent,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                    fontWeight: 800,
                  }}
                >
                  ✓
                </span>
                <span style={{ fontSize: 19, color: theme.color.text }}>{b}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* right: window */}
      <div
        style={{
          flex: 1,
          display: "flex",
          justifyContent: "center",
          opacity: inWin,
          transform: `translateX(${(1 - inWin) * 60}px) scale(${interpolate(
            inWin,
            [0, 1],
            [0.94, 1],
          )})`,
        }}
      >
        <Window
          title={windowTitle}
          subtitle={windowSubtitle}
          accent={accent}
          width={windowWidth}
        >
          {renderMock(reveal)}
        </Window>
      </div>
    </AbsoluteFill>
  );
};
