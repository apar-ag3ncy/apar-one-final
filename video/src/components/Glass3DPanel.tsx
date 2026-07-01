import React from "react";
import { Img, staticFile } from "remotion";
import { theme } from "../theme";

/**
 * A screenshot (or any content) presented as a floating glass slab in 3D:
 * perspective tilt, orange edge-glow, reflection, deep shadow. Used to make
 * the real OS screenshots feel like holographic panels in space.
 */
export const Glass3DPanel: React.FC<{
  src?: string;
  children?: React.ReactNode;
  width: number;
  height: number;
  rotX?: number;
  rotY?: number;
  rotZ?: number;
  glow?: string;
  glowStrength?: number;
  radius?: number;
  style?: React.CSSProperties;
}> = ({
  src,
  children,
  width,
  height,
  rotX = 0,
  rotY = 0,
  rotZ = 0,
  glow = theme.color.brand,
  glowStrength = 0.6,
  radius = 16,
  style,
}) => {
  return (
    <div style={{ perspective: 1600, ...style }}>
      <div
        style={{
          width,
          height,
          transformStyle: "preserve-3d",
          transform: `rotateX(${rotX}deg) rotateY(${rotY}deg) rotateZ(${rotZ}deg)`,
          borderRadius: radius,
          position: "relative",
          boxShadow: `0 60px 140px rgba(0,0,0,0.7), 0 0 90px ${glow}${Math.round(
            glowStrength * 120,
          )
            .toString(16)
            .padStart(2, "0")}`,
          border: `1px solid ${glow}66`,
          background: "#05060a",
          overflow: "hidden",
        }}
      >
        {src ? (
          <Img
            src={staticFile(src)}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          children
        )}
        {/* glass sheen */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(120deg, rgba(255,255,255,0.16) 0%, transparent 24%, transparent 76%, rgba(255,255,255,0.06) 100%)",
            pointerEvents: "none",
          }}
        />
        {/* inner edge highlight */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: radius,
            boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 0 60px ${glow}22`,
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
};
