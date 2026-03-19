import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

import { COLORS, THRESHOLDS, MEETING_HEAVY_PCT } from "../constants";
import { getStatus } from "../utils";
import { CustomTooltip, CardPanel, ColorDot } from "../components";

interface WeeklySummaryEntry {
  name: string;
  avg: number | null;
  sum: number | null;
  devAvg: number;
  meetAvg: number;
  daysReported: number;
  meetSum: number;
  meetPct: number;
  trend: string;
  stdDev: number | null;
  stabilityPct: number;
  stabilityColor: string;
  commitTotal: number;
  commitAvg: number;
  consistency: { ok: number; warn: number; red: number };
}

interface WeeklyViewProps {
  weeklySummary: WeeklySummaryEntry[];
  chartHeight: number;
  members: string[];
  memberColors: Record<string, string>;
  selectedMembers: Set<string>;
  onToggleMember: (name: string) => void;
  isMobile: boolean;
  dates: string[];
}

export function WeeklyView({
  weeklySummary,
  chartHeight,
  members,
  memberColors,
  selectedMembers,
  onToggleMember,
  isMobile,
  dates,
}: WeeklyViewProps) {
  return (
    <div>
      <div className="animate-in" style={{ animationDelay: "0.15s" }}>
        <CardPanel title="日均工時分佈（開發 + 會議）">
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart data={weeklySummary} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} horizontal={false} />
              <XAxis type="number" domain={[0, 10]} tick={{ fill: COLORS.textDim, fontSize: 11 }} axisLine={{ stroke: COLORS.border }} tickLine={false} unit="hr" />
              <YAxis type="category" dataKey="name" width={48} tick={{ fill: COLORS.text, fontSize: 12, fontWeight: 600 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine x={THRESHOLDS.target} stroke={COLORS.green} strokeDasharray="6 4" strokeWidth={1.5} label={{ value: `${THRESHOLDS.target}hr`, fill: COLORS.green, fontSize: 11, position: "top" }} />
              <ReferenceLine x={THRESHOLDS.ok} stroke={COLORS.yellow} strokeDasharray="4 4" strokeWidth={1} />
              <Bar dataKey="devAvg" name="開發" stackId="a" fill={COLORS.accentLight} barSize={22} />
              <Bar dataKey="meetAvg" name="會議" stackId="a" fill={COLORS.purple} radius={[0, 4, 4, 0]} barSize={22} />
              <Legend wrapperStyle={{ fontSize: 12, color: COLORS.textMuted, paddingTop: 8 }} />
            </BarChart>
          </ResponsiveContainer>
        </CardPanel>
      </div>

      <div className="animate-in" style={{ animationDelay: "0.2s" }}>
        <CardPanel title="週統計明細" padding={20}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 2px", fontSize: 13, minWidth: isMobile ? 550 : "auto" }}>
              <thead>
                <tr>
                  {["成員", "回報", "總工時", "日均", "會議%", "穩定度", "Commits", "日均C", "一致性", "趨勢"].map((h, i) => {
                    const isTealHeader = h === "Commits" || h === "日均C" || h === "一致性";
                    return (
                      <th key={h} style={{ textAlign: h === "成員" ? "left" : "center", padding: "10px 8px", borderBottom: `1px solid ${COLORS.border}`, color: isTealHeader ? COLORS.teal : COLORS.textMuted, fontWeight: 600, fontSize: 11, whiteSpace: "nowrap", ...(i === 0 ? { position: "sticky" as const, left: 0, background: COLORS.card, zIndex: 1 } : {}), ...(h === "Commits" ? { borderLeft: `2px solid ${COLORS.tealDim}` } : {}) }}>{h}</th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {weeklySummary.map(m => {
                  const st = getStatus(m.avg);
                  const isHighlighted = selectedMembers.has(m.name);
                  return (
                    <tr key={m.name} onClick={() => onToggleMember(m.name)} style={{ cursor: "pointer", transition: "background 0.15s ease" }}>
                      <td style={{ padding: "9px 8px", fontWeight: 600, whiteSpace: "nowrap", position: "sticky", left: 0, background: isHighlighted ? memberColors[m.name] + "15" : COLORS.card, zIndex: 1, borderBottom: `1px solid ${COLORS.border}15` }}>
                        <ColorDot color={isHighlighted ? memberColors[m.name] : COLORS.textDim} />
                        <span style={{ color: isHighlighted ? memberColors[m.name] : COLORS.text }}>{m.name}</span>
                      </td>
                      <td style={{
                        textAlign: "center", padding: "9px 8px", fontVariantNumeric: "tabular-nums",
                        fontWeight: m.daysReported < dates.length ? 700 : 400,
                        color: m.daysReported < dates.length ? COLORS.yellow : COLORS.textMuted,
                        background: m.daysReported < dates.length - 2 ? COLORS.red + "12" : "transparent",
                        borderBottom: `1px solid ${COLORS.border}15`,
                      }}>
                        {m.daysReported}/{dates.length}
                      </td>
                      <td style={{ textAlign: "center", padding: "9px 8px", fontWeight: 600, fontVariantNumeric: "tabular-nums", borderBottom: `1px solid ${COLORS.border}15` }}>
                        {m.sum !== null ? m.sum : "—"}
                      </td>
                      <td style={{
                        textAlign: "center", padding: "9px 8px", fontWeight: 700, fontVariantNumeric: "tabular-nums",
                        color: st.color,
                        background: m.avg !== null ? st.color + "12" : "transparent",
                        borderBottom: `1px solid ${COLORS.border}15`,
                      }}>
                        {m.avg !== null ? m.avg : "—"}
                      </td>
                      <td style={{
                        textAlign: "center", padding: "9px 8px",
                        background: m.meetPct > MEETING_HEAVY_PCT ? COLORS.yellow + "15" : "transparent",
                        borderBottom: `1px solid ${COLORS.border}15`,
                      }}>
                        <span style={{ color: m.meetPct > MEETING_HEAVY_PCT ? COLORS.yellow : m.meetPct > 30 ? COLORS.textMuted : COLORS.textDim, fontWeight: m.meetPct > MEETING_HEAVY_PCT ? 700 : 400 }}>
                          {m.sum ? `${m.meetPct}%` : "—"}{m.meetPct > MEETING_HEAVY_PCT ? " ⚠" : ""}
                        </span>
                      </td>
                      <td style={{ textAlign: "center", padding: "9px 8px", borderBottom: `1px solid ${COLORS.border}15`, minWidth: 64 }}>
                        {m.stdDev !== null ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "center" }}>
                            <div style={{ width: 36, height: 5, borderRadius: 3, background: COLORS.bg, overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${m.stabilityPct}%`, borderRadius: 3, background: m.stabilityColor, transition: "width 0.4s ease" }} />
                            </div>
                            <span style={{ fontSize: 10, color: m.stabilityColor, fontWeight: 600, minWidth: 14 }}>{m.stdDev.toFixed(1)}</span>
                          </div>
                        ) : <span style={{ color: COLORS.textDim, fontSize: 10 }}>—</span>}
                      </td>
                      <td style={{ textAlign: "center", padding: "9px 8px", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: m.commitTotal > 0 ? COLORS.teal : COLORS.textDim, borderBottom: `1px solid ${COLORS.border}15`, borderLeft: `2px solid ${COLORS.tealDim}` }}>
                        {m.commitTotal > 0 ? m.commitTotal : "—"}
                      </td>
                      <td style={{ textAlign: "center", padding: "9px 8px", fontVariantNumeric: "tabular-nums", color: m.commitAvg > 0 ? COLORS.teal : COLORS.textDim, borderBottom: `1px solid ${COLORS.border}15` }}>
                        {m.commitAvg > 0 ? m.commitAvg : "—"}
                      </td>
                      <td style={{ textAlign: "center", padding: "9px 8px", fontSize: 11, borderBottom: `1px solid ${COLORS.border}15`, whiteSpace: "nowrap" }}>
                        {(m.consistency.ok + m.consistency.warn + m.consistency.red) > 0 ? (
                          <span>
                            {m.consistency.ok > 0 && <span style={{ color: COLORS.green }}>✅{m.consistency.ok}</span>}
                            {m.consistency.ok > 0 && m.consistency.warn > 0 && ' '}
                            {m.consistency.warn > 0 && <span style={{ color: COLORS.yellow }}>⚠️{m.consistency.warn}</span>}
                            {(m.consistency.ok > 0 || m.consistency.warn > 0) && m.consistency.red > 0 && ' '}
                            {m.consistency.red > 0 && <span style={{ color: COLORS.red }}>🔴{m.consistency.red}</span>}
                          </span>
                        ) : <span style={{ color: COLORS.textDim }}>—</span>}
                      </td>
                      <td style={{ textAlign: "center", padding: "9px 6px", fontSize: 13, borderBottom: `1px solid ${COLORS.border}15` }}>{m.trend}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardPanel>
      </div>
    </div>
  );
}
