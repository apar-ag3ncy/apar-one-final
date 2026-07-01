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
import { Scene1Hook } from "./scenes/Scene1Hook";
import { Scene2Logo } from "./scenes/Scene2Logo";
import { Scene3Desktop } from "./scenes/Scene3Desktop";
import { Scene4Features } from "./scenes/Scene4Features";
import { Scene5Why } from "./scenes/Scene5Why";
import { Scene6CTA } from "./scenes/Scene6CTA";

/**
 * Apar One — "The Bookkeeping OS" — 60s SaaS intro.
 * 1800 frames @ 30fps. Scenes share a continuous dark backdrop, each fades
 * its foreground out so the cuts read as soft crossfades.
 */
export const OsIntro: React.FC = () => {
  const frame = useCurrentFrame();
  // Gentle fade in at the top, duck slightly under the desktop VO beat,
  // and fade out over the final CTA.
  const volume = interpolate(
    frame,
    [0, 20, 1700, 1800],
    [0, 0.75, 0.75, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill style={{ backgroundColor: theme.color.bgDeep }}>
      <Audio src={staticFile("soundtrack.mp3")} volume={volume} />
      <Sequence durationInFrames={210} name="1 · Hook">
        <Scene1Hook />
      </Sequence>
      <Sequence from={210} durationInFrames={210} name="2 · Brand">
        <Scene2Logo />
      </Sequence>
      <Sequence from={420} durationInFrames={300} name="3 · Desktop">
        <Scene3Desktop />
      </Sequence>
      <Sequence from={720} durationInFrames={600} name="4 · Features">
        <Scene4Features />
      </Sequence>
      <Sequence from={1320} durationInFrames={240} name="5 · Why">
        <Scene5Why />
      </Sequence>
      <Sequence from={1560} durationInFrames={240} name="6 · CTA">
        <Scene6CTA />
      </Sequence>
    </AbsoluteFill>
  );
};
