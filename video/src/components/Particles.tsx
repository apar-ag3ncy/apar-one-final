import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";

/** Deterministic PRNG (mulberry32) so particles are identical every render. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Floating embers / dust that drift upward with parallax. Deterministic,
 * frame-driven. Sits over AI backdrops for extra depth and motion.
 */
export const Particles: React.FC<{
  count?: number;
  color?: string;
  seed?: number;
  speed?: number;
  maxSize?: number;
  opacity?: number;
  drift?: number;
}> = ({
  count = 70,
  color = theme.color.brand,
  seed = 7,
  speed = 1,
  maxSize = 7,
  opacity = 0.7,
  drift = 40,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  const parts = useMemo(() => {
    const rnd = mulberry32(seed);
    return Array.from({ length: count }, () => ({
      x: rnd(),
      y: rnd(),
      size: 1 + rnd() * maxSize,
      spd: 0.15 + rnd() * 0.85,
      phase: rnd() * Math.PI * 2,
      sway: 0.3 + rnd() * 0.7,
      glow: 0.4 + rnd() * 0.6,
    }));
  }, [count, seed, maxSize]);

  const t = frame / fps;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {parts.map((p, i) => {
        const rise = (p.y - t * p.spd * 0.06 * speed) % 1;
        const y = (rise < 0 ? rise + 1 : rise) * height;
        const x =
          p.x * width + Math.sin(t * p.sway + p.phase) * drift * p.sway;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: p.size,
              height: p.size,
              borderRadius: "50%",
              background: color,
              opacity: opacity * p.glow,
              boxShadow: `0 0 ${p.size * 3}px ${p.size}px ${color}`,
              filter: "blur(0.4px)",
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
