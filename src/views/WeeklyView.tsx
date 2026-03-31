import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

import { COLORS, THRESHOLDS, MEETING_HEAVY_PCT } from "../constants";
import { getStatus } from "../utils";
import { CustomTooltip, CardPanel, ColorDot } from "../components";
import type { CommitData, LeaveRange } from "../types";

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
  commitData: CommitData | null;
  leave: Record<string, LeaveRange[]>;
  dailyDates: string[];
  dayLabels: Record<string, string>;
  onDateSelect: (d: string) => void;
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
  commitData,
  leave,
  dailyDates,
  dayLabels,
  onDateSelect,
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

      {commitData && (() => {
        const { analysis } = commitData;
        const gridDates = dates.filter(d => analysis[d]);
        return (
          <div className="animate-in" style={{ animationDelay: "0.25s" }}>
            <CardPanel title="一致性總覽（全期間）">
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 2, fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ padding: "6px 10px", textAlign: "left", color: COLORS.textMuted, fontWeight: 600, fontSize: 11, whiteSpace: "nowrap", position: "sticky", left: 0, background: COLORS.card, zIndex: 1 }}>成員</th>
                      {gridDates.map(d => (
                        <th key={d} onClick={() => onDateSelect(d)} style={{
                          padding: "6px 6px", textAlign: "center", fontSize: 10, cursor: "pointer",
                          fontWeight: 400, color: COLORS.textMuted,
                          transition: "all 0.15s ease",
                        }}>{d}</th>
                      ))}
                      <th style={{ padding: "6px 8px", textAlign: "center", color: COLORS.teal, fontWeight: 600, fontSize: 10, whiteSpace: "nowrap" }}>合計</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.filter(m => gridDates.some(d => analysis[d]?.[m])).map(m => {
                      let totalCommits = 0, activeDays = 0;
                      gridDates.forEach(d => {
                        const a = analysis[d]?.[m];
                        if (a && a.commitCount > 0) { totalCommits += a.commitCount; activeDays++; }
                      });
                      return (
                        <tr key={m}>
                          <td style={{ padding: "4px 10px", color: COLORS.text, fontWeight: 600, fontSize: 12, whiteSpace: "nowrap", position: "sticky", left: 0, background: COLORS.card, zIndex: 1 }}>
                            <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: memberColors[m] || COLORS.textDim, marginRight: 6, verticalAlign: "middle" }} />
                            {m}
                          </td>
                          {gridDates.map(d => {
                            const a = analysis[d]?.[m];
                            const onLeaveDay = leave[m] && leave[m].some(r => {
                              const dn = d.split('/').map(Number);
                              const sn = r.start.split('/').map(Number);
                              const en = r.end.split('/').map(Number);
                              return (dn[0]*100+dn[1]) >= (sn[0]*100+sn[1]) && (dn[0]*100+dn[1]) <= (en[0]*100+en[1]);
                            });

                            let bg, color, topLabel, bottomLabel, tooltip;

                            if (a) {
                              const intensity = Math.min(1, 0.3 + (a.commitCount / 20) * 0.7);
                              const baseColor = a.status === '\u2705' ? COLORS.green : a.status === '\u26A0\uFE0F' ? COLORS.yellow : COLORS.red;
                              const baseBg = a.status === '\u2705' ? COLORS.greenDim : a.status === '\u26A0\uFE0F' ? COLORS.yellowDim : COLORS.redDim;
                              bg = baseBg + Math.round(intensity * 255).toString(16).padStart(2, '0');
                              color = baseColor;
                              topLabel = a.commitCount > 0 ? a.commitCount : '\u2014';
                              bottomLabel = a.hours != null ? a.hours + 'h' : '?';
                              tooltip = `${m} ${d}\n${a.status} Commits: ${a.commitCount} | \u5DE5\u6642: ${a.hours || '\u672A\u5831'}hr`;
                            } else if (onLeaveDay) {
                              bg = COLORS.orangeDim + '44';
                              color = COLORS.orange;
                              topLabel = '\u5047';
                              bottomLabel = '';
                              tooltip = `${m} ${d}\n\u4F11\u5047`;
                            } else {
                              bg = 'transparent';
                              color = COLORS.textDim;
                              topLabel = '\u00B7';
                              bottomLabel = '';
                              tooltip = `${m} ${d}\n\u7121\u8CC7\u6599`;
                            }

                            return (
                              <td key={d} title={tooltip} onClick={() => onDateSelect(d)} style={{
                                padding: 0, textAlign: "center", cursor: "pointer",
                              }}>
                                <div style={{
                                  margin: "1px auto", width: 38, padding: "3px 2px", borderRadius: 5,
                                  background: bg, transition: "all 0.15s ease",
                                  display: "flex", flexDirection: "column", alignItems: "center", gap: 0,
                                }}>
                                  <span style={{ fontSize: 12, fontWeight: 700, color, lineHeight: 1.3, fontVariantNumeric: "tabular-nums" }}>{topLabel}</span>
                                  {bottomLabel && <span style={{ fontSize: 9, color: COLORS.textDim, lineHeight: 1.2, fontVariantNumeric: "tabular-nums" }}>{bottomLabel}</span>}
                                </div>
                              </td>
                            );
                          })}
                          <td style={{ padding: "4px 8px", textAlign: "center" }}>
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: totalCommits > 0 ? COLORS.teal : COLORS.textDim, fontVariantNumeric: "tabular-nums" }}>{totalCommits || '\u2014'}</span>
                              {activeDays > 0 && <span style={{ fontSize: 9, color: COLORS.textDim }}>{activeDays}d</span>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td style={{ padding: "6px 10px", color: COLORS.textMuted, fontWeight: 600, fontSize: 11, borderTop: `1px solid ${COLORS.border}`, position: "sticky", left: 0, background: COLORS.card, zIndex: 1 }}>合計</td>
                      {gridDates.map(d => {
                        const dateMembers = analysis[d] || {};
                        const totalC = Object.values(dateMembers).reduce((s: number, a: any) => s + (a.commitCount || 0), 0);
                        const hoursArr = Object.values(dateMembers).filter((a: any) => a.hours != null).map((a: any) => a.hours);
                        const avgH = hoursArr.length ? (hoursArr.reduce((a: number, b: number) => a + b, 0) / hoursArr.length).toFixed(1) : null;
                        return (
                          <td key={d} onClick={() => onDateSelect(d)} style={{
                            padding: "4px 4px", textAlign: "center", cursor: "pointer",
                            borderTop: `1px solid ${COLORS.border}`,
                          }}>
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: totalC > 0 ? COLORS.teal : COLORS.textDim, fontVariantNumeric: "tabular-nums" }}>{totalC || '\u2014'}</span>
                              {avgH && <span style={{ fontSize: 9, color: COLORS.textDim }}>{avgH}h</span>}
                            </div>
                          </td>
                        );
                      })}
                      <td style={{ borderTop: `1px solid ${COLORS.border}` }} />
                    </tr>
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 10, paddingTop: 8, borderTop: `1px solid ${COLORS.border}`, flexWrap: "wrap" }}>
                {[
                  { label: "\u2705 \u5DE5\u6642+Commits \u4E00\u81F4", bg: COLORS.greenDim, color: COLORS.green },
                  { label: "\u26A0\uFE0F \u6709\u5DE5\u6642\uFF0C\u7121 Commits", bg: COLORS.yellowDim, color: COLORS.yellow },
                  { label: "\uD83D\uDD34 \u6709 Commits\uFF0C\u672A\u56DE\u5831", bg: COLORS.redDim, color: COLORS.red },
                  { label: "\u5047 \u4F11\u5047", bg: COLORS.orangeDim, color: COLORS.orange },
                ].map(l => (
                  <span key={l.label} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: COLORS.textDim }}>
                    <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: l.bg, border: `1px solid ${l.color}33` }} />
                    {l.label}
                  </span>
                ))}
                <span style={{ fontSize: 10, color: COLORS.textDim, marginLeft: "auto" }}>上方=commits 下方=工時 | 點擊日期切換至 Commits</span>
              </div>
            </CardPanel>
          </div>
        );
      })()}
    </div>
  );
}
