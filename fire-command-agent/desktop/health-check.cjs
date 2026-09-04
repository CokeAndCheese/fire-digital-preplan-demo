'use strict';

const http = require('node:http');

const MAX_BODY_BYTES = 64 * 1024;

/**
 * Distinguish the expected packaged service from an unrelated process that
 * happens to answer on the same localhost port. Response bodies are bounded
 * and never included in the result so accidental secrets cannot reach logs.
 */
function inspectServiceHealth(url, expectedService, options = {}) {
  const timeoutMs = options.timeoutMs ?? 1200;

  return new Promise((resolve) => {
    let settled = false;
    let connected = false;
    let deadline;
    const finish = (state) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve({ state });
    };

    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      const chunks = [];
      let received = 0;

      response.on('data', (chunk) => {
        received += chunk.length;
        if (received <= MAX_BODY_BYTES) {
          chunks.push(chunk);
        } else {
          response.destroy();
          finish('occupied');
        }
      });
      response.on('end', () => {
        if (received > MAX_BODY_BYTES) {
          finish('occupied');
          return;
        }

        const statusCode = response.statusCode ?? 0;
        if (statusCode < 200 || statusCode >= 300) {
          finish('occupied');
          return;
        }

        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          finish(payload?.status === 'ok' && payload?.service === expectedService ? 'expected' : 'occupied');
        } catch {
          finish('occupied');
        }
      });
      response.on('error', () => finish('occupied'));
    });

    request.on('socket', (socket) => {
      if (!socket.connecting) connected = true;
      socket.once('connect', () => { connected = true; });
    });
    request.on('error', () => finish('unreachable'));
    request.on('timeout', () => {
      request.destroy();
      finish(connected ? 'occupied' : 'unreachable');
    });
    deadline = setTimeout(() => {
      request.destroy();
      finish(connected ? 'occupied' : 'unreachable');
    }, timeoutMs);
  });
}

module.exports = { inspectServiceHealth };
