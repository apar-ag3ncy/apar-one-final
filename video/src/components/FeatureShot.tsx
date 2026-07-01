import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { KenBurns } from "./KenBurns";
import { theme } from "../theme";
import { interFamily } from "../fonts";
import { hexToRgba } from "./Background";

/**
 * One feature beat: a real 4K OS screenshot fills the frame with a slow Ken
 * Burns push toward its window, a left scrim carries the copy, and a thin
 * top/bottom cinematic letterbox keeps it feeling like product footage.
 */
export const FeatureShot: React.FC<{
  src: string;
  tag: string;
  title: React.ReactNode;
  benefit: string;
  accent: string;
  duration: number;
  focalX?: number;
  focalY?: number;
  fromScale?: number;
  toScale?: number;
}> = ({
  src,
  tag,
  title,
  benefit,
  accent,
  duration,
  focalX = 52,
  focalY = 40,
  fromScale = 1.08,
  toScale = 1.2,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const inAll = spring({ frame, fps, config: { damping: 200 } });
  const fadeOut = interpolate(frame, [duration - 16, duration], [1, 0], {
    extrapolateLeft: "clamp",
  });
  const copyIn = spring({ frame: frame - 6, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill style={{ fontFamily: interFamily, opacity: fadeOut }}>
      {/* real product footage */}
      <AbsoluteFill style={{ opacity: inAll, transform: `scale(${interpolate(inAll, [0, 1], [1.02, 1])})` }}>
        <KenBurns
          src={src}
          durationInFrames={duration}
          focalX={focalX}
          focalY={focalY}
          fromScale={fromScale}
          toScale={toScale}
        />
      </AbsoluteFill>

      {/* left scrim for legibility */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(90deg, ${hexToRgba(
            theme.color.bgDeep,
            0.95,
          )} 0%, ${hexToRgba(theme.color.bgDeep, 0.8)} 26%, ${hexToRgba(
            theme.color.bgDeep,
            0.15,
          )} 48%, transparent 62%)`,
        }}
      />
      {/* subtle vignette + top glow tint */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 20% 40%, ${hexToRgba(
            accent,
            0.14,
          )} 0%, transparent 40%)`,
        }}
      />

      {/* copy */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "flex-start",
          padding: "0 0 0 120px",
        }}
      >
        <div
          style={{
            width: 620,
            opacity: copyIn,
            transform: `translateX(${(1 - copyIn) * -40}px)`,
          }}
        >
          <span
            style={{
              display: "inline-block",
              fontSize: 17,
              fontWeight: 800,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: accent,
              padding: "8px 16px",
              borderRadius: 999,
              background: hexToRgba(accent, 0.14),
              border: `1px solid ${hexToRgba(accent, 0.35)}`,
              marginBottom: 26,
            }}
          >
            {tag}
          </span>
          <h2
            style={{
              fontSize: 62,
              fontWeight: 800,
              lineHeight: 1.05,
              color: theme.color.text,
              margin: 0,
              textShadow: "0 4px 30px rgba(0,0,0,0.6)",
            }}
          >
            {title}
          </h2>
          <p
            style={{
              fontSize: 25,
              lineHeight: 1.5,
              color: theme.color.textMuted,
              marginTop: 22,
              fontWeight: 500,
              textShadow: "0 2px 18px rgba(0,0,0,0.7)",
            }}
          >
            {benefit}
          </p>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
