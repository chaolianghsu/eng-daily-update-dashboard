import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

import { COLORS, THRESHOLDS, MEETING_HEAVY_PCT } from "../constants";
import { isOnLeave, getStatus } from "../utils";
import { CustomTooltip, CardPanel, StatusBadge } from "../components";
import type { CommitData, LeaveRange } from "../types";

interface DailyViewProps {
  dailyDates: string[];
  activeDate: string;
  onDateSelect: (date: string) => void;
  dayLabels: Record<string, string>;
  weekLabel: string;
  dailyBarData: Array<{ name: string; 開發: number; 會議: number; total: number | null }>;
  chartHeight: number;
  memberColors: Record<string, string>;
  issueMap: Record<string, { severity: string; text: string }>;
  commitData: CommitData | null;
  leave: Record<string, LeaveRange[]>;
}

export function DailyView({
  dailyDates, activeDate, onDateSelect, dayLabels, weekLabel,
  dailyBarData, chartHeight, memberColors, issueMap, commitData, leave,
}: DailyViewProps) {
  return (
    <div>
      <div className="animate-in" style={{ animationDelay: "0.15s", marginBottom: 20 }}>
        <p className="week-label" style={{ fontSize: 13, color: COLORS.textDim, marginBottom: 10, fontWeight: 600, letterSpacing: "0.03em" }}>
          {weekLabel}
        </p>
        <div className="date-scroll">
          {dailyDates.map(d => (
            <button key={d} className="date-btn" onClick={() => onDateSelect(d)}
              style={{
                padding: "8px 20px", borderRadius: 8, cursor: "pointer",
                fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                border: activeDate === d ? `2px solid ${COLORS.accent}` : `1px solid ${COLORS.border}`,
                background: activeDate === d ? "rgba(59,130,246,0.15)" : "transparent",
                color: activeDate === d ? COLORS.accentLight : COLORS.textMuted,
              }}
            >{d}（{dayLabels[d]}）</button>
          ))}
        </div>
      </div>

      <div className="animate-in" style={{ animationDelay: "0.2s" }}>
        <CardPanel title={`${activeDate} 個人工時（開發 + 會議）`}>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <ComposedChart data={dailyBarData} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} horizontal={false} />
              <XAxis type="number" domain={[0, 10]} tick={{ fill: COLORS.textDim, fontSize: 11 }} axisLine={{ stroke: COLORS.border }} tickLine={false} unit="hr" />
              <YAxis type="category" dataKey="name" width={48} tick={{ fill: COLORS.text, fontSize: 12, fontWeight: 600 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine x={THRESHOLDS.target} stroke={COLORS.green} strokeDasharray="6 4" strokeWidth={1.5} label={{ value: `${THRESHOLDS.target}hr`, fill: COLORS.green, fontSize: 11, position: "top" }} />
              <ReferenceLine x={THRESHOLDS.ok} stroke={COLORS.yellow} strokeDasharray="4 4" strokeWidth={1} label={{ value: `${THRESHOLDS.ok}`, fill: COLORS.yellow, fontSize: 10, position: "top" }} />
              <Bar dataKey="開發" stackId="a" fill={COLORS.accentLight} barSize={22} />
              <Bar dataKey="會議" stackId="a" fill={COLORS.purple} radius={[0, 4, 4, 0]} barSize={22} />
              <Legend wrapperStyle={{ fontSize: 12, color: COLORS.textMuted, paddingTop: 8 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardPanel>
      </div>

      <div className="animate-in member-grid" style={{ animationDelay: "0.25s", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
        {dailyBarData.map((d, idx) => {
          const status = getStatus(d.total, isOnLeave(activeDate, leave[d.name]));
          const meetPct = d.total ? Math.round((d.會議 || 0) / d.total * 100) : 0;
          const issue = issueMap[d.name];
          return (
            <div key={d.name} className="member-card animate-in" style={{
              animationDelay: `${0.28 + idx * 0.04}s`,
              background: COLORS.card, borderRadius: 10, padding: "14px 12px",
              border: `1px solid ${issue?.severity === "🔴" ? COLORS.red + "44" : issue?.severity === "🟡" ? COLORS.yellow + "33" : COLORS.border}`,
              position: "relative",
            }}>
              {commitData && commitData.commits?.[activeDate]?.[d.name]?.count > 0 && (
                <span style={{ position: "absolute", top: 8, right: 8, background: COLORS.tealDim, color: COLORS.teal, padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
                  {commitData.commits[activeDate][d.name].count} commits
                </span>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{d.name}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <StatusBadge status={status} />
                  {commitData?.analysis?.[activeDate]?.[d.name] && (
                    <span style={{ fontSize: 12 }}>
                      {commitData.analysis[activeDate][d.name].status}
                    </span>
                  )}
                </span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: status.color, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
                {d.total !== null ? d.total : "—"}
                <span style={{ fontSize: 12, fontWeight: 500, color: COLORS.textDim }}>hr</span>
              </div>
              {d.total !== null && (
                <div style={{ marginTop: 6, height: 4, borderRadius: 2, background: COLORS.bg, overflow: "hidden", display: "flex" }}>
                  <div style={{ height: "100%", width: `${((d.開發 || 0) / 10) * 100}%`, background: COLORS.accentLight, transition: "width 0.5s ease" }} />
                  <div style={{ height: "100%", width: `${((d.會議 || 0) / 10) * 100}%`, background: COLORS.purple, transition: "width 0.5s ease" }} />
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                {meetPct > 0 ? (
                  <span style={{ fontSize: 10, color: meetPct > MEETING_HEAVY_PCT ? COLORS.yellow : COLORS.textDim }}>
                    會議 {meetPct}%{meetPct > MEETING_HEAVY_PCT ? " ⚠" : ""}
                  </span>
                ) : <span />}
                {issue && <span style={{ fontSize: 10 }}>{issue.severity}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
