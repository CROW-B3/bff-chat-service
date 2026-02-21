import type { Environment } from './types';
import { OpenAPIHono } from '@hono/zod-openapi';
import { DurableObject } from 'cloudflare:workers';
import { desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { logger } from 'hono/logger';
import { poweredBy } from 'hono/powered-by';
import { runCrewAgenticLoop } from './ai/agent';
import * as schema from './db/schema';
import {
  CreateSessionRoute,
  GetMessagesRoute,
  GetSessionsByOrgRoute,
  HelloWorldRoute,
  SendMessageRoute,
} from './routes';

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

const app = new OpenAPIHono<{ Bindings: Environment }>();
app.use(poweredBy());
app.use(logger());

app.openapi(HelloWorldRoute, c =>
  c.json({ status: 'ok', service: 'crow-bff-chat-service' })
);

app.openapi(CreateSessionRoute, async c => {
  const database = drizzle(c.env.DB, { schema });
  const { organizationId, userId } = c.req.valid('json');

  const sessionId = crypto.randomUUID();
  const now = Date.now();

  await database.insert(schema.chatSession).values({
    id: sessionId,
    organizationId,
    userId,
    createdAt: now,
  });

  return c.json({ sessionId });
});

app.openapi(SendMessageRoute, async c => {
  const database = drizzle(c.env.DB, { schema });
  const { sessionId } = c.req.valid('param');
  const { content, organizationId } = c.req.valid('json');

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
  const assistantContent = await runCrewAgenticLoop(
    contextMessages,
    organizationId,
    c.env.API_GATEWAY_URL,
    c.env.AI,
    c.env
  );

  const assistantMessageId = crypto.randomUUID();
  const assistantNow = Date.now();

  await database.insert(schema.chatMessage).values({
    id: assistantMessageId,
    sessionId,
    role: 'assistant',
    content: assistantContent,
    createdAt: assistantNow,
  });

  return c.json({
    message: {
      id: assistantMessageId,
      role: 'assistant',
      content: assistantContent,
      createdAt: assistantNow,
    },
  });
});

app.openapi(GetMessagesRoute, async c => {
  const database = drizzle(c.env.DB, { schema });
  const { sessionId } = c.req.valid('param');
  const { page: pageStr, limit: limitStr } = c.req.valid('query');

  const page = Number.parseInt(pageStr || '1', 10);
  const limit = Number.parseInt(limitStr || '20', 10);
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
      createdAt: Number(message.createdAt),
    })),
    total: allMessages.length,
    page,
    limit,
  });
});

app.openapi(GetSessionsByOrgRoute, async c => {
  const database = drizzle(c.env.DB, { schema });
  const { orgId } = c.req.valid('param');

  const sessions = await database
    .select()
    .from(schema.chatSession)
    .where(eq(schema.chatSession.organizationId, orgId))
    .orderBy(desc(schema.chatSession.createdAt));

  return c.json({
    sessions: sessions.map(session => ({
      id: session.id,
      organizationId: session.organizationId,
      userId: session.userId,
      createdAt: Number(session.createdAt),
    })),
  });
});

app.doc('/docs', {
  openapi: '3.0.0',
  info: { version: '1.0.0', title: 'CROW BFF Chat Service API' },
});

app.get('/.well-known/agent.json', c => {
  return c.json({
    name: 'CROW Analytics Agent',
    description:
      'AI-powered retail analytics assistant with access to product catalog, customer interactions, and behavioral patterns',
    url: 'https://dev.internal.chat.crowai.dev',
    version: '1.0.0',
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
      schemes: ['ApiKey'],
      credentials: null,
    },
  });
});

app.post('/a2a/tasks/send', async c => {
  const apiKey =
    c.req.header('X-API-Key') ||
    c.req.header('Authorization')?.replace('Bearer ', '');
  if (!apiKey) return c.json({ error: 'API key required' }, 401);

  if (c.env.INTERNAL_API_KEY && apiKey !== c.env.INTERNAL_API_KEY)
    return c.json({ error: 'Invalid API key' }, 401);

  const body = await c.req.json();
  const taskId = body.id || crypto.randomUUID();
  const userMessage: string =
    body.message?.parts?.[0]?.text || body.message?.content || '';
  const organizationId: string = body.metadata?.organizationId || 'default';

  const responseText = await runCrewAgenticLoop(
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
        parts: [{ type: 'text', text: responseText }],
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
