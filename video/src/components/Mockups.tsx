import React from "react";
import { theme } from "../theme";
import { AparLogo } from "./AparLogo";

const inr = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

/** A ledger / statement-of-account style table with running balance. */
export const StatementTable: React.FC<{ reveal?: number }> = ({
  reveal = 1,
}) => {
  const rows = [
    { date: "01 Apr", ref: "INV-26-0412", part: "Retainer — April", dr: 0, cr: 450000, bal: 450000 },
    { date: "07 Apr", ref: "RCPT-0031", part: "NEFT received", dr: 450000, cr: 0, bal: 0 },
    { date: "12 Apr", ref: "INV-26-0455", part: "Campaign production", dr: 0, cr: 780000, bal: 780000 },
    { date: "18 Apr", ref: "CN-0009", part: "Credit note — rework", dr: 60000, cr: 0, bal: 720000 },
    { date: "24 Apr", ref: "INV-26-0501", part: "Media buying fee", dr: 0, cr: 320000, bal: 1040000 },
  ];
  return (
    <div style={{ padding: "8px 26px 26px", fontSize: 15 }}>
      <Row header cols={["Date", "Reference", "Particulars", "Debit", "Credit", "Balance"]} />
      {rows.map((r, i) => {
        const shown = reveal * rows.length > i + 0.4;
        return (
          <div
            key={r.ref}
            style={{
              opacity: shown ? 1 : 0,
              transform: shown ? "translateY(0)" : "translateY(14px)",
              transition: "all 0.4s",
            }}
          >
            <Row
              cols={[
                r.date,
                r.ref,
                r.part,
                r.dr ? inr(r.dr) : "—",
                r.cr ? inr(r.cr) : "—",
                inr(r.bal),
              ]}
              accentLast
            />
          </div>
        );
      })}
    </div>
  );
};

const Row: React.FC<{
  cols: string[];
  header?: boolean;
  accentLast?: boolean;
}> = ({ cols, header, accentLast }) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "0.8fr 1.2fr 2fr 1fr 1fr 1.1fr",
      padding: "13px 8px",
      borderBottom: `1px solid ${theme.color.stroke}`,
      color: header ? theme.color.textFaint : theme.color.text,
      fontWeight: header ? 700 : 500,
      fontSize: header ? 12 : 15,
      letterSpacing: header ? 0.6 : 0,
      textTransform: header ? "uppercase" : "none",
    }}
  >
    {cols.map((c, i) => (
      <span
        key={i}
        style={{
          textAlign: i >= 3 ? "right" : "left",
          color:
            !header && i === 2
              ? theme.color.textMuted
              : accentLast && i === 5
                ? theme.color.brandBright
                : undefined,
          fontVariantNumeric: "tabular-nums",
          fontWeight: accentLast && i === 5 && !header ? 700 : undefined,
        }}
      >
        {c}
      </span>
    ))}
  </div>
);

/** KPI stat card with an animated count-up value. */
export const StatCard: React.FC<{
  label: string;
  value: string;
  delta?: string;
  positive?: boolean;
  accent?: string;
}> = ({ label, value, delta, positive = true, accent = theme.color.brand }) => (
  <div
    style={{
      flex: 1,
      background: theme.color.surface,
      border: `1px solid ${theme.color.stroke}`,
      borderRadius: theme.radius.md,
      padding: "22px 24px",
      display: "flex",
      flexDirection: "column",
      gap: 10,
    }}
  >
    <span style={{ color: theme.color.textMuted, fontSize: 15, fontWeight: 600 }}>
      {label}
    </span>
    <span
      style={{
        color: theme.color.text,
        fontSize: 34,
        fontWeight: 800,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {value}
    </span>
    {delta && (
      <span
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: positive ? theme.color.green : accent,
        }}
      >
        {positive ? "▲" : "▼"} {delta}
      </span>
    )}
  </div>
);

/** Compact trial-balance table that proves debits == credits. */
export const TrialBalanceMini: React.FC<{ reveal?: number }> = ({
  reveal = 1,
}) => {
  const rows = [
    { code: "1110", name: "Cash & Bank", dr: 1840000, cr: 0 },
    { code: "1120", name: "Accounts Receivable", dr: 1040000, cr: 0 },
    { code: "2100", name: "Accounts Payable", dr: 0, cr: 620000 },
    { code: "4000", name: "Service Revenue", dr: 0, cr: 2510000 },
    { code: "6200", name: "Office Utilities", dr: 250000, cr: 0 },
  ];
  const drTotal = rows.reduce((s, r) => s + r.dr, 0);
  const crTotal = rows.reduce((s, r) => s + r.cr, 0);
  return (
    <div style={{ padding: "10px 26px 22px", fontSize: 15 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "0.7fr 2fr 1fr 1fr",
          padding: "10px 6px",
          color: theme.color.textFaint,
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          borderBottom: `1px solid ${theme.color.stroke}`,
        }}
      >
        <span>Code</span>
        <span>Account</span>
        <span style={{ textAlign: "right" }}>Debit</span>
        <span style={{ textAlign: "right" }}>Credit</span>
      </div>
      {rows.map((r, i) => {
        const shown = reveal * rows.length > i + 0.3;
        return (
          <div
            key={r.code}
            style={{
              display: "grid",
              gridTemplateColumns: "0.7fr 2fr 1fr 1fr",
              padding: "12px 6px",
              borderBottom: `1px solid ${theme.color.stroke}`,
              color: theme.color.text,
              fontVariantNumeric: "tabular-nums",
              opacity: shown ? 1 : 0,
              transform: shown ? "none" : "translateY(10px)",
              transition: "all 0.35s",
            }}
          >
            <span style={{ color: theme.color.textFaint }}>{r.code}</span>
            <span style={{ color: theme.color.textMuted }}>{r.name}</span>
            <span style={{ textAlign: "right" }}>{r.dr ? inr(r.dr) : "—"}</span>
            <span style={{ textAlign: "right" }}>{r.cr ? inr(r.cr) : "—"}</span>
          </div>
        );
      })}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "0.7fr 2fr 1fr 1fr",
          padding: "14px 6px 4px",
          color: theme.color.text,
          fontWeight: 800,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span />
        <span
          style={{
            color: theme.color.green,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            style={{
              width: 20,
              height: 20,
              borderRadius: 999,
              background: theme.color.greenSoft,
              color: theme.color.green,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
            }}
          >
            ✓
          </span>
          In balance
        </span>
        <span style={{ textAlign: "right" }}>{inr(drTotal)}</span>
        <span style={{ textAlign: "right" }}>{inr(crTotal)}</span>
      </div>
    </div>
  );
};

/** A branded export document (invoice/statement) with the Apar mark. */
export const ExportDoc: React.FC<{ reveal?: number }> = ({ reveal = 1 }) => (
  <div
    style={{
      margin: "26px",
      background: "#fbf9f7",
      borderRadius: 12,
      padding: "28px 30px",
      color: "#1a1411",
      boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
      transform: `translateY(${(1 - reveal) * 20}px)`,
      opacity: reveal,
    }}
  >
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        borderBottom: "2px solid #ee3a24",
        paddingBottom: 16,
      }}
    >
      <AparLogo color="#ee3a24" width={110} />
      <div style={{ textAlign: "right" }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>STATEMENT</div>
        <div style={{ color: "#6b5f58", fontSize: 13 }}>INV-26-0501</div>
      </div>
    </div>
    <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 11 }}>
      {[
        ["Media buying fee — April", "₹3,20,000"],
        ["Campaign production", "₹7,80,000"],
        ["Less: credit note", "− ₹60,000"],
      ].map(([l, v]) => (
        <div
          key={l}
          style={{ display: "flex", justifyContent: "space-between", fontSize: 15 }}
        >
          <span style={{ color: "#6b5f58" }}>{l}</span>
          <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {v}
          </span>
        </div>
      ))}
    </div>
    <div
      style={{
        marginTop: 16,
        paddingTop: 14,
        borderTop: "1px solid #e5dcd6",
        display: "flex",
        justifyContent: "space-between",
        fontSize: 18,
        fontWeight: 800,
      }}
    >
      <span>Balance due</span>
      <span style={{ color: "#ee3a24" }}>₹10,40,000</span>
    </div>
    <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
      {["PDF", "Signed Excel", "Apar-branded"].map((b) => (
        <span
          key={b}
          style={{
            fontSize: 12,
            fontWeight: 700,
            padding: "5px 12px",
            borderRadius: 999,
            background: "rgba(238,58,36,0.1)",
            color: "#c22a17",
          }}
        >
          {b}
        </span>
      ))}
    </div>
  </div>
);

/** Simple animated bar chart. `grow` 0..1 scales bar heights. */
export const BarChart: React.FC<{
  grow?: number;
  color?: string;
  data?: number[];
}> = ({ grow = 1, color = theme.color.brand, data }) => {
  const bars = data ?? [42, 58, 47, 71, 63, 88, 79, 96];
  const max = Math.max(...bars);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 12,
        height: "100%",
        padding: "10px 4px 0",
      }}
    >
      {bars.map((b, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: `${(b / max) * 100 * grow}%`,
            background: `linear-gradient(180deg, ${color}, ${color}55)`,
            borderRadius: 8,
            minHeight: 4,
          }}
        />
      ))}
    </div>
  );
};

/** Donut-ish aging buckets legend. */
export const AgingBuckets: React.FC<{ reveal?: number }> = ({ reveal = 1 }) => {
  const buckets = [
    { label: "0–30 days", pct: 62, color: theme.color.green },
    { label: "31–60 days", pct: 24, color: theme.color.amber },
    { label: "61–90 days", pct: 9, color: theme.color.brandBright },
    { label: "90+ days", pct: 5, color: theme.color.brandDeep },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 6 }}>
      {buckets.map((b) => (
        <div key={b.label} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15 }}>
            <span style={{ color: theme.color.textMuted, fontWeight: 600 }}>
              {b.label}
            </span>
            <span style={{ color: theme.color.text, fontWeight: 700 }}>
              {b.pct}%
            </span>
          </div>
          <div
            style={{
              height: 10,
              borderRadius: 999,
              background: theme.color.surfaceRaised,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${b.pct * reveal}%`,
                background: b.color,
                borderRadius: 999,
                transition: "width 0.5s",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};
