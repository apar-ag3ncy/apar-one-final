import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { HeroMedia } from "../components/HeroMedia";
import { Particles } from "../components/Particles";
import { KineticWords } from "../components/KineticText";
import { Vignette, LightSweep, Flash } from "../components/Overlays";
import { theme } from "../theme";
import { interFamily } from "../fonts";

/** Scene A — ignition cold open. The core powers up out of black. */
export const EpicA_Ignition: React.FC = () => {
  const frame = useCurrentFrame();
  const wake = interpolate(frame, [0, 40], [0, 1], { extrapolateRight: "clamp" });
  const outro = interpolate(frame, [150, 180], [1, 0], {
    extrapolateLeft: "clamp",
  });
  const eyebrow = interpolate(frame, [12, 30], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000", fontFamily: interFamily }}>
      <AbsoluteFill style={{ opacity: wake * outro }}>
        <HeroMedia asset="core" durationInFrames={180} fromScale={1.3} toScale={1.05} />
        <Particles count={80} seed={3} speed={1.2} />
        <Vignette strength={0.72} />
        <LightSweep from={30} to={80} />
      </AbsoluteFill>

      <Flash at={38} duration={12} color={theme.color.brandBright} />

      <AbsoluteFill
        style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 120, opacity: outro }}
      >
        <div
          style={{
            opacity: eyebrow,
            letterSpacing: 8,
            textTransform: "uppercase",
            color: theme.color.brand,
            fontSize: 22,
            fontWeight: 800,
            marginBottom: 26,
          }}
        >
          Apar presents
        </div>
        <KineticWords
          text="Your books just came alive."
          startFrame={52}
          fontSize={82}
          accentWords={[4]}
          stagger={5}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
