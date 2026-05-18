// src/views/CXOView.tsx
import { useMemo, useState } from "react";
import { COLORS, SEVERITY_COLORS } from "../constants";
import { CardPanel } from "../components";
import {
  useCenterROI,
  useParentCenterROI,
  useSpecOwnership,
  useWeeklyHealth,
  useTopRisks,
  useCapacityHeatmap,
} from "../hooks/useCXOMetrics";
import type { CentersMap, ParentCentersMap, Period } from "../hooks/useCXOMetrics";
import { dateToNum } from "../utils";
import type {
  CommitData,
  TaskAnalysisData,
  PlanAnalysisData,
  Issue,
} from "../types";

interface CXOViewProps {
  rawData: Record<string, Record<string, any>> | null;
  commitData: CommitData | null;
  taskAnalysisData: TaskAnalysisData | null;
  planAnalysisData: PlanAnalysisData | null;
  issues: Issue[];
  members: string[];
  dates: string[];
  centers: CentersMap;
  parentCenters?: ParentCentersMap;
}

// Pick "current week" = last Monday to last reported date (or just all available if <5)
function computeCurrentWeek(dates: string[]): Period {
  if (!dates.length) return { dates: [] };
  const sorted = [...dates].sort((a, b) => dateToNum(a) - dateToNum(b));
  const last = sorted[sorted.length - 1];
  const year = new Date().getFullYear();
  const [m, d] = last.split("/").map(Number);
  const lastDate = new Date(year, m - 1, d);
  const dayOfWeek = lastDate.getDay();
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Mon-anchored
  const monday = new Date(lastDate);
  monday.setDate(lastDate.getDate() - diff);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  // Filter sorted dates within [monday, friday]
  const startN = (monday.getMonth() + 1) * 100 + monday.getDate();
  const endN = (friday.getMonth() + 1) * 100 + friday.getDate();
  const inWeek = sorted.filter(d => {
    const n = dateToNum(d);
    return n >= startN && n <= endN;
  });
  return { dates: inWeek.length ? inWeek : sorted.slice(-5) };
}

const STATUS_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  matched: { label: "✅ 對齊", color: COLORS.green, bg: COLORS.greenDim },
  unmatched: { label: "🔴 未對齊", color: COLORS.red, bg: COLORS.redDim },
  partial: { label: "🟡 部分", color: COLORS.yellow, bg: COLORS.yellowDim },
  unknown: { label: "—", color: COLORS.textDim, bg: COLORS.border },
};

function heatColor(h: number): string {
  if (h === 0) return "#1e293b";
  if (h < 20) return COLORS.red;     // under capacity
  if (h < 35) return COLORS.yellow;  // light
  if (h <= 45) return COLORS.green;  // healthy
  if (h <= 55) return COLORS.yellow; // heavy
  return COLORS.red;                 // over capacity
}

export function CXOView({
  rawData,
  commitData,
  taskAnalysisData,
  planAnalysisData,
  issues,
  members,
  dates,
  centers,
  parentCenters,
}: CXOViewProps) {
  const period = useMemo(() => computeCurrentWeek(dates), [dates]);
  // Two-tier selector: parent-center + (optional) dept inside that parent.
  // parentFilter === "all"  →  no scope (whole org)
  // parentFilter === "<parent>" + deptFilter === "all"  →  all depts under that parent
  // parentFilter === "<parent>" + deptFilter === "<dept>"  →  only that dept
  const [parentFilter, setParentFilter] = useState<string>("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");

  // Compute the set of dept keys the filter currently allows. Used by Card 1B
  // and the capacity heatmap. Card 1A (parent ROI) always shows all parents.
  const allowedDepts: Set<string> | null = useMemo(() => {
    if (parentFilter === "all") return null; // no filter
    if (deptFilter !== "all") return new Set([deptFilter]);
    if (parentCenters && parentCenters[parentFilter]) {
      return new Set(parentCenters[parentFilter].children || []);
    }
    return new Set();
  }, [parentFilter, deptFilter, parentCenters]);

  // Always compute full data; filter for display
  const fullROI = useCenterROI(rawData, commitData, period, centers);
  const parentROI = useParentCenterROI(rawData, commitData, parentCenters, centers, period);
  const specRows = useSpecOwnership(planAnalysisData, centers, 8);
  const health = useWeeklyHealth(rawData, commitData, taskAnalysisData, period, members);
  const risks = useTopRisks(issues, taskAnalysisData, commitData, rawData, members, period, 5);
  const fullHeatmap = useCapacityHeatmap(rawData, dates, 4, centers);

  // Filter dept-level data by allowedDepts.
  const allROI = useMemo(() => {
    if (!allowedDepts) return fullROI;
    return fullROI.filter(r => allowedDepts.has(r.center));
  }, [fullROI, allowedDepts]);

  const heatmap = useMemo(() => {
    if (!allowedDepts) return fullHeatmap;
    return {
      ...fullHeatmap,
      centers: fullHeatmap.centers.filter(c => allowedDepts.has(c.center)),
    };
  }, [fullHeatmap, allowedDepts]);

  const parentOptions = useMemo(() => {
    return Object.keys(parentCenters || {});
  }, [parentCenters]);

  const deptOptions = useMemo(() => {
    if (parentFilter === "all" || !parentCenters?.[parentFilter]) return [];
    return (parentCenters[parentFilter].children || []).filter(d => centers?.[d]);
  }, [parentFilter, parentCenters, centers]);

  const onParentChange = (next: string) => {
    setParentFilter(next);
    setDeptFilter("all"); // reset dept when parent changes
  };

  const [expandedSpec, setExpandedSpec] = useState<number | null>(null);

  return (
    <div data-testid="cxo-view" className="animate-in" style={{ display: "grid", gap: 16 }}>
      {/* Two-tier filter header: parent center + (optional) dept */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 14, color: COLORS.textMuted, fontWeight: 600 }}>
          策略總覽 · {period.dates[0] || "—"} ~ {period.dates[period.dates.length - 1] || "—"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: COLORS.textDim }}>中心</span>
          <select
            data-testid="cxo-parent-filter"
            value={parentFilter}
            onChange={e => onParentChange(e.target.value)}
            style={{
              background: COLORS.card, color: COLORS.text, border: `1px solid ${COLORS.border}`,
              borderRadius: 6, padding: "4px 10px", fontSize: 12, fontFamily: "inherit",
            }}
          >
            <option value="all">全部</option>
            {parentOptions.map(p => (
              <option key={p} value={p}>{parentCenters?.[p]?.label || p}</option>
            ))}
          </select>
          {parentFilter !== "all" && deptOptions.length > 0 && (
            <>
              <span style={{ fontSize: 11, color: COLORS.textDim }}>部門</span>
              <select
                data-testid="cxo-dept-filter"
                value={deptFilter}
                onChange={e => setDeptFilter(e.target.value)}
                style={{
                  background: COLORS.card, color: COLORS.text, border: `1px solid ${COLORS.border}`,
                  borderRadius: 6, padding: "4px 10px", fontSize: 12, fontFamily: "inherit",
                }}
              >
                <option value="all">(全部部門)</option>
                {deptOptions.map(d => (
                  <option key={d} value={d}>{centers?.[d]?.label || d}</option>
                ))}
              </select>
            </>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        {/* Card 1A: Parent Center ROI (roll-up) */}
        <div data-testid="cxo-card-roi-parent">
          <CardPanel title="🏢 中心 ROI（roll-up）" padding="16px">
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {parentROI.map(p => (
                <div key={p.parentCenter}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.text }}>{p.label}</span>
                    <span style={{ fontSize: 11, color: COLORS.textMuted, fontVariantNumeric: "tabular-nums" }}>
                      {p.peopleMonth.toFixed(2)} 人月 · {p.commits} commits · {p.items} items
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 4, height: 18 }}>
                    <div title={`人月: ${p.peopleMonth.toFixed(2)}`} style={{
                      flex: 1, background: COLORS.bg, borderRadius: 4, overflow: "hidden",
                    }}>
                      <div style={{
                        width: `${Math.min(100, p.peopleMonth * 50)}%`, height: "100%",
                        background: COLORS.accent, transition: "width 0.4s ease",
                      }} />
                    </div>
                    <div title={`commits: ${p.commits}`} style={{
                      flex: 1, background: COLORS.bg, borderRadius: 4, overflow: "hidden",
                    }}>
                      <div style={{
                        width: `${Math.min(100, (p.commits / 50) * 100)}%`, height: "100%",
                        background: COLORS.teal, transition: "width 0.4s ease",
                      }} />
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: COLORS.textDim, marginTop: 4 }}>
                    包含：{p.departments.join("・")}
                  </div>
                </div>
              ))}
              {parentROI.length === 0 && (
                <span style={{ fontSize: 12, color: COLORS.textDim }}>尚未設定中心階層</span>
              )}
              {parentROI.length === 1 && (
                <div style={{ marginTop: 4, fontSize: 10, color: COLORS.textDim, fontStyle: "italic" }}>
                  目前只有一個中心 — 隨組織擴張會自動顯示更多中心
                </div>
              )}
            </div>
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${COLORS.border}`, display: "flex", gap: 12, fontSize: 10, color: COLORS.textDim }}>
              <span><span style={{ display: "inline-block", width: 8, height: 8, background: COLORS.accent, borderRadius: 2, marginRight: 4 }} />人月投入</span>
              <span><span style={{ display: "inline-block", width: 8, height: 8, background: COLORS.teal, borderRadius: 2, marginRight: 4 }} />commits 產出</span>
            </div>
          </CardPanel>
        </div>

        {/* Card 1B: Department ROI (grouped by parent center) */}
        <div data-testid="cxo-card-roi-dept">
          <CardPanel title="🏭 部門 ROI 細節" padding="16px">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {(() => {
                // Group rows by parent center for visual section headers.
                // Use centers config to look up parent; fall back to "未分類" group.
                const groups: Array<{ parentKey: string; parentLabel: string; rows: typeof allROI }> = [];
                const seen: Record<string, number> = {};
                for (const r of allROI) {
                  const cfg = centers?.[r.center];
                  const parentKey = cfg?.parent || "__未分類";
                  const parentLabel =
                    parentCenters?.[parentKey]?.label
                    || (parentKey === "__未分類" ? "未分類" : parentKey);
                  if (seen[parentKey] == null) {
                    seen[parentKey] = groups.length;
                    groups.push({ parentKey, parentLabel, rows: [] });
                  }
                  groups[seen[parentKey]].rows.push(r);
                }
                const showHeaders = groups.length > 1 || (groups.length === 1 && groups[0].parentKey !== "__未分類");
                return groups.map(g => (
                  <div key={g.parentKey}>
                    {showHeaders && (
                      <div style={{
                        fontSize: 10, color: COLORS.textDim, fontWeight: 600,
                        textTransform: "uppercase", letterSpacing: "0.08em",
                        marginBottom: 6, paddingBottom: 4,
                        borderBottom: `1px solid ${COLORS.border}`,
                      }}>
                        {g.parentLabel}
                      </div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {g.rows.map(r => (
                        <div key={r.center} style={{ opacity: r.placeholder ? 0.4 : 1 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.text }}>{r.label}</span>
                            {r.placeholder ? (
                              <span style={{ fontSize: 11, color: COLORS.textDim }}>尚未加入</span>
                            ) : (
                              <span style={{ fontSize: 11, color: COLORS.textMuted, fontVariantNumeric: "tabular-nums" }}>
                                {r.peopleMonth.toFixed(2)} 人月 · {r.commits} commits · {r.items} items
                              </span>
                            )}
                          </div>
                          {!r.placeholder && (
                            <div style={{ display: "flex", gap: 4, height: 18 }}>
                              <div title={`人月: ${r.peopleMonth.toFixed(2)}`} style={{
                                flex: 1, background: COLORS.bg, borderRadius: 4, overflow: "hidden",
                              }}>
                                <div style={{
                                  width: `${Math.min(100, r.peopleMonth * 50)}%`, height: "100%",
                                  background: COLORS.accent, transition: "width 0.4s ease",
                                }} />
                              </div>
                              <div title={`commits: ${r.commits}`} style={{
                                flex: 1, background: COLORS.bg, borderRadius: 4, overflow: "hidden",
                              }}>
                                <div style={{
                                  width: `${Math.min(100, (r.commits / 50) * 100)}%`, height: "100%",
                                  background: COLORS.teal, transition: "width 0.4s ease",
                                }} />
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ));
              })()}
              {allROI.length === 0 && (
                <span style={{ fontSize: 12, color: COLORS.textDim }}>無資料</span>
              )}
            </div>
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${COLORS.border}`, display: "flex", gap: 12, fontSize: 10, color: COLORS.textDim }}>
              <span><span style={{ display: "inline-block", width: 8, height: 8, background: COLORS.accent, borderRadius: 2, marginRight: 4 }} />人月投入</span>
              <span><span style={{ display: "inline-block", width: 8, height: 8, background: COLORS.teal, borderRadius: 2, marginRight: 4 }} />commits 產出</span>
            </div>
          </CardPanel>
        </div>

        {/* Card 2: Spec/Feature Ownership */}
        <div data-testid="cxo-card-spec">
          <CardPanel title="📜 Spec / Feature 負責" padding="16px">
            {specRows.length === 0 ? (
              <div style={{ fontSize: 12, color: COLORS.textDim, padding: "8px 0" }}>本週無 spec 活動</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {specRows.map((s, i) => {
                  const sb = STATUS_BADGE[s.status];
                  const isOpen = expandedSpec === i;
                  return (
                    <div key={i} style={{
                      background: COLORS.bg, borderRadius: 6, padding: "8px 10px",
                      border: `1px solid ${COLORS.border}`, cursor: "pointer",
                    }} onClick={() => setExpandedSpec(isOpen ? null : i)}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
                          <span style={{ fontSize: 10, color: COLORS.textDim, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{s.date}</span>
                          <span style={{ fontSize: 11, color: COLORS.accentLight, fontWeight: 700, flexShrink: 0 }}>{s.member}</span>
                          <span style={{ fontSize: 10, color: COLORS.textMuted, flexShrink: 0 }}>{s.center}</span>
                          <span style={{ fontSize: 11, color: COLORS.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
                            {s.title}
                          </span>
                        </div>
                        <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, background: sb.bg, color: sb.color, flexShrink: 0 }}>
                          {sb.label}
                        </span>
                      </div>
                      {isOpen && (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${COLORS.border}`, fontSize: 11, color: COLORS.textMuted }}>
                          {s.reasoning && <div style={{ marginBottom: 6 }}>{s.reasoning}</div>}
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            {s.files.map(f => (
                              <span key={f} style={{ fontSize: 10, color: COLORS.textDim, fontFamily: "'JetBrains Mono', monospace" }}>📄 {f}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardPanel>
        </div>

        {/* Card 3: Weekly Health */}
        <div data-testid="cxo-card-health">
          <CardPanel title="❤️ 本週健康度" padding="16px">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <KpiTile
                label="回報率"
                value={`${health.reportingRate}%`}
                color={health.reportingRate >= 90 ? COLORS.green : health.reportingRate >= 70 ? COLORS.yellow : COLORS.red}
              />
              <KpiTile
                label="一致性"
                value={`${health.consistency.ok}✅`}
                sub={`⚠️${health.consistency.warn} 🔴${health.consistency.crit}`}
                color={COLORS.teal}
              />
              <KpiTile
                label="任務警示"
                value={`${health.warnings.crit + health.warnings.warn}`}
                sub={`🔴${health.warnings.crit} 🟡${health.warnings.warn}`}
                color={health.warnings.crit > 0 ? COLORS.red : health.warnings.warn > 0 ? COLORS.yellow : COLORS.green}
              />
            </div>
          </CardPanel>
        </div>

        {/* Card 4: Top 5 risks */}
        <div data-testid="cxo-card-risks">
          <CardPanel title="🚨 本週 Top-5 風險" padding="16px">
            {risks.length === 0 ? (
              <div style={{ fontSize: 12, color: COLORS.green, padding: "8px 0" }}>無重大風險</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {risks.map((r, i) => {
                  const sev = SEVERITY_COLORS[r.severity];
                  return (
                    <div key={i} style={{
                      display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 10px",
                      background: (sev?.bg || COLORS.border) + "33", borderRadius: 6,
                      border: `1px solid ${sev?.sc || COLORS.border}33`,
                    }}>
                      <span style={{ fontSize: 14, flexShrink: 0 }}>{r.severity}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: sev?.sc || COLORS.text, fontWeight: 700 }}>
                          {r.member} <span style={{ color: COLORS.textMuted, fontWeight: 500 }}>· {r.text}</span>
                        </div>
                        <div style={{ fontSize: 10, color: COLORS.textDim, marginTop: 2 }}>
                          → {r.hint}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardPanel>
        </div>

        {/* Card 5: Capacity heatmap (full width) */}
        <div data-testid="cxo-card-capacity" style={{ gridColumn: "1 / -1" }}>
          <CardPanel title="🌡️ 4 週人力 Heat Map" padding="16px">
            {heatmap.centers.length === 0 || heatmap.centers.every(c => c.members.length === 0) ? (
              <div style={{ fontSize: 12, color: COLORS.textDim, padding: "8px 0" }}>無成員資料</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Week header */}
                <div style={{ display: "grid", gridTemplateColumns: "100px repeat(4, 1fr)", gap: 4, alignItems: "center" }}>
                  <div style={{ fontSize: 10, color: COLORS.textDim }}>成員 / 週</div>
                  {heatmap.weekLabels.map((wk, idx) => (
                    <div key={idx} style={{ fontSize: 10, color: COLORS.textDim, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{wk}</div>
                  ))}
                </div>
                {heatmap.centers.map(c => (
                  c.members.length > 0 && (
                    <div key={c.center}>
                      <div style={{ fontSize: 11, color: COLORS.textMuted, fontWeight: 700, marginBottom: 6 }}>{c.label}</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        {c.members.map(m => (
                          <div key={m.name} style={{ display: "grid", gridTemplateColumns: "100px repeat(4, 1fr)", gap: 4, alignItems: "center" }}>
                            <span style={{ fontSize: 11, color: COLORS.text, fontWeight: 600 }}>{m.name}</span>
                            {m.weeks.map((h, i) => (
                              <div key={i} title={`${h.toFixed(1)} hr`} style={{
                                background: heatColor(h), borderRadius: 3, padding: "6px 0",
                                textAlign: "center", fontSize: 10, fontWeight: 700,
                                color: h === 0 ? COLORS.textDim : "#0f172a",
                                fontVariantNumeric: "tabular-nums",
                                cursor: "default",
                              }}>
                                {h > 0 ? h.toFixed(0) : "—"}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                ))}
                <div style={{ display: "flex", gap: 10, fontSize: 10, color: COLORS.textDim, paddingTop: 6, borderTop: `1px solid ${COLORS.border}` }}>
                  <Legend color={COLORS.red} label="<20 / >55" />
                  <Legend color={COLORS.yellow} label="20-35 / 45-55" />
                  <Legend color={COLORS.green} label="35-45" />
                </div>
              </div>
            )}
          </CardPanel>
        </div>
      </div>
    </div>
  );
}

function KpiTile({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{
      background: COLORS.bg, borderRadius: 6, padding: "10px 12px",
      border: `1px solid ${COLORS.border}`, textAlign: "center",
    }}>
      <div style={{ fontSize: 10, color: COLORS.textDim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: COLORS.textMuted, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span style={{ display: "inline-block", width: 10, height: 10, background: color, borderRadius: 2 }} />
      {label}
    </span>
  );
}
