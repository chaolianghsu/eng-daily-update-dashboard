#!/usr/bin/env node
/**
 * Migration script: layer-on `parentCenters` aggregation block + `parent` field
 * on each existing department entry in `centers`.
 *
 * Default mapping (today's known depts → parent center):
 *   工程   → 產品中心
 *   技發   → 產品中心
 *   產品   → 產品中心
 *   分析調查一 → 數據平台中心 (deferred — not auto-created)
 *
 * Idempotent: re-running on already-migrated data is a no-op.
 *
 * Usage (one-shot):
 *   node scripts/migrate-to-parent-centers.js                 # migrates public/raw_data.json in place
 *   node scripts/migrate-to-parent-centers.js path/to.json    # migrates specific file
 *
 * Exports `migrateToParentCenters(obj)` for testing.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Known department → parent center mapping. Add entries here as new depts onboard.
const DEPT_PARENT = {
  工程: "產品中心",
  技發: "產品中心",
  產品: "產品中心",
  分析調查一: "數據平台中心",
};

const PARENT_LABELS = {
  產品中心: "產品中心",
  數據平台中心: "數據平台中心",
};

export function migrateToParentCenters(data) {
  if (!data || typeof data !== "object") return data;
  if (!data.centers || typeof data.centers !== "object") return data;

  // Deep-clone the affected pieces (shallow clone everything else to avoid mutation).
  const out = { ...data };
  out.centers = {};
  for (const [key, cfg] of Object.entries(data.centers)) {
    out.centers[key] = { ...cfg };
  }
  out.parentCenters = data.parentCenters ? { ...data.parentCenters } : {};

  // Step 1: ensure every dept has a parent field.
  for (const [deptKey, cfg] of Object.entries(out.centers)) {
    if (cfg.parent) continue; // preserve explicit setting
    const inferred = DEPT_PARENT[deptKey] || "產品中心"; // default fallback
    cfg.parent = inferred;
  }

  // Step 2: build a children index from the parent field on each dept.
  const childrenByParent = {};
  for (const [deptKey, cfg] of Object.entries(out.centers)) {
    const parent = cfg.parent;
    if (!parent) continue;
    if (!childrenByParent[parent]) childrenByParent[parent] = [];
    childrenByParent[parent].push(deptKey);
  }

  // Step 3: merge into parentCenters block (preserve order, dedup).
  for (const [parentKey, children] of Object.entries(childrenByParent)) {
    const existing = out.parentCenters[parentKey];
    if (existing && Array.isArray(existing.children)) {
      const merged = [...existing.children];
      for (const c of children) {
        if (!merged.includes(c)) merged.push(c);
      }
      out.parentCenters[parentKey] = {
        ...existing,
        label: existing.label || PARENT_LABELS[parentKey] || parentKey,
        children: merged,
      };
    } else {
      out.parentCenters[parentKey] = {
        label: PARENT_LABELS[parentKey] || parentKey,
        children,
      };
    }
  }

  return out;
}

// CLI entry — only run when invoked directly.
const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isMain) {
  const inputPath = process.argv[2]
    ? resolve(process.argv[2])
    : resolve(dirname(__filename), "..", "public", "raw_data.json");
  const before = JSON.parse(readFileSync(inputPath, "utf-8"));
  const after = migrateToParentCenters(before);
  writeFileSync(inputPath, JSON.stringify(after, null, 2) + "\n", "utf-8");
  const summary = {
    file: inputPath,
    centers: Object.fromEntries(
      Object.entries(after.centers || {}).map(([k, v]) => [k, { parent: v.parent }])
    ),
    parentCenters: Object.fromEntries(
      Object.entries(after.parentCenters || {}).map(([k, v]) => [k, { children: v.children }])
    ),
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
}
