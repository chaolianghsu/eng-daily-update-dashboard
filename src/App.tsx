import { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, Cell, LineChart, Line,
  ComposedChart, Area,
} from "recharts";

import { COLORS, SEVERITY_COLORS, THRESHOLDS, MEETING_HEAVY_PCT, WEEK_DAYS, MEMBER_PALETTE } from "./constants";
import { isOnLeave, getStatus, getTrendIcon, getWeekRange } from "./utils";
import { CustomTooltip, CardPanel, ColorDot, StatusBadge, tabStyle } from "./components";
import CommitsView from "./CommitsView";
import { useCurrentWeek } from "./hooks/useCurrentWeek";
import { useDailyBarData } from "./hooks/useDailyBarData";
import { useTrendData } from "./hooks/useTrendData";
import { useWeeklySummary } from "./hooks/useWeeklySummary";
import { useAllIssues } from "./hooks/useAllIssues";
import type { LoadData, CommitData, TaskAnalysisData } from "./types";
import "./styles.css";

export default function App({ loadData }: { loadData: LoadData }) {
  const [view, setView] = useState("daily");
  const [rawData, setRawData] = useState<Record<string, Record<string, any>> | null>(null);
  const [issues, setIssues] = useState<any[]>([]);
  const [leave, setLeave] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [commitData, setCommitData] = useState<CommitData | null>(null);
  const [taskAnalysisData, setTaskAnalysisData] = useState<TaskAnalysisData | null>(null);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [trendRange, setTrendRange] = useState("2weeks");

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    loadData()
      .then(data => {
        setRawData(data.rawData);
        setIssues(data.issues);
        setLeave(data.leave);
        setCommitData(data.commitData);
        setTaskAnalysisData(data.taskAnalysisData);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const dates = rawData ? Object.keys(rawData) : [];
  const members = rawData ? [...new Set(dates.flatMap(d => Object.keys(rawData[d])))] : [];
  const dayLabels = Object.fromEntries(dates.map(d => {
    const [m, dd] = d.split("/").map(Number);
    const dow = new Date(new Date().getFullYear(), m - 1, dd).getDay();
    return [d, WEEK_DAYS[dow]];
  }));
  const memberColors = Object.fromEntries(members.map((m, i) => [m, MEMBER_PALETTE[i % MEMBER_PALETTE.length]]));
  const issueMap = Object.fromEntries(issues.map(iss => [iss.member, iss]));

  const currentWeek = useCurrentWeek(dates);

  const dailyDates = currentWeek.dates;
  const activeDate = (selectedDate && dailyDates.includes(selectedDate))
    ? selectedDate
    : dailyDates[dailyDates.length - 1] || dates[dates.length - 1];

  const chartHeight = isMobile ? 280 : 380;

  const dailyBarData = useDailyBarData(rawData, activeDate, members);

  const { trendDates, trendData, useWeeklyAgg, weekGroups } = useTrendData(rawData, dates, members, dayLabels, commitData, trendRange);

  const weeklySummary = useWeeklySummary(rawData, dates, members);

  const allIssues = useAllIssues(issues, commitData, activeDate);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: COLORS.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <div style={{ width: 40, height: 40, border: `3px solid ${COLORS.border}`, borderTopColor: COLORS.accent, borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
        <p style={{ color: COLORS.textMuted, fontSize: 14, fontFamily: "'JetBrains Mono','SF Mono',monospace" }}>載入資料中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: "100vh", background: COLORS.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: COLORS.red, fontSize: 16, fontFamily: "'JetBrains Mono','SF Mono',monospace" }}>載入失敗：{error}</p>
      </div>
    );
  }

  return (
    <div className="dashboard-container" style={{ minHeight: "100vh", background: "transparent", color: COLORS.text, padding: "24px 16px", fontFamily: "'JetBrains Mono','SF Mono','Noto Sans TC',monospace" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>

        {/* Header */}
        <div className="animate-in" style={{ marginBottom: 24 }}>
          <h1 className="dashboard-title" style={{
            fontSize: 28, fontWeight: 800, margin: 0,
            fontFamily: "'Bricolage Grotesque','Noto Sans TC',sans-serif",
            background: "linear-gradient(135deg, #60a5fa 0%, #a78bfa 50%, #f472b6 100%)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>
            工程部 Daily Update
          </h1>
          <p className="dashboard-subtitle" style={{ color: COLORS.textDim, fontSize: 13, marginTop: 6, letterSpacing: "0.02em" }}>
            工時追蹤・一致性分析・風險警示 — {dates[0]}~{dates[dates.length-1]}（{dates.length} 工作天）
          </p>
        </div>

        {/* Team Status Overview */}
        {(() => {
          const attentionIssues = allIssues;
          const stableIssues = issues.filter(i => i.severity === "🟢");
          const reportedCount = members.filter(m => {
            const latest = dates[dates.length - 1];
            return rawData?.[latest]?.[m]?.total != null;
          }).length;
          const latestData = rawData?.[dates[dates.length - 1]] || {};
          const teamVals = Object.values(latestData).filter((v: any) => v.total != null).map((v: any) => v.total);
          const teamAvg = teamVals.length ? +(teamVals.reduce((a: number, b: number) => a + b, 0) / teamVals.length).toFixed(1) : null;
          const actionHints: Record<string, string> = {
            "超時": "留意工作量分配",
            "未回報": "請確認是否需要協助",
            "連續": "建議主動聯繫",
            "工時偏低": "建議了解狀況",
            "不足": "建議了解狀況",
            "會議佔比": "留意會議時間",
          };
          const getHint = (text: string) => {
            for (const [key, hint] of Object.entries(actionHints)) {
              if (text.includes(key)) return hint;
            }
            return null;
          };
          return (
            <div className="animate-in" style={{ animationDelay: "0.05s", background: COLORS.card, borderRadius: 12, border: `1px solid ${COLORS.border}`, marginBottom: 20, overflow: "hidden" }}>
              <div className="status-overview" style={{ display: "flex", gap: 0 }}>
                {/* Left: KPI metrics */}
                <div className="status-kpis" style={{ display: "flex", gap: 0, borderRight: `1px solid ${COLORS.border}`, flexShrink: 0 }}>
                  <div style={{ padding: "16px 20px", borderRight: `1px solid ${COLORS.border}`, minWidth: 90, textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: COLORS.textDim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>回報率</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: reportedCount >= members.length ? COLORS.green : reportedCount >= members.length - 2 ? COLORS.yellow : COLORS.red, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>
                      {reportedCount}<span style={{ fontSize: 13, fontWeight: 500, color: COLORS.textDim }}>/{members.length}</span>
                    </div>
                  </div>
                  <div style={{ padding: "16px 20px", borderRight: `1px solid ${COLORS.border}`, minWidth: 90, textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: COLORS.textDim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>團隊均時</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: teamAvg ? getStatus(teamAvg).color : COLORS.textDim, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>
                      {teamAvg ?? "—"}<span style={{ fontSize: 11, fontWeight: 500, color: COLORS.textDim }}>hr</span>
                    </div>
                    {teamAvg && (
                      <div style={{ marginTop: 6, height: 3, borderRadius: 2, background: COLORS.bg, overflow: "hidden", width: 56, margin: "6px auto 0" }}>
                        <div style={{ height: "100%", width: `${Math.min(100, (teamAvg / 10) * 100)}%`, borderRadius: 2, background: getStatus(teamAvg).color, transition: "width 0.5s ease" }} />
                      </div>
                    )}
                  </div>
                  <div style={{ padding: "16px 20px", minWidth: 80, textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: COLORS.textDim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>需關注</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: attentionIssues.length > 0 ? COLORS.yellow : COLORS.green, lineHeight: 1.1 }}>
                      {attentionIssues.length}<span style={{ fontSize: 11, fontWeight: 500, color: COLORS.textDim }}>人</span>
                    </div>
                  </div>
                </div>

                {/* Right: Attention cards */}
                <div style={{ flex: 1, padding: "10px 16px", display: "flex", flexWrap: "wrap", gap: 8, alignContent: "center" }}>
                  {attentionIssues.length === 0 ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                      <span style={{ fontSize: 12, color: COLORS.green, fontWeight: 600 }}>全員狀態正常</span>
                    </div>
                  ) : attentionIssues.map((iss, i) => {
                    const sev = SEVERITY_COLORS[iss.severity];
                    const hint = getHint(iss.text);
                    const isLeave = iss.text.includes("休假");
                    return (
                      <div key={i} className="attention-card" style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
                        borderRadius: 8, background: sev?.bg + "44" || COLORS.border,
                        border: `1px solid ${sev?.sc || COLORS.border}22`,
                        transition: "transform 0.15s ease",
                      }}>
                        <span style={{ fontSize: 14 }}>{iss.severity}</span>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: sev?.sc || COLORS.text }}>{iss.member} <span style={{ fontWeight: 500, color: COLORS.textMuted }}>{iss.text}</span></div>
                          {hint && !isLeave && <div style={{ fontSize: 10, color: COLORS.textDim, marginTop: 2 }}>{hint}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Bottom: stable members */}
              {stableIssues.length > 0 && (
                <div style={{ borderTop: `1px solid ${COLORS.border}`, padding: "8px 16px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, color: COLORS.textDim, fontWeight: 600, flexShrink: 0 }}>穩定</span>
                  {stableIssues.map((iss, i) => (
                    <span key={i} style={{ fontSize: 11, color: COLORS.green, fontWeight: 500, opacity: 0.75 }}>
                      {iss.member}{iss.text.includes("改善") ? " ↑" : ""}{i < stableIssues.length - 1 ? "," : ""}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* Tabs */}
        <div className="animate-in tab-bar" style={{ animationDelay: "0.1s", display: "flex", gap: 4, marginBottom: 24, background: COLORS.card, borderRadius: 10, padding: 4, width: "fit-content" }}>
          {[
            { key: "daily", label: "📊 每日工時" },
            { key: "trend", label: "📈 趨勢比較" },
            { key: "weekly", label: "📋 週統計" },
            ...(commitData ? [{ key: "commits", label: "🔀 Commits" }] : []),
          ].map(tab => (
            <button key={tab.key} className={`tab-btn ${view === tab.key ? 'tab-active' : ''}`} onClick={() => setView(tab.key)} style={tabStyle(view === tab.key)}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* DAILY */}
        {view === "daily" && (
          <div>
            <div className="animate-in" style={{ animationDelay: "0.15s", marginBottom: 20 }}>
              <p className="week-label" style={{ fontSize: 13, color: COLORS.textDim, marginBottom: 10, fontWeight: 600, letterSpacing: "0.03em" }}>
                {currentWeek.label}
              </p>
              <div className="date-scroll">
                {dailyDates.map(d => (
                  <button key={d} className="date-btn" onClick={() => setSelectedDate(d)}
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
        )}

        {/* TREND */}
        {view === "trend" && (
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
                      <button key={r.key} onClick={() => setTrendRange(r.key)} style={{
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
                      <button key={m} onClick={() => {
                        const next = new Set(selectedMembers);
                        isOn ? next.delete(m) : next.add(m);
                        setSelectedMembers(next);
                      }} className="tab-btn" style={{
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
                    <button onClick={() => setSelectedMembers(new Set())} className="tab-btn" style={{
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
                          {["成員", ...weekGroups.map((w: any) => w.label), "平均", "穩定度", ""].map((h, i) => (
                            <th key={i} style={{ textAlign: i === 0 ? "left" : "center", padding: "8px 8px", borderBottom: `1px solid ${COLORS.border}`, color: COLORS.textMuted, fontWeight: 600, fontSize: 11, whiteSpace: "nowrap", ...(i === 0 ? { position: "sticky" as const, left: 0, background: COLORS.card, zIndex: 1 } : {}) }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {members.map(m => {
                          const allVals = trendDates.map(d => rawData![d]?.[m]?.total ?? null).filter((v): v is number => v !== null);
                          const avg = allVals.length ? +(allVals.reduce((a, b) => a + b, 0) / allVals.length).toFixed(1) : null;
                          const stdDev = allVals.length >= 2 ? Math.sqrt(allVals.reduce((s, v) => s + (v - avg!) * (v - avg!), 0) / allVals.length) : null;
                          const maxStdDev = 3;
                          const stabilityPct = stdDev !== null ? Math.max(0, 100 - (stdDev / maxStdDev) * 100) : 0;
                          const stabilityColor = stabilityPct >= 70 ? COLORS.green : stabilityPct >= 40 ? COLORS.yellow : COLORS.orange;
                          const firstVal = trendDates.length ? (rawData![trendDates[0]]?.[m]?.total ?? null) : null;
                          const lastVal = trendDates.length ? (rawData![trendDates[trendDates.length - 1]]?.[m]?.total ?? null) : null;
                          const trend = getTrendIcon(firstVal, lastVal);
                          const avgStatus = getStatus(avg);
                          const isHighlighted = selectedMembers.has(m);
                          return (
                            <tr key={m} onClick={() => {
                              const next = new Set(selectedMembers);
                              isHighlighted ? next.delete(m) : next.add(m);
                              setSelectedMembers(next);
                            }} style={{ cursor: "pointer", transition: "background 0.15s ease" }}>
                              <td style={{ padding: "7px 8px", fontWeight: 600, whiteSpace: "nowrap", position: "sticky", left: 0, background: isHighlighted ? memberColors[m] + "15" : COLORS.card, zIndex: 1, borderBottom: `1px solid ${COLORS.border}15` }}>
                                <ColorDot color={isHighlighted ? memberColors[m] : COLORS.textDim} />
                                <span style={{ color: isHighlighted ? memberColors[m] : COLORS.text }}>{m}</span>
                              </td>
                              {weekGroups.map((w: any, wi: number) => {
                                const wVals = w.dates.map((d: string) => rawData![d]?.[m]?.total).filter((v: any) => v != null);
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
                              <td style={{ textAlign: "center", padding: "7px 6px", fontSize: 13, borderBottom: `1px solid ${COLORS.border}15` }}>{trend}</td>
                            </tr>
                          );
                        })}
                        <tr style={{ borderTop: `2px solid ${COLORS.border}` }}>
                          <td style={{ padding: "8px 8px", fontWeight: 700, whiteSpace: "nowrap", position: "sticky", left: 0, background: COLORS.card, zIndex: 1, color: COLORS.textMuted, fontSize: 12 }}>
                            團隊平均
                          </td>
                          {weekGroups.map((w: any, wi: number) => {
                            const allW = members.flatMap(m => w.dates.map((d: string) => rawData![d]?.[m]?.total)).filter((v: any) => v != null);
                            const wAvg = allW.length ? +(allW.reduce((a: number, b: number) => a + b, 0) / allW.length).toFixed(1) : null;
                            const st = getStatus(wAvg);
                            return (
                              <td key={wi} style={{ textAlign: "center", padding: "6px 8px", fontVariantNumeric: "tabular-nums", background: wAvg !== null ? st.color + "0a" : "transparent" }}>
                                {wAvg !== null ? <span style={{ color: st.color, fontWeight: 700, fontSize: 12 }}>{wAvg}</span> : <span style={{ color: COLORS.textDim }}>—</span>}
                              </td>
                            );
                          })}
                          <td colSpan={3} />
                        </tr>
                      </tbody>
                    </table>
                  ) : (
                    <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 2px", fontSize: 13, minWidth: isMobile ? 600 : "auto" }}>
                      <thead>
                        <tr>
                          {["成員", ...trendDates.map(d => `${d}(${dayLabels[d]})`), "平均", "穩定度", ""].map((h, i) => (
                            <th key={i} style={{ textAlign: i === 0 ? "left" : "center", padding: "8px 8px", borderBottom: `1px solid ${COLORS.border}`, color: COLORS.textMuted, fontWeight: 600, fontSize: 11, whiteSpace: "nowrap", ...(i === 0 ? { position: "sticky" as const, left: 0, background: COLORS.card, zIndex: 1 } : {}) }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {members.map(m => {
                          const vals = trendDates.map(d => rawData![d]?.[m]?.total ?? null);
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
                            <tr key={m} onClick={() => {
                              const next = new Set(selectedMembers);
                              isHighlighted ? next.delete(m) : next.add(m);
                              setSelectedMembers(next);
                            }} style={{ cursor: "pointer", transition: "background 0.15s ease" }}>
                              <td style={{ padding: "7px 8px", fontWeight: 600, whiteSpace: "nowrap", position: "sticky", left: 0, background: isHighlighted ? memberColors[m] + "15" : COLORS.card, zIndex: 1, borderBottom: `1px solid ${COLORS.border}15` }}>
                                <ColorDot color={isHighlighted ? memberColors[m] : COLORS.textDim} />
                                <span style={{ color: isHighlighted ? memberColors[m] : COLORS.text }}>{m}</span>
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
                              <td style={{ textAlign: "center", padding: "7px 6px", fontSize: 13, borderBottom: `1px solid ${COLORS.border}15` }}>{trend}</td>
                            </tr>
                          );
                        })}
                        <tr style={{ borderTop: `2px solid ${COLORS.border}` }}>
                          <td style={{ padding: "8px 8px", fontWeight: 700, whiteSpace: "nowrap", position: "sticky", left: 0, background: COLORS.card, zIndex: 1, color: COLORS.textMuted, fontSize: 12 }}>
                            團隊平均
                          </td>
                          {trendDates.map((d, i) => {
                            const dayVals = members.map(m => rawData![d]?.[m]?.total).filter((v: any) => v != null);
                            const dayAvg = dayVals.length ? +(dayVals.reduce((a: any, b: any) => a + b, 0) / dayVals.length).toFixed(1) : null;
                            const st = getStatus(dayAvg);
                            return (
                              <td key={i} style={{ textAlign: "center", padding: "6px 6px", fontVariantNumeric: "tabular-nums", background: dayAvg !== null ? st.color + "0a" : "transparent" }}>
                                {dayAvg !== null ? <span style={{ color: st.color, fontWeight: 700, fontSize: 12 }}>{dayAvg}</span> : <span style={{ color: COLORS.textDim }}>—</span>}
                              </td>
                            );
                          })}
                          <td colSpan={3} />
                        </tr>
                      </tbody>
                    </table>
                  )}
                </div>
              </CardPanel>
            </div>
          </div>
        )}

        {/* WEEKLY */}
        {view === "weekly" && (
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
                        {["成員", "回報", "總工時", "日均", "會議", "會議%", "穩定度", "趨勢"].map((h, i) => (
                          <th key={h} style={{ textAlign: h === "成員" ? "left" : "center", padding: "10px 8px", borderBottom: `1px solid ${COLORS.border}`, color: COLORS.textMuted, fontWeight: 600, fontSize: 11, whiteSpace: "nowrap", ...(i === 0 ? { position: "sticky" as const, left: 0, background: COLORS.card, zIndex: 1 } : {}) }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {weeklySummary.map(m => {
                        const st = getStatus(m.avg);
                        const isHighlighted = selectedMembers.has(m.name);
                        return (
                          <tr key={m.name} onClick={() => {
                            const next = new Set(selectedMembers);
                            isHighlighted ? next.delete(m.name) : next.add(m.name);
                            setSelectedMembers(next);
                          }} style={{ cursor: "pointer", transition: "background 0.15s ease" }}>
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
                            <td style={{ textAlign: "center", padding: "9px 8px", fontVariantNumeric: "tabular-nums", color: COLORS.textMuted, borderBottom: `1px solid ${COLORS.border}15` }}>
                              {m.meetSum > 0 ? m.meetSum : "—"}
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
        )}

        {/* COMMITS */}
        {view === "commits" && commitData && (
          <CommitsView commitData={commitData} dates={dates} members={members} memberColors={memberColors} leave={leave}
            activeDate={activeDate} onDateSelect={setSelectedDate} dailyDates={dailyDates} dayLabels={dayLabels} taskAnalysisData={taskAnalysisData} />
        )}

        {/* Footer */}
        <div className="footer-bar" style={{ marginTop: 28, paddingTop: 14, borderTop: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 11, color: COLORS.textDim }}>
            ✅ {THRESHOLDS.ok}-{THRESHOLDS.high}hr ｜ ⚠️ {THRESHOLDS.low}-{THRESHOLDS.ok} / {THRESHOLDS.high}-{THRESHOLDS.overtime}hr ｜ ❌ &lt;{THRESHOLDS.low} / &gt;{THRESHOLDS.overtime}hr ｜ 會議 &gt;{MEETING_HEAVY_PCT}% ⚠
          </span>
          <span style={{ fontSize: 11, color: COLORS.textDim }}>
            Daily Update Analyzer v2 — {dates.length} 工作天
          </span>
        </div>
      </div>
    </div>
  );
}
