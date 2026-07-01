import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";
import { hexToRgba } from "./Background";

/** Cinematic vignette. */
export const Vignette: React.FC<{ strength?: number }> = ({ strength = 0.6 }) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(circle at 50% 48%, transparent 38%, rgba(0,0,0,${strength}) 100%)`,
      pointerEvents: "none",
    }}
  />
);

/** Subtle animated scanlines for a hi-tech HUD feel. */
export const Scanlines: React.FC<{ opacity?: number }> = ({ opacity = 0.06 }) => (
  <AbsoluteFill
    style={{
      backgroundImage:
        "repeating-linear-gradient(0deg, rgba(255,255,255,0.5) 0px, rgba(255,255,255,0.5) 1px, transparent 1px, transparent 4px)",
      opacity,
      pointerEvents: "none",
      mixBlendMode: "overlay",
    }}
  />
);

/** Animated perspective grid floor receding to the horizon. */
export const Grid3D: React.FC<{ color?: string; opacity?: number }> = ({
  color = theme.color.brand,
  opacity = 0.5,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const shift = ((frame / fps) * 40) % 80;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: "-50%",
          right: "-50%",
          bottom: 0,
          height: "55%",
          transform: "rotateX(74deg)",
          transformOrigin: "bottom center",
          backgroundImage: `linear-gradient(${hexToRgba(color, 0.55)} 1px, transparent 1px), linear-gradient(90deg, ${hexToRgba(
            color,
            0.55,
          )} 1px, transparent 1px)`,
          backgroundSize: `80px 80px`,
          backgroundPosition: `0px ${shift}px`,
          opacity,
          maskImage: "linear-gradient(to top, black 0%, transparent 85%)",
          WebkitMaskImage: "linear-gradient(to top, black 0%, transparent 85%)",
        }}
      />
    </AbsoluteFill>
  );
};

/** A diagonal light sweep that crosses the frame once over [from,to]. */
export const LightSweep: React.FC<{
  from: number;
  to: number;
  color?: string;
}> = ({ from, to, color = "rgba(255,255,255,0.14)" }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [from, to], [-30, 130], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          top: "-50%",
          left: `${p}%`,
          width: "22%",
          height: "200%",
          background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
          transform: "rotate(18deg)",
          filter: "blur(8px)",
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * RGB-split glitch flash over [from,to]. Renders chroma-offset copies of
 * `children`. Great for hard cuts / problem beats.
 */
export const RgbGlitch: React.FC<{
  from: number;
  to: number;
  amount?: number;
  children: React.ReactNode;
}> = ({ from, to, amount = 12, children }) => {
  const frame = useCurrentFrame();
  const active = frame >= from && frame <= to;
  const k = active ? Math.sin((frame - from) * 1.9) : 0;
  const off = k * amount;
  const jitter = active ? Math.sin((frame - from) * 4.3) * (amount * 0.3) : 0;
  return (
    <div
      style={{
        transform: `translateX(${jitter}px)`,
        filter: `drop-shadow(${off}px 0 0 rgba(255,40,40,0.65)) drop-shadow(${-off}px 0 0 rgba(0,200,255,0.6))`,
      }}
    >
      {children}
    </div>
  );
};

/** Full-frame color flash (impact hit). */
export const Flash: React.FC<{ at: number; duration?: number; color?: string }> = ({
  at,
  duration = 8,
  color = "#ffffff",
}) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [at, at + duration], [0.55, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  if (frame < at) return null;
  return (
    <AbsoluteFill style={{ background: color, opacity: o, pointerEvents: "none" }} />
  );
};
