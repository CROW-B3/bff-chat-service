import { createRoute, z } from '@hono/zod-openapi';

export const HelloWorldRoute = createRoute({
  method: 'get',
  path: '/',
  request: {},
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({ status: z.string() }),
        },
      },
      description: 'Health check',
    },
  },
});

export const CreateSessionRoute = createRoute({
  method: 'post',
  path: '/api/v1/chat/sessions',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            organizationId: z.string(),
            userId: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({ sessionId: z.string() }),
        },
      },
      description: 'Created chat session',
    },
  },
});

export const SendMessageRoute = createRoute({
  method: 'post',
  path: '/api/v1/chat/sessions/:sessionId/messages',
  request: {
    params: z.object({ sessionId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            content: z.string(),
            organizationId: z.string(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            message: z.object({
              id: z.string(),
              role: z.string(),
              content: z.string(),
              references: z
                .array(
                  z.object({
                    index: z.number(),
                    type: z.string(),
                    label: z.string(),
                  })
                )
                .nullable(),
              createdAt: z.number(),
            }),
          }),
        },
      },
      description: 'Assistant response message',
    },
  },
});

export const GetMessagesRoute = createRoute({
  method: 'get',
  path: '/api/v1/chat/sessions/:sessionId/messages',
  request: {
    params: z.object({ sessionId: z.string() }),
    query: z.object({
      limit: z.string().optional(),
      page: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            messages: z.array(
              z.object({
                id: z.string(),
                sessionId: z.string(),
                role: z.string(),
                content: z.string(),
                references: z
                  .array(
                    z.object({
                      index: z.number(),
                      type: z.string(),
                      label: z.string(),
                    })
                  )
                  .nullable(),
                createdAt: z.number(),
              })
            ),
            total: z.number(),
            page: z.number(),
            limit: z.number(),
          }),
        },
      },
      description: 'Paginated message history',
    },
  },
});

export const GetSessionRoute = createRoute({
  method: 'get',
  path: '/api/v1/chat/sessions/:sessionId',
  request: {
    params: z.object({ sessionId: z.string() }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            id: z.string(),
            organizationId: z.string(),
            userId: z.string().optional(),
            createdAt: z.number(),
          }),
        },
      },
      description: 'Chat session details',
    },
    404: {
      content: {
        'application/json': {
          schema: z.object({ error: z.string() }),
        },
      },
      description: 'Session not found',
    },
  },
});

export const DeleteSessionRoute = createRoute({
  method: 'delete',
  path: '/api/v1/chat/sessions/:sessionId',
  request: {
    params: z.object({ sessionId: z.string() }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({ success: z.boolean() }),
        },
      },
      description: 'Session deleted',
    },
    404: {
      content: {
        'application/json': {
          schema: z.object({ error: z.string() }),
        },
      },
      description: 'Session not found',
    },
  },
});

export const GetSessionsByOrgRoute = createRoute({
  method: 'get',
  path: '/api/v1/chat/sessions/organization/:orgId',
  request: {
    params: z.object({ orgId: z.string() }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            sessions: z.array(
              z.object({
                id: z.string(),
                organizationId: z.string(),
                userId: z.string().optional(),
                createdAt: z.number(),
              })
            ),
          }),
        },
      },
      description: 'Chat sessions for organization',
    },
  },
});
