import { z } from '@hono/zod-openapi';

export interface Environment {
  AI: Ai;
  DB: D1Database;
  R2_BUCKET: R2Bucket;
  ENVIRONMENT: string;
  API_GATEWAY_URL: string;
  INTERNAL_API_KEY?: string;
  INTERNAL_GATEWAY_KEY: string;
  QNA_SERVICE_URL: string;
  CHAT_CREW_CONTAINER?: DurableObjectNamespace;
}

export interface ToolExecutionContext {
  organizationId: string;
  apiGatewayUrl: string;
  internalGatewayKey: string;
  qnaServiceUrl: string;
}

export interface SourceReference {
  index: number;
  type: 'product' | 'interaction' | 'pattern' | 'org_context';
  label: string;
}

export interface AgenticLoopResult {
  content: string;
  references: SourceReference[];
}

export const HelloWorldSchema = z
  .object({
    text: z.string(),
  })
  .openapi('HelloWorld');

export interface AiMessage {
  role: string;
  content: string;
}
export interface AiToolCall {
  name: string;
  arguments: Record<string, unknown>;
}
export interface AiRunResult {
  response?: string;
  tool_calls?: AiToolCall[];
}
