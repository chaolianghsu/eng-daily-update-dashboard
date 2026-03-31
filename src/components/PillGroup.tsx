// src/components/PillGroup.tsx
import { COLORS } from "../constants";

export interface PillItem {
  key: string;
  label: string;
  badge?: number;
  badgeColor?: string;
}

interface PillGroupProps {
  items: PillItem[];
  activeKey: string;
  onSelect: (key: string) => void;
}

export function PillGroup({ items, activeKey, onSelect }: PillGroupProps) {
  return (
    <div style={{
      display: "flex", gap: 3, background: COLORS.card, borderRadius: 8,
      padding: 3, width: "fit-content",
    }}>
      {items.map(item => {
        const isActive = item.key === activeKey;
        return (
          <button
            key={item.key}
            onClick={() => onSelect(item.key)}
            style={{
              padding: "5px 14px", borderRadius: 6, fontSize: 12, fontWeight: 500,
              fontFamily: "inherit", border: "none", cursor: "pointer",
              transition: "all 0.15s",
              color: isActive ? COLORS.text : COLORS.textDim,
              background: isActive ? "var(--pill-active, #334155)" : "transparent",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            {item.label}
            {item.badge != null && item.badge > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10,
                minWidth: 18, textAlign: "center",
                background: (item.badgeColor || COLORS.teal) + "22",
                color: item.badgeColor || COLORS.teal,
              }}>
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
