import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";
import { interFamily } from "../fonts";

/**
 * Word-by-word kinetic headline. Each word springs up in 3D with a blur
 * settle. `startFrame` offsets the whole line.
 */
export const KineticWords: React.FC<{
  text: string;
  startFrame?: number;
  stagger?: number;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  accent?: string;
  accentWords?: number[]; // indices to paint with accent
  lineHeight?: number;
  style?: React.CSSProperties;
}> = ({
  text,
  startFrame = 0,
  stagger = 4,
  fontSize = 90,
  fontWeight = 900,
  color = theme.color.text,
  accent = theme.color.brand,
  accentWords = [],
  lineHeight = 1.02,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(" ");

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: `0 ${fontSize * 0.26}px`,
        justifyContent: "center",
        fontFamily: interFamily,
        fontSize,
        fontWeight,
        lineHeight,
        letterSpacing: -1,
        perspective: 900,
        ...style,
      }}
    >
      {words.map((w, i) => {
        const s = spring({
          frame: frame - startFrame - i * stagger,
          fps,
          config: { damping: 160, mass: 0.7 },
        });
        const blur = interpolate(s, [0, 1], [12, 0]);
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              color: accentWords.includes(i) ? accent : color,
              opacity: s,
              transform: `translateY(${(1 - s) * 70}px) rotateX(${
                (1 - s) * -70
              }deg) scale(${interpolate(s, [0, 1], [0.7, 1])})`,
              filter: `blur(${blur}px)`,
              transformOrigin: "50% 100%",
              textShadow: "0 10px 40px rgba(0,0,0,0.6)",
            }}
          >
            {w}
          </span>
        );
      })}
    </div>
  );
};

/**
 * A single word/phrase that SLAMS in with scale-down + shake, for punchy
 * problem-statement cuts.
 */
export const SlamText: React.FC<{
  text: string;
  startFrame?: number;
  fontSize?: number;
  color?: string;
  style?: React.CSSProperties;
}> = ({ text, startFrame = 0, fontSize = 130, color = theme.color.text, style }) => {
  const frame = useCurrentFrame();
  const local = frame - startFrame;
  const inP = spring({
    frame: local,
    fps: 30,
    config: { damping: 200, stiffness: 320, mass: 0.6 },
  });
  const scale = interpolate(inP, [0, 1], [1.6, 1]);
  const shake =
    local >= 0 && local < 8 ? Math.sin(local * 3) * (8 - local) * 0.8 : 0;
  const blur = interpolate(inP, [0, 0.6], [26, 0], {
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        fontFamily: interFamily,
        fontSize,
        fontWeight: 900,
        letterSpacing: -2,
        color,
        opacity: inP,
        transform: `scale(${scale}) translateX(${shake}px)`,
        filter: `blur(${blur}px)`,
        textAlign: "center",
        textShadow: "0 12px 50px rgba(0,0,0,0.7)",
        ...style,
      }}
    >
      {text}
    </div>
  );
};
