import React from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { theme } from "./theme";
import { EpicA_Ignition } from "./scenes/EpicA_Ignition";
import { EpicB_Problem } from "./scenes/EpicB_Problem";
import { EpicC_Brand } from "./scenes/EpicC_Brand";
import { EpicD_OS } from "./scenes/EpicD_OS";
import { EpicE_Features } from "./scenes/EpicE_Features";
import { EpicF_Momentum } from "./scenes/EpicF_Momentum";
import { EpicG_CTA } from "./scenes/EpicG_CTA";

/**
 * Apar One — "The Bookkeeping OS" — 60s epic 3D generative launch film.
 * 1800 frames @ 30fps. AI-generated cinematic backdrops (Nano Banana 2) +
 * KLING motion + real OS screenshots on floating 3D glass, cut to a trailer
 * soundtrack.
 */
export const OsIntro: React.FC = () => {
  const frame = useCurrentFrame();
  const volume = interpolate(
    frame,
    [0, 24, 1700, 1800],
    [0, 0.82, 0.82, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Audio src={staticFile("soundtrack-epic.mp3")} volume={volume} />

      <Sequence durationInFrames={180} name="A · Ignition">
        <EpicA_Ignition />
      </Sequence>
      <Sequence from={180} durationInFrames={180} name="B · Problem">
        <EpicB_Problem />
      </Sequence>
      <Sequence from={360} durationInFrames={210} name="C · Brand">
        <EpicC_Brand />
      </Sequence>
      <Sequence from={570} durationInFrames={240} name="D · OS Reveal">
        <EpicD_OS />
      </Sequence>
      <Sequence from={810} durationInFrames={540} name="E · Features">
        <EpicE_Features />
      </Sequence>
      <Sequence from={1350} durationInFrames={240} name="F · Momentum">
        <EpicF_Momentum />
      </Sequence>
      <Sequence from={1590} durationInFrames={210} name="G · CTA">
        <EpicG_CTA />
      </Sequence>
    </AbsoluteFill>
  );
};
