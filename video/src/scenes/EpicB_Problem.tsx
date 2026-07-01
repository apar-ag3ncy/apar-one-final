import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { HeroMedia } from "../components/HeroMedia";
import { SlamText } from "../components/KineticText";
import { Vignette, Scanlines, Flash, RgbGlitch } from "../components/Overlays";
import { Particles } from "../components/Particles";
import { theme } from "../theme";
import { interFamily } from "../fonts";

/** Scene B — the problem. Hard-cut kinetic slams with glitch + flash. */
const PROBLEMS = [
  { t: "Spreadsheets.", at: 6 },
  { t: "Silos.", at: 44 },
  { t: "Month-end dread.", at: 82 },
];

export const EpicB_Problem: React.FC = () => {
  const frame = useCurrentFrame();
  const outro = interpolate(frame, [150, 180], [1, 0], {
    extrapolateLeft: "clamp",
  });
  // which slam is current — only render the latest to get hard cuts
  const current = [...PROBLEMS].reverse().find((p) => frame >= p.at);

  return (
    <AbsoluteFill style={{ backgroundColor: "#050506", fontFamily: interFamily }}>
      <AbsoluteFill style={{ opacity: 0.5 * outro }}>
        <HeroMedia asset="network" durationInFrames={180} fromScale={1.15} toScale={1.3} />
      </AbsoluteFill>
      <Particles count={40} seed={9} color={theme.color.brandDeep} opacity={0.4} />
      <Vignette strength={0.8} />

      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: outro }}>
        {current && (
          <RgbGlitch from={current.at} to={current.at + 6} amount={10}>
            <SlamText text={current.t} startFrame={current.at} fontSize={128} />
          </RgbGlitch>
        )}
      </AbsoluteFill>

      {PROBLEMS.map((p) => (
        <Flash key={p.t} at={p.at} duration={7} color="#ffffff" />
      ))}
      <Scanlines opacity={0.08} />
      <div
        style={{
          position: "absolute",
          bottom: 90,
          width: "100%",
          textAlign: "center",
          color: theme.color.textFaint,
          fontSize: 22,
          letterSpacing: 4,
          textTransform: "uppercase",
          opacity: interpolate(frame, [120, 140], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) * outro,
          fontWeight: 700,
        }}
      >
        Bookkeeping was never built for this
      </div>
    </AbsoluteFill>
  );
};
