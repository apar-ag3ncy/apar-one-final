import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { Background } from "../components/Background";
import { FeaturePanel } from "../components/FeaturePanel";
import {
  StatementTable,
  TrialBalanceMini,
  AgingBuckets,
  ExportDoc,
  BarChart,
  StatCard,
} from "../components/Mockups";
import { theme } from "../theme";

const D = 120; // frames per feature (4s @30fps)

/** Scene 4 — five product features, each a split slide over one backdrop. */
export const Scene4Features: React.FC = () => {
  return (
    <AbsoluteFill>
      <Background glowIntensity={0.45} grid />

      <Sequence durationInFrames={D}>
        <FeaturePanel
          tag="Ledger core"
          accent="#3f4e8e"
          title={<>An always-balanced trial balance.</>}
          benefit="Every transaction posts to both sides. Debits and credits reconcile in real time — never chase a mismatch again."
          windowTitle="Trial Balance"
          windowSubtitle="Posted GL only · as of 30 Apr 2026"
          windowWidth={780}
          duration={D}
          renderMock={(r) => <TrialBalanceMini reveal={r} />}
        />
      </Sequence>

      <Sequence from={D} durationInFrames={D}>
        <FeaturePanel
          tag="Reporting"
          accent={theme.color.green}
          title={<>P&L and Balance Sheet, live.</>}
          benefit="Revenue, direct cost and operating expense roll up the moment a transaction lands. Close the month in minutes, not days."
          windowTitle="Profit & Loss"
          windowSubtitle="FY 25-26 · YTD"
          windowWidth={780}
          duration={D}
          renderMock={(r) => <PnLMock reveal={r} />}
        />
      </Sequence>

      <Sequence from={D * 2} durationInFrames={D}>
        <FeaturePanel
          tag="Statements"
          accent={theme.color.brand}
          title={<>Statements that read themselves.</>}
          benefit="Rich particulars, references and a running balance on every line — for any client or vendor, at any date."
          windowTitle="Statement of Account — Tanishq"
          windowSubtitle="Ledger particulars · running balance"
          windowWidth={860}
          duration={D}
          renderMock={(r) => <StatementTable reveal={r} />}
        />
      </Sequence>

      <Sequence from={D * 3} durationInFrames={D}>
        <FeaturePanel
          tag="Cash flow"
          accent={theme.color.amber}
          title={<>Know who owes you, instantly.</>}
          benefit="Receivables and payables bucketed 0–30 through 90+ days, computed automatically from your ledger."
          bullets={["AR & AP aging", "Drill down to any invoice"]}
          windowTitle="AR Aging"
          windowSubtitle="Outstanding by age bucket"
          windowWidth={760}
          duration={D}
          renderMock={(r) => (
            <div style={{ padding: "26px 30px" }}>
              <AgingBuckets reveal={r} />
            </div>
          )}
        />
      </Sequence>

      <Sequence from={D * 4} durationInFrames={D}>
        <FeaturePanel
          tag="Deliver"
          accent={theme.color.brand}
          title={<>Exports your clients trust.</>}
          benefit="Every statement, PDF and signed Excel carries your Apar branding — audit-ready, in a single click."
          windowTitle="Export — Lodha Group"
          windowSubtitle="PDF · Signed Excel"
          windowWidth={760}
          duration={D}
          renderMock={(r) => <ExportDoc reveal={r} />}
        />
      </Sequence>
    </AbsoluteFill>
  );
};

const PnLMock: React.FC<{ reveal: number }> = ({ reveal }) => (
  <div style={{ padding: "22px 28px", display: "flex", flexDirection: "column", gap: 20 }}>
    <div style={{ display: "flex", gap: 16 }}>
      <StatCard label="Revenue" value="₹25.1L" delta="18% YoY" accent={theme.color.green} />
      <StatCard label="Net profit" value="₹9.4L" delta="37% margin" accent={theme.color.green} />
    </div>
    <div style={{ height: 180 }}>
      <BarChart grow={reveal} color={theme.color.green} />
    </div>
  </div>
);
