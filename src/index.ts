import type { Environment } from './types';
import { OpenAPIHono } from '@hono/zod-openapi';
import { DurableObject } from 'cloudflare:workers';
import { desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { logger } from 'hono/logger';
import { runCrewAgenticLoop } from './ai/agent';
import * as schema from './db/schema';
import {
  CreateSessionRoute,
  DeleteSessionRoute,
  GetMessagesRoute,
  GetSessionRoute,
  GetSessionsByOrgRoute,
  HelloWorldRoute,
  SendMessageRoute,
} from './routes';

function parseStoredReferences(
  raw: string | null
): Array<{ index: number; type: string; label: string }> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export class ChatCrewContainer extends DurableObject<Environment> {
  private container: Container;

  constructor(state: DurableObjectState, env: Environment) {
    super(state, env);
    this.container = (state as unknown as { container: Container }).container;
  }

  async fetch(request: Request): Promise<Response> {
    return (
      this.container as unknown as { fetch: (r: Request) => Promise<Response> }
    ).fetch(request);
  }
}

async function fetchRecentMessages(
  database: ReturnType<typeof drizzle>,
  sessionId: string
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const recentMessages = await database
    .select()
    .from(schema.chatMessage)
    .where(eq(schema.chatMessage.sessionId, sessionId))
    .orderBy(desc(schema.chatMessage.createdAt))
    .limit(10);

  return recentMessages.reverse().map(message => ({
    role: message.role as 'user' | 'assistant',
    content: message.content,
  }));
}

function resolveAgentBaseUrl(environment: string): string {
  if (environment === 'dev') return 'https://dev.internal.chat.crowai.dev';
  if (environment === 'local') return 'http://localhost:8009';
  return 'https://internal.chat.crowai.dev';
}

const app = new OpenAPIHono<{ Bindings: Environment }>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        { error: 'Bad Request', message: 'Invalid request parameters' },
        400
      );
    }
  },
});
app.use(logger());

// Verify X-Internal-Key on all /api/* routes
app.use('/api/*', async (c, next) => {
  const key = c.req.header('X-Internal-Key');
  if (!key || key !== c.env.INTERNAL_GATEWAY_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return next();
});

app.onError((err, c) => {
  const errorName = err instanceof Error ? err.name : '';
  const errorMessage = err instanceof Error ? err.message : '';
  if (
    errorName === 'ZodError' ||
    errorName === 'SyntaxError' ||
    errorMessage.includes('Malformed JSON')
  ) {
    return c.json(
      { error: 'Bad Request', message: 'Invalid request parameters' },
      400
    );
  }
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

app.openapi(HelloWorldRoute, c => c.json({ status: 'ok' }));
app.get('/health', c => c.json({ status: 'ok' }));

app.openapi(CreateSessionRoute, async c => {
  const database = drizzle(c.env.DB, { schema });
  const body = c.req.valid('json');
  const callerOrgId = c.req.header('X-Organization-Id');
  const organizationId = callerOrgId || body.organizationId;
  if (!organizationId) {
    return c.json(
      { error: 'Bad Request', message: 'Organization ID required' },
      400
    ) as never;
  }
  if (
    body.organizationId &&
    callerOrgId &&
    body.organizationId !== callerOrgId
  ) {
    return c.json(
      { error: 'Forbidden', message: 'Organization mismatch' },
      403
    ) as never;
  }
  const userId = c.req.header('X-User-Id') ?? '';

  const sessionId = crypto.randomUUID();
  const now = Date.now();

  await database.insert(schema.chatSession).values({
    id: sessionId,
    organizationId: organizationId as string,
    userId,
    createdAt: now,
  });

  return c.json({ sessionId });
});

app.openapi(SendMessageRoute, async c => {
  const database = drizzle(c.env.DB, { schema });
  const { sessionId } = c.req.valid('param');
  const body = c.req.valid('json');
  const callerOrgId = c.req.header('X-Organization-Id');
  const organizationId = callerOrgId || body.organizationId;
  if (!organizationId) {
    return c.json(
      { error: 'Bad Request', message: 'Organization ID required' },
      400
    ) as never;
  }
  if (
    body.organizationId &&
    callerOrgId &&
    body.organizationId !== callerOrgId
  ) {
    return c.json(
      { error: 'Forbidden', message: 'Organization mismatch' },
      403
    ) as never;
  }
  const content = body.content;
  const session = await database
    .select()
    .from(schema.chatSession)
    .where(eq(schema.chatSession.id, sessionId))
    .get();
  if (!session || session.organizationId !== organizationId) {
    return c.json(
      { error: 'Forbidden', message: 'Session not found or access denied' },
      403
    ) as never;
  }

  const now = Date.now();
  const userMessageId = crypto.randomUUID();

  await database.insert(schema.chatMessage).values({
    id: userMessageId,
    sessionId,
    role: 'user',
    content,
    createdAt: now,
  });

  const contextMessages = await fetchRecentMessages(database, sessionId);
  let agenticResult: {
    content: string;
    references: Array<{ index: number; type: string; label: string }>;
  };
  try {
    agenticResult = await runCrewAgenticLoop(
      contextMessages,
      organizationId as string,
      c.env.API_GATEWAY_URL,
      c.env.AI,
      c.env
    );
  } catch (agentErr) {
    console.error('Agent loop failed:', agentErr);
    agenticResult = {
      content:
        'I apologize, I encountered an issue processing your request. Please try again.',
      references: [],
    };
  }

  const assistantMessageId = crypto.randomUUID();
  const assistantNow = Date.now();
  const serializedReferences =
    agenticResult.references.length > 0
      ? JSON.stringify(agenticResult.references)
      : null;

  await database.insert(schema.chatMessage).values({
    id: assistantMessageId,
    sessionId,
    role: 'assistant',
    content: agenticResult.content,
    references: serializedReferences,
    createdAt: assistantNow,
  });

  return c.json({
    message: {
      id: assistantMessageId,
      role: 'assistant',
      content: agenticResult.content,
      references:
        agenticResult.references.length > 0 ? agenticResult.references : null,
      createdAt: assistantNow,
    },
  });
});

app.openapi(GetMessagesRoute, async c => {
  const database = drizzle(c.env.DB, { schema });
  const { sessionId } = c.req.valid('param');
  const { page: pageStr, limit: limitStr } = c.req.valid('query');

  const callerOrgId = c.req.header('X-Organization-Id');
  if (!callerOrgId) {
    return c.json(
      { error: 'Forbidden', message: 'Authentication required' },
      403
    ) as never;
  }
  const sessionCheck = await database
    .select()
    .from(schema.chatSession)
    .where(eq(schema.chatSession.id, sessionId))
    .get();
  if (!sessionCheck || sessionCheck.organizationId !== callerOrgId) {
    return c.json(
      { error: 'Session not found or access denied' },
      404
    ) as never;
  }

  const page = Number.parseInt(pageStr || '1', 10);
  const limit = Math.min(Number.parseInt(limitStr || '20', 10), 100);
  const offset = (page - 1) * limit;

  const messages = await database
    .select()
    .from(schema.chatMessage)
    .where(eq(schema.chatMessage.sessionId, sessionId))
    .orderBy(schema.chatMessage.createdAt)
    .limit(limit)
    .offset(offset);

  const allMessages = await database
    .select()
    .from(schema.chatMessage)
    .where(eq(schema.chatMessage.sessionId, sessionId));

  return c.json({
    messages: messages.map(message => ({
      id: message.id,
      sessionId: message.sessionId,
      role: message.role,
      content: message.content,
      references: parseStoredReferences(message.references),
      createdAt: Number(message.createdAt),
    })),
    total: allMessages.length,
    page,
    limit,
  });
});

app.openapi(GetSessionsByOrgRoute, async c => {
  const { orgId } = c.req.valid('param');
  const callerOrgId = c.req.header('X-Organization-Id');
  if (!callerOrgId || callerOrgId !== orgId) {
    return c.json(
      { error: 'Forbidden', message: 'Access denied to this organization' },
      403
    ) as never;
  }

  const rows = await c.env.DB.prepare(
    'SELECT id, organization_id, user_id, created_at FROM chat_session WHERE organization_id = ? ORDER BY created_at DESC'
  )
    .bind(orgId)
    .all();

  c.res.headers.set('Cache-Control', 'no-store');

  return c.json({
    sessions: (rows.results as Record<string, unknown>[]).map(row => ({
      id: row.id as string,
      organizationId: row.organization_id as string,
      userId: row.user_id as string,
      createdAt: Number(row.created_at),
    })),
  });
});

app.openapi(GetSessionRoute, async c => {
  const { sessionId } = c.req.valid('param');

  const row = await c.env.DB.prepare(
    'SELECT id, organization_id, user_id, created_at FROM chat_session WHERE id = ?'
  )
    .bind(sessionId)
    .first<Record<string, unknown>>();

  if (!row) return c.json({ error: 'Session not found' }, 404) as never;

  const callerOrgId = c.req.header('X-Organization-Id');
  if (!callerOrgId || callerOrgId !== (row.organization_id as string))
    return c.json({ error: 'Session not found' }, 404) as never;

  return c.json(
    {
      id: row.id as string,
      organizationId: row.organization_id as string,
      userId: row.user_id as string,
      createdAt: Number(row.created_at),
    },
    200
  ) as never;
});

app.openapi(DeleteSessionRoute, async c => {
  const database = drizzle(c.env.DB, { schema });
  const { sessionId } = c.req.valid('param');

  const results = await database
    .select()
    .from(schema.chatSession)
    .where(eq(schema.chatSession.id, sessionId))
    .limit(1);

  if (results.length === 0)
    return c.json({ error: 'Session not found' }, 404) as never;

  const callerOrgId = c.req.header('X-Organization-Id');
  if (!callerOrgId || callerOrgId !== results[0].organizationId)
    return c.json({ error: 'Session not found' }, 404) as never;

  await database
    .delete(schema.chatMessage)
    .where(eq(schema.chatMessage.sessionId, sessionId));

  await database
    .delete(schema.chatSession)
    .where(eq(schema.chatSession.id, sessionId));

  return c.json({ success: true }, 200) as never;
});

app.doc('/docs', {
  openapi: '3.0.0',
  info: { version: '1.0.0', title: 'CROW BFF Chat Service API' },
});

app.get('/.well-known/agent.json', c => {
  const baseUrl = resolveAgentBaseUrl(c.env.ENVIRONMENT);
  return c.json({
    name: 'CROW Analytics Agent',
    description:
      'AI-powered retail analytics assistant with access to product catalog, customer interactions, and behavioral patterns',
    url: baseUrl,
    version: '1.0.0',
    provider: { organization: 'CROW AI', url: 'https://crowai.dev' },
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [
      {
        id: 'product-search',
        name: 'Product Search',
        description: 'Search and analyze the product catalog',
        tags: ['retail', 'products', 'search'],
      },
      {
        id: 'interaction-analysis',
        name: 'Interaction Analysis',
        description:
          'Analyze customer interactions across web, CCTV, and social channels',
        tags: ['analytics', 'interactions', 'behavioral'],
      },
      {
        id: 'pattern-insights',
        name: 'Pattern Insights',
        description: 'Get AI-generated behavioral pattern insights',
        tags: ['patterns', 'insights', 'trends'],
      },
    ],
    authentication: {
      schemes: ['apiKey'],
      credentials: null,
    },
  });
});

app.post('/a2a/tasks/send', async c => {
  const apiKey =
    c.req.header('X-API-Key') ||
    c.req.header('Authorization')?.replace('Bearer ', '');
  if (!apiKey) return c.json({ error: 'API key required' }, 401);

  if (!c.env.INTERNAL_API_KEY || apiKey !== c.env.INTERNAL_API_KEY)
    return c.json({ error: 'Invalid API key' }, 401);

  const body = await c.req.json();
  const taskId = body.id || crypto.randomUUID();
  const userMessage: string =
    body.message?.parts?.[0]?.text || body.message?.content || '';
  if (!userMessage)
    return c.json(
      { error: 'Bad Request', message: 'message content is required' },
      400
    );
  const organizationId: string | undefined = body.metadata?.organizationId;
  if (!organizationId)
    return c.json(
      { error: 'Bad Request', message: 'metadata.organizationId is required' },
      400
    );

  const agenticResult = await runCrewAgenticLoop(
    [{ role: 'user', content: userMessage }],
    organizationId,
    c.env.API_GATEWAY_URL,
    c.env.AI,
    c.env
  );

  return c.json({
    id: taskId,
    status: { state: 'completed' },
    artifacts: [
      {
        parts: [{ type: 'text', text: agenticResult.content }],
        metadata: {
          references: agenticResult.references,
        },
      },
    ],
  });
});

app.get('/a2a/tasks/:taskId', c => {
  return c.json({
    id: c.req.param('taskId'),
    status: { state: 'completed' },
    artifacts: [],
  });
});

export default app;
