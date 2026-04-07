#!/usr/bin/env node
/**
 * Patches ~/.claude/settings.json to enable channelsEnabled: true.
 * Required for claude --channels mode (Telegram plugin) to work.
 * Safe to run multiple times (idempotent).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');

let settings = {};
if (fs.existsSync(settingsPath)) {
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (e) {
    console.error(`Error reading ${settingsPath}:`, e.message);
    process.exit(1);
  }
}

if (settings.channelsEnabled === true) {
  console.log('✓ channelsEnabled is already set.');
  process.exit(0);
}

settings.channelsEnabled = true;

fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
console.log(`✓ Set channelsEnabled: true in ${settingsPath}`);
