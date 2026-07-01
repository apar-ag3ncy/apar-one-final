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

/**
 * Scene 1 — the problem. Three broken realities of bookkeeping get struck
 * out one by one, then a turn line sets up the product.
 */
const PROBLEMS = [
  "Ledgers trapped in spreadsheets",
  "Reconciliation done by hand",
  "Reports that take days to close",
];

export const Scene1Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const label = interpolate(frame, [4, 20], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  const outro = interpolate(frame, [180, 210], [1, 0], {
    extrapolateLeft: "clamp",
  });

  return (
    <AbsoluteFill style={{ fontFamily: interFamily }}>
      <Background glowIntensity={0.35} />
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "flex-start",
          padding: "0 200px",
          opacity: outro,
        }}
      >
        <div
          style={{
            opacity: label,
            transform: `translateY(${(1 - label) * 12}px)`,
            color: theme.color.brand,
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: 4,
            textTransform: "uppercase",
            marginBottom: 46,
          }}
        >
          Bookkeeping today
        </div>

        {PROBLEMS.map((text, i) => {
          const start = 26 + i * 34;
          const appear = spring({
            frame: frame - start,
            fps,
            config: { damping: 200 },
          });
          const strike = interpolate(
            frame,
            [start + 20, start + 40],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          );
          return (
            <div
              key={text}
              style={{
                position: "relative",
                opacity: appear,
                transform: `translateX(${(1 - appear) * -40}px)`,
                marginBottom: 26,
              }}
            >
              <span
                style={{
                  fontSize: 62,
                  fontWeight: 700,
                  color: theme.color.textMuted,
                }}
              >
                {text}
              </span>
              <div
                style={{
                  position: "absolute",
                  top: "52%",
                  left: 0,
                  height: 5,
                  width: `${strike * 100}%`,
                  background: theme.color.brand,
                  borderRadius: 4,
                  boxShadow: `0 0 16px ${theme.color.brandGlow}`,
                }}
              />
            </div>
          );
        })}

        <TurnLine frame={frame} fps={fps} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const TurnLine: React.FC<{ frame: number; fps: number }> = ({ frame, fps }) => {
  const start = 150;
  const appear = spring({
    frame: frame - start,
    fps,
    config: { damping: 200 },
  });
  return (
    <div
      style={{
        marginTop: 40,
        opacity: appear,
        transform: `translateY(${(1 - appear) * 20}px)`,
        fontSize: 40,
        fontWeight: 800,
        color: theme.color.text,
      }}
    >
      It’s time your books had an{" "}
      <span style={{ color: theme.color.brand }}>operating system.</span>
    </div>
  );
};
