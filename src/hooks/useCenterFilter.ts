import { useMemo } from "react";
import type { Center, ParentCenter } from "../types";

export type CenterSelection = string | "all";

/**
 * Resolve a center selection to a filtered member list.
 *
 * The `selected` key may be:
 *   - "all" → no filter, all members returned
 *   - a dept key in `centers` → that department's members
 *   - a parent center key in `parentCenters` (when provided) → union of
 *     members across all child departments of that parent
 *   - anything else → []
 *
 * Backward compat: omitting `parentCenters` preserves dept-level behavior.
 */
export function useCenterFilter(
  members: string[],
  centers: Record<string, Center> | undefined,
  selected: CenterSelection,
  parentCenters?: Record<string, ParentCenter>
): string[] {
  return useMemo(() => {
    if (!centers || selected === "all") return members;

    // Dept-level match wins (existing behavior).
    if (centers[selected]) {
      const allow = new Set(centers[selected]?.members ?? []);
      return members.filter((m) => allow.has(m));
    }

    // Parent-level match: union of child dept members.
    if (parentCenters && parentCenters[selected]) {
      const allow = new Set<string>();
      for (const childKey of parentCenters[selected].children || []) {
        for (const m of centers[childKey]?.members ?? []) {
          allow.add(m);
        }
      }
      return members.filter((m) => allow.has(m));
    }

    // Unknown key.
    return [];
  }, [members, centers, selected, parentCenters]);
}
