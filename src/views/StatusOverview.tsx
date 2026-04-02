import { COLORS, SEVERITY_COLORS } from "../constants";
import { getStatus } from "../utils";
import type { Issue } from "../types";

interface StatusOverviewProps {
  allIssues: Issue[];
  issues: Issue[];
  members: string[];
  rawData: Record<string, Record<string, any>>;
  dates: string[];
  activeDate: string;
}

export function StatusOverview({ allIssues, issues, members, rawData, dates, activeDate }: StatusOverviewProps) {
  const attentionIssues = allIssues;
  const stableIssues = issues.filter(i => i.severity === "🟢");
  const displayDate = activeDate || dates[dates.length - 1];
  const reportedCount = members.filter(m => {
    return rawData?.[displayDate]?.[m]?.total != null;
  }).length;
  const latestData = rawData?.[displayDate] || {};
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
                  <div style={{ fontSize: 12, fontWeight: 700, color: sev?.sc || COLORS.text }}>
                    {iss.member} <span style={{ fontWeight: 500, color: COLORS.textMuted }}>{iss.text}</span>
                    {(iss as any).source === "trend" && (
                      <span style={{ fontSize: 9, padding: "1px 6px", background: "#f472b644", color: "#f472b6", borderRadius: 3, marginLeft: 6, fontWeight: 600 }}>趨勢</span>
                    )}
                  </div>
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
}
