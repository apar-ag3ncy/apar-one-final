import React from "react";
import {
  AbsoluteFill,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { HeroMedia } from "../components/HeroMedia";
import { Glass3DPanel } from "../components/Glass3DPanel";
import { Particles } from "../components/Particles";
import { Vignette, Grid3D, LightSweep } from "../components/Overlays";
import { hexToRgba } from "../components/Background";
import { theme } from "../theme";
import { interFamily } from "../fonts";

const D = 135; // frames per feature

type Feat = {
  src: string;
  tag: string;
  title: string;
  benefit: string;
  accent: string;
  side: "left" | "right";
};

const FEATURES: Feat[] = [
  {
    src: "os/trial-balance.png",
    tag: "Ledger core",
    title: "Always balanced.",
    benefit: "Debits and credits reconcile in real time. Never chase a mismatch again.",
    accent: "#5b8def",
    side: "right",
  },
  {
    src: "os/pnl.png",
    tag: "Reporting",
    title: "P&L, live.",
    benefit: "Revenue, cost and profit roll up the instant a transaction lands.",
    accent: theme.color.green,
    side: "left",
  },
  {
    src: "os/statement.png",
    tag: "Statements",
    title: "Every line, explained.",
    benefit: "Rich particulars and a running balance for any client or vendor.",
    accent: theme.color.brand,
    side: "right",
  },
  {
    src: "os/balance-sheet.png",
    tag: "Deliver",
    title: "Branded exports.",
    benefit: "Signed Excel and Apar-branded PDF your auditors trust — one click.",
    accent: theme.color.amber,
    side: "left",
  },
];

const FeatureCard3D: React.FC<{ feat: Feat }> = ({ feat }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dir = feat.side === "right" ? 1 : -1;

  const inP = spring({ frame, fps, config: { damping: 150, mass: 1 } });
  const out = interpolate(frame, [D - 18, D], [1, 0], { extrapolateLeft: "clamp" });
  const x = interpolate(inP, [0, 1], [dir * 900, dir * 300]);
  const rotY = interpolate(inP, [0, 1], [dir * 55, dir * -14]);
  const scale = interpolate(inP, [0, 1], [0.72, 1]);
  const float = Math.sin(frame / 26) * 10;
  const drift = interpolate(frame, [0, D], [0, dir * -40]); // slow parallax

  const textIn = spring({ frame: frame - 12, fps, config: { damping: 200 } });
  const textX = feat.side === "right" ? -1 : 1;

  const scrimDir = feat.side === "right" ? "90deg" : "270deg";
  return (
    <AbsoluteFill style={{ opacity: out }}>
      {/* caption-side scrim for guaranteed legibility over bright bg */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(${scrimDir}, ${hexToRgba(
            theme.color.bgDeep,
            0.9,
          )} 0%, ${hexToRgba(theme.color.bgDeep, 0.55)} 24%, transparent 50%)`,
          opacity: textIn,
        }}
      />
      {/* panel */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            transform: `translateX(${x + drift}px) translateY(${float}px) scale(${scale})`,
            opacity: inP,
          }}
        >
          <Glass3DPanel
            src={feat.src}
            width={1120}
            height={700}
            rotX={6}
            rotY={rotY}
            glow={feat.accent}
            glowStrength={0.7}
          />
        </div>
      </AbsoluteFill>

      {/* caption on the opposite side */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: feat.side === "right" ? "flex-start" : "flex-end",
          padding: "0 130px",
        }}
      >
        <div
          style={{
            width: 500,
            textAlign: feat.side === "right" ? "left" : "right",
            opacity: textIn,
            transform: `translateX(${(1 - textIn) * textX * 60}px)`,
          }}
        >
          <span
            style={{
              display: "inline-block",
              fontSize: 17,
              fontWeight: 800,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: feat.accent,
              padding: "8px 16px",
              borderRadius: 999,
              background: hexToRgba(feat.accent, 0.16),
              border: `1px solid ${hexToRgba(feat.accent, 0.4)}`,
              marginBottom: 22,
            }}
          >
            {feat.tag}
          </span>
          <div style={{ fontSize: 68, fontWeight: 900, color: theme.color.text, lineHeight: 1.02, letterSpacing: -1, textShadow: "0 8px 40px rgba(0,0,0,0.7)" }}>
            {feat.title}
          </div>
          <div style={{ fontSize: 23, color: theme.color.textMuted, marginTop: 20, lineHeight: 1.5, fontWeight: 500, textShadow: "0 2px 20px rgba(0,0,0,0.8)" }}>
            {feat.benefit}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Scene E — feature barrage: real screenshots on flying 3D glass panels. */
export const EpicE_Features: React.FC = () => {
  const frame = useCurrentFrame();
  const intro = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ backgroundColor: theme.color.bgDeep, fontFamily: interFamily }}>
      <AbsoluteFill style={{ opacity: 0.85 * intro }}>
        <HeroMedia asset="city" durationInFrames={540} playbackRate={0.5} />
        <div style={{ position: "absolute", inset: 0, background: hexToRgba(theme.color.bgDeep, 0.6) }} />
      </AbsoluteFill>
      <Grid3D opacity={0.28} />
      <Particles count={44} seed={21} speed={0.8} opacity={0.5} />

      {FEATURES.map((f, i) => (
        <Sequence key={f.src} from={i * D} durationInFrames={D}>
          <FeatureCard3D feat={f} />
        </Sequence>
      ))}

      <LightSweep from={0} to={540} color="rgba(255,255,255,0.05)" />
      <Vignette strength={0.5} />
    </AbsoluteFill>
  );
};
