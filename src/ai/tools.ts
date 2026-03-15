import type {
  AiToolCall,
  SourceReference,
  ToolExecutionContext,
} from '../types';

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

function buildAuthenticatedHeaders(context: ToolExecutionContext): HeadersInit {
  return {
    'X-Internal-Key': context.internalGatewayKey,
    'X-Organization-Id': context.organizationId,
    'Content-Type': 'application/json',
  };
}

async function fetchFromGateway(
  url: string,
  context: ToolExecutionContext
): Promise<unknown> {
  const response = await fetch(url, {
    headers: buildAuthenticatedHeaders(context),
  });
  return response.json();
}

function buildProductSearchUrl(
  args: Record<string, unknown>,
  context: ToolExecutionContext
): string {
  const url = new URL(`${context.apiGatewayUrl}/api/v1/products/search`);
  url.searchParams.set('q', args.query as string);
  url.searchParams.set('organizationId', context.organizationId);
  url.searchParams.set('mode', (args.mode as string) ?? 'hybrid');
  url.searchParams.set('limit', String(args.limit ?? 10));
  return url.toString();
}

function buildInteractionSearchUrl(
  args: Record<string, unknown>,
  context: ToolExecutionContext
): string {
  const url = new URL(
    `${context.apiGatewayUrl}/api/v1/interactions/organization/${context.organizationId}`
  );
  if (args.query) url.searchParams.set('query', args.query as string);
  if (args.sourceType)
    url.searchParams.set('sourceType', args.sourceType as string);
  if (args.limit) url.searchParams.set('limit', String(args.limit));
  if (args.page) url.searchParams.set('page', String(args.page));
  return url.toString();
}

function buildPatternSearchUrl(
  args: Record<string, unknown>,
  context: ToolExecutionContext
): string {
  const url = new URL(
    `${context.apiGatewayUrl}/api/v1/patterns/organization/${context.organizationId}`
  );
  if (args.query) url.searchParams.set('query', args.query as string);
  if (args.period) url.searchParams.set('period', args.period as string);
  return url.toString();
}

function resolveToolUrl(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
): string {
  switch (toolName) {
    case 'search_products':
      return buildProductSearchUrl(args, context);
    case 'search_interactions':
      return buildInteractionSearchUrl(args, context);
    case 'search_patterns':
      return buildPatternSearchUrl(args, context);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<unknown> {
  const url = resolveToolUrl(toolName, args, context);
  return fetchFromGateway(url, context);
}

function extractProductReferences(
  data: unknown,
  startIndex: number
): SourceReference[] {
  const products = extractArrayFromResponse(data, 'products');
  return products.map((product, offset) => ({
    index: startIndex + offset + 1,
    type: 'product' as const,
    label: `Product: "${(product as Record<string, unknown>).name ?? (product as Record<string, unknown>).title ?? 'Unknown'}"`,
  }));
}

function extractInteractionReferences(
  data: unknown,
  startIndex: number
): SourceReference[] {
  const interactions = extractArrayFromResponse(data, 'interactions');
  return interactions.map((interaction, offset) => {
    const record = interaction as Record<string, unknown>;
    const source = (record.source ?? record.sourceType ?? 'unknown') as string;
    const date = formatReferenceDate(record.createdAt ?? record.date);
    return {
      index: startIndex + offset + 1,
      type: 'interaction' as const,
      label: `Interaction #${record.id ?? offset + 1} (${source}, ${date})`,
    };
  });
}

function extractPatternReferences(
  data: unknown,
  startIndex: number
): SourceReference[] {
  const patterns = extractArrayFromResponse(data, 'patterns');
  return patterns.map((pattern, offset) => {
    const record = pattern as Record<string, unknown>;
    const title = (record.title ?? record.type ?? 'Insight') as string;
    return {
      index: startIndex + offset + 1,
      type: 'pattern' as const,
      label: `Pattern: "${title}"`,
    };
  });
}

function extractArrayFromResponse(data: unknown, key: string): unknown[] {
  if (!data || typeof data !== 'object') return [];
  const record = data as Record<string, unknown>;
  if (Array.isArray(record[key])) return record[key] as unknown[];
  if (Array.isArray(record.data)) return record.data as unknown[];
  if (Array.isArray(data)) return data as unknown[];
  return [];
}

function formatReferenceDate(value: unknown): string {
  if (!value) return 'unknown date';
  if (typeof value === 'number')
    return new Date(value).toISOString().split('T')[0];
  if (typeof value === 'string') return value.split('T')[0];
  return 'unknown date';
}

function extractReferencesForTool(
  toolName: string,
  data: unknown,
  startIndex: number
): SourceReference[] {
  switch (toolName) {
    case 'search_products':
      return extractProductReferences(data, startIndex);
    case 'search_interactions':
      return extractInteractionReferences(data, startIndex);
    case 'search_patterns':
      return extractPatternReferences(data, startIndex);
    default:
      return [];
  }
}

export interface ToolExecutionResult {
  toolResultText: string;
  references: SourceReference[];
}

export async function executeToolCallsWithReferences(
  toolCalls: AiToolCall[],
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const allReferences: SourceReference[] = [];
  const resultTexts = await Promise.all(
    toolCalls.map(async toolCall => {
      try {
        const toolResult = await executeTool(
          toolCall.name,
          toolCall.arguments ?? {},
          context
        );
        const newReferences = extractReferencesForTool(
          toolCall.name,
          toolResult,
          allReferences.length
        );
        allReferences.push(...newReferences);
        return `Tool "${toolCall.name}" result: ${JSON.stringify(toolResult)}`;
      } catch (err) {
        return `Tool "${toolCall.name}" error: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
    })
  );
  return {
    toolResultText: resultTexts.join('\n\n'),
    references: allReferences,
  };
}

export function formatReferencesAsFootnotes(
  references: SourceReference[]
): string {
  if (references.length === 0) return '';
  const lines = references.map(ref => `[${ref.index}] ${ref.label}`);
  return `\n\nSources:\n${lines.join('\n')}`;
}
