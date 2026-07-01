import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { HeroMedia } from "../components/HeroMedia";
import { Glass3DPanel } from "../components/Glass3DPanel";
import { Particles } from "../components/Particles";
import { KineticWords } from "../components/KineticText";
import { Vignette, Grid3D, LightSweep } from "../components/Overlays";
import { hexToRgba } from "../components/Background";
import { theme } from "../theme";
import { interFamily } from "../fonts";

/** Scene D — the OS reveal. Real desktop flies in as a floating 3D slab. */
export const EpicD_OS: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const panelIn = spring({ frame: frame - 10, fps, config: { damping: 150, mass: 1 } });
  const rotY = interpolate(panelIn, [0, 1], [-42, 0]);
  const rotX = interpolate(panelIn, [0, 1], [16, 6]);
  const panelScale = interpolate(panelIn, [0, 1], [0.7, 1]);
  const float = Math.sin(frame / 30) * 8;
  const headIn = spring({ frame: frame - 4, fps, config: { damping: 200 } });
  const outro = interpolate(frame, [212, 240], [1, 0], { extrapolateLeft: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: theme.color.bgDeep, fontFamily: interFamily }}>
      <AbsoluteFill style={{ opacity: 0.9 * outro }}>
        <HeroMedia asset="command" durationInFrames={240} fromScale={1.05} toScale={1.2} />
        <div style={{ position: "absolute", inset: 0, background: hexToRgba(theme.color.bgDeep, 0.55) }} />
      </AbsoluteFill>
      <Grid3D opacity={0.35} />
      <Particles count={46} seed={12} speed={0.7} opacity={0.5} />

      {/* headline */}
      <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 70, opacity: outro }}>
        <div style={{ opacity: headIn, transform: `translateY(${(1 - headIn) * -14}px)`, textAlign: "center" }}>
          <div style={{ color: theme.color.brand, fontWeight: 800, letterSpacing: 5, textTransform: "uppercase", fontSize: 20, marginBottom: 14 }}>
            Introducing the OS
          </div>
          <KineticWords text="Your books, as an operating system." startFrame={8} fontSize={52} stagger={3} accentWords={[4, 5]} />
        </div>
      </AbsoluteFill>

      {/* floating desktop slab */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", paddingTop: 90, opacity: outro }}>
        <div style={{ opacity: panelIn, transform: `translateY(${float}px) scale(${panelScale})` }}>
          <Glass3DPanel src="os/desktop-dark.png" width={1280} height={720} rotX={rotX} rotY={rotY} glowStrength={0.7} radius={20} />
        </div>
      </AbsoluteFill>

      <LightSweep from={20} to={70} />
      <Vignette strength={0.55} />
    </AbsoluteFill>
  );
};
