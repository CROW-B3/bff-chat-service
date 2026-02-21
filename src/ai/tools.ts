import type { AiToolCall } from '../types';

export const TOOLS = [
  {
    name: 'search_products',
    description:
      "Search the organization's product catalog using semantic/vector or full-text search",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        mode: {
          type: 'string',
          enum: ['semantic', 'fts', 'hybrid'],
          description: 'Search mode',
        },
        limit: { type: 'number', description: 'Max results' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_interactions',
    description:
      'Search customer interaction history (web visits, CCTV footage analysis, social media)',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Text search query to filter interactions',
        },
        sourceType: {
          type: 'string',
          enum: ['web', 'cctv', 'social'],
          description: 'Filter by source',
        },
        limit: { type: 'number', description: 'Max results' },
        page: { type: 'number', description: 'Page number' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_patterns',
    description:
      'Search AI-analyzed behavioral patterns and insights for the organization',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Text search query to filter pattern insights',
        },
        period: {
          type: 'string',
          enum: ['daily', 'weekly', 'monthly', 'yearly'],
          description: 'Time period',
        },
      },
      required: ['query'],
    },
  },
];

async function fetchSearchProducts(
  args: Record<string, unknown>,
  organizationId: string,
  apiGatewayUrl: string
): Promise<unknown> {
  const url = new URL(`${apiGatewayUrl}/api/v1/products/search`);
  url.searchParams.set('q', args.query as string);
  url.searchParams.set('organizationId', organizationId);
  url.searchParams.set('mode', (args.mode as string) ?? 'hybrid');
  url.searchParams.set('limit', String(args.limit ?? 10));
  const response = await fetch(url.toString());
  return response.json();
}

async function fetchSearchInteractions(
  args: Record<string, unknown>,
  organizationId: string,
  apiGatewayUrl: string
): Promise<unknown> {
  const url = new URL(
    `${apiGatewayUrl}/api/v1/interactions/organization/${organizationId}`
  );
  if (args.query) url.searchParams.set('query', args.query as string);
  if (args.sourceType)
    url.searchParams.set('sourceType', args.sourceType as string);
  if (args.limit) url.searchParams.set('limit', String(args.limit));
  if (args.page) url.searchParams.set('page', String(args.page));
  const response = await fetch(url.toString());
  return response.json();
}

async function fetchSearchPatterns(
  args: Record<string, unknown>,
  organizationId: string,
  apiGatewayUrl: string
): Promise<unknown> {
  const url = new URL(
    `${apiGatewayUrl}/api/v1/patterns/organization/${organizationId}`
  );
  if (args.query) url.searchParams.set('query', args.query as string);
  if (args.period) url.searchParams.set('period', args.period as string);
  const response = await fetch(url.toString());
  return response.json();
}

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  organizationId: string,
  apiGatewayUrl: string
): Promise<unknown> {
  switch (toolName) {
    case 'search_products':
      return fetchSearchProducts(args, organizationId, apiGatewayUrl);
    case 'search_interactions':
      return fetchSearchInteractions(args, organizationId, apiGatewayUrl);
    case 'search_patterns':
      return fetchSearchPatterns(args, organizationId, apiGatewayUrl);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

export async function executeToolCalls(
  toolCalls: AiToolCall[],
  organizationId: string,
  apiGatewayUrl: string
): Promise<string[]> {
  return Promise.all(
    toolCalls.map(async toolCall => {
      try {
        const toolResult = await executeTool(
          toolCall.name,
          toolCall.arguments ?? {},
          organizationId,
          apiGatewayUrl
        );
        return `Tool "${toolCall.name}" result: ${JSON.stringify(toolResult)}`;
      } catch (err) {
        return `Tool "${toolCall.name}" error: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
    })
  );
}
