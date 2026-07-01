import React from "react";
import { Composition } from "remotion";
import { OsIntro } from "./OsIntro";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="OsIntro"
      component={OsIntro}
      durationInFrames={1800}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
