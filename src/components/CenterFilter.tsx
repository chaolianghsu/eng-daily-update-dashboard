import { COLORS } from "../constants";
import type { Center, ParentCenter } from "../types";

interface Props {
  centers: Record<string, Center> | undefined;
  parentCenters?: Record<string, ParentCenter>;
  selected: string;
  onChange: (key: string) => void;
}

const chipStyle = (active: boolean): React.CSSProperties => ({
  padding: "6px 12px",
  fontSize: 12,
  fontFamily: "'JetBrains Mono','SF Mono','Noto Sans TC',monospace",
  background: active ? COLORS.accent : COLORS.card,
  color: active ? "#fff" : COLORS.text,
  border: `1px solid ${active ? COLORS.accent : COLORS.border}`,
  borderRadius: 6,
  cursor: "pointer",
  transition: "background 0.15s, color 0.15s",
});

export function CenterFilter({ centers, parentCenters, selected, onChange }: Props) {
  if (!centers || Object.keys(centers).length === 0) return null;
  const centerKeys = Object.keys(centers);

  // Backward compat: no parentCenters → flat row of chips in centers order.
  if (!parentCenters || Object.keys(parentCenters).length === 0) {
    return (
      <div
        className="center-filter"
        style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}
      >
        <button
          key="all"
          onClick={() => onChange("all")}
          style={chipStyle(selected === "all")}
        >
          全部
        </button>
        {centerKeys.map(key => (
          <button
            key={key}
            onClick={() => onChange(key)}
            style={chipStyle(selected === key)}
          >
            {centers[key]?.label || key}
          </button>
        ))}
      </div>
    );
  }

  // Group by parent center.
  const parentKeys = Object.keys(parentCenters);
  const showGroupLabels = parentKeys.length > 1;

  // Build ordered chip groups from parentCenters.children (skip unknown depts).
  const groups = parentKeys.map(pk => {
    const cfg = parentCenters[pk];
    const orderedChildren = (cfg.children || []).filter(c => centers[c]);
    return { parentKey: pk, parentLabel: cfg.label || pk, children: orderedChildren };
  });

  // Capture any dept that exists in centers but is not in any parentCenters.children.
  const claimed = new Set(groups.flatMap(g => g.children));
  const orphans = centerKeys.filter(k => !claimed.has(k));
  if (orphans.length > 0) {
    groups.push({ parentKey: "__orphan", parentLabel: "其他", children: orphans });
  }

  return (
    <div
      className="center-filter"
      style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}
    >
      <button
        key="all"
        onClick={() => onChange("all")}
        style={chipStyle(selected === "all")}
      >
        全部
      </button>
      {groups.map((g, idx) => (
        <div
          key={g.parentKey}
          style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
        >
          {idx === 0 && showGroupLabels && (
            <span style={{ color: COLORS.textDim, fontSize: 12, marginRight: 2 }}>｜</span>
          )}
          {showGroupLabels && (
            <span
              data-group-label={g.parentKey}
              style={{
                fontSize: 11,
                color: COLORS.textDim,
                fontWeight: 600,
                marginRight: 2,
              }}
            >
              {g.parentLabel}：
            </span>
          )}
          {g.children.map(key => (
            <button
              key={key}
              onClick={() => onChange(key)}
              style={chipStyle(selected === key)}
            >
              {centers[key]?.label || key}
            </button>
          ))}
          {showGroupLabels && idx < groups.length - 1 && (
            <span style={{ color: COLORS.textDim, fontSize: 12, marginLeft: 2 }}>｜</span>
          )}
        </div>
      ))}
    </div>
  );
}
