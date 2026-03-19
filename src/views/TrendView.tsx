import {
  ResponsiveContainer, ComposedChart, CartesianGrid, XAxis, YAxis,
  Tooltip, ReferenceLine, Bar, Area, Line, Legend,
} from "recharts";
import { COLORS, THRESHOLDS, WEEK_DAYS } from "../constants";
import { getStatus, getTrendIcon, isOnLeave } from "../utils";
import { CustomTooltip, CardPanel, ColorDot } from "../components";
import type { CommitData, LeaveRange } from "../types";

interface TrendViewProps {
  trendRange: string;
  onTrendRangeChange: (range: string) => void;
  trendDates: string[];
  trendData: any[];
  useWeeklyAgg: boolean;
  weekGroups: Array<{ key: string; label: string; dates: string[] }>;
  members: string[];
  memberColors: Record<string, string>;
  selectedMembers: Set<string>;
  onToggleMember: (member: string) => void;
  onClearMembers: () => void;
  isMobile: boolean;
  commitData: CommitData | null;
  rawData: Record<string, Record<string, any>>;
  leave: Record<string, LeaveRange[]>;
}

export function TrendView({
  trendRange, onTrendRangeChange, trendDates, trendData,
  useWeeklyAgg, weekGroups, members, memberColors,
  selectedMembers, onToggleMember, onClearMembers,
  isMobile, commitData, rawData, leave,
}: TrendViewProps) {
  const dayLabels: Record<string, string> = {};
  for (const d of trendDates) {
    const [m, dd] = d.split("/").map(Number);
    const dow = new Date(new Date().getFullYear(), m - 1, dd).getDay();
    dayLabels[d] = WEEK_DAYS[dow];
  }

  return (
    <div>
      <div className="animate-in" style={{ animationDelay: "0.15s" }}>
        <CardPanel title="每日工時趨勢">
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 2, background: COLORS.bg, borderRadius: 6, padding: 2 }}>
              {[
                { key: "week", label: "1週" },
                { key: "2weeks", label: "2週" },
                { key: "month", label: "1月" },
                { key: "all", label: "全部" },
              ].map(r => (
                <button key={r.key} onClick={() => onTrendRangeChange(r.key)} style={{
                  padding: "4px 12px", borderRadius: 5, border: "none", cursor: "pointer",
                  fontSize: 11, fontWeight: 600, fontFamily: "inherit",
                  background: trendRange === r.key ? COLORS.accent : "transparent",
                  color: trendRange === r.key ? "#fff" : COLORS.textDim,
                  transition: "all 0.15s ease",
                }}>{r.label}</button>
              ))}
            </div>
            <span style={{ fontSize: 11, color: COLORS.textDim }}>
              {trendDates[0]}–{trendDates[trendDates.length - 1]}（{trendDates.length}天）
            </span>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
            <span style={{ fontSize: 11, color: COLORS.textDim, lineHeight: "28px", marginRight: 4 }}>比較：</span>
            {members.map(m => {
              const isOn = selectedMembers.has(m);
              return (
                <button key={m} onClick={() => onToggleMember(m)} className="tab-btn" style={{
                  padding: "4px 12px", borderRadius: 20, cursor: "pointer",
                  fontSize: 12, fontWeight: 600, fontFamily: "inherit",
                  border: `1.5px solid ${isOn ? memberColors[m] : COLORS.border}`,
                  background: isOn ? memberColors[m] + "20" : "transparent",
                  color: isOn ? memberColors[m] : COLORS.textDim,
                }}>
                  <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: isOn ? memberColors[m] : COLORS.textDim, marginRight: 5, verticalAlign: "middle" }} />
                  {m}
                </button>
              );
            })}
            {selectedMembers.size > 0 && (
              <button onClick={() => onClearMembers()} className="tab-btn" style={{
                padding: "4px 10px", borderRadius: 20, cursor: "pointer",
                fontSize: 11, fontWeight: 600, fontFamily: "inherit",
                border: `1px solid ${COLORS.border}`, background: "transparent",
                color: COLORS.textDim,
              }}>清除</button>
            )}
          </div>

          <ResponsiveContainer width="100%" height={isMobile ? 320 : 400}>
            <ComposedChart data={trendData} margin={{ left: 0, right: commitData ? 40 : 16, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
              <XAxis dataKey="date" tick={{ fill: COLORS.text, fontSize: isMobile ? 10 : 12 }} axisLine={{ stroke: COLORS.border }} tickLine={false} angle={isMobile ? -30 : 0} textAnchor={isMobile ? "end" : "middle"} height={isMobile ? 50 : 30} />
              <YAxis yAxisId="left" domain={[0, 12]} tick={{ fill: COLORS.textDim, fontSize: 11 }} axisLine={{ stroke: COLORS.border }} tickLine={false} unit="hr" />
              {commitData && <YAxis yAxisId="right" orientation="right" tick={{ fill: COLORS.textDim, fontSize: 11 }} axisLine={{ stroke: COLORS.border }} tickLine={false} label={{ value: "commits", angle: 90, position: "insideRight", fill: COLORS.textDim, fontSize: 11 }} />}
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine yAxisId="left" y={THRESHOLDS.target} stroke={COLORS.green} strokeDasharray="6 4" strokeWidth={1.5} />
              <ReferenceLine yAxisId="left" y={THRESHOLDS.ok} stroke={COLORS.yellow} strokeDasharray="4 4" strokeWidth={1} />

              {commitData && selectedMembers.size > 0 && [...selectedMembers].map(m =>
                <Bar key={`commit-${m}`} yAxisId="right" dataKey={`_commit_${m}`} fill={memberColors[m]} fillOpacity={0.25} name={`${m} commits`} barSize={12} legendType="none" />
              )}

              <Area yAxisId="left" type="monotone" dataKey="_max" stroke="none" fill={COLORS.accent} fillOpacity={0.06} connectNulls={false} legendType="none" tooltipType="none" />
              <Area yAxisId="left" type="monotone" dataKey="_min" stroke="none" fill={COLORS.bg} fillOpacity={1} connectNulls={false} legendType="none" tooltipType="none" />

              <Line yAxisId="left" type="monotone" dataKey="團隊平均" stroke="#e2e8f0" strokeWidth={3}
                strokeDasharray="8 4"
                dot={{ r: isMobile ? 3 : 4, fill: "#e2e8f0", stroke: COLORS.card, strokeWidth: 2 }}
                connectNulls={false} />

              {members.filter(m => selectedMembers.has(m)).map(m => (
                <Line key={m} yAxisId="left" type="monotone" dataKey={m} stroke={memberColors[m]} strokeWidth={2.5}
                  dot={{ r: isMobile ? 3 : 5, fill: memberColors[m], stroke: COLORS.card, strokeWidth: 2 }}
                  connectNulls={false} />
              ))}

              <Legend
                wrapperStyle={{ fontSize: 11, paddingTop: 12 }}
                payload={[
                  { value: '團隊平均', type: 'line', color: '#e2e8f0' },
                  ...members.filter(m => selectedMembers.has(m)).map(m => ({
                    value: m, type: 'line' as const, color: memberColors[m]
                  }))
                ]}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </CardPanel>
      </div>

      <div className="animate-in" style={{ animationDelay: "0.2s" }}>
        <CardPanel title={useWeeklyAgg ? "週均變化" : "日間變化"} padding={20}>
          <div style={{ overflowX: "auto" }}>
            {useWeeklyAgg ? (
              <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 2px", fontSize: 13 }}>
                <thead>
                  <tr>
                    {["成員", ...weekGroups.map((w: any) => w.label), "平均", "穩定度", "Commits", "一致✅", ""].map((h, i, arr) => {
                      const isTealHeader = h === "Commits" || h === "一致✅";
                      const isCommitsHeader = h === "Commits";
                      return (
                        <th key={i} style={{ textAlign: i === 0 ? "left" : "center", padding: "8px 8px", borderBottom: `1px solid ${COLORS.border}`, color: isTealHeader ? COLORS.teal : COLORS.textMuted, fontWeight: 600, fontSize: 11, whiteSpace: "nowrap", ...(i === 0 ? { position: "sticky" as const, left: 0, background: COLORS.card, zIndex: 1 } : {}), ...(isCommitsHeader ? { borderLeft: `2px solid ${COLORS.tealDim}` } : {}) }}>{h}</th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {members.map(m => {
                    const allVals = trendDates.map(d => rawData[d]?.[m]?.total ?? null).filter((v): v is number => v !== null);
                    const avg = allVals.length ? +(allVals.reduce((a, b) => a + b, 0) / allVals.length).toFixed(1) : null;
                    const stdDev = allVals.length >= 2 ? Math.sqrt(allVals.reduce((s, v) => s + (v - avg!) * (v - avg!), 0) / allVals.length) : null;
                    const maxStdDev = 3;
                    const stabilityPct = stdDev !== null ? Math.max(0, 100 - (stdDev / maxStdDev) * 100) : 0;
                    const stabilityColor = stabilityPct >= 70 ? COLORS.green : stabilityPct >= 40 ? COLORS.yellow : COLORS.orange;
                    const firstVal = trendDates.length ? (rawData[trendDates[0]]?.[m]?.total ?? null) : null;
                    const lastVal = trendDates.length ? (rawData[trendDates[trendDates.length - 1]]?.[m]?.total ?? null) : null;
                    const trend = getTrendIcon(firstVal, lastVal);
                    const avgStatus = getStatus(avg);
                    const isHighlighted = selectedMembers.has(m);
                    return (
                      <tr key={m} onClick={() => onToggleMember(m)} style={{ cursor: "pointer", transition: "background 0.15s ease" }}>
                        <td style={{ padding: "7px 8px", fontWeight: 600, whiteSpace: "nowrap", position: "sticky", left: 0, background: isHighlighted ? memberColors[m] + "15" : COLORS.card, zIndex: 1, borderBottom: `1px solid ${COLORS.border}15` }}>
                          <ColorDot color={isHighlighted ? memberColors[m] : COLORS.textDim} />
                          <span style={{ color: isHighlighted ? memberColors[m] : COLORS.text }}>{"\u200B"}{m}</span>
                        </td>
                        {weekGroups.map((w: any, wi: number) => {
                          const wVals = w.dates.map((d: string) => rawData[d]?.[m]?.total).filter((v: any) => v != null);
                          const wAvg = wVals.length ? +(wVals.reduce((a: number, b: number) => a + b, 0) / wVals.length).toFixed(1) : null;
                          const st = getStatus(wAvg);
                          return (
                            <td key={wi} style={{
                              textAlign: "center", padding: "6px 8px", fontVariantNumeric: "tabular-nums",
                              borderBottom: `1px solid ${COLORS.border}15`,
                              background: wAvg !== null ? st.color + "12" : "transparent",
                            }}>
                              {wAvg !== null ? (
                                <div>
                                  <span style={{ color: st.color, fontWeight: 700, fontSize: 13 }}>{wAvg}</span>
                                  <span style={{ color: COLORS.textDim, fontSize: 9, marginLeft: 2 }}>{wVals.length}d</span>
                                </div>
                              ) : (
                                <span style={{ color: COLORS.textDim, fontSize: 10 }}>—</span>
                              )}
                            </td>
                          );
                        })}
                        <td style={{ textAlign: "center", padding: "7px 8px", fontVariantNumeric: "tabular-nums", borderBottom: `1px solid ${COLORS.border}15` }}>
                          {avg !== null ? <span style={{ color: avgStatus.color, fontWeight: 700 }}>{avg}</span> : <span style={{ color: COLORS.textDim }}>—</span>}
                        </td>
                        <td style={{ textAlign: "center", padding: "7px 8px", borderBottom: `1px solid ${COLORS.border}15`, minWidth: 64 }}>
                          {stdDev !== null ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "center" }}>
                              <div style={{ width: 36, height: 5, borderRadius: 3, background: COLORS.bg, overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${stabilityPct}%`, borderRadius: 3, background: stabilityColor, transition: "width 0.4s ease" }} />
                              </div>
                              <span style={{ fontSize: 10, color: stabilityColor, fontWeight: 600, minWidth: 14 }}>{stdDev.toFixed(1)}</span>
                            </div>
                          ) : <span style={{ color: COLORS.textDim, fontSize: 10 }}>—</span>}
                        </td>
                        {(() => {
                          let ct = 0, okCount = 0, totalAnalysis = 0;
                          if (commitData) {
                            for (const d of trendDates) {
                              const c = commitData.commits?.[d]?.[m];
                              if (c) ct += c.count;
                              const a = commitData.analysis?.[d]?.[m];
                              if (a) { totalAnalysis++; if (a.status === '✅') okCount++; }
                            }
                          }
                          const pct = totalAnalysis > 0 ? Math.round(okCount / totalAnalysis * 100) : null;
                          return (
                            <>
                              <td style={{ textAlign: "center", padding: "7px 8px", fontVariantNumeric: "tabular-nums", color: ct > 0 ? COLORS.teal : COLORS.textDim, fontWeight: 700, borderBottom: `1px solid ${COLORS.border}15`, borderLeft: `2px solid ${COLORS.tealDim}` }}>
                                {ct > 0 ? ct : "—"}
                              </td>
                              <td style={{ textAlign: "center", padding: "7px 8px", borderBottom: `1px solid ${COLORS.border}15` }}>
                                {pct !== null ? <span style={{ color: COLORS.green, fontWeight: 700 }}>{pct}%</span> : <span style={{ color: COLORS.textDim }}>—</span>}
                              </td>
                            </>
                          );
                        })()}
                        <td style={{ textAlign: "center", padding: "7px 6px", fontSize: 13, borderBottom: `1px solid ${COLORS.border}15` }}>{trend}</td>
                      </tr>
                    );
                  })}
                  <tr style={{ borderTop: `2px solid ${COLORS.border}` }}>
                    <td style={{ padding: "8px 8px", fontWeight: 700, whiteSpace: "nowrap", position: "sticky", left: 0, background: COLORS.card, zIndex: 1, color: COLORS.textMuted, fontSize: 12 }}>
                      團隊平均
                    </td>
                    {weekGroups.map((w: any, wi: number) => {
                      const allW = members.flatMap(m => w.dates.map((d: string) => rawData[d]?.[m]?.total)).filter((v: any) => v != null);
                      const wAvg = allW.length ? +(allW.reduce((a: number, b: number) => a + b, 0) / allW.length).toFixed(1) : null;
                      const st = getStatus(wAvg);
                      return (
                        <td key={wi} style={{ textAlign: "center", padding: "6px 8px", fontVariantNumeric: "tabular-nums", background: wAvg !== null ? st.color + "0a" : "transparent" }}>
                          {wAvg !== null ? <span style={{ color: st.color, fontWeight: 700, fontSize: 12 }}>{wAvg}</span> : <span style={{ color: COLORS.textDim }}>—</span>}
                        </td>
                      );
                    })}
                    <td colSpan={5} />
                  </tr>
                </tbody>
              </table>
            ) : (
              <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 2px", fontSize: 13, minWidth: isMobile ? 600 : "auto" }}>
                <thead>
                  <tr>
                    {["成員", ...trendDates.map(d => `${d}(${dayLabels[d]})`), "平均", "穩定度", "Commits", "一致✅", ""].map((h, i, arr) => {
                      const isTealHeader = h === "Commits" || h === "一致✅";
                      const isCommitsHeader = h === "Commits";
                      return (
                        <th key={i} style={{ textAlign: i === 0 ? "left" : "center", padding: "8px 8px", borderBottom: `1px solid ${COLORS.border}`, color: isTealHeader ? COLORS.teal : COLORS.textMuted, fontWeight: 600, fontSize: 11, whiteSpace: "nowrap", ...(i === 0 ? { position: "sticky" as const, left: 0, background: COLORS.card, zIndex: 1 } : {}), ...(isCommitsHeader ? { borderLeft: `2px solid ${COLORS.tealDim}` } : {}) }}>{h}</th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {members.map(m => {
                    const vals = trendDates.map(d => rawData[d]?.[m]?.total ?? null);
                    const valid = vals.filter((v): v is number => v !== null);
                    const avg = valid.length ? +(valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(1) : null;
                    const stdDev = valid.length >= 2 ? Math.sqrt(valid.reduce((s, v) => s + (v - avg!) * (v - avg!), 0) / valid.length) : null;
                    const maxStdDev = 3;
                    const stabilityPct = stdDev !== null ? Math.max(0, 100 - (stdDev / maxStdDev) * 100) : 0;
                    const stabilityColor = stabilityPct >= 70 ? COLORS.green : stabilityPct >= 40 ? COLORS.yellow : COLORS.orange;
                    const trend = getTrendIcon(vals[0], vals[vals.length - 1]);
                    const avgStatus = getStatus(avg);
                    const isHighlighted = selectedMembers.has(m);
                    return (
                      <tr key={m} onClick={() => onToggleMember(m)} style={{ cursor: "pointer", transition: "background 0.15s ease" }}>
                        <td style={{ padding: "7px 8px", fontWeight: 600, whiteSpace: "nowrap", position: "sticky", left: 0, background: isHighlighted ? memberColors[m] + "15" : COLORS.card, zIndex: 1, borderBottom: `1px solid ${COLORS.border}15` }}>
                          <ColorDot color={isHighlighted ? memberColors[m] : COLORS.textDim} />
                          <span style={{ color: isHighlighted ? memberColors[m] : COLORS.text }}>{"\u200B"}{m}</span>
                        </td>
                        {vals.map((v, i) => {
                          const onLv = isOnLeave(trendDates[i], leave[m]);
                          const st = getStatus(v, onLv);
                          return (
                            <td key={i} style={{
                              textAlign: "center", padding: "6px 6px", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
                              borderBottom: `1px solid ${COLORS.border}15`,
                              background: v !== null ? st.color + "12" : "transparent",
                            }}>
                              {v !== null ? (
                                <span style={{ color: st.color, fontWeight: 700, fontSize: 12 }}>{v}</span>
                              ) : (
                                <span style={{ color: onLv ? COLORS.orange : COLORS.red, fontSize: 10, opacity: 0.8 }}>{onLv ? "假" : "缺"}</span>
                              )}
                            </td>
                          );
                        })}
                        <td style={{ textAlign: "center", padding: "7px 8px", fontVariantNumeric: "tabular-nums", borderBottom: `1px solid ${COLORS.border}15` }}>
                          {avg !== null ? <span style={{ color: avgStatus.color, fontWeight: 700 }}>{avg}</span> : <span style={{ color: COLORS.textDim }}>—</span>}
                        </td>
                        <td style={{ textAlign: "center", padding: "7px 8px", borderBottom: `1px solid ${COLORS.border}15`, minWidth: 64 }}>
                          {stdDev !== null ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "center" }}>
                              <div style={{ width: 36, height: 5, borderRadius: 3, background: COLORS.bg, overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${stabilityPct}%`, borderRadius: 3, background: stabilityColor, transition: "width 0.4s ease" }} />
                              </div>
                              <span style={{ fontSize: 10, color: stabilityColor, fontWeight: 600, minWidth: 14 }}>{stdDev.toFixed(1)}</span>
                            </div>
                          ) : <span style={{ color: COLORS.textDim, fontSize: 10 }}>—</span>}
                        </td>
                        {(() => {
                          let ct = 0, okCount = 0, totalAnalysis = 0;
                          if (commitData) {
                            for (const d of trendDates) {
                              const c = commitData.commits?.[d]?.[m];
                              if (c) ct += c.count;
                              const a = commitData.analysis?.[d]?.[m];
                              if (a) { totalAnalysis++; if (a.status === '✅') okCount++; }
                            }
                          }
                          const pct = totalAnalysis > 0 ? Math.round(okCount / totalAnalysis * 100) : null;
                          return (
                            <>
                              <td style={{ textAlign: "center", padding: "7px 8px", fontVariantNumeric: "tabular-nums", color: ct > 0 ? COLORS.teal : COLORS.textDim, fontWeight: 700, borderBottom: `1px solid ${COLORS.border}15`, borderLeft: `2px solid ${COLORS.tealDim}` }}>
                                {ct > 0 ? ct : "—"}
                              </td>
                              <td style={{ textAlign: "center", padding: "7px 8px", borderBottom: `1px solid ${COLORS.border}15` }}>
                                {pct !== null ? <span style={{ color: COLORS.green, fontWeight: 700 }}>{pct}%</span> : <span style={{ color: COLORS.textDim }}>—</span>}
                              </td>
                            </>
                          );
                        })()}
                        <td style={{ textAlign: "center", padding: "7px 6px", fontSize: 13, borderBottom: `1px solid ${COLORS.border}15` }}>{trend}</td>
                      </tr>
                    );
                  })}
                  <tr style={{ borderTop: `2px solid ${COLORS.border}` }}>
                    <td style={{ padding: "8px 8px", fontWeight: 700, whiteSpace: "nowrap", position: "sticky", left: 0, background: COLORS.card, zIndex: 1, color: COLORS.textMuted, fontSize: 12 }}>
                      團隊平均
                    </td>
                    {trendDates.map((d, i) => {
                      const dayVals = members.map(m => rawData[d]?.[m]?.total).filter((v: any) => v != null);
                      const dayAvg = dayVals.length ? +(dayVals.reduce((a: any, b: any) => a + b, 0) / dayVals.length).toFixed(1) : null;
                      const st = getStatus(dayAvg);
                      return (
                        <td key={i} style={{ textAlign: "center", padding: "6px 6px", fontVariantNumeric: "tabular-nums", background: dayAvg !== null ? st.color + "0a" : "transparent" }}>
                          {dayAvg !== null ? <span style={{ color: st.color, fontWeight: 700, fontSize: 12 }}>{dayAvg}</span> : <span style={{ color: COLORS.textDim }}>—</span>}
                        </td>
                      );
                    })}
                    <td colSpan={5} />
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </CardPanel>
      </div>
    </div>
  );
}
