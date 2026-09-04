import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { inspectServiceHealth } = require('../health-check.cjs');

async function withServer(handler, assertion) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    assert.equal(typeof address, 'object');
    await assertion(`http://127.0.0.1:${address.port}/health`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('accepts only the expected 2xx JSON health identity', async () => {
  await withServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', service: 'fire-command-agent' }));
  }, async (url) => {
    assert.deepEqual(await inspectServiceHealth(url, 'fire-command-agent'), { state: 'expected' });
  });
});

test('treats a wrong service identity as an occupied port', async () => {
  await withServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', service: 'unrelated-service' }));
  }, async (url) => {
    assert.deepEqual(await inspectServiceHealth(url, 'fire-command-agent'), { state: 'occupied' });
  });
});

test('treats non-2xx and non-JSON responses as occupied ports', async () => {
  await withServer((_request, response) => {
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('not found');
  }, async (url) => {
    assert.deepEqual(await inspectServiceHealth(url, 'fire-command-agent'), { state: 'occupied' });
  });
});

test('reports a closed port as unreachable', async () => {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.equal(typeof address, 'object');
  await new Promise((resolve) => server.close(resolve));
  assert.deepEqual(
    await inspectServiceHealth(`http://127.0.0.1:${address.port}/health`, 'fire-command-agent'),
    { state: 'unreachable' },
  );
});
