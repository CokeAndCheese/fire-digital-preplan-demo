import process from 'node:process';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const actionId = argument('--action');
const encodedInput = argument('--input-base64');
const rawInput = encodedInput ? Buffer.from(encodedInput, 'base64').toString('utf8') : argument('--input') || '{}';
if (!actionId) throw new Error('Missing --action.');

const baseUrl = (process.env.FIRE_COMMAND_AGENT_URL || 'http://127.0.0.1:3100').replace(/\/+$/, '');
const response = await fetch(`${baseUrl}/api/skills/execute`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ skillId: 'response-level', actionId, input: JSON.parse(rawInput), approved: process.argv.includes('--approved') }),
});
const payload = await response.json();
if (!response.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
