import type { AiMessage, AiRunResult } from '../types';
import { executeToolCalls, TOOLS } from './tools';

const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MAX_ITERATIONS = 5;

function buildSystemPrompt(organizationId: string): string {
  return `You are CROW AI, an intelligent retail analytics assistant. You have access to tools to search products, get customer interactions, and analyze behavioral patterns for organization: ${organizationId}. Use these tools to provide accurate, data-driven answers. Always use tools when the user asks about products, customers, interactions, or patterns.`;
}

async function callWithTools(
  messages: AiMessage[],
  systemPrompt: string,
  ai: Ai,
  includeTools: boolean
): Promise<AiRunResult> {
  const payload = {
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    ...(includeTools ? { tools: TOOLS } : {}),
  };
  const response = await ai.run(
    AI_MODEL as keyof AiModels,
    payload as Parameters<Ai['run']>[1]
  );
  return response as AiRunResult;
}

export async function runAgenticLoop(
  messages: AiMessage[],
  organizationId: string,
  apiGatewayUrl: string,
  ai: Ai
): Promise<string> {
  const systemPrompt = buildSystemPrompt(organizationId);
  const currentMessages = [...messages];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const result = await callWithTools(currentMessages, systemPrompt, ai, true);
    if (!result.tool_calls || result.tool_calls.length === 0)
      return result.response ?? 'I was unable to generate a response.';

    const toolResultParts = await executeToolCalls(
      result.tool_calls,
      organizationId,
      apiGatewayUrl
    );

    currentMessages.push({
      role: 'assistant',
      content:
        result.response ??
        `I'll use tools to help answer: ${result.tool_calls[0].name}`,
    });
    currentMessages.push({
      role: 'user',
      content: `Tool results:\n${toolResultParts.join('\n\n')}\n\nNow please provide a complete answer based on this data.`,
    });
  }

  const finalResult = await callWithTools(
    currentMessages,
    systemPrompt,
    ai,
    false
  );
  return (
    finalResult.response ??
    'I was unable to generate a response after analysis.'
  );
}
