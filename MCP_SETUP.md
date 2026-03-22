# CROW Chat Agent - MCP Server Setup

Connect the CROW Analytics Agent to Claude Desktop (or any MCP-compatible client) so you can query your retail data directly from your desktop AI assistant.

## Prerequisites

- Claude Desktop installed
- Access to the CROW dev environment
- A valid `INTERNAL_API_KEY` (set as a Cloudflare secret on the bff-chat-service worker)

## Claude Desktop Configuration

Add the following to your `claude_desktop_config.json`:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "crow-analytics": {
      "url": "https://dev.internal.chat.crowai.dev/a2a/tasks/send",
      "transport": "http",
      "headers": {
        "X-API-Key": "<your-INTERNAL_API_KEY>",
        "Content-Type": "application/json"
      },
      "metadata": {
        "organizationId": "<your-organization-id>"
      }
    }
  }
}
```

Replace `<your-INTERNAL_API_KEY>` with the dev environment's internal API key and `<your-organization-id>` with your CROW organization ID.

## Server URL

| Environment | URL                                    |
| ----------- | -------------------------------------- |
| Dev         | `https://dev.internal.chat.crowai.dev` |
| Local       | `http://localhost:8009`                |
| Production  | `https://internal.chat.crowai.dev`     |

## Available Tools / Skills

The CROW agent exposes the following skills through its A2A interface:

### 1. Product Search (`product-search`)

Search and analyze the product catalog. Find products by name, category, attributes, or any combination.

**Tags:** `retail`, `products`, `search`

### 2. Interaction Analysis (`interaction-analysis`)

Analyze customer interactions across web, CCTV, and social channels. Understand how customers engage with your brand across touchpoints.

**Tags:** `analytics`, `interactions`, `behavioral`

### 3. Pattern Insights (`pattern-insights`)

Get AI-generated behavioral pattern insights. Discover trends in customer behavior, product performance, and business patterns.

**Tags:** `patterns`, `insights`, `trends`

### 4. Organization Context (`org-context`)

Search the organization knowledge base including company overview, products summary, and target market information.

**Tags:** `organization`, `context`, `knowledge`

## Example Queries

Once connected, you can ask questions like:

**Product queries:**

- "Search for blue shirts in our catalog"
- "What products do we have in the electronics category?"
- "Show me products priced above $50"

**Customer interaction queries:**

- "What are the most common customer interactions this week?"
- "Show me recent CCTV interactions at Store #3"
- "How are customers engaging with our social media channels?"

**Pattern and insights queries:**

- "What behavioral patterns have been detected recently?"
- "Are there any trending products based on customer behavior?"
- "What insights can you give me about customer purchasing patterns?"

**Organization context queries:**

- "What is our company's target market?"
- "Give me an overview of our product strategy"
- "What does our organization knowledge base say about our brand positioning?"

## Agent Discovery

The agent publishes a standard A2A agent card at:

```
GET https://dev.internal.chat.crowai.dev/.well-known/agent.json
```

This endpoint requires no authentication and returns the agent's capabilities, skills, and supported input/output modes per the A2A specification.

## Authentication

The A2A endpoint accepts authentication via either:

- **Header:** `X-API-Key: <key>`
- **Header:** `Authorization: Bearer <key>`

The key must match the `INTERNAL_API_KEY` Cloudflare secret configured on the worker.

## Request / Response Format

**Request:**

```json
POST /a2a/tasks/send
{
  "id": "optional-task-id",
  "message": {
    "parts": [
      { "type": "text", "text": "Search for blue shirts in our catalog" }
    ]
  },
  "metadata": {
    "organizationId": "your-org-id"
  }
}
```

**Response:**

```json
{
  "id": "task-id",
  "status": { "state": "completed" },
  "artifacts": [
    {
      "parts": [
        { "type": "text", "text": "I found 3 blue shirts in your catalog..." }
      ],
      "metadata": {
        "references": [
          { "index": 1, "type": "product", "label": "Blue Oxford Shirt" }
        ]
      }
    }
  ]
}
```

## Troubleshooting

- **401 Unauthorized:** Verify your `INTERNAL_API_KEY` is correct and matches the Cloudflare secret.
- **400 Bad Request:** Ensure `metadata.organizationId` is included in every request.
- **No response from agent:** Check that the worker is deployed and the URL is reachable. For local development, run `npm run dev` first.
