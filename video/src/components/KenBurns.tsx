import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";

/**
 * Full-bleed image with a slow Ken Burns zoom/pan toward a focal point.
 * Keeps static 4K screenshots feeling alive. Image stays crisp because the
 * source is 3840x2160 and we only ever scale up slightly.
 */
export const KenBurns: React.FC<{
  src: string;
  durationInFrames: number;
  fromScale?: number;
  toScale?: number;
  focalX?: number; // transform-origin %, where the zoom pushes toward
  focalY?: number;
  style?: React.CSSProperties;
}> = ({
  src,
  durationInFrames,
  fromScale = 1.05,
  toScale = 1.16,
  focalX = 50,
  focalY = 42,
  style,
}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, durationInFrames], [fromScale, toScale], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ overflow: "hidden", ...style }}>
      <Img
        src={staticFile(src)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale})`,
          transformOrigin: `${focalX}% ${focalY}%`,
        }}
      />
    </AbsoluteFill>
  );
};
