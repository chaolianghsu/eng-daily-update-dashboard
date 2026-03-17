#!/usr/bin/env node
'use strict';
const { collectCommits } = require('./fetch-gitlab-commits');

async function main() {
  const args = process.argv.slice(2);
  let dateArg = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) { dateArg = args[i + 1]; i++; }
  }
  const { allCommits } = await collectCommits(dateArg);
  console.log(JSON.stringify(allCommits, null, 2));
  console.error(`\nDone: ${allCommits.length} commits collected`);
}

if (require.main === module) {
  main().catch(e => { console.error(`Error: ${e.message}`); process.exit(1); });
}
