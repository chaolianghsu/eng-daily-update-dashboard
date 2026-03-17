// src/CommitsView.tsx
import { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, Cell, ScatterChart, Scatter, ZAxis, LabelList,
} from "recharts";
import { COLORS, SEVERITY_COLORS, PROJECT_PALETTE } from "./constants";
import type { CommitData, TaskAnalysisData, LeaveRange } from "./types";
import { CardPanel } from "./components";

interface CommitsViewProps {
  commitData: CommitData;
  dates: string[];
  members: string[];
  memberColors: Record<string, string>;
  leave: Record<string, LeaveRange[]>;
  activeDate: string;
  onDateSelect: (d: string) => void;
  dailyDates: string[];
  dayLabels: Record<string, string>;
  taskAnalysisData: TaskAnalysisData | null;
}

export default function CommitsView({ commitData, dates, members, memberColors, leave, activeDate, onDateSelect, dailyDates, dayLabels, taskAnalysisData }: CommitsViewProps) {
  const { commits, analysis, projectRisks } = commitData;
  const [expandedMember, setExpandedMember] = useState(null);

  const gridDates = dates.filter(d => analysis[d]);

  const projectSet = new Set<string>();
  const memberProjectCounts: Record<string, Record<string, number>> = {};
  const dateCommits = commits[activeDate] || {};
  for (const [member, data] of Object.entries(dateCommits)) {
    if (!memberProjectCounts[member]) memberProjectCounts[member] = {};
    for (const item of data.items) {
      projectSet.add(item.project);
      memberProjectCounts[member][item.project] = (memberProjectCounts[member][item.project] || 0) + 1;
    }
  }
  const allProjects = [...projectSet].sort();
  const projectColors: Record<string, string> = {};
  allProjects.forEach((p, i) => { projectColors[p] = PROJECT_PALETTE[i % PROJECT_PALETTE.length]; });

  const barData = Object.entries(memberProjectCounts)
    .map(([member, projects]) => ({ member, ...(projects as any), _total: Object.values(projects).reduce((a: number, b: number) => a + b, 0) }))
    .sort((a, b) => b._total - a._total);

  const memberCommitList: Record<string, any[]> = {};
  const dateCommitsForDetail = commits[activeDate] || {};
  for (const [member, data] of Object.entries(dateCommitsForDetail)) {
    if (!memberCommitList[member]) memberCommitList[member] = [];
    for (const item of data.items) {
      memberCommitList[member].push({ date: activeDate, ...item });
    }
  }

  const consistencyStyle = (status) => {
    const map = { "\u2705": { c: COLORS.green, b: COLORS.greenDim }, "\u26A0\uFE0F": { c: COLORS.yellow, b: COLORS.yellowDim } };
    const s = map[status] || (SEVERITY_COLORS[status] ? { c: SEVERITY_COLORS[status].sc, b: SEVERITY_COLORS[status].bg } : { c: COLORS.textDim, b: COLORS.border });
    return s;
  };
  const statusColor = s => consistencyStyle(s).c;
  const statusBg = s => consistencyStyle(s).b;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <div className="date-scroll">
          {dailyDates.map(d => (
            <button key={d} className="date-btn" onClick={() => onDateSelect(d)}
              style={{
                padding: "8px 20px", borderRadius: 8, cursor: "pointer",
                fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                border: activeDate === d ? `2px solid ${COLORS.teal}` : `1px solid ${COLORS.border}`,
                background: activeDate === d ? "rgba(6,182,212,0.15)" : "transparent",
                color: activeDate === d ? COLORS.teal : COLORS.textMuted,
              }}
            >{d}（{dayLabels[d]}）</button>
          ))}
        </div>
      </div>
      {/* Correlation Overview */}
      {(() => {
        const dateAnalysis = analysis[activeDate] || {};
        const dateCommitData = commits[activeDate] || {};

        // Build scatter data for members with any data on activeDate
        const scatterData = [];
        const noData = [];

        members.forEach(m => {
          const a = dateAnalysis[m];
          const onLv = leave[m] && leave[m].some(r => {
            const dn = activeDate.split('/').map(Number);
            const sn = r.start.split('/').map(Number);
            const en = r.end.split('/').map(Number);
            return (dn[0]*100+dn[1]) >= (sn[0]*100+sn[1]) && (dn[0]*100+dn[1]) <= (en[0]*100+en[1]);
          });

          if (onLv) {
            noData.push({ name: m, reason: '休假' });
            return;
          }
          if (!a) {
            noData.push({ name: m, reason: '無資料' });
            return;
          }

          scatterData.push({
            name: m,
            hours: a.hours || 0,
            commits: a.commitCount || 0,
            status: a.status,
            color: memberColors[m],
          });
        });

        // Sort summary by commits descending
        const sortedSummary = [...scatterData].sort((a, b) => b.commits - a.commits);

        return (
          <CardPanel title={`工時 × Commits 關聯分析（${activeDate}）`}>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              {/* Scatter Chart */}
              <div style={{ flex: "1 1 400px", minWidth: 300 }}>
                <ResponsiveContainer width="100%" height={300}>
                  <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                    <XAxis
                      type="number"
                      dataKey="hours"
                      name="工時"
                      unit="hr"
                      domain={[0, 'auto']}
                      tick={{ fill: COLORS.textDim, fontSize: 11 }}
                      axisLine={{ stroke: COLORS.border }}
                      tickLine={false}
                      label={{ value: "Daily Update 工時 (hr)", position: "bottom", offset: 0, fill: COLORS.textDim, fontSize: 11 }}
                    />
                    <YAxis
                      type="number"
                      dataKey="commits"
                      name="Commits"
                      domain={[0, 'auto']}
                      tick={{ fill: COLORS.textDim, fontSize: 11 }}
                      axisLine={{ stroke: COLORS.border }}
                      tickLine={false}
                      label={{ value: "Commits", angle: -90, position: "insideLeft", offset: 10, fill: COLORS.textDim, fontSize: 11 }}
                    />
                    <ZAxis range={[120, 120]} />
                    <Tooltip
                      cursor={{ strokeDasharray: '3 3', stroke: COLORS.textDim }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0]?.payload;
                        if (!d) return null;
                        return (
                          <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "10px 14px", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
                            <div style={{ fontWeight: 700, color: d.color, marginBottom: 4 }}>{d.name} {d.status}</div>
                            <div style={{ fontSize: 12, color: COLORS.textMuted }}>工時：{d.hours}hr</div>
                            <div style={{ fontSize: 12, color: COLORS.textMuted }}>Commits：{d.commits}</div>
                          </div>
                        );
                      }}
                    />
                    <Scatter data={scatterData} isAnimationActive={false}>
                      {scatterData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} stroke={entry.color} fillOpacity={0.8} />
                      ))}
                      <LabelList dataKey="name" position="top" style={{ fill: COLORS.textMuted, fontSize: 11, fontWeight: 600 }} />
                    </Scatter>
                    {/* Quadrant reference lines */}
                    <ReferenceLine x={6.5} stroke={COLORS.textDim} strokeDasharray="4 4" strokeWidth={0.5} />
                    <ReferenceLine y={scatterData.length > 0 ? Math.max(1, Math.round(scatterData.reduce((s, d) => s + d.commits, 0) / Math.max(1, scatterData.filter(d => d.commits > 0).length))) : 1} stroke={COLORS.textDim} strokeDasharray="4 4" strokeWidth={0.5} />
                  </ScatterChart>
                </ResponsiveContainer>
                {/* Quadrant legend */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginTop: 4, padding: "0 10px" }}>
                  <span style={{ fontSize: 10, color: COLORS.textDim }}>↙ 低工時 · 少 commits</span>
                  <span style={{ fontSize: 10, color: COLORS.textDim, textAlign: "right" }}>↘ 高工時 · 少 commits（⚠️ 非 coding）</span>
                  <span style={{ fontSize: 10, color: COLORS.textDim }}>↖ 低工時 · 多 commits（🔴 低估？）</span>
                  <span style={{ fontSize: 10, color: COLORS.textDim, textAlign: "right" }}>↗ 高工時 · 多 commits（✅ 一致）</span>
                </div>
              </div>

              {/* Summary Table */}
              <div style={{ flex: "1 1 300px", minWidth: 250 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ padding: "6px 8px", textAlign: "left", color: COLORS.textMuted, fontWeight: 600, borderBottom: `1px solid ${COLORS.border}` }}>成員</th>
                      <th style={{ padding: "6px 8px", textAlign: "center", color: COLORS.textMuted, fontWeight: 600, borderBottom: `1px solid ${COLORS.border}` }}>工時</th>
                      <th style={{ padding: "6px 8px", textAlign: "center", color: COLORS.teal, fontWeight: 600, borderBottom: `1px solid ${COLORS.border}` }}>Commits</th>
                      <th style={{ padding: "6px 8px", textAlign: "center", color: COLORS.textMuted, fontWeight: 600, borderBottom: `1px solid ${COLORS.border}` }}>狀態</th>
                      <th style={{ padding: "6px 8px", textAlign: "left", color: COLORS.textMuted, fontWeight: 600, borderBottom: `1px solid ${COLORS.border}` }}>Projects</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSummary.map(d => {
                      const memberCommitData = dateCommitData[d.name];
                      const projects = memberCommitData ? memberCommitData.projects : [];
                      return (
                        <tr key={d.name} style={{ borderBottom: `1px solid ${COLORS.border}15` }}>
                          <td style={{ padding: "6px 8px", fontWeight: 600 }}>
                            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: d.color, marginRight: 6, verticalAlign: "middle" }} />
                            {d.name}
                          </td>
                          <td style={{ padding: "6px 8px", textAlign: "center", fontVariantNumeric: "tabular-nums", color: d.hours > 0 ? COLORS.text : COLORS.textDim }}>
                            {d.hours > 0 ? `${d.hours}hr` : '—'}
                          </td>
                          <td style={{ padding: "6px 8px", textAlign: "center", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: d.commits > 0 ? COLORS.teal : COLORS.textDim }}>
                            {d.commits > 0 ? d.commits : '—'}
                          </td>
                          <td style={{ padding: "6px 8px", textAlign: "center", fontSize: 14 }}>{d.status}</td>
                          <td style={{ padding: "6px 8px", fontSize: 11, color: COLORS.textMuted }}>
                            {projects.map(p => p.split('/').pop()).join(', ') || '—'}
                          </td>
                        </tr>
                      );
                    })}
                    {noData.map(d => (
                      <tr key={d.name} style={{ borderBottom: `1px solid ${COLORS.border}15`, opacity: 0.5 }}>
                        <td style={{ padding: "6px 8px", fontWeight: 600, color: COLORS.textDim }}>
                          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: COLORS.textDim, marginRight: 6, verticalAlign: "middle" }} />
                          {d.name}
                        </td>
                        <td colSpan={3} style={{ padding: "6px 8px", textAlign: "center", color: COLORS.textDim, fontSize: 11 }}>{d.reason}</td>
                        <td />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </CardPanel>
        );
      })()}
      {/* Consistency Grid — Enhanced */}
      <CardPanel title="一致性檢查（每日明細）">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 2, fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ padding: "6px 10px", textAlign: "left", color: COLORS.textMuted, fontWeight: 600, fontSize: 11, whiteSpace: "nowrap", position: "sticky", left: 0, background: COLORS.card, zIndex: 1 }}>成員</th>
                {gridDates.map(d => (
                  <th key={d} onClick={() => onDateSelect(d)} style={{
                    padding: "6px 6px", textAlign: "center", fontSize: 10, cursor: "pointer",
                    fontWeight: d === activeDate ? 700 : 400,
                    color: d === activeDate ? COLORS.teal : COLORS.textMuted,
                    background: d === activeDate ? COLORS.tealDim + "40" : "transparent",
                    borderRadius: "6px 6px 0 0",
                    transition: "all 0.15s ease",
                  }}>{d}</th>
                ))}
                <th style={{ padding: "6px 8px", textAlign: "center", color: COLORS.teal, fontWeight: 600, fontSize: 10, whiteSpace: "nowrap" }}>合計</th>
              </tr>
            </thead>
            <tbody>
              {members.filter(m => gridDates.some(d => analysis[d]?.[m])).map(m => {
                // Member totals
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

                      const isActive = d === activeDate;
                      let bg, color, topLabel, bottomLabel, tooltip;

                      if (a) {
                        const intensity = Math.min(1, 0.3 + (a.commitCount / 20) * 0.7);
                        const baseColor = a.status === '✅' ? COLORS.green : a.status === '⚠️' ? COLORS.yellow : COLORS.red;
                        const baseBg = a.status === '✅' ? COLORS.greenDim : a.status === '⚠️' ? COLORS.yellowDim : COLORS.redDim;
                        bg = baseBg + Math.round(intensity * 255).toString(16).padStart(2, '0');
                        color = baseColor;
                        topLabel = a.commitCount > 0 ? a.commitCount : '—';
                        bottomLabel = a.hours != null ? a.hours + 'h' : '?';
                        tooltip = `${m} ${d}\n${a.status} Commits: ${a.commitCount} | 工時: ${a.hours || '未報'}hr`;
                      } else if (onLeaveDay) {
                        bg = COLORS.orangeDim + '44';
                        color = COLORS.orange;
                        topLabel = '假';
                        bottomLabel = '';
                        tooltip = `${m} ${d}\n休假`;
                      } else {
                        bg = 'transparent';
                        color = COLORS.textDim;
                        topLabel = '·';
                        bottomLabel = '';
                        tooltip = `${m} ${d}\n無資料`;
                      }

                      return (
                        <td key={d} title={tooltip} onClick={() => onDateSelect(d)} style={{
                          padding: 0, textAlign: "center", cursor: "pointer",
                          background: isActive ? COLORS.tealDim + "30" : "transparent",
                          borderLeft: isActive ? `1px solid ${COLORS.teal}33` : "1px solid transparent",
                          borderRight: isActive ? `1px solid ${COLORS.teal}33` : "1px solid transparent",
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
                    {/* Member total column */}
                    <td style={{ padding: "4px 8px", textAlign: "center" }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: totalCommits > 0 ? COLORS.teal : COLORS.textDim, fontVariantNumeric: "tabular-nums" }}>{totalCommits || '—'}</span>
                        {activeDays > 0 && <span style={{ fontSize: 9, color: COLORS.textDim }}>{activeDays}d</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {/* Summary row */}
              <tr>
                <td style={{ padding: "6px 10px", color: COLORS.textMuted, fontWeight: 600, fontSize: 11, borderTop: `1px solid ${COLORS.border}`, position: "sticky", left: 0, background: COLORS.card, zIndex: 1 }}>合計</td>
                {gridDates.map(d => {
                  const dateMembers = analysis[d] || {};
                  const totalC = Object.values(dateMembers).reduce((s, a) => s + (a.commitCount || 0), 0);
                  const hoursArr = Object.values(dateMembers).filter(a => a.hours != null).map(a => a.hours);
                  const avgH = hoursArr.length ? (hoursArr.reduce((a, b) => a + b, 0) / hoursArr.length).toFixed(1) : null;
                  const isActive = d === activeDate;
                  return (
                    <td key={d} onClick={() => onDateSelect(d)} style={{
                      padding: "4px 4px", textAlign: "center", cursor: "pointer",
                      borderTop: `1px solid ${COLORS.border}`,
                      background: isActive ? COLORS.tealDim + "30" : "transparent",
                    }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: totalC > 0 ? COLORS.teal : COLORS.textDim, fontVariantNumeric: "tabular-nums" }}>{totalC || '—'}</span>
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
        {/* Legend */}
        <div style={{ display: "flex", gap: 16, marginTop: 10, paddingTop: 8, borderTop: `1px solid ${COLORS.border}`, flexWrap: "wrap" }}>
          {[
            { label: "✅ 工時+Commits 一致", bg: COLORS.greenDim, color: COLORS.green },
            { label: "⚠️ 有工時，無 Commits", bg: COLORS.yellowDim, color: COLORS.yellow },
            { label: "🔴 有 Commits，未回報", bg: COLORS.redDim, color: COLORS.red },
            { label: "假 休假", bg: COLORS.orangeDim, color: COLORS.orange },
          ].map(l => (
            <span key={l.label} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: COLORS.textDim }}>
              <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: l.bg, border: `1px solid ${l.color}33` }} />
              {l.label}
            </span>
          ))}
          <span style={{ fontSize: 10, color: COLORS.textDim, marginLeft: "auto" }}>上方=commits 下方=工時 | 點擊日期切換</span>
        </div>
      </CardPanel>

      {/* Task Reasonableness Warnings */}
      {(() => {
        if (!taskAnalysisData || !taskAnalysisData.warnings) return null;
        const warnings = taskAnalysisData.warnings;
        const summary = taskAnalysisData.summary;
        const typeLabels = { low_output: '產出不足', mismatch: '領域不符', outlier: '偏離均值' };
        const typeIcons = { low_output: '🔴', mismatch: '🟠', outlier: '🟡' };

        if (warnings.length === 0) {
          return (
            <CardPanel title="任務合理性警示">
              <div style={{ padding: "12px 0", textAlign: "center", color: COLORS.textDim, fontSize: 13 }}>
                無警示 — 所有成員任務與 commit 記錄一致
              </div>
            </CardPanel>
          );
        }

        return (
          <CardPanel title={`任務合理性警示（${taskAnalysisData.period || ''}）`}>
            {/* Summary stats */}
            <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
              <div style={{ background: COLORS.bg, borderRadius: 8, padding: "8px 14px", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 20, fontWeight: 800, color: COLORS.red }}>{warnings.length}</span>
                <span style={{ fontSize: 11, color: COLORS.textMuted }}>警示總數</span>
              </div>
              {Object.entries(summary?.byType || {}).filter(([, v]) => v > 0).map(([type, count]) => {
                const sev = SEVERITY_COLORS[typeIcons[type]];
                return (
                  <div key={type} style={{ background: sev ? sev.bg + '33' : COLORS.bg, borderRadius: 8, padding: "8px 14px", display: "flex", alignItems: "center", gap: 8, border: `1px solid ${sev ? sev.sc + '33' : COLORS.border}` }}>
                    <span style={{ fontSize: 14 }}>{typeIcons[type]}</span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: sev ? sev.sc : COLORS.text }}>{count}</span>
                    <span style={{ fontSize: 11, color: COLORS.textMuted }}>{typeLabels[type]}</span>
                  </div>
                );
              })}
            </div>
            {/* Warning cards */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {warnings.map((w, i) => {
                const sev = SEVERITY_COLORS[w.severity] || { sc: COLORS.textDim, bg: COLORS.border };
                return (
                  <div key={i} style={{
                    background: sev.bg + '22', border: `1px solid ${sev.sc}33`, borderRadius: 10,
                    padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 18 }}>{w.severity}</span>
                      <span style={{ fontWeight: 700, fontSize: 14, color: COLORS.text }}>{w.member}</span>
                      <span style={{ fontSize: 12, color: COLORS.textMuted, background: COLORS.bg, padding: "2px 8px", borderRadius: 4 }}>{w.date}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
                        background: sev.bg, color: sev.sc, marginLeft: "auto",
                      }}>{typeLabels[w.type] || w.type}</span>
                    </div>
                    <div style={{ fontSize: 12, color: COLORS.textMuted }}>
                      <span style={{ fontWeight: 600, color: COLORS.text }}>任務：</span>{w.task}
                    </div>
                    <div style={{ fontSize: 12, color: COLORS.teal }}>
                      <span style={{ fontWeight: 600, color: COLORS.text }}>Commits：</span>{w.commits}
                    </div>
                    <div style={{ fontSize: 12, color: COLORS.textMuted, background: COLORS.bg + '80', borderRadius: 6, padding: "8px 10px", lineHeight: 1.6 }}>
                      {w.reasoning}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardPanel>
        );
      })()}

      {/* Project Participation */}
      {allProjects.length > 0 && (
        <CardPanel title={`專案參與度（${activeDate}）`}>
          <ResponsiveContainer width="100%" height={barData.length * 36 + 40}>
            <BarChart data={barData} layout="vertical" margin={{ left: 60, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
              <XAxis type="number" tick={{ fill: COLORS.textDim, fontSize: 11 }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
              <YAxis type="category" dataKey="member" width={50} tick={{ fill: COLORS.textMuted, fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text }} />
              {allProjects.map(p => (
                <Bar key={p} dataKey={p} stackId="a" fill={projectColors[p]} name={p.split('/').pop()} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </CardPanel>
      )}

      {/* Commit Detail */}
      <CardPanel title={`Commit 明細（${activeDate}）`}>
        {Object.entries(memberCommitList).sort((a, b) => b[1].length - a[1].length).map(([member, items]) => (
          <div key={member} style={{ marginBottom: 8 }}>
            <button
              onClick={() => setExpandedMember(expandedMember === member ? null : member)}
              style={{ width: "100%", textAlign: "left", background: "transparent", border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "8px 12px", color: COLORS.text, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "inherit", fontSize: 13 }}
            >
              <span>{member}</span>
              <span style={{ color: COLORS.teal }}>{items.length} commits {expandedMember === member ? "\u25B2" : "\u25BC"}</span>
            </button>
            {expandedMember === member && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 4 }}>
                <tbody>
                  {items.sort((a, b) => b.date.localeCompare(a.date)).map((item, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                      <td style={{ padding: "4px 8px", color: COLORS.textMuted, width: 40 }}>{item.date}</td>
                      <td style={{ padding: "4px 8px", color: COLORS.teal, width: 120, fontSize: 11 }}>{item.project.split('/').pop()}</td>
                      <td style={{ padding: "4px 8px", color: COLORS.text }}>{item.title}</td>
                      <td style={{ padding: "4px 8px", width: 70 }}>
                        {item.url ? (
                          <a href={item.url} target="_blank" rel="noopener noreferrer"
                            style={{ color: COLORS.teal, fontFamily: "JetBrains Mono, SF Mono, monospace", fontSize: 11, textDecoration: "none" }}
                            onMouseOver={e => (e.target as HTMLElement).style.textDecoration = "underline"}
                            onMouseOut={e => (e.target as HTMLElement).style.textDecoration = "none"}
                          >{item.sha}</a>
                        ) : (
                          <span style={{ color: COLORS.textDim, fontFamily: "JetBrains Mono, SF Mono, monospace", fontSize: 11 }}>{item.sha}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </CardPanel>
    </div>
  );
}
