import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Sequence,
} from "remotion";
import { HeroMedia } from "../components/HeroMedia";
import { Particles } from "../components/Particles";
import { SlamText } from "../components/KineticText";
import { Vignette, Flash, LightSweep } from "../components/Overlays";
import { OsIcon, OS_APPS } from "../components/OsIcons";
import { hexToRgba } from "../components/Background";
import { theme } from "../theme";
import { interFamily } from "../fonts";

const STATS = [
  { metric: "20+", label: "apps, one desktop", at: 96, accent: theme.color.brand },
  { metric: "0", label: "spreadsheets", at: 132, accent: theme.color.green },
  { metric: "1-click", label: "audit-ready exports", at: 168, accent: theme.color.amber },
];

/** Scene F — momentum: real app icons explode into a ring, stats slam in. */
export const EpicF_Momentum: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const outro = interpolate(frame, [212, 240], [1, 0], { extrapolateLeft: "clamp" });
  const headIn = spring({ frame, fps, config: { damping: 200 } });
  const R = 300;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000", fontFamily: interFamily }}>
      <AbsoluteFill style={{ opacity: 0.9 * outro }}>
        <HeroMedia asset="burst" durationInFrames={240} fromScale={1.15} toScale={1.35} />
      </AbsoluteFill>
      <Particles count={70} seed={33} speed={1.6} />
      {/* center scrim so headline / icons / stats read over the burst */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse 60% 55% at 50% 52%, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.25) 45%, transparent 70%)",
        }}
      />
      <Vignette strength={0.72} />

      {/* exploding app-icon ring */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: outro }}>
        <div style={{ position: "relative", width: 1, height: 1 }}>
          {OS_APPS.map((app, i) => {
            const a = (i / OS_APPS.length) * Math.PI * 2 - Math.PI / 2;
            const burst = spring({ frame: frame - 6 - i * 2, fps, config: { damping: 120, mass: 0.8 } });
            const rad = R * burst;
            const spin = interpolate(frame, [0, 240], [0, 40]);
            const x = Math.cos(a + spin * 0.01) * rad;
            const y = Math.sin(a + spin * 0.01) * rad;
            return (
              <div
                key={app.id}
                style={{
                  position: "absolute",
                  left: x - 30,
                  top: y - 30,
                  width: 60,
                  height: 60,
                  borderRadius: 15,
                  background: app.id === "admin_console" ? theme.color.brand : "rgba(255,255,255,0.95)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: burst,
                  transform: `scale(${burst}) rotate(${(1 - burst) * 180}deg)`,
                  boxShadow: `0 10px 30px rgba(0,0,0,0.5)`,
                }}
              >
                <OsIcon name={app.icon} size={30} color={app.id === "admin_console" ? "#fff" : theme.color.brand} />
              </div>
            );
          })}
        </div>
      </AbsoluteFill>

      {/* headline */}
      <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 92, opacity: outro }}>
        <div style={{ opacity: headIn, transform: `translateY(${(1 - headIn) * -12}px)`, textAlign: "center" }}>
          <div style={{ color: theme.color.brand, fontWeight: 800, letterSpacing: 5, textTransform: "uppercase", fontSize: 20 }}>
            Why it wins
          </div>
          <div style={{ fontSize: 46, fontWeight: 900, color: theme.color.text, marginTop: 10 }}>
            The best books your firm has ever kept.
          </div>
        </div>
      </AbsoluteFill>

      {/* stat slams */}
      {STATS.map((s) => (
        <Sequence key={s.metric} from={s.at} durationInFrames={240 - s.at}>
          <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 96, opacity: outro }}>
            <StatSlam metric={s.metric} label={s.label} accent={s.accent} />
          </AbsoluteFill>
        </Sequence>
      ))}
      {STATS.map((s) => (
        <Flash key={s.label} at={s.at} duration={6} color={s.accent} />
      ))}
      <LightSweep from={60} to={130} />
    </AbsoluteFill>
  );
};

const StatSlam: React.FC<{ metric: string; label: string; accent: string }> = ({ metric, label, accent }) => {
  const frame = useCurrentFrame();
  const fade = interpolate(frame, [0, 6, 30, 40], [0, 1, 1, 0], { extrapolateRight: "clamp" });
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 20, opacity: fade }}>
      <SlamText text={metric} startFrame={0} fontSize={120} color={accent} />
      <span style={{ fontSize: 40, fontWeight: 700, color: theme.color.text, textShadow: "0 4px 20px #000" }}>{label}</span>
    </div>
  );
};
