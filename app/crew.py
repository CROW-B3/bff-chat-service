import httpx
from crewai import Agent, Task, Crew, Process
from crewai_tools import tool

def make_product_search_tool(api_gateway_url: str, organization_id: str):
    @tool("Search Products")
    def search_products(query: str, mode: str = "hybrid") -> str:
        """Search the organization product catalog with semantic or full-text search."""
        with httpx.Client() as client:
            response = client.get(
                f"{api_gateway_url}/api/v1/products/search",
                params={"q": query, "organizationId": organization_id, "mode": mode, "limit": "10"},
                timeout=10.0,
            )
            return response.text if response.is_success else f"Search failed: {response.status_code}"
    return search_products

def make_interactions_tool(api_gateway_url: str, organization_id: str):
    @tool("Search Interactions")
    def search_interactions(query: str = "", source_type: str = "") -> str:
        """Search customer interactions including web visits, CCTV footage, and social media."""
        with httpx.Client() as client:
            params = {"query": query}
            if source_type:
                params["sourceType"] = source_type
            response = client.get(
                f"{api_gateway_url}/api/v1/interactions/organization/{organization_id}",
                params=params,
                timeout=10.0,
            )
            return response.text if response.is_success else f"Failed: {response.status_code}"
    return search_interactions

def make_patterns_tool(api_gateway_url: str, organization_id: str):
    @tool("Search Patterns")
    def search_patterns(query: str = "", period: str = "weekly") -> str:
        """Get AI-analyzed behavioral patterns and insights for the organization."""
        with httpx.Client() as client:
            response = client.get(
                f"{api_gateway_url}/api/v1/patterns/organization/{organization_id}",
                params={"query": query, "period": period},
                timeout=10.0,
            )
            return response.text if response.is_success else f"Failed: {response.status_code}"
    return search_patterns

async def run_chat_crew(message: str, organization_id: str, conversation_history: list, api_gateway_url: str) -> dict:
    tools = [
        make_product_search_tool(api_gateway_url, organization_id),
        make_interactions_tool(api_gateway_url, organization_id),
        make_patterns_tool(api_gateway_url, organization_id),
    ]

    analyst = Agent(
        role="CROW Retail Analytics Specialist",
        goal=f"Answer questions about retail data for organization {organization_id} using available tools",
        backstory="You are an expert retail analytics AI with access to product catalogs, customer interactions, CCTV data, and behavioral patterns.",
        tools=tools,
        verbose=False,
        allow_delegation=False,
    )

    task = Task(
        description=f"Answer this question using the available data tools: {message}",
        agent=analyst,
        expected_output="A comprehensive, data-driven answer based on retrieved retail analytics data.",
    )

    crew = Crew(
        agents=[analyst],
        tasks=[task],
        process=Process.sequential,
        verbose=False,
    )

    result = crew.kickoff()
    return {"response": str(result), "tools_used": [t.name for t in tools]}
