#!/usr/bin/env node
'use strict';

/**
 * detect-plan-specs.js
 * Detects plan/spec/design commits via keyword matching and file path filtering.
 */

const SPEC_KEYWORDS_EN = /\b(plan|spec|design|docs?|rfc|proposal|architecture)\b/i;
const SPEC_KEYWORDS_ZH = /規劃|設計|架構|文件/;
const FALSE_POSITIVES = /\b(docker|dockerfile|archive|archived)\b/i;

/**
 * Check if a commit title matches plan/spec keywords.
 * Returns true if it matches spec keywords AND does not match false positive exclusions.
 * @param {string} title - Commit title
 * @returns {boolean}
 */
function matchesSpecKeyword(title) {
  if (FALSE_POSITIVES.test(title)) return false;
  return SPEC_KEYWORDS_EN.test(title) || SPEC_KEYWORDS_ZH.test(title);
}

module.exports = {
  matchesSpecKeyword,
};
