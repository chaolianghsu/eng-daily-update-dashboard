#!/usr/bin/env node
/**
 * One-shot expansion: ensures the org-chart departments + parent centers
 * exist in the data file, even when no daily-update reporter has been
 * onboarded yet. Adds placeholder departments and parent centers so the
 * filter UI reflects the org, not the data.
 *
 * Additions (idempotent — re-running is a no-op):
 *   centers.產品          = { label: "產品部",       members: [], parent: "產品中心",    validCodes: {} }
 *   centers.分析調查一    = { label: "分析調查部(一)", members: [], parent: "數據平台中心", validCodes: {} }
 *   parentCenters.數據平台中心 = { label: "數據平台中心", children: ["分析調查一"] }
 *   parentCenters.產品中心.children = ["工程", "技發", "產品"]   (union, preserves order)
 *
 * Existing entries are NEVER overwritten — only created when missing,
 * and only the children array of 產品中心 is augmented (never duplicated).
 *
 * Usage:
 *   node scripts/expand-org-structure.js                # public/raw_data.json in place
 *   node scripts/expand-org-structure.js path/to.json   # specific file
 *
 * Exports `expandOrgStructure(data)` for tests.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const PLACEHOLDER_DEPTS = {
  產品: {
    label: "產品部",
    parent: "產品中心",
  },
  分析調查一: {
    label: "分析調查部(一)",
    parent: "數據平台中心",
  },
};

const PLACEHOLDER_PARENTS = {
  數據平台中心: {
    label: "數據平台中心",
    children: ["分析調查一"],
  },
};

// Desired child ordering per parent center. Existing children are kept
// (without duplication); additions are appended in the order below if
// not already present.
const DESIRED_CHILDREN = {
  產品中心: ["工程", "技發", "產品"],
};

/**
 * Pure transform. Returns a new object — does not mutate the input.
 */
export function expandOrgStructure(data) {
  if (!data || typeof data !== "object") return data;

  const out = { ...data };
  out.centers = { ...(data.centers || {}) };
  out.parentCenters = { ...(data.parentCenters || {}) };

  // 1. Add placeholder departments (only if missing — never overwrite).
  for (const [key, cfg] of Object.entries(PLACEHOLDER_DEPTS)) {
    if (out.centers[key]) continue;
    out.centers[key] = {
      label: cfg.label,
      members: [],
      parent: cfg.parent,
      validCodes: {},
    };
  }

  // 2. Add placeholder parent centers (only if missing).
  for (const [key, cfg] of Object.entries(PLACEHOLDER_PARENTS)) {
    if (out.parentCenters[key]) continue;
    out.parentCenters[key] = {
      label: cfg.label,
      children: [...cfg.children],
    };
  }

  // 3. Update children list of known parents — union with desired set,
  //    preserving existing order and appending new entries.
  for (const [parentKey, desired] of Object.entries(DESIRED_CHILDREN)) {
    if (!out.parentCenters[parentKey]) continue;
    const existing = out.parentCenters[parentKey].children || [];
    const next = [...existing];
    for (const child of desired) {
      if (!next.includes(child)) next.push(child);
    }
    out.parentCenters[parentKey] = {
      ...out.parentCenters[parentKey],
      children: next,
    };
  }

  return out;
}

// CLI entrypoint
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  (process.argv[1] && process.argv[1].endsWith("expand-org-structure.js"));
if (isMain) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const target = process.argv[2]
    ? resolve(process.cwd(), process.argv[2])
    : resolve(__dirname, "..", "public", "raw_data.json");
  const raw = readFileSync(target, "utf8");
  const data = JSON.parse(raw);
  const expanded = expandOrgStructure(data);
  writeFileSync(target, JSON.stringify(expanded, null, 2) + "\n");
  console.log(`✓ expanded org structure → ${target}`);
}
