import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Background } from "../components/Background";
import { AparLogo } from "../components/AparLogo";
import { theme } from "../theme";
import { interFamily } from "../fonts";

/**
 * Scene 2 — brand reveal. The Apar wordmark draws on and locks up with
 * "One · The Bookkeeping OS".
 */
export const Scene2Logo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const draw = interpolate(frame, [6, 46], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fill = interpolate(frame, [40, 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pop = spring({ frame: frame - 6, fps, config: { damping: 160 } });
  const scale = interpolate(pop, [0, 1], [0.82, 1]);

  const glow = interpolate(frame, [40, 70, 120], [0, 0.7, 0.5], {
    extrapolateRight: "clamp",
  });

  const tagAppear = spring({ frame: frame - 62, fps, config: { damping: 200 } });
  const outro = interpolate(frame, [185, 210], [1, 0], {
    extrapolateLeft: "clamp",
  });

  return (
    <AbsoluteFill style={{ fontFamily: interFamily }}>
      <Background glowIntensity={glow} grid />
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          opacity: outro,
        }}
      >
        <div style={{ transform: `scale(${scale})`, textAlign: "center" }}>
          <div
            style={{
              filter: `drop-shadow(0 0 ${40 * glow}px ${theme.color.brandGlow})`,
            }}
          >
            <AparLogo
              color={theme.color.brand}
              width={620}
              drawProgress={draw}
              fillOpacity={fill}
            />
          </div>

          <div
            style={{
              opacity: tagAppear,
              transform: `translateY(${(1 - tagAppear) * 18}px)`,
              marginTop: 30,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 14,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 18,
                color: theme.color.text,
                fontSize: 44,
                fontWeight: 300,
                letterSpacing: 2,
              }}
            >
              <span style={{ fontWeight: 800 }}>One</span>
              <span style={{ color: theme.color.textFaint }}>·</span>
              <span style={{ color: theme.color.textMuted }}>
                The Bookkeeping{" "}
                <span style={{ color: theme.color.brand, fontWeight: 700 }}>
                  OS
                </span>
              </span>
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
