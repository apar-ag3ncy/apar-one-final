import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { HeroMedia } from "../components/HeroMedia";
import { Particles } from "../components/Particles";
import { AparLogo } from "../components/AparLogo";
import { Vignette, LightSweep, Flash } from "../components/Overlays";
import { hexToRgba } from "../components/Background";
import { theme } from "../theme";
import { interFamily } from "../fonts";

/** Scene G — finale + CTA. Logo lockup over the neon horizon. */
export const EpicG_CTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoPop = spring({ frame: frame - 6, fps, config: { damping: 150 } });
  const tag = spring({ frame: frame - 28, fps, config: { damping: 200 } });
  const cta = spring({ frame: frame - 46, fps, config: { damping: 150 } });
  const glow = interpolate(frame, [6, 46], [0.2, 0.7], { extrapolateRight: "clamp" });
  const breathe = 1 + Math.sin(frame / 24) * 0.012;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000", fontFamily: interFamily }}>
      <AbsoluteFill>
        <HeroMedia asset="horizon" durationInFrames={210} fromScale={1.15} toScale={1.0} focalY={55} />
        <div style={{ position: "absolute", inset: 0, background: hexToRgba(theme.color.bgDeep, 0.42) }} />
      </AbsoluteFill>
      <Particles count={60} seed={44} speed={0.6} />
      <Flash at={4} duration={12} color={theme.color.brandBright} />

      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}>
        <div
          style={{
            transform: `scale(${interpolate(logoPop, [0, 1], [0.8, 1]) * breathe})`,
            opacity: logoPop,
            filter: `drop-shadow(0 0 ${50 * glow}px ${theme.color.brandGlow})`,
          }}
        >
          <AparLogo color={theme.color.brand} width={520} />
        </div>
        <div
          style={{
            opacity: tag,
            transform: `translateY(${(1 - tag) * 16}px)`,
            marginTop: 24,
            fontSize: 40,
            fontWeight: 300,
            color: theme.color.text,
            letterSpacing: 1,
          }}
        >
          <span style={{ fontWeight: 800 }}>One</span>
          <span style={{ color: theme.color.textFaint, margin: "0 16px" }}>·</span>
          <span style={{ color: theme.color.textMuted }}>
            The Bookkeeping <span style={{ color: theme.color.brand, fontWeight: 700 }}>OS</span>
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
              padding: "18px 46px",
              borderRadius: 999,
              background: `linear-gradient(135deg, ${theme.color.brandBright}, ${theme.color.brandDeep})`,
              color: "#fff",
              fontSize: 27,
              fontWeight: 800,
              boxShadow: `0 20px 60px ${theme.color.brandGlow}`,
            }}
          >
            See the OS in action →
          </div>
          <div style={{ color: theme.color.textFaint, fontSize: 18, fontWeight: 500 }}>
            Apar LLP · Accounting, reimagined
          </div>
        </div>
      </AbsoluteFill>

      <LightSweep from={30} to={90} />
      <Vignette strength={0.5} />
    </AbsoluteFill>
  );
};
