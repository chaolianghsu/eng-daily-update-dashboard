import { useState, useRef, useEffect } from "react";
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
  dailyBarData: Array<{ name: string; 開發: number; 會議: number; total: number | null; status?: string }>;
  chartHeight: number;
  memberColors: Record<string, string>;
  issueMap: Record<string, { severity: string; text: string }>;
  commitData: CommitData | null;
  leave: Record<string, LeaveRange[]>;
  weeks: Array<{ dates: string[]; label: string }>;
  weekIndex: number;
  canGoPrev: boolean;
  canGoNext: boolean;
  isThisWeek: boolean;
  isLastWeek: boolean;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onThisWeek: () => void;
  onLastWeek: () => void;
  onSelectWeek: (index: number) => void;
}

export function DailyView({
  dailyDates, activeDate, onDateSelect, dayLabels,
  dailyBarData, chartHeight, memberColors, issueMap, commitData, leave,
  weeks, weekIndex, canGoPrev, canGoNext, isThisWeek, isLastWeek,
  onPrevWeek, onNextWeek, onThisWeek, onLastWeek, onSelectWeek,
}: DailyViewProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDropdownOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [dropdownOpen]);

  return (
    <div>
      <div className="animate-in" style={{ animationDelay: "0.15s", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={onPrevWeek} disabled={!canGoPrev}
              style={{
                background: "none", border: "none", cursor: canGoPrev ? "pointer" : "default",
                color: canGoPrev ? COLORS.textDim : COLORS.border, fontSize: 16, padding: "4px 6px",
                fontFamily: "inherit", transition: "color 0.15s",
              }}
              onMouseEnter={e => { if (canGoPrev) (e.currentTarget as HTMLElement).style.color = COLORS.text; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = canGoPrev ? COLORS.textDim : COLORS.border; }}
            >◀</button>

            <div ref={dropdownRef} style={{ position: "relative" }}>
              <button onClick={() => setDropdownOpen(o => !o)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: COLORS.text, fontSize: 13, fontWeight: 700, fontFamily: "inherit",
                  padding: "4px 8px", borderRadius: 6,
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = COLORS.card; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "none"; }}
              >
                {isThisWeek ? "本週 " : ""}{weeks[weekIndex]?.label || ""} ▾
              </button>

              {dropdownOpen && (
                <div style={{
                  position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 50,
                  background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10,
                  padding: 4, minWidth: 180, maxHeight: 240, overflowY: "auto",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
                }}>
                  {weeks.map((w, i) => (
                    <button key={i} onClick={() => { onSelectWeek(i); setDropdownOpen(false); }}
                      style={{
                        display: "block", width: "100%", textAlign: "left", padding: "8px 12px",
                        background: i === weekIndex ? "rgba(59,130,246,0.1)" : "transparent",
                        border: "none", borderRadius: 6, cursor: "pointer",
                        borderLeft: i === weekIndex ? `3px solid ${COLORS.accent}` : "3px solid transparent",
                        color: i === weekIndex ? COLORS.accentLight : COLORS.textMuted,
                        fontSize: 12, fontWeight: i === weekIndex ? 700 : 500, fontFamily: "inherit",
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={e => { if (i !== weekIndex) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"; }}
                      onMouseLeave={e => { if (i !== weekIndex) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                    >{w.label}</button>
                  ))}
                </div>
              )}
            </div>

            <button onClick={onNextWeek} disabled={!canGoNext}
              style={{
                background: "none", border: "none", cursor: canGoNext ? "pointer" : "default",
                color: canGoNext ? COLORS.textDim : COLORS.border, fontSize: 16, padding: "4px 6px",
                fontFamily: "inherit", transition: "color 0.15s",
              }}
              onMouseEnter={e => { if (canGoNext) (e.currentTarget as HTMLElement).style.color = COLORS.text; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = canGoNext ? COLORS.textDim : COLORS.border; }}
            >▶</button>
          </div>

          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={onThisWeek}
              style={{
                padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, fontFamily: "inherit",
                border: isThisWeek ? `1px solid ${COLORS.accent}44` : `1px solid ${COLORS.border}`,
                background: isThisWeek ? "rgba(59,130,246,0.15)" : "transparent",
                color: isThisWeek ? COLORS.accentLight : COLORS.textDim,
                cursor: "pointer", transition: "all 0.15s",
              }}
            >本週</button>
            <button onClick={onLastWeek} disabled={weeks.length < 2}
              style={{
                padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, fontFamily: "inherit",
                border: isLastWeek ? `1px solid ${COLORS.accent}44` : `1px solid ${COLORS.border}`,
                background: isLastWeek ? "rgba(59,130,246,0.15)" : "transparent",
                color: weeks.length < 2 ? COLORS.border : (isLastWeek ? COLORS.accentLight : COLORS.textDim),
                cursor: weeks.length < 2 ? "default" : "pointer",
                opacity: weeks.length < 2 ? 0.4 : 1,
                transition: "all 0.15s",
              }}
            >上週</button>
          </div>
        </div>

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
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{d.name}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {commitData && commitData.commits?.[activeDate]?.[d.name]?.count > 0 && (
                    <span style={{ background: COLORS.tealDim, color: COLORS.teal, padding: "1px 6px", borderRadius: 8, fontSize: 10, fontWeight: 600 }}>
                      {commitData.commits[activeDate][d.name].count}C
                    </span>
                  )}
                  {commitData?.analysis?.[activeDate]?.[d.name] && (
                    <span style={{ fontSize: 12 }}>
                      {commitData.analysis[activeDate][d.name].status}
                    </span>
                  )}
                  <StatusBadge status={status} />
                </span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: status.color, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
                {d.total !== null ? d.total : (
                  d.status === 'unreported' ? <span style={{ color: COLORS.red, fontSize: 11 }}>未報</span> :
                  d.status === 'replied_no_hours' ? <span style={{ color: COLORS.orange, fontSize: 11 }}>無工時</span> :
                  d.status === 'leave' ? <span style={{ color: COLORS.orange, fontSize: 11 }}>假</span> :
                  d.status === 'zero' ? '0' : '—'
                )}
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
