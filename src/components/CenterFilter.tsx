import { COLORS } from "../constants";
import type { Center } from "../types";

interface Props {
  centers: Record<string, Center> | undefined;
  selected: string;
  onChange: (key: string) => void;
}

export function CenterFilter({ centers, selected, onChange }: Props) {
  if (!centers || Object.keys(centers).length === 0) return null;
  const keys = ["all", ...Object.keys(centers)];

  return (
    <div
      className="center-filter"
      style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}
    >
      {keys.map((key) => {
        const active = key === selected;
        const label = key === "all" ? "全部" : centers[key]?.label || key;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            style={{
              padding: "6px 12px",
              fontSize: 12,
              fontFamily: "'JetBrains Mono','SF Mono','Noto Sans TC',monospace",
              background: active ? COLORS.accent : COLORS.card,
              color: active ? "#fff" : COLORS.text,
              border: `1px solid ${active ? COLORS.accent : COLORS.border}`,
              borderRadius: 6,
              cursor: "pointer",
              transition: "background 0.15s, color 0.15s",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
