// src/components/DateNavigator.tsx
import { useState, useRef, useEffect } from "react";
import { COLORS } from "../constants";

interface Week {
  dates: string[];
  label: string;
}

interface DateNavigatorProps {
  dates: string[];
  activeDate: string;
  onDateSelect: (d: string) => void;
  dayLabels: Record<string, string>;
  weeks: Week[];
  weekIndex: number;
  canGoPrev: boolean;
  canGoNext: boolean;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onSelectWeek: (i: number) => void;
}

export function DateNavigator({
  dates, activeDate, onDateSelect, dayLabels,
  weeks, weekIndex, canGoPrev, canGoNext,
  onPrevWeek, onNextWeek, onSelectWeek,
}: DateNavigatorProps) {
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

  // Compute ISO week number for display
  const getWeekNumber = (dateStr: string): number => {
    const [m, d] = dateStr.split("/").map(Number);
    const date = new Date(new Date().getFullYear(), m - 1, d);
    const jan1 = new Date(date.getFullYear(), 0, 1);
    const days = Math.floor((date.getTime() - jan1.getTime()) / 86400000);
    return Math.ceil((days + jan1.getDay() + 1) / 7);
  };

  const weekNum = dates.length > 0 ? getWeekNumber(dates[0]) : 0;

  // Determine this-week and last-week indices for shortcuts
  const thisWeekIndex = weeks.length > 0 ? weeks.length - 1 : -1;
  const lastWeekIndex = weeks.length > 1 ? weeks.length - 2 : -1;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6, marginBottom: 16,
      background: COLORS.card, borderRadius: 10, padding: "6px 10px",
    }}>
      <button
        onClick={onPrevWeek}
        disabled={!canGoPrev}
        style={{
          background: "none", border: "none", color: canGoPrev ? "#475569" : COLORS.border,
          fontSize: 13, cursor: canGoPrev ? "pointer" : "default", padding: "4px 2px",
          fontFamily: "inherit", transition: "color 0.15s",
        }}
      >◀</button>

      <div style={{ display: "flex", gap: 3, flex: 1 }}>
        {dates.map(d => {
          const isActive = d === activeDate;
          const dayNum = d.split("/")[1];
          return (
            <button
              key={d}
              onClick={() => onDateSelect(d)}
              style={{
                flex: 1, textAlign: "center", padding: "6px 0", borderRadius: 6,
                fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.15s",
                background: isActive ? "#06b6d4" : "transparent",
                color: isActive ? "#0f172a" : COLORS.textMuted,
                border: "none", fontFamily: "inherit",
              }}
            >
              {dayNum}
              <span style={{
                display: "block", fontSize: 9, fontWeight: 400, marginTop: 1,
                opacity: isActive ? 0.7 : 0.5,
              }}>
                {dayLabels[d] || ""}
              </span>
            </button>
          );
        })}
      </div>

      <button
        onClick={onNextWeek}
        disabled={!canGoNext}
        style={{
          background: "none", border: "none", color: canGoNext ? "#475569" : COLORS.border,
          fontSize: 13, cursor: canGoNext ? "pointer" : "default", padding: "4px 2px",
          fontFamily: "inherit", transition: "color 0.15s",
        }}
      >▶</button>

      <div style={{ width: 1, height: 22, background: COLORS.border, margin: "0 2px" }} />

      <div ref={dropdownRef} style={{ position: "relative" }}>
        <button
          onClick={() => setDropdownOpen(o => !o)}
          style={{
            background: "none", border: "none", color: COLORS.textDim, fontSize: 11,
            fontWeight: 500, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
            padding: "4px 6px", borderRadius: 4, transition: "all 0.15s",
          }}
        >
          W{weekNum} ▾
        </button>

        {dropdownOpen && (
          <div style={{
            position: "absolute", top: "100%", right: 0, marginTop: 4, zIndex: 50,
            background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10,
            padding: 4, minWidth: 180, maxHeight: 280, overflowY: "auto",
            boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
          }}>
            {/* Shortcuts */}
            <div style={{ display: "flex", gap: 4, padding: "4px 8px 8px", borderBottom: `1px solid ${COLORS.border}` }}>
              <button
                onClick={() => { if (thisWeekIndex >= 0) { onSelectWeek(thisWeekIndex); setDropdownOpen(false); } }}
                style={{
                  flex: 1, padding: "4px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                  fontFamily: "inherit", border: `1px solid ${COLORS.accent}44`,
                  background: weekIndex === thisWeekIndex ? "rgba(59,130,246,0.15)" : "transparent",
                  color: weekIndex === thisWeekIndex ? COLORS.accentLight : COLORS.textDim,
                  cursor: "pointer",
                }}
              >本週</button>
              <button
                onClick={() => { if (lastWeekIndex >= 0) { onSelectWeek(lastWeekIndex); setDropdownOpen(false); } }}
                disabled={lastWeekIndex < 0}
                style={{
                  flex: 1, padding: "4px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                  fontFamily: "inherit", border: `1px solid ${COLORS.border}`,
                  background: weekIndex === lastWeekIndex ? "rgba(59,130,246,0.15)" : "transparent",
                  color: lastWeekIndex < 0 ? COLORS.border : (weekIndex === lastWeekIndex ? COLORS.accentLight : COLORS.textDim),
                  cursor: lastWeekIndex < 0 ? "default" : "pointer",
                  opacity: lastWeekIndex < 0 ? 0.4 : 1,
                }}
              >上週</button>
            </div>
            {/* Week list */}
            {weeks.map((w, i) => (
              <button
                key={i}
                onClick={() => { onSelectWeek(i); setDropdownOpen(false); }}
                style={{
                  display: "block", width: "100%", textAlign: "left", padding: "8px 12px",
                  background: i === weekIndex ? "rgba(59,130,246,0.1)" : "transparent",
                  border: "none", borderRadius: 6, cursor: "pointer",
                  borderLeft: i === weekIndex ? `3px solid ${COLORS.accent}` : "3px solid transparent",
                  color: i === weekIndex ? COLORS.accentLight : COLORS.textMuted,
                  fontSize: 12, fontWeight: i === weekIndex ? 700 : 500, fontFamily: "inherit",
                  transition: "background 0.1s",
                }}
              >{w.label}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
