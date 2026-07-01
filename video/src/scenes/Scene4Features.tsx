import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { FeatureShot } from "../components/FeatureShot";
import { theme } from "../theme";

const D = 150; // frames per feature (5s @30fps) — 4 features = 600f

/**
 * Scene 4 — four product features, each a real 4K OS screenshot (captured
 * from production in dark mode) with animated copy. Only clean, real-data
 * windows are used.
 */
export const Scene4Features: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: theme.color.bgDeep }}>
      <Sequence durationInFrames={D}>
        <FeatureShot
          src="os/trial-balance.png"
          tag="Ledger core"
          accent="#5b8def"
          title={<>An always-balanced trial balance.</>}
          benefit="Every transaction posts to both sides. Debits and credits reconcile in real time — never chase a mismatch again."
          duration={D}
          focalX={54}
          focalY={40}
        />
      </Sequence>

      <Sequence from={D} durationInFrames={D}>
        <FeatureShot
          src="os/pnl.png"
          tag="Reporting"
          accent={theme.color.green}
          title={<>Profit & Loss, the instant you need it.</>}
          benefit="Revenue, direct cost and operating expense roll up automatically. Gross and net profit, always current."
          duration={D}
          focalX={52}
          focalY={42}
        />
      </Sequence>

      <Sequence from={D * 2} durationInFrames={D}>
        <FeatureShot
          src="os/statement.png"
          tag="Statements"
          accent={theme.color.brand}
          title={<>Every line, with a running balance.</>}
          benefit="Per-party statements with rich particulars and a live closing balance — and instant receivables aging, for any client or vendor."
          duration={D}
          focalX={52}
          focalY={44}
        />
      </Sequence>

      <Sequence from={D * 3} durationInFrames={D}>
        <FeatureShot
          src="os/balance-sheet.png"
          tag="Deliver"
          accent={theme.color.brand}
          title={<>Branded exports, in one click.</>}
          benefit="Balance sheet, P&L, any statement — exported to a signed Excel or an Apar-branded PDF your auditors trust."
          duration={D}
          focalX={72}
          focalY={20}
          fromScale={1.1}
          toScale={1.22}
        />
      </Sequence>
    </AbsoluteFill>
  );
};
