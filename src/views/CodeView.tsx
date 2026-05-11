import { useMemo } from "react";
import { COLORS } from "../constants";
import { aggregateByCode } from "../utils/codeAggregation";
import type { MemberHours, ValidCode, CommitData } from "../types";

interface Props {
  rawData: Record<string, Record<string, MemberHours>>;
  validCodes: Record<string, ValidCode> | undefined;
  members: string[];
  dates: string[];
  commitData: CommitData | null;
}

const CATEGORY_COLOR: Record<string, string> = {
  product: COLORS.accent,
  platform: COLORS.teal,
  special: COLORS.purple,
  research: COLORS.green,
};

export function CodeView({ rawData, validCodes, members, dates, commitData }: Props) {
  const aggregations = useMemo(
    () => aggregateByCode(rawData, validCodes, { members, dates }),
    [rawData, validCodes, members, dates]
  );

  const commitsByCode = useMemo(() => {
    if (!commitData) return new Map<string, number>();
    const map = new Map<string, number>();
    for (const agg of aggregations) {
      if (!agg.gitlabProjectPrefixes?.length) continue;
      let count = 0;
      for (const day of Object.values(commitData.commits)) {
        for (const memberCommits of Object.values(day)) {
          for (const c of memberCommits.items) {
            if (agg.gitlabProjectPrefixes.some((p) => c.project.startsWith(p))) count++;
          }
        }
      }
      map.set(agg.code, count);
    }
    return map;
  }, [commitData, aggregations]);

  if (aggregations.length === 0) {
    return (
      <div style={{ padding: 24, color: COLORS.textMuted, fontSize: 13, textAlign: "center" }}>
        尚無 [CODE] 標記的工項資料。在每日工項前加 <code>[KEYPO]</code> 之類的標籤即可分類。
      </div>
    );
  }

  return (
    <div className="code-view" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {aggregations.map((agg) => {
        const isUncat = agg.code === "(uncategorized)";
        const sevColor = isUncat
          ? COLORS.orange
          : (agg.category && CATEGORY_COLOR[agg.category]) || COLORS.accent;
        const commitCount = commitsByCode.get(agg.code) ?? null;
        return (
          <div
            key={agg.code}
            style={{
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              borderLeft: `3px solid ${sevColor}`,
              borderRadius: 10,
              padding: "12px 16px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <div>
                <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>
                  {isUncat ? "📝" : "💼"} {agg.label}
                </span>
                {!isUncat && agg.label !== agg.code && (
                  <span style={{ fontSize: 11, color: COLORS.textDim, marginLeft: 8, fontFamily: "monospace" }}>{agg.code}</span>
                )}
                {agg.category && (
                  <span style={{
                    fontSize: 10, marginLeft: 8, padding: "1px 6px", borderRadius: 4,
                    background: sevColor + "22", color: sevColor, fontWeight: 600,
                  }}>{agg.category}</span>
                )}
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 12, color: COLORS.textMuted }}>
                <span><b style={{ color: COLORS.text, fontVariantNumeric: "tabular-nums" }}>{agg.totalHours}</b>h</span>
                <span><b style={{ color: COLORS.text }}>{agg.memberCount}</b> 人</span>
                {commitCount !== null && <span style={{ color: COLORS.teal }}><b>{commitCount}</b> commits</span>}
              </div>
            </div>
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {agg.members.slice(0, 10).map((m) => (
                <span
                  key={m}
                  style={{
                    fontSize: 10, padding: "2px 8px", borderRadius: 4,
                    background: COLORS.bg, color: COLORS.textMuted,
                    border: `1px solid ${COLORS.border}`,
                  }}
                >
                  {m} · {Math.round(agg.memberHours[m] * 10) / 10}h
                </span>
              ))}
              {agg.members.length > 10 && (
                <span style={{ fontSize: 10, color: COLORS.textDim }}>
                  +{agg.members.length - 10} more
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
