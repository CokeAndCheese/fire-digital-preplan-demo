#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

const envPath = process.argv[2] || '.env';

function parseEnv(source) {
  const values = new Map();
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return values;
}

const values = parseEnv(await readFile(envPath, 'utf8'));
const required = [
  'AGENT_APP_KEY',
  'AGENT_COMPETITION_APP_ID',
  'X_APP_KEY',
  'AGENT_GATEWAY',
  'USTUDIO_GATEWAY',
];
const missing = required.filter((key) => !values.get(key));

if (missing.length > 0) {
  console.error(`deployment configuration is missing required names: ${missing.join(', ')}`);
  process.exit(1);
}

const exact = new Map([
  ['FIRE_BASE_PATH', '/fire-digital-preplan-demo'],
  ['SCENE_BASE_PATH', '/fire-digital-preplan-demo/scene'],
  ['FIRE_PUBLIC_SCENE_URL', '/fire-digital-preplan-demo/scene'],
  ['BROWSER_X_APP_KEY_CONFIRMED', 'true'],
  ['OLD_EMBEDDED_CREDENTIALS_REVOKED', 'true'],
  ['PUBLIC_UNAUTHENTICATED_DEMO_CONFIRMED', 'true'],
]);

const invalid = [];
for (const [key, expected] of exact) {
  if (values.get(key) !== expected) invalid.push(key);
}

if (values.get('NEXT_PUBLIC_X_APP_KEY')) invalid.push('NEXT_PUBLIC_X_APP_KEY');

if (invalid.length > 0) {
  console.error(`deployment configuration failed policy checks: ${invalid.join(', ')}`);
  process.exit(1);
}

console.log('deployment environment names and policy flags are valid');
