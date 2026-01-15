#!/usr/bin/env node

import { execSync } from 'child_process';
import { createInterface } from 'readline';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

const projects = [
  {
    name: 'xp',
    description: 'XPartners Assistant',
    command: 'dev:xp',
  },
  {
    name: 'bkk',
    description: 'BKK Linde Assistant',
    command: 'dev:bkk',
  },
];

console.log('\n📦 Available Projects:\n');
projects.forEach((p, i) => {
  console.log(`  ${i + 1}. ${p.name.toUpperCase().padEnd(5)} - ${p.description}`);
});
console.log('');

rl.question('Select project (1-2) or type name (xp/bkk): ', (answer) => {
  const input = answer.toLowerCase().trim();
  let selected = null;

  // Try to match by number
  const num = parseInt(input);
  if (!isNaN(num) && num >= 1 && num <= projects.length) {
    selected = projects[num - 1];
  } else {
    // Try to match by name
    selected = projects.find((p) => p.name === input);
  }

  if (!selected) {
    console.error(
      '\n❌ Invalid selection. Choose: 1-2 or type xp/bkk\n'
    );
    rl.close();
    process.exit(1);
  }

  console.log(
    `\n🚀 Starting ${selected.description} development server...\n`
  );

  try {
    execSync(`npm run ${selected.command}`, { stdio: 'inherit' });
  } catch (err) {
    console.error('\n❌ Error starting dev server:', err.message);
    rl.close();
    process.exit(1);
  }

  rl.close();
});
