import { useState, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";

import { useMemberProfile } from "../hooks/useMemberProfile";
import { COLORS, SEVERITY_COLORS, PROJECT_PALETTE, THRESHOLDS } from "../constants";
import { CardPanel } from "../components";
import type { HealthAlert, CommitData, TaskAnalysisData, LeaveRange } from "../types";

interface MemberViewProps {
  rawData: Record<string, Record<string, { total: number | null; meeting: number | null; dev: number | null }>>;
  members: string[];
  memberColors: Record<string, string>;
  dates: string[];
  commitData: CommitData | null;
  leave: Record<string, LeaveRange[]>;
  taskAnalysisData: TaskAnalysisData | null;
  healthAlerts: HealthAlert[];
  isMobile: boolean;
}

const STATUS_BAR_COLORS: Record<string, string> = {
  normal: COLORS.accentLight,
  warning: COLORS.yellow,
  danger: COLORS.red,
};

const CONSISTENCY_COLORS: Record<string, string> = {
  "✅": COLORS.green,
  "⚠️": COLORS.yellow,
  "🔴": COLORS.red,
};

export function MemberView({
  rawData, members, memberColors, dates, commitData, leave,
  taskAnalysisData, healthAlerts, isMobile,
}: MemberViewProps) {
  const firstAlertMember = useMemo(() => {
    if (healthAlerts.length === 0) return null;
    return healthAlerts[0].member;
  }, [healthAlerts]);

  const [selectedMember, setSelectedMember] = useState(
    firstAlertMember ?? members[0] ?? ""
  );

  const memberAlerts = useMemo(
    () => healthAlerts.filter(a => a.member === selectedMember),
    [healthAlerts, selectedMember],
  );

  const alertsByMember = useMemo(() => {
    const map: Record<string, HealthAlert[]> = {};
    for (const a of healthAlerts) {
      if (!map[a.member]) map[a.member] = [];
      map[a.member].push(a);
    }
    return map;
  }, [healthAlerts]);

  const profile = useMemberProfile(rawData, selectedMember, dates, commitData ?? null, leave, taskAnalysisData);

  return (
    <div>
      {/* Member selector pills */}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16,
      }}>
        {members.map(m => {
          const isActive = m === selectedMember;
          const mAlerts = alertsByMember[m];
          const topSeverity = mAlerts?.[0]?.severity;
          return (
            <button
              key={m}
              onClick={() => setSelectedMember(m)}
              style={{
                padding: "6px 16px",
                borderRadius: 8,
                border: `1px solid ${isActive ? memberColors[m] || COLORS.accent : COLORS.border}`,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "inherit",
                background: isActive ? (memberColors[m] || COLORS.accent) + "22" : "transparent",
                color: isActive ? memberColors[m] || COLORS.accent : COLORS.textMuted,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {m}
              {topSeverity && (
                <span style={{ fontSize: 12 }}>{topSeverity}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Alert banner */}
      {memberAlerts.length > 0 && (
        <div
          data-testid="alert-banner"
          style={{
            marginBottom: 16,
            borderRadius: 10,
            padding: "12px 16px",
            background: SEVERITY_COLORS[memberAlerts[0].severity]?.bg + "66" || COLORS.redDim + "66",
            border: `1px solid ${SEVERITY_COLORS[memberAlerts[0].severity]?.sc || COLORS.red}33`,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {memberAlerts.map((alert, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 13, color: COLORS.text, fontWeight: 600 }}>{alert.text}</span>
              <span style={{
                fontSize: 10, color: COLORS.textDim, marginLeft: "auto",
                background: COLORS.bg, padding: "2px 8px", borderRadius: 4,
              }}>
                {alert.source}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 4-card profile grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
        gap: 16,
      }}>
        {/* Card 1: 30 天工時曲線 */}
        <div data-testid="profile-card-hours">
          <CardPanel title="30 天工時曲線">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={profile.hoursTrend} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} horizontal vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: COLORS.textDim, fontSize: 10 }}
                  axisLine={{ stroke: COLORS.border }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[0, 12]}
                  tick={{ fill: COLORS.textDim, fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={28}
                />
                <Tooltip />
                {profile.baseline !== null && (
                  <ReferenceLine
                    y={profile.baseline}
                    stroke={COLORS.green}
                    strokeDasharray="6 4"
                    strokeWidth={1.5}
                    label={{
                      value: `基準 ${profile.baseline.toFixed(1)}`,
                      fill: COLORS.green,
                      fontSize: 10,
                      position: "right",
                    }}
                  />
                )}
                <Bar dataKey="total" barSize={8} radius={[2, 2, 0, 0]}>
                  {profile.hoursTrend.map((entry, idx) => (
                    <Cell key={idx} fill={STATUS_BAR_COLORS[entry.status] || COLORS.accentLight} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {profile.recentAvg !== null && (
              <div style={{ fontSize: 11, color: COLORS.textDim, marginTop: 4, textAlign: "right" }}>
                近 7 天均值: <span style={{ color: COLORS.text, fontWeight: 600 }}>{profile.recentAvg.toFixed(1)}hr</span>
              </div>
            )}
          </CardPanel>
        </div>

        {/* Card 2: 一致性 Timeline */}
        <div data-testid="profile-card-consistency">
          <CardPanel title="一致性 Timeline">
            <div style={{
              display: "grid",
              gridTemplateColumns: `repeat(${Math.min(dates.length, 10)}, 1fr)`,
              gap: 3,
              marginBottom: 8,
            }}>
              {profile.consistencyGrid.map((g, i) => (
                <div
                  key={i}
                  title={`${g.date}: ${g.status ?? "N/A"}`}
                  style={{
                    width: "100%",
                    aspectRatio: "1",
                    borderRadius: 3,
                    background: g.status ? CONSISTENCY_COLORS[g.status] + "44" : COLORS.border + "44",
                    border: `1px solid ${g.status ? CONSISTENCY_COLORS[g.status] + "66" : COLORS.border}`,
                  }}
                />
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 11, color: COLORS.textDim }}>
                一致率: <span style={{
                  color: profile.consistencyRate >= 80 ? COLORS.green : profile.consistencyRate >= 50 ? COLORS.yellow : COLORS.red,
                  fontWeight: 700,
                }}>{profile.consistencyRate.toFixed(0)}%</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {["✅", "⚠️", "🔴"].map(s => (
                  <span key={s} style={{ fontSize: 10, color: COLORS.textDim }}>
                    {s} {profile.consistencyGrid.filter(g => g.status === s).length}
                  </span>
                ))}
              </div>
            </div>
          </CardPanel>
        </div>

        {/* Card 3: 專案分布 */}
        <div data-testid="profile-card-projects">
          <CardPanel title="專案分布">
            {profile.projectDistribution.length === 0 ? (
              <div style={{ fontSize: 12, color: COLORS.textDim, textAlign: "center", padding: "20px 0" }}>
                無 commit 資料
              </div>
            ) : (
              <>
                {/* Horizontal stacked bar */}
                <div style={{
                  height: 20, borderRadius: 6, overflow: "hidden", display: "flex",
                  background: COLORS.bg, marginBottom: 12,
                }}>
                  {profile.projectDistribution.map((p, i) => (
                    <div
                      key={p.project}
                      title={`${p.project}: ${p.count} (${p.pct.toFixed(0)}%)`}
                      style={{
                        width: `${p.pct}%`,
                        height: "100%",
                        background: PROJECT_PALETTE[i % PROJECT_PALETTE.length],
                        transition: "width 0.5s ease",
                      }}
                    />
                  ))}
                </div>
                {/* Legend */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {profile.projectDistribution.slice(0, 6).map((p, i) => (
                    <div key={p.project} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: 2, display: "inline-block",
                        background: PROJECT_PALETTE[i % PROJECT_PALETTE.length],
                      }} />
                      <span style={{ fontSize: 11, color: COLORS.textMuted }}>{p.project}</span>
                      <span style={{ fontSize: 10, color: COLORS.textDim }}>{p.count}</span>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: COLORS.textDim, marginTop: 8 }}>
                  總 commits: <span style={{ color: COLORS.text, fontWeight: 600 }}>{profile.totalCommits}</span>
                  {profile.prevCommits > 0 && (
                    <span style={{
                      marginLeft: 8,
                      color: profile.recentCommits >= profile.prevCommits ? COLORS.green : COLORS.red,
                    }}>
                      近7天 {profile.recentCommits} (prev {profile.prevCommits})
                    </span>
                  )}
                </div>
              </>
            )}
          </CardPanel>
        </div>

        {/* Card 4: 會議比例 & 任務警告 */}
        <div data-testid="profile-card-meetings">
          <CardPanel title="會議比例 & 任務警告">
            {/* Weekly meeting bar chart */}
            {profile.weeklyMeetingPct.length > 0 && (
              <ResponsiveContainer width="100%" height={100}>
                <BarChart data={profile.weeklyMeetingPct} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                  <XAxis
                    dataKey="week"
                    tick={{ fill: COLORS.textDim, fontSize: 10 }}
                    axisLine={{ stroke: COLORS.border }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: COLORS.textDim, fontSize: 9 }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                    unit="%"
                  />
                  <Tooltip />
                  <ReferenceLine y={THRESHOLDS.target * 10} stroke={COLORS.yellow} strokeDasharray="4 4" strokeWidth={1} />
                  <Bar dataKey="pct" barSize={14} radius={[3, 3, 0, 0]}>
                    {profile.weeklyMeetingPct.map((entry, idx) => (
                      <Cell key={idx} fill={entry.pct > 50 ? COLORS.yellow : COLORS.purple} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
            {profile.meetingPct !== null && (
              <div style={{ fontSize: 11, color: COLORS.textDim, marginTop: 4 }}>
                近 7 天會議佔比: <span style={{
                  color: profile.meetingPct > 50 ? COLORS.yellow : COLORS.textMuted,
                  fontWeight: 600,
                }}>{profile.meetingPct.toFixed(0)}%</span>
              </div>
            )}
            {/* Task warnings */}
            {profile.taskWarnings.length > 0 && (
              <div style={{ marginTop: 10, borderTop: `1px solid ${COLORS.border}`, paddingTop: 8 }}>
                <div style={{ fontSize: 11, color: COLORS.textDim, fontWeight: 600, marginBottom: 6 }}>任務警告</div>
                {profile.taskWarnings.map((w, i) => {
                  const sev = SEVERITY_COLORS[w.severity];
                  return (
                    <div key={i} style={{
                      fontSize: 11, color: COLORS.textMuted, marginBottom: 4,
                      padding: "4px 8px", borderRadius: 4,
                      background: sev?.bg + "33" || "transparent",
                      display: "flex", gap: 6, alignItems: "flex-start",
                    }}>
                      <span>{w.severity}</span>
                      <div>
                        <span style={{ color: COLORS.textDim, marginRight: 6 }}>{w.date}</span>
                        <span>{w.task}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {profile.taskWarnings.length === 0 && profile.weeklyMeetingPct.length === 0 && (
              <div style={{ fontSize: 12, color: COLORS.textDim, textAlign: "center", padding: "20px 0" }}>
                無相關資料
              </div>
            )}
          </CardPanel>
        </div>
      </div>
    </div>
  );
}
