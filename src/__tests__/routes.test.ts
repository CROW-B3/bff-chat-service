import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../ai/agent', () => ({
  runCrewAgenticLoop: vi.fn(() =>
    Promise.resolve({
      content: 'Test response from agent',
      references: [],
    })
  ),
}));

vi.mock('drizzle-orm/d1', () => ({
  drizzle: vi.fn(() => mockDrizzleDb),
}));

const mockDrizzleDb = {
  select: vi.fn(() => mockDrizzleDb),
  from: vi.fn(() => mockDrizzleDb),
  where: vi.fn(() => mockDrizzleDb),
  limit: vi.fn(() => mockDrizzleDb),
  offset: vi.fn(() => mockDrizzleDb),
  orderBy: vi.fn(() => mockDrizzleDb),
  insert: vi.fn(() => mockDrizzleDb),
  values: vi.fn(() => Promise.resolve()),
  delete: vi.fn(() => mockDrizzleDb),
  get: vi.fn(() => null),
};

// Make the chain thenable by default (resolves to empty array)
function setupSelectReturns(results: unknown[], getSingle?: unknown) {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    offset: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    get: vi.fn(() => getSingle ?? null),
    then: (resolve: Function) => Promise.resolve(results).then(resolve),
  };
  mockDrizzleDb.select.mockReturnValue(chain);
  return chain;
}

const mockD1 = {
  prepare: vi.fn(() => ({
    bind: vi.fn((..._args: unknown[]) => ({
      all: vi.fn(() => ({ results: [] })),
      first: vi.fn(() => null),
      run: vi.fn(() => ({ success: true })),
    })),
  })),
  batch: vi.fn(() => []),
};

const mockEnv = {
  AI: { run: vi.fn() },
  DB: mockD1,
  R2_BUCKET: { put: vi.fn(), get: vi.fn() },
  ENVIRONMENT: 'local',
  API_GATEWAY_URL: 'http://localhost:8000',
  INTERNAL_API_KEY: 'test-internal-key',
  INTERNAL_GATEWAY_KEY: 'test-key',
  QNA_SERVICE_URL: 'http://localhost:8010',
};

import app from '../index';

describe('bff-chat-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET / (health check)', () => {
    it('should return 200 with status ok', async () => {
      const res = await app.request('/', {}, mockEnv);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
    });
  });

  describe('GET /health', () => {
    it('should return 200 with status ok', async () => {
      const res = await app.request('/health', {}, mockEnv);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
    });
  });

  describe('POST /api/v1/chat/sessions', () => {
    it('should return 401 without X-Internal-Key', async () => {
      const res = await app.request(
        '/api/v1/chat/sessions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ organizationId: 'org-123' }),
        },
        mockEnv
      );
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 401 with wrong X-Internal-Key', async () => {
      const res = await app.request(
        '/api/v1/chat/sessions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Key': 'wrong-key',
          },
          body: JSON.stringify({ organizationId: 'org-123' }),
        },
        mockEnv
      );
      expect(res.status).toBe(401);
    });

    it('should create a session with valid internal key', async () => {
      mockDrizzleDb.insert.mockReturnValue({
        values: vi.fn(() => Promise.resolve()),
      });

      const res = await app.request(
        '/api/v1/chat/sessions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Key': 'test-key',
            'X-Organization-Id': 'org-123',
          },
          body: JSON.stringify({ organizationId: 'org-123' }),
        },
        mockEnv
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessionId).toBeDefined();
    });

    it('should return 400 without organizationId', async () => {
      const res = await app.request(
        '/api/v1/chat/sessions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Key': 'test-key',
          },
          body: JSON.stringify({}),
        },
        mockEnv
      );
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/chat/sessions/:sessionId/messages', () => {
    it('should return 401 without X-Internal-Key', async () => {
      const res = await app.request(
        '/api/v1/chat/sessions/sess-123/messages',
        {},
        mockEnv
      );
      expect(res.status).toBe(401);
    });

    it('should return 403 without X-Organization-Id header', async () => {
      setupSelectReturns([], null);

      const res = await app.request(
        '/api/v1/chat/sessions/sess-123/messages',
        {
          headers: {
            'X-Internal-Key': 'test-key',
          },
        },
        mockEnv
      );
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/chat/sessions/organization/:orgId', () => {
    it('should return 401 without internal key', async () => {
      const res = await app.request(
        '/api/v1/chat/sessions/organization/org-123',
        {},
        mockEnv
      );
      expect(res.status).toBe(401);
    });

    it('should return 403 with mismatched org ID', async () => {
      const res = await app.request(
        '/api/v1/chat/sessions/organization/org-123',
        {
          headers: {
            'X-Internal-Key': 'test-key',
            'X-Organization-Id': 'org-different',
          },
        },
        mockEnv
      );
      expect(res.status).toBe(403);
    });

    it('should return sessions for matching org ID', async () => {
      mockD1.prepare.mockReturnValue({
        bind: vi.fn(() => ({
          all: vi.fn(() => ({
            results: [
              { id: 'sess-1', organization_id: 'org-123', user_id: 'u1', created_at: Date.now() },
            ],
          })),
        })),
      });

      const res = await app.request(
        '/api/v1/chat/sessions/organization/org-123',
        {
          headers: {
            'X-Internal-Key': 'test-key',
            'X-Organization-Id': 'org-123',
          },
        },
        mockEnv
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessions).toBeDefined();
      expect(Array.isArray(body.sessions)).toBe(true);
    });
  });

  describe('DELETE /api/v1/chat/sessions/:sessionId', () => {
    it('should return 401 without internal key', async () => {
      const res = await app.request(
        '/api/v1/chat/sessions/sess-123',
        { method: 'DELETE' },
        mockEnv
      );
      expect(res.status).toBe(401);
    });

    it('should return 404 when session not found', async () => {
      setupSelectReturns([]);

      const res = await app.request(
        '/api/v1/chat/sessions/sess-123',
        {
          method: 'DELETE',
          headers: {
            'X-Internal-Key': 'test-key',
            'X-Organization-Id': 'org-123',
          },
        },
        mockEnv
      );
      expect(res.status).toBe(404);
    });
  });
});
