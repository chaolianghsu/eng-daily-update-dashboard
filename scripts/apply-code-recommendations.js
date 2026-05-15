#!/usr/bin/env node
'use strict';

/**
 * apply-code-recommendations.js
 *
 * Takes a recommend-codes.js JSON output + raw_data.json, applies the
 * recommended [CODE] tags to items where `code === null`.
 *
 * Defensive — never overwrites an existing non-null code.
 *
 * CLI:
 *   node scripts/apply-code-recommendations.js \
 *     --recommendations <path> \
 *     --rawdata <path> \
 *     [--filter-confidence high|medium|low|all]   (default: all)
 *     [--filter-source rule|meeting|commit|all]   (default: all)
 *     [--dry-run]                                  (default: write)
 *
 *   - Without --dry-run: writes the updated rawdata path in place.
 *   - With --dry-run: prints the resulting raw_data to stdout, no file mutation.
 *   - Summary stats always written to stderr.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function filterRecommendations(recs, { confidence = 'all', source = 'all' } = {}) {
  return recs.filter(r => {
    if (r.recommendedCode == null) return false; // drop "none" recs
    if (confidence !== 'all' && r.confidence !== confidence) return false;
    if (source !== 'all' && r.source !== source) return false;
    return true;
  });
}

/**
 * Apply recommendations to rawData. Mutates `data` unless dryRun is true.
 *
 * Returns:
 *   {
 *     applied: number,
 *     skippedExisting: number,    // item already had a non-null code
 *     skippedMissing: number,     // date/member/itemIndex not found
 *     appliedDetails: Array<{date,member,itemIndex,code,source,confidence}>,
 *     warnings: string[],
 *     previewData?: object        // present iff dryRun
 *   }
 */
function applyRecommendations(data, recs, { dryRun = false, validCodesLookup = null } = {}) {
  const target = dryRun ? JSON.parse(JSON.stringify(data)) : data;
  const rawData = target?.rawData || {};

  const out = {
    applied: 0,
    skippedExisting: 0,
    skippedMissing: 0,
    appliedDetails: [],
    warnings: [],
  };

  for (const rec of recs) {
    if (rec == null || rec.recommendedCode == null) continue;
    const { date, member, itemIndex, recommendedCode, source, confidence } = rec;

    const day = rawData[date];
    if (!day) {
      out.skippedMissing++;
      out.warnings.push(`missing date: ${date} (${member} #${itemIndex})`);
      continue;
    }
    const memberEntry = day[member];
    if (!memberEntry) {
      out.skippedMissing++;
      out.warnings.push(`missing member: ${date} ${member}`);
      continue;
    }
    const items = memberEntry.items;
    if (!Array.isArray(items) || items.length === 0) {
      out.skippedMissing++;
      out.warnings.push(`no items: ${date} ${member}`);
      continue;
    }
    if (itemIndex < 0 || itemIndex >= items.length) {
      out.skippedMissing++;
      out.warnings.push(`itemIndex out of bounds: ${date} ${member} #${itemIndex} (len=${items.length})`);
      continue;
    }

    const item = items[itemIndex];
    if (item.code != null) {
      // Defensive — never overwrite an existing code.
      out.skippedExisting++;
      continue;
    }

    // Optional validation against validCodes.
    if (validCodesLookup) {
      const valid = validCodesLookup(rec);
      if (valid && !valid[recommendedCode]) {
        out.warnings.push(`code "${recommendedCode}" not in validCodes for ${date} ${member} — applying anyway`);
      }
    }

    item.code = recommendedCode;
    out.applied++;
    out.appliedDetails.push({
      date, member, itemIndex,
      code: recommendedCode,
      source: source || 'unknown',
      confidence: confidence || 'unknown',
    });
  }

  if (dryRun) out.previewData = target;
  return out;
}

/**
 * Build aggregate stats from appliedDetails.
 */
function buildApplySummary(appliedDetails) {
  const summary = {
    totalApplied: appliedDetails.length,
    byCode: {},
    bySource: {},
    byConfidence: {},
  };
  for (const d of appliedDetails) {
    summary.byCode[d.code] = (summary.byCode[d.code] || 0) + 1;
    summary.bySource[d.source] = (summary.bySource[d.source] || 0) + 1;
    summary.byConfidence[d.confidence] = (summary.byConfidence[d.confidence] || 0) + 1;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    recommendations: null,
    rawdata: 'public/raw_data.json',
    filterConfidence: 'all',
    filterSource: 'all',
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--recommendations':     args.recommendations = next(); break;
      case '--rawdata':             args.rawdata = next(); break;
      case '--filter-confidence':   args.filterConfidence = next(); break;
      case '--filter-source':       args.filterSource = next(); break;
      case '--dry-run':             args.dryRun = true; break;
      default:
        if (a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
    }
  }
  if (!args.recommendations) throw new Error('--recommendations <path> required');
  return args;
}

function formatStderrSummary({ filtered, total, result, summary, dryRun }) {
  const lines = [];
  lines.push('apply-code-recommendations:');
  lines.push(`  input recs:        ${total}`);
  lines.push(`  after filter:      ${filtered}`);
  lines.push(`  applied:           ${result.applied}`);
  lines.push(`  skipped (existing):${result.skippedExisting}`);
  lines.push(`  skipped (missing): ${result.skippedMissing}`);
  if (result.warnings.length) {
    lines.push(`  warnings (${result.warnings.length}):`);
    for (const w of result.warnings.slice(0, 10)) lines.push(`    - ${w}`);
    if (result.warnings.length > 10) lines.push(`    ... (+${result.warnings.length - 10} more)`);
  }
  if (summary.totalApplied > 0) {
    lines.push('  by code:');
    for (const [code, n] of Object.entries(summary.byCode).sort((a, b) => b[1] - a[1])) {
      lines.push(`    ${code}: ${n}`);
    }
    lines.push('  by source:');
    for (const [src, n] of Object.entries(summary.bySource).sort((a, b) => b[1] - a[1])) {
      lines.push(`    ${src}: ${n}`);
    }
  }
  lines.push(`  mode:              ${dryRun ? 'dry-run (no file written)' : 'write'}`);
  return lines.join('\n') + '\n';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const recsPath = path.resolve(process.cwd(), args.recommendations);
  const rawPath = path.resolve(process.cwd(), args.rawdata);

  const recsFile = JSON.parse(fs.readFileSync(recsPath, 'utf8'));
  const allRecs = Array.isArray(recsFile) ? recsFile : (recsFile.recommendations || []);
  const data = JSON.parse(fs.readFileSync(rawPath, 'utf8'));

  const filtered = filterRecommendations(allRecs, {
    confidence: args.filterConfidence,
    source: args.filterSource,
  });

  const result = applyRecommendations(data, filtered, { dryRun: args.dryRun });
  const summary = buildApplySummary(result.appliedDetails);

  process.stderr.write(formatStderrSummary({
    total: allRecs.length,
    filtered: filtered.length,
    result,
    summary,
    dryRun: args.dryRun,
  }));

  if (args.dryRun) {
    // Print resulting raw_data to stdout
    process.stdout.write(JSON.stringify(result.previewData, null, 2) + '\n');
  } else {
    // Write in place (raw_data is already mutated)
    fs.writeFileSync(rawPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  }
}

if (require.main === module) {
  try { main(); }
  catch (err) {
    process.stderr.write(`apply-code-recommendations: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  applyRecommendations,
  filterRecommendations,
  buildApplySummary,
};
