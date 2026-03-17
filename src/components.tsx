// src/components.tsx
import { COLORS } from "./constants";
import type { StatusInfo } from "./types";

export const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: COLORS.card, border: `1px solid ${COLORS.border}`,
      borderRadius: 8, padding: "12px 16px", fontSize: 13,
      boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
    }}>
      <p style={{ color: COLORS.text, fontWeight: 700, marginBottom: 8, fontSize: 14 }}>{label}</p>
      {payload.filter((p: any) => p.value !== null && p.value !== undefined).map((p: any, i: number) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: p.color || p.stroke, display: "inline-block", flexShrink: 0 }} />
          <span style={{ color: COLORS.textMuted, minWidth: 36 }}>{p.name}:</span>
          <span style={{ color: COLORS.text, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {p.value}hr
          </span>
        </div>
      ))}
    </div>
  );
};

export const CardPanel = ({ title, children, padding }: { title: string; children: React.ReactNode; padding?: string | number }) => (
  <div className="card-panel" style={{ background: COLORS.card, borderRadius: 12, padding: padding || "20px 16px 8px", border: `1px solid ${COLORS.border}`, marginBottom: 20 }}>
    <p style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 12, fontWeight: 600 }}>{title}</p>
    {children}
  </div>
);

export const ColorDot = ({ color }: { color: string }) => (
  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color, marginRight: 8, verticalAlign: "middle" }} />
);

export const StatusBadge = ({ status }: { status: StatusInfo }) => (
  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: status.bg, color: status.color }}>
    {status.label}
  </span>
);

export const tabStyle = (active: boolean) => ({
  padding: "8px 20px", borderRadius: 8, border: "none", cursor: "pointer",
  fontSize: 13, fontWeight: 600, fontFamily: "inherit",
  background: active ? COLORS.accent : "transparent",
  color: active ? "#fff" : COLORS.textMuted,
});
