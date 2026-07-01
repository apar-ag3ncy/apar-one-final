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
import { theme } from "../theme";
import { interFamily } from "../fonts";

/** Scene C — the brand strike. Big impact, logo ignites over the monolith. */
export const EpicC_Brand: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const pop = spring({ frame: frame - 4, fps, config: { damping: 140, mass: 0.8 } });
  const scale = interpolate(pop, [0, 1], [0.55, 1]);
  const glow = interpolate(frame, [4, 30, 120], [0, 1, 0.7], {
    extrapolateRight: "clamp",
  });
  const tag = spring({ frame: frame - 40, fps, config: { damping: 200 } });
  const outro = interpolate(frame, [182, 210], [1, 0], {
    extrapolateLeft: "clamp",
  });
  const breathe = 1 + Math.sin(frame / 22) * 0.014;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000", fontFamily: interFamily }}>
      <AbsoluteFill style={{ opacity: outro }}>
        <HeroMedia asset="monolith" durationInFrames={210} fromScale={1.18} toScale={1.04} focalY={55} />
        <Particles count={60} seed={5} speed={0.8} />
        <Vignette strength={0.7} />
        <LightSweep from={6} to={46} color="rgba(255,120,80,0.28)" />
      </AbsoluteFill>

      <Flash at={4} duration={14} color={theme.color.brandBright} />

      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: outro }}>
        <div style={{ transform: `scale(${scale * breathe})`, textAlign: "center" }}>
          <div style={{ filter: `drop-shadow(0 0 ${52 * glow}px ${theme.color.brandGlow})` }}>
            <AparLogo color={theme.color.brand} width={640} />
          </div>
          <div
            style={{
              opacity: tag,
              transform: `translateY(${(1 - tag) * 20}px)`,
              marginTop: 30,
              fontSize: 42,
              fontWeight: 300,
              letterSpacing: 3,
              color: theme.color.text,
            }}
          >
            <span style={{ fontWeight: 800 }}>ONE</span>
            <span style={{ color: theme.color.textFaint, margin: "0 18px" }}>·</span>
            <span style={{ color: theme.color.textMuted }}>
              The Bookkeeping{" "}
              <span style={{ color: theme.color.brand, fontWeight: 700 }}>OS</span>
            </span>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
