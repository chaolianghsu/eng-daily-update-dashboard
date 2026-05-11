import { useMemo } from "react";
import type { Center } from "../types";

export type CenterSelection = string | "all";

export function useCenterFilter(
  members: string[],
  centers: Record<string, Center> | undefined,
  selected: CenterSelection
): string[] {
  return useMemo(() => {
    if (!centers || selected === "all") return members;
    const centerMembers = centers[selected]?.members ?? [];
    const allow = new Set(centerMembers);
    return members.filter((m) => allow.has(m));
  }, [members, centers, selected]);
}
