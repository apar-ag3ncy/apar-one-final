import React from "react";
import { AbsoluteFill, OffthreadVideo, staticFile } from "remotion";
import { KenBurns } from "./KenBurns";
import { GEN, GenKey } from "../gen";

/**
 * Full-bleed hero backdrop for a scene. Plays the KLING motion clip when one
 * exists for this asset; otherwise Ken Burns the still image. Either way the
 * scene code stays identical.
 */
export const HeroMedia: React.FC<{
  asset: GenKey;
  durationInFrames: number;
  fromScale?: number;
  toScale?: number;
  focalX?: number;
  focalY?: number;
  videoStartFrom?: number;
  playbackRate?: number;
  style?: React.CSSProperties;
}> = ({
  asset,
  durationInFrames,
  fromScale = 1.06,
  toScale = 1.18,
  focalX = 50,
  focalY = 50,
  videoStartFrom = 0,
  playbackRate = 1,
  style,
}) => {
  const a = GEN[asset];
  if (a.hasVideo && a.video) {
    return (
      <AbsoluteFill style={{ overflow: "hidden", ...style }}>
        <OffthreadVideo
          src={staticFile(a.video)}
          startFrom={videoStartFrom}
          playbackRate={playbackRate}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </AbsoluteFill>
    );
  }
  return (
    <KenBurns
      src={a.img}
      durationInFrames={durationInFrames}
      fromScale={fromScale}
      toScale={toScale}
      focalX={focalX}
      focalY={focalY}
      style={style}
    />
  );
};
