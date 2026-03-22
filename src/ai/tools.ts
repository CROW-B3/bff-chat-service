import type {
  AiToolCall,
  SourceReference,
  ToolExecutionContext,
} from '../types';

export const TOOLS = [
  {
    name: 'search_products',
    description:
      "Semantic search across the organization's product catalog using vectorize",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_interactions',
    description:
      'Semantic search across customer interaction history (web visits, CCTV footage analysis, social media) using vectorize',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Semantic search query for interactions',
        },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_patterns',
    description:
      'Semantic search across AI-analyzed behavioral patterns and insights using vectorize',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Semantic search query for pattern insights',
        },
        limit: { type: 'number', description: 'Max results (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_org_context',
    description:
      'Search organization context including company overview, products summary, target market, and general knowledge base via QnA vectorize',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query about the organization',
        },
      },
      required: ['query'],
    },
  },
];

interface ToolResult {
  results: Array<{
    id: string;
    content: string;
    score: number;
    source: string;
    metadata: Record<string, unknown>;
  }>;
  total: number;
}

function buildAuthHeaders(context: ToolExecutionContext): HeadersInit {
  return {
    'X-Internal-Key': context.internalGatewayKey,
    'X-Organization-Id': context.organizationId,
    'Content-Type': 'application/json',
  };
}

async function fetchJson(
  url: string,
  context: ToolExecutionContext
): Promise<unknown> {
  const response = await fetch(url, {
    headers: buildAuthHeaders(context),
  });
  if (!response.ok) {
    console.error(`Tool fetch failed: ${response.status} ${url}`);
    return { results: [], total: 0 };
  }
  return response.json();
}

function buildProductSearchUrl(
  args: Record<string, unknown>,
  context: ToolExecutionContext
): string {
  const base = `${context.apiGatewayUrl}/api/v1/products/search`;
  const url = new URL(base);
  url.searchParams.set('q', args.query as string);
  url.searchParams.set('organizationId', context.organizationId);
  url.searchParams.set('limit', String(args.limit ?? 10));
  return url.toString();
}

function buildInteractionSearchUrl(
  args: Record<string, unknown>,
  context: ToolExecutionContext
): string {
  const base = `${context.apiGatewayUrl}/api/v1/interactions/organization/${context.organizationId}/search`;
  const url = new URL(base);
  url.searchParams.set('q', args.query as string);
  url.searchParams.set('limit', String(args.limit ?? 10));
  return url.toString();
}

function buildPatternSearchUrl(
  args: Record<string, unknown>,
  context: ToolExecutionContext
): string {
  const base = `${context.apiGatewayUrl}/api/v1/patterns/organization/${context.organizationId}/search`;
  const url = new URL(base);
  url.searchParams.set('q', args.query as string);
  url.searchParams.set('topK', String(args.limit ?? 5));
  return url.toString();
}

function buildOrgContextSearchUrl(
  args: Record<string, unknown>,
  context: ToolExecutionContext
): string {
  const base = `${context.qnaServiceUrl}/api/v1/qna/search`;
  const url = new URL(base);
  url.searchParams.set('q', args.query as string);
  url.searchParams.set('organizationId', context.organizationId);
  return url.toString();
}

function normalizeProductResult(raw: unknown): ToolResult {
  const data = (raw ?? {}) as Record<string, unknown>;
  const items = extractArray(data, 'results');
  const mapped = items.map(item => {
    const r = item as Record<string, unknown>;
    return {
      id: String(r.id ?? ''),
      content: String(r.description ?? r.title ?? ''),
      score: Number(r.score ?? 0),
      source: 'product',
      metadata: {
        title: r.title,
        ...omitKeys(r, ['id', 'description', 'score']),
      },
    };
  });
  return { results: mapped, total: Number(data.total ?? mapped.length) };
}

function normalizeInteractionResult(raw: unknown): ToolResult {
  const data = (raw ?? {}) as Record<string, unknown>;
  const items = extractArray(data, 'results');
  const mapped = items.map(item => {
    const r = item as Record<string, unknown>;
    return {
      id: String(r.id ?? ''),
      content: String(r.summary ?? r.description ?? ''),
      score: Number(r.score ?? 0),
      source: `interaction:${r.sourceType ?? 'unknown'}`,
      metadata: omitKeys(r, ['id', 'summary', 'score']),
    };
  });
  return { results: mapped, total: Number(data.total ?? mapped.length) };
}

function normalizePatternResult(raw: unknown): ToolResult {
  const data = (raw ?? {}) as Record<string, unknown>;
  const items = extractArray(data, 'results');
  const mapped = items.map(item => {
    const r = item as Record<string, unknown>;
    return {
      id: String(r.id ?? ''),
      content: String(r.description ?? r.type ?? ''),
      score: Number(r.score ?? 0),
      source: 'pattern',
      metadata: {
        type: r.type,
        ...omitKeys(r, ['id', 'description', 'score']),
      },
    };
  });
  return { results: mapped, total: Number(data.total ?? mapped.length) };
}

function normalizeOrgContextResult(raw: unknown): ToolResult {
  const data = (raw ?? {}) as Record<string, unknown>;
  const items = extractArray(data, 'results');
  const mapped = items.map((item, idx) => {
    const r = item as Record<string, unknown>;
    return {
      id: String(r.id ?? `qna-${idx}`),
      content: String(r.content ?? r.text ?? ''),
      score: Number(r.score ?? 0),
      source: `org_context:${r.type ?? 'general'}`,
      metadata: omitKeys(r, ['id', 'content', 'score']),
    };
  });
  return { results: mapped, total: Number(data.total ?? mapped.length) };
}

function extractArray(data: Record<string, unknown>, key: string): unknown[] {
  if (Array.isArray(data[key])) return data[key] as unknown[];
  if (Array.isArray(data.data)) return data.data as unknown[];
  if (Array.isArray(data)) return data as unknown[];
  return [];
}

function omitKeys(
  obj: Record<string, unknown>,
  keys: string[]
): Record<string, unknown> {
  const keysSet = new Set(keys);
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => !keysSet.has(k))
  );
}

type ToolUrlBuilder = (
  args: Record<string, unknown>,
  context: ToolExecutionContext
) => string;

type ResultNormalizer = (raw: unknown) => ToolResult;

const TOOL_CONFIG: Record<
  string,
  { buildUrl: ToolUrlBuilder; normalize: ResultNormalizer }
> = {
  search_products: {
    buildUrl: buildProductSearchUrl,
    normalize: normalizeProductResult,
  },
  search_interactions: {
    buildUrl: buildInteractionSearchUrl,
    normalize: normalizeInteractionResult,
  },
  search_patterns: {
    buildUrl: buildPatternSearchUrl,
    normalize: normalizePatternResult,
  },
  search_org_context: {
    buildUrl: buildOrgContextSearchUrl,
    normalize: normalizeOrgContextResult,
  },
};

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolResult> {
  const config = TOOL_CONFIG[toolName];
  if (!config) throw new Error(`Unknown tool: ${toolName}`);
  const url = config.buildUrl(args, context);
  const raw = await fetchJson(url, context);
  return config.normalize(raw);
}

function buildReferencesFromResult(
  toolName: string,
  result: ToolResult,
  startIndex: number
): SourceReference[] {
  return result.results.map((item, offset) => ({
    index: startIndex + offset + 1,
    type: resolveReferenceType(toolName),
    label: buildReferenceLabel(toolName, item),
  }));
}

function resolveReferenceType(toolName: string): SourceReference['type'] {
  const typeMap: Record<string, SourceReference['type']> = {
    search_products: 'product',
    search_interactions: 'interaction',
    search_patterns: 'pattern',
    search_org_context: 'org_context',
  };
  return typeMap[toolName] ?? 'product';
}

function buildReferenceLabel(
  toolName: string,
  item: ToolResult['results'][number]
): string {
  if (toolName === 'search_products') {
    const title = (item.metadata.title as string) ?? 'Unknown';
    return `Product: "${title}"`;
  }
  if (toolName === 'search_interactions') {
    const sourceType = item.source.replace('interaction:', '');
    return `Interaction #${item.id} (${sourceType})`;
  }
  if (toolName === 'search_patterns') {
    const patternType = (item.metadata.type as string) ?? 'Insight';
    return `Pattern: "${patternType}"`;
  }
  if (toolName === 'search_org_context') {
    const contextType = item.source.replace('org_context:', '');
    return `Org Context: ${contextType}`;
  }
  return `Source: ${item.id}`;
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
        const newReferences = buildReferencesFromResult(
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
