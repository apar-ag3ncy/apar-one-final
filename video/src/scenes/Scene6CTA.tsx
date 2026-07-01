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

/** Scene 6 — closing brand lockup and call to action. */
export const Scene6CTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoPop = spring({ frame, fps, config: { damping: 160 } });
  const tag = spring({ frame: frame - 22, fps, config: { damping: 200 } });
  const cta = spring({ frame: frame - 42, fps, config: { damping: 160 } });
  const glow = interpolate(frame, [0, 40], [0.2, 0.6], {
    extrapolateRight: "clamp",
  });
  const breathe = 1 + Math.sin(frame / 24) * 0.012;

  return (
    <AbsoluteFill style={{ fontFamily: interFamily }}>
      <Background glowIntensity={glow} grid />
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        <div
          style={{
            transform: `scale(${interpolate(logoPop, [0, 1], [0.8, 1]) * breathe})`,
            opacity: logoPop,
            filter: `drop-shadow(0 0 ${46 * glow}px ${theme.color.brandGlow})`,
          }}
        >
          <AparLogo color={theme.color.brand} width={520} />
        </div>

        <div
          style={{
            opacity: tag,
            transform: `translateY(${(1 - tag) * 16}px)`,
            marginTop: 26,
            fontSize: 40,
            fontWeight: 300,
            color: theme.color.text,
            letterSpacing: 1,
          }}
        >
          <span style={{ fontWeight: 800 }}>One</span>
          <span style={{ color: theme.color.textFaint, margin: "0 16px" }}>·</span>
          <span style={{ color: theme.color.textMuted }}>
            The Bookkeeping{" "}
            <span style={{ color: theme.color.brand, fontWeight: 700 }}>OS</span>
          </span>
        </div>

        <div
          style={{
            opacity: cta,
            transform: `translateY(${(1 - cta) * 20}px)`,
            marginTop: 44,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 18,
          }}
        >
          <div
            style={{
              padding: "18px 44px",
              borderRadius: 999,
              background: `linear-gradient(135deg, ${theme.color.brandBright}, ${theme.color.brandDeep})`,
              color: "#fff",
              fontSize: 26,
              fontWeight: 800,
              boxShadow: `0 20px 50px ${theme.color.brandGlow}`,
            }}
          >
            See the OS in action →
          </div>
          <div
            style={{ color: theme.color.textFaint, fontSize: 18, fontWeight: 500 }}
          >
            Apar LLP · Accounting, reimagined
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
