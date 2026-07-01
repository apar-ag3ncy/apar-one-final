import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { KenBurns } from "../components/KenBurns";
import { theme } from "../theme";
import { interFamily } from "../fonts";
import { hexToRgba } from "../components/Background";

/**
 * Scene 3 — the desktop reveal. The real Apar OS desktop (dark, captured from
 * production) powers on and pulls back to reveal the full workspace + dock,
 * driving home the literal "operating system for your books" idea.
 */
export const Scene3Desktop: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const powerOn = spring({ frame, fps, config: { damping: 200 } });
  const eyebrow = spring({ frame: frame - 16, fps, config: { damping: 200 } });
  const headline = spring({ frame: frame - 24, fps, config: { damping: 200 } });
  const caption = spring({ frame: frame - 40, fps, config: { damping: 200 } });
  const outro = interpolate(frame, [272, 300], [1, 0], {
    extrapolateLeft: "clamp",
  });

  return (
    <AbsoluteFill
      style={{ fontFamily: interFamily, backgroundColor: theme.color.bgDeep }}
    >
      <AbsoluteFill style={{ opacity: powerOn * outro }}>
        {/* real desktop, gently pulling back to reveal the whole OS + dock */}
        <KenBurns
          src="os/desktop-dark.png"
          durationInFrames={300}
          fromScale={1.1}
          toScale={1.0}
          focalX={50}
          focalY={44}
        />

        {/* top scrim only — keeps the dock at the bottom fully visible */}
        <AbsoluteFill
          style={{
            background: `linear-gradient(180deg, ${hexToRgba(
              theme.color.bgDeep,
              0.94,
            )} 0%, ${hexToRgba(theme.color.bgDeep, 0.6)} 20%, transparent 42%)`,
          }}
        />

        {/* headline block, pinned to the top */}
        <AbsoluteFill
          style={{
            justifyContent: "flex-start",
            alignItems: "center",
            paddingTop: 64,
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                opacity: eyebrow,
                transform: `translateY(${(1 - eyebrow) * -12}px)`,
                fontSize: 20,
                fontWeight: 800,
                letterSpacing: 5,
                textTransform: "uppercase",
                color: theme.color.brand,
                marginBottom: 14,
              }}
            >
              Introducing the OS
            </div>
            <div
              style={{
                opacity: headline,
                transform: `translateY(${(1 - headline) * -14}px)`,
                fontSize: 56,
                fontWeight: 800,
                color: theme.color.text,
                textShadow: "0 6px 30px rgba(0,0,0,0.7)",
              }}
            >
              Your books, as an operating system.
            </div>
            <div
              style={{
                opacity: caption,
                transform: `translateY(${(1 - caption) * -10}px)`,
                marginTop: 18,
                fontSize: 27,
                fontWeight: 500,
                color: theme.color.textMuted,
                textShadow: "0 2px 20px rgba(0,0,0,0.8)",
              }}
            >
              One workspace ·{" "}
              <span style={{ color: theme.color.text }}>
                every ledger, statement & report
              </span>
            </div>
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
