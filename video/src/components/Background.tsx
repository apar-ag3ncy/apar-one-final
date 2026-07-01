import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { theme } from "../theme";

/**
 * Cinematic dark backdrop: deep radial glow that drifts, a faint grid,
 * and a vignette. Shared by every scene for visual continuity.
 */
export const Background: React.FC<{
  glow?: string;
  glowIntensity?: number;
  grid?: boolean;
}> = ({ glow = theme.color.brand, glowIntensity = 0.5, grid = true }) => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 60) * 60;
  const drift2 = Math.cos(frame / 80) * 50;

  return (
    <AbsoluteFill style={{ backgroundColor: theme.color.bgDeep }}>
      {/* base gradient */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(160deg, ${theme.color.bg} 0%, ${theme.color.bgDeep} 60%, #000 100%)`,
        }}
      />
      {/* brand glow */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${50 + drift / 20}% ${
            35 + drift2 / 30
          }%, ${hexToRgba(glow, glowIntensity)} 0%, transparent 45%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${20 - drift / 30}% 90%, ${hexToRgba(
            glow,
            glowIntensity * 0.4,
          )} 0%, transparent 40%)`,
        }}
      />
      {/* faint grid */}
      {grid && (
        <AbsoluteFill
          style={{
            backgroundImage: `linear-gradient(${theme.color.stroke} 1px, transparent 1px), linear-gradient(90deg, ${theme.color.stroke} 1px, transparent 1px)`,
            backgroundSize: "64px 64px",
            maskImage:
              "radial-gradient(circle at 50% 45%, black 0%, transparent 75%)",
            WebkitMaskImage:
              "radial-gradient(circle at 50% 45%, black 0%, transparent 75%)",
            opacity: 0.6,
          }}
        />
      )}
      {/* vignette */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 50% 50%, transparent 40%, rgba(0,0,0,0.55) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
