// src/PlanSpecView.tsx
import { COLORS } from "./constants";
import { CardPanel } from "./components";
import { buildFileBlobUrl } from "./utils";
import type { PlanAnalysisData, PlanCorrelation, PlanSpecItem } from "./types";

interface PlanSpecViewProps {
  planAnalysisData: PlanAnalysisData;
  members: string[];
  memberColors: Record<string, string>;
  dates: string[];
  activeDate: string;
}

const statusIcon = (status: PlanCorrelation["status"]): string => {
  switch (status) {
    case "matched": return "✅";
    case "unmatched": return "🔴";
    case "partial": return "⚠️";
    default: return "—";
  }
};

export default function PlanSpecView({ planAnalysisData, members, memberColors, dates, activeDate }: PlanSpecViewProps) {
  const { planSpecs, correlations, summary } = planAnalysisData;

  if (!planSpecs || planSpecs.length === 0) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: COLORS.textDim, fontSize: 14 }}>
        無規劃文件
      </div>
    );
  }

  const dateSpecs = planSpecs.filter(s => s.date === activeDate);
  const dateCorrelations = (correlations || []).filter(c => c.date === activeDate);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Summary Cards */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "14px 20px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 24, fontWeight: 800, color: COLORS.teal }}>{summary.totalSpecCommits}</span>
          <span style={{ fontSize: 12, color: COLORS.textMuted }}>規劃文件 Commits</span>
        </div>
        <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "14px 20px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 24, fontWeight: 800, color: COLORS.green }}>{summary.matched}</span>
          <span style={{ fontSize: 12, color: COLORS.textMuted }}>已匹配</span>
        </div>
        <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "14px 20px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 24, fontWeight: 800, color: COLORS.red }}>{summary.unmatched}</span>
          <span style={{ fontSize: 12, color: COLORS.textMuted }}>未匹配</span>
        </div>
      </div>

      {/* Correlation Table */}
      {dateCorrelations.length > 0 && (
        <CardPanel title={`規劃追蹤關聯（${activeDate}）`}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ padding: "6px 8px", textAlign: "left", color: COLORS.textMuted, fontWeight: 600, borderBottom: `1px solid ${COLORS.border}` }}>成員</th>
                <th style={{ padding: "6px 8px", textAlign: "center", color: COLORS.teal, fontWeight: 600, borderBottom: `1px solid ${COLORS.border}` }}>Spec Commits</th>
                <th style={{ padding: "6px 8px", textAlign: "center", color: COLORS.textMuted, fontWeight: 600, borderBottom: `1px solid ${COLORS.border}` }}>狀態</th>
                <th style={{ padding: "6px 8px", textAlign: "left", color: COLORS.textMuted, fontWeight: 600, borderBottom: `1px solid ${COLORS.border}` }}>匹配任務</th>
                <th style={{ padding: "6px 8px", textAlign: "left", color: COLORS.textMuted, fontWeight: 600, borderBottom: `1px solid ${COLORS.border}` }}>說明</th>
              </tr>
            </thead>
            <tbody>
              {dateCorrelations.map((c, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${COLORS.border}15` }}>
                  <td style={{ padding: "6px 8px", fontWeight: 600 }}>
                    <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: memberColors[c.member] || COLORS.textDim, marginRight: 6, verticalAlign: "middle" }} />
                    {c.member}
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "center", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: COLORS.teal }}>{c.specCommits}</td>
                  <td style={{ padding: "6px 8px", textAlign: "center", fontSize: 14 }}>{statusIcon(c.status)}</td>
                  <td style={{ padding: "6px 8px", color: COLORS.textMuted, fontSize: 11 }}>{c.matchedTasks.join(", ") || "—"}</td>
                  <td style={{ padding: "6px 8px", color: COLORS.textDim, fontSize: 11 }}>{c.reasoning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardPanel>
      )}

      {/* Spec Commit Details */}
      {dateSpecs.length > 0 && (
        <CardPanel title={`規劃文件明細（${activeDate}）`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {dateSpecs.map((spec, i) => (
              <div key={i} style={{
                background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 8,
                padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13 }}>{spec.commit.source === 'github' ? '🐙' : '🦊'}</span>
                  <span style={{ fontWeight: 700, color: COLORS.text, fontSize: 13 }}>{spec.member}</span>
                  <span style={{ color: COLORS.teal, fontSize: 11 }}>{spec.commit.project.split('/').pop()}</span>
                  <span style={{ marginLeft: "auto", fontFamily: "JetBrains Mono, SF Mono, monospace", fontSize: 11, color: COLORS.textDim }}>{spec.commit.sha}</span>
                </div>
                <div style={{ fontSize: 12, color: COLORS.text }}>{spec.commit.title}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {spec.files.map((f, j) => {
                    const fileName = f.split('/').pop() || f;
                    return (
                      <span key={j} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <a
                          href={buildFileBlobUrl(spec.commit, f)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={f}
                          style={{
                            fontSize: 10, padding: "2px 8px", borderRadius: 4,
                            background: COLORS.tealDim, color: COLORS.teal,
                            fontFamily: "JetBrains Mono, SF Mono, monospace",
                            textDecoration: "none",
                          }}
                        >
                          {fileName}
                        </a>
                        <a
                          href={spec.commit.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="查看 diff"
                          style={{
                            fontSize: 10, color: COLORS.teal, opacity: 0.6,
                            textDecoration: "none",
                          }}
                        >
                          ↔
                        </a>
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </CardPanel>
      )}
    </div>
  );
}
