import { COLORS } from "../constants";
import type { Center, ParentCenter } from "../types";

interface Props {
  centers: Record<string, Center> | undefined;
  parentCenters?: Record<string, ParentCenter>;
  selected: string;
  onChange: (key: string) => void;
}

interface ChipStyleOpts {
  active: boolean;
  /** Lighter active state used for the parent chip when its dept child is selected. */
  parentActive?: boolean;
  /** Placeholder (no members onboarded yet) — dim the chip. */
  placeholder?: boolean;
}

const chipStyle = ({ active, parentActive, placeholder }: ChipStyleOpts): React.CSSProperties => {
  const bg = active
    ? COLORS.accent
    : parentActive
      ? `${COLORS.accent}99` // 60% opacity active hint for parent
      : COLORS.card;
  const fg = active || parentActive ? "#fff" : COLORS.text;
  const border = active || parentActive ? COLORS.accent : COLORS.border;
  return {
    padding: "6px 12px",
    fontSize: 12,
    fontFamily: "'JetBrains Mono','SF Mono','Noto Sans TC',monospace",
    background: bg,
    color: fg,
    border: `1px solid ${border}`,
    borderRadius: 6,
    cursor: "pointer",
    transition: "background 0.15s, color 0.15s, opacity 0.15s",
    opacity: placeholder ? 0.55 : 1,
  };
};

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
          style={chipStyle({ active: selected === "all" })}
        >
          全部
        </button>
        {centerKeys.map(key => (
          <button
            key={key}
            onClick={() => onChange(key)}
            style={chipStyle({ active: selected === key })}
          >
            {centers[key]?.label || key}
          </button>
        ))}
      </div>
    );
  }

  // Two-tier layout.
  const parentKeys = Object.keys(parentCenters);

  // Resolve the "active parent" — the parent whose chip should highlight
  // either as fully active (selected matches a parent key) or as parent-active
  // (selected matches one of its children).
  let activeParentKey: string | null = null;
  if (parentKeys.includes(selected)) {
    activeParentKey = selected;
  } else if (centers[selected]?.parent && parentKeys.includes(centers[selected].parent!)) {
    activeParentKey = centers[selected].parent!;
  }

  // Decide which depts to render in row 2.
  // - selected === "all" → all depts grouped by parent
  // - selected matches a parent key → only that parent's children
  // - selected matches a dept key → that dept's parent's children (siblings)
  let row2Children: string[] = [];
  if (selected === "all") {
    // Flatten in parentCenters.children order, then append unclaimed.
    const claimed = new Set<string>();
    for (const pk of parentKeys) {
      for (const c of parentCenters[pk].children || []) {
        if (centers[c] && !claimed.has(c)) {
          row2Children.push(c);
          claimed.add(c);
        }
      }
    }
    for (const k of centerKeys) {
      if (!claimed.has(k)) row2Children.push(k);
    }
  } else if (parentKeys.includes(selected)) {
    row2Children = (parentCenters[selected].children || []).filter(c => centers[c]);
  } else if (activeParentKey) {
    row2Children = (parentCenters[activeParentKey].children || []).filter(c => centers[c]);
  } else {
    // Unknown selection — show full list as fallback.
    row2Children = centerKeys;
  }

  return (
    <div
      className="center-filter"
      style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}
    >
      {/* Row 1: parent center chips */}
      <div
        data-row="parent"
        style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}
      >
        <button
          key="all"
          onClick={() => onChange("all")}
          style={chipStyle({ active: selected === "all" })}
        >
          全部
        </button>
        {parentKeys.map(pk => {
          const isActive = selected === pk;
          const isParentActive = !isActive && activeParentKey === pk;
          return (
            <button
              key={pk}
              data-parent-chip={pk}
              data-active={isActive ? "true" : "false"}
              data-parent-active={isParentActive ? "true" : "false"}
              onClick={() => onChange(pk)}
              style={chipStyle({ active: isActive, parentActive: isParentActive })}
            >
              {parentCenters[pk].label || pk}
            </button>
          );
        })}
      </div>

      {/* Row 2: dept chips */}
      {row2Children.length > 0 && (
        <div
          data-row="dept"
          style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", paddingLeft: 16 }}
        >
          {row2Children.map(key => {
            const cfg = centers[key];
            const isActive = selected === key;
            const placeholder = (cfg?.members?.length ?? 0) === 0;
            return (
              <button
                key={key}
                data-dept-chip={key}
                data-active={isActive ? "true" : "false"}
                title={placeholder ? "尚未啟用" : undefined}
                onClick={() => onChange(key)}
                style={chipStyle({ active: isActive, placeholder })}
              >
                {cfg?.label || key}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
