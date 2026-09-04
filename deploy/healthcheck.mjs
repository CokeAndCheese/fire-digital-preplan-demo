#!/usr/bin/env node

const [, , target, expectedService] = process.argv;

const url = /^\d{2,5}$/.test(target ?? '')
  ? `http://127.0.0.1:${target}${process.env.NEXT_PUBLIC_BASE_PATH || ''}/health`
  : target;

if (!url || !expectedService || !/^https?:\/\//.test(url)) {
  console.error('usage: healthcheck.mjs <port-or-http(s)-url> <expected-service>');
  process.exit(2);
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 4000);

try {
  const response = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: controller.signal,
  });

  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !/^application\/json(?:;|$)/i.test(contentType)) {
    throw new Error(`unexpected HTTP response: ${response.status} ${contentType}`);
  }

  const payload = await response.json();
  if (!payload || payload.status !== 'ok' || payload.service !== expectedService) {
    throw new Error('health payload did not match the expected status/service');
  }

  console.log(`ok: ${expectedService}`);
} catch (error) {
  console.error(`healthcheck failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
