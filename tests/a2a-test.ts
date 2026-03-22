/* eslint-disable no-console, node/prefer-global/process */

/**
 * A2A (Agent-to-Agent) Protocol Test Script
 *
 * Tests the CROW chat agent's A2A endpoint for correct request/response handling.
 *
 * Usage:
 *   npx tsx tests/a2a-test.ts
 *
 * Environment variables:
 *   A2A_BASE_URL     - Base URL of the chat service (default: http://localhost:8009)
 *   INTERNAL_API_KEY - API key for authentication (required for most tests)
 *   ORG_ID           - Organization ID for test requests (default: test-org-001)
 */

const BASE_URL = process.env.A2A_BASE_URL || 'http://localhost:8009';
const API_KEY = process.env.INTERNAL_API_KEY || '';
const ORG_ID = process.env.ORG_ID || 'test-org-001';

interface A2ATaskResponse {
  id: string;
  status: { state: string };
  artifacts: Array<{
    parts: Array<{ type: string; text: string }>;
    metadata?: {
      references?: Array<{ index: number; type: string; label: string }>;
    };
  }>;
}

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, duration: Date.now() - start });
    console.log(`  PASS  ${name} (${Date.now() - start}ms)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({
      name,
      passed: false,
      error: message,
      duration: Date.now() - start,
    });
    console.log(`  FAIL  ${name} (${Date.now() - start}ms)`);
    console.log(`        ${message}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function testAgentCard(): Promise<void> {
  const res = await fetch(`${BASE_URL}/.well-known/agent.json`);
  assert(res.ok, `Expected 200, got ${res.status}`);

  const card = (await res.json()) as Record<string, unknown>;
  assert(typeof card.name === 'string', 'agent card must have a name');
  assert(
    typeof card.description === 'string',
    'agent card must have a description'
  );
  assert(typeof card.url === 'string', 'agent card must have a url');
  assert(typeof card.version === 'string', 'agent card must have a version');

  const capabilities = card.capabilities as Record<string, unknown> | undefined;
  assert(capabilities !== undefined, 'agent card must have capabilities');
  assert(
    typeof capabilities!.streaming === 'boolean',
    'capabilities.streaming must be boolean'
  );

  const skills = card.skills as Array<Record<string, unknown>> | undefined;
  assert(Array.isArray(skills), 'agent card must have a skills array');
  assert(skills!.length > 0, 'agent card must expose at least one skill');

  for (const skill of skills!) {
    assert(typeof skill.id === 'string', 'each skill must have an id');
    assert(typeof skill.name === 'string', 'each skill must have a name');
    assert(
      typeof skill.description === 'string',
      'each skill must have a description'
    );
  }

  const auth = card.authentication as Record<string, unknown> | undefined;
  assert(auth !== undefined, 'agent card must have authentication');
  assert(
    Array.isArray(auth!.schemes),
    'authentication.schemes must be an array'
  );
}

async function testA2ATaskSend(): Promise<void> {
  assert(API_KEY !== '', 'INTERNAL_API_KEY env var is required');

  const taskId = `test-${Date.now()}`;
  const res = await fetch(`${BASE_URL}/a2a/tasks/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
    },
    body: JSON.stringify({
      id: taskId,
      message: {
        parts: [
          {
            type: 'text',
            text: 'What products do we have in the catalog?',
          },
        ],
      },
      metadata: { organizationId: ORG_ID },
    }),
  });

  assert(res.ok, `Expected 2xx, got ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as A2ATaskResponse;
  assert(data.id === taskId, `Expected task id "${taskId}", got "${data.id}"`);
  assert(
    data.status?.state === 'completed',
    `Expected status completed, got "${data.status?.state}"`
  );
  assert(Array.isArray(data.artifacts), 'Response must have artifacts array');
  assert(data.artifacts.length > 0, 'Response must have at least one artifact');
  assert(
    data.artifacts[0].parts.length > 0 &&
      typeof data.artifacts[0].parts[0].text === 'string',
    'First artifact must contain a text part'
  );
}

async function testA2ATaskSendWithBearerAuth(): Promise<void> {
  assert(API_KEY !== '', 'INTERNAL_API_KEY env var is required');

  const res = await fetch(`${BASE_URL}/a2a/tasks/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      id: `test-bearer-${Date.now()}`,
      message: {
        parts: [{ type: 'text', text: 'Hello' }],
      },
      metadata: { organizationId: ORG_ID },
    }),
  });

  assert(res.ok, `Bearer auth should succeed, got ${res.status}`);
}

async function testA2ARejectsNoAuth(): Promise<void> {
  const res = await fetch(`${BASE_URL}/a2a/tasks/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'test-noauth',
      message: { parts: [{ type: 'text', text: 'Hello' }] },
      metadata: { organizationId: ORG_ID },
    }),
  });

  assert(res.status === 401, `Expected 401 without auth, got ${res.status}`);
}

async function testA2ARejectsInvalidKey(): Promise<void> {
  const res = await fetch(`${BASE_URL}/a2a/tasks/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': 'invalid-key-12345',
    },
    body: JSON.stringify({
      id: 'test-badkey',
      message: { parts: [{ type: 'text', text: 'Hello' }] },
      metadata: { organizationId: ORG_ID },
    }),
  });

  assert(
    res.status === 401,
    `Expected 401 with invalid key, got ${res.status}`
  );
}

async function testA2ARejectsMissingOrgId(): Promise<void> {
  assert(API_KEY !== '', 'INTERNAL_API_KEY env var is required');

  const res = await fetch(`${BASE_URL}/a2a/tasks/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
    },
    body: JSON.stringify({
      id: 'test-noorg',
      message: { parts: [{ type: 'text', text: 'Hello' }] },
      metadata: {},
    }),
  });

  assert(res.status === 400, `Expected 400 without orgId, got ${res.status}`);
}

async function testA2ARejectsMissingMessage(): Promise<void> {
  assert(API_KEY !== '', 'INTERNAL_API_KEY env var is required');

  const res = await fetch(`${BASE_URL}/a2a/tasks/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
    },
    body: JSON.stringify({
      id: 'test-nomsg',
      message: { parts: [] },
      metadata: { organizationId: ORG_ID },
    }),
  });

  assert(
    res.status === 400,
    `Expected 400 without message content, got ${res.status}`
  );
}

async function testA2AGeneratesTaskId(): Promise<void> {
  assert(API_KEY !== '', 'INTERNAL_API_KEY env var is required');

  const res = await fetch(`${BASE_URL}/a2a/tasks/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
    },
    body: JSON.stringify({
      message: {
        parts: [{ type: 'text', text: 'Hello' }],
      },
      metadata: { organizationId: ORG_ID },
    }),
  });

  assert(res.ok, `Expected 2xx, got ${res.status}`);
  const data = (await res.json()) as A2ATaskResponse;
  assert(
    typeof data.id === 'string' && data.id.length > 0,
    'Server must generate a task id when none is provided'
  );
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`\nCROW A2A Protocol Tests`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`Org ID: ${ORG_ID}`);
  console.log(
    `API Key: ${API_KEY ? `***${API_KEY.slice(-4)}` : '(not set)'}\n`
  );

  // Agent card test (no auth needed)
  await runTest(
    'GET /.well-known/agent.json returns valid agent card',
    testAgentCard
  );

  // Auth rejection tests (no valid key needed)
  await runTest(
    'POST /a2a/tasks/send rejects request without auth',
    testA2ARejectsNoAuth
  );
  await runTest(
    'POST /a2a/tasks/send rejects invalid API key',
    testA2ARejectsInvalidKey
  );

  // Validation tests (need valid key)
  if (API_KEY) {
    await runTest(
      'POST /a2a/tasks/send rejects missing organizationId',
      testA2ARejectsMissingOrgId
    );
    await runTest(
      'POST /a2a/tasks/send rejects empty message',
      testA2ARejectsMissingMessage
    );
    await runTest(
      'POST /a2a/tasks/send auto-generates task id',
      testA2AGeneratesTaskId
    );
    await runTest(
      'POST /a2a/tasks/send accepts Bearer auth',
      testA2ATaskSendWithBearerAuth
    );
    await runTest(
      'POST /a2a/tasks/send returns valid response',
      testA2ATaskSend
    );
  } else {
    console.log(
      '\n  SKIP  Authenticated tests (set INTERNAL_API_KEY to run)\n'
    );
  }

  // Summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(
    `\n${passed} passed, ${failed} failed, ${results.length} total\n`
  );

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
