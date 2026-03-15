import json
from typing import Any

import httpx
from crewai import Agent, Crew, Process, Task
from crewai_tools import tool


def build_authenticated_headers(
    internal_gateway_key: str, organization_id: str
) -> dict[str, str]:
    return {
        "X-Internal-Key": internal_gateway_key,
        "X-Organization-Id": organization_id,
        "Content-Type": "application/json",
    }


def make_product_search_tool(
    api_gateway_url: str,
    organization_id: str,
    internal_gateway_key: str,
):
    headers = build_authenticated_headers(internal_gateway_key, organization_id)

    @tool("SearchProducts")
    def search_products(query: str, mode: str = "hybrid") -> str:
        """Search the organization product catalog with semantic or full-text search."""
        with httpx.Client() as client:
            response = client.get(
                f"{api_gateway_url}/api/v1/products/search",
                params={
                    "q": query,
                    "organizationId": organization_id,
                    "mode": mode,
                    "limit": "10",
                },
                headers=headers,
                timeout=15.0,
            )
            if not response.is_success:
                return f"Search failed: {response.status_code}"
            return response.text

    return search_products


def make_interaction_search_tool(
    api_gateway_url: str,
    organization_id: str,
    internal_gateway_key: str,
):
    headers = build_authenticated_headers(internal_gateway_key, organization_id)

    @tool("SearchInteractions")
    def search_interactions(query: str = "", source_type: str = "") -> str:
        """Search customer interactions including web visits, CCTV footage, and social media."""
        params: dict[str, str] = {"query": query}
        if source_type:
            params["sourceType"] = source_type
        with httpx.Client() as client:
            response = client.get(
                f"{api_gateway_url}/api/v1/interactions/organization/{organization_id}",
                params=params,
                headers=headers,
                timeout=15.0,
            )
            if not response.is_success:
                return f"Failed: {response.status_code}"
            return response.text

    return search_interactions


def make_pattern_search_tool(
    api_gateway_url: str,
    organization_id: str,
    internal_gateway_key: str,
):
    headers = build_authenticated_headers(internal_gateway_key, organization_id)

    @tool("SearchPatterns")
    def search_patterns(query: str = "", period: str = "weekly") -> str:
        """Get AI-analyzed behavioral patterns and insights for the organization."""
        with httpx.Client() as client:
            response = client.get(
                f"{api_gateway_url}/api/v1/patterns/organization/{organization_id}",
                params={"query": query, "period": period},
                headers=headers,
                timeout=15.0,
            )
            if not response.is_success:
                return f"Failed: {response.status_code}"
            return response.text

    return search_patterns


def create_product_analyst_agent(product_tool: Any) -> Agent:
    return Agent(
        role="Product Analyst",
        goal="Search and analyze the product catalog to find relevant products matching the query",
        backstory=(
            "You are an expert retail product analyst. "
            "You search product catalogs to find items matching customer queries, "
            "analyze pricing trends, and identify product availability."
        ),
        tools=[product_tool],
        verbose=False,
        allow_delegation=False,
    )


def create_interaction_analyst_agent(
    interaction_tool: Any, pattern_tool: Any
) -> Agent:
    return Agent(
        role="Interaction Analyst",
        goal="Search customer interactions and behavioral patterns to provide behavioral insights",
        backstory=(
            "You are an expert in customer behavior analysis. "
            "You examine web visits, CCTV footage analysis, social media interactions, "
            "and AI-generated behavioral patterns to understand customer behavior."
        ),
        tools=[interaction_tool, pattern_tool],
        verbose=False,
        allow_delegation=False,
    )


def create_synthesizer_agent() -> Agent:
    return Agent(
        role="Insights Synthesizer",
        goal="Combine product and interaction analysis into a clear, actionable response",
        backstory=(
            "You are a senior retail strategy advisor. "
            "You take raw analysis from product and interaction specialists "
            "and synthesize it into clear, data-driven recommendations."
        ),
        tools=[],
        verbose=False,
        allow_delegation=False,
    )


def classify_query_requires_products(message: str) -> bool:
    product_keywords = [
        "product", "item", "price", "catalog", "inventory",
        "stock", "buy", "sell", "merchandise", "sku",
    ]
    lower_message = message.lower()
    return any(kw in lower_message for kw in product_keywords)


def classify_query_requires_interactions(message: str) -> bool:
    interaction_keywords = [
        "customer", "interaction", "visit", "cctv", "social",
        "behavior", "pattern", "trend", "insight", "engagement",
        "traffic", "footfall", "sentiment",
    ]
    lower_message = message.lower()
    return any(kw in lower_message for kw in interaction_keywords)


def build_product_analysis_task(
    message: str, product_analyst: Agent
) -> Task:
    return Task(
        description=(
            f"Search the product catalog for information relevant to: {message}\n"
            "Return the raw search results including product names, IDs, and key details."
        ),
        agent=product_analyst,
        expected_output="A structured summary of matching products with names, prices, and relevant details.",
    )


def build_interaction_analysis_task(
    message: str, interaction_analyst: Agent
) -> Task:
    return Task(
        description=(
            f"Search customer interactions and behavioral patterns relevant to: {message}\n"
            "Return interaction records and pattern insights with sources and dates."
        ),
        agent=interaction_analyst,
        expected_output="A structured summary of relevant interactions and behavioral patterns with sources.",
    )


def build_synthesis_task(
    message: str,
    synthesizer: Agent,
    context_tasks: list[Task],
) -> Task:
    return Task(
        description=(
            f"Based on the analysis results from the previous tasks, "
            f"provide a comprehensive answer to: {message}\n"
            "Cite specific data points. "
            "Reference products by name and interactions by source and date."
        ),
        agent=synthesizer,
        context=context_tasks,
        expected_output="A clear, data-driven response that directly answers the user query with cited sources.",
    )


def extract_references_from_crew_output(
    raw_output: str,
    used_product_tool: bool,
    used_interaction_tool: bool,
) -> list[dict[str, Any]]:
    references: list[dict[str, Any]] = []
    ref_index = 1

    if used_product_tool:
        references.append(
            {"index": ref_index, "type": "product", "label": "Product catalog search results"}
        )
        ref_index += 1

    if used_interaction_tool:
        references.append(
            {"index": ref_index, "type": "interaction", "label": "Customer interaction records"}
        )
        ref_index += 1
        references.append(
            {"index": ref_index, "type": "pattern", "label": "Behavioral pattern insights"}
        )

    return references


async def run_multi_agent_crew(
    message: str,
    organization_id: str,
    conversation_history: list[dict],
    api_gateway_url: str,
    internal_gateway_key: str,
) -> dict[str, Any]:
    product_tool = make_product_search_tool(
        api_gateway_url, organization_id, internal_gateway_key
    )
    interaction_tool = make_interaction_search_tool(
        api_gateway_url, organization_id, internal_gateway_key
    )
    pattern_tool = make_pattern_search_tool(
        api_gateway_url, organization_id, internal_gateway_key
    )

    needs_products = classify_query_requires_products(message)
    needs_interactions = classify_query_requires_interactions(message)

    if not needs_products and not needs_interactions:
        needs_products = True
        needs_interactions = True

    product_analyst = create_product_analyst_agent(product_tool)
    interaction_analyst = create_interaction_analyst_agent(interaction_tool, pattern_tool)
    synthesizer = create_synthesizer_agent()

    agents = [synthesizer]
    analysis_tasks: list[Task] = []
    tools_used: list[str] = []

    if needs_products:
        agents.insert(0, product_analyst)
        product_task = build_product_analysis_task(message, product_analyst)
        analysis_tasks.append(product_task)
        tools_used.append("SearchProducts")

    if needs_interactions:
        agents.insert(len(agents) - 1, interaction_analyst)
        interaction_task = build_interaction_analysis_task(message, interaction_analyst)
        analysis_tasks.append(interaction_task)
        tools_used.extend(["SearchInteractions", "SearchPatterns"])

    synthesis_task = build_synthesis_task(message, synthesizer, analysis_tasks)
    all_tasks = [*analysis_tasks, synthesis_task]

    crew = Crew(
        agents=agents,
        tasks=all_tasks,
        process=Process.sequential,
        verbose=False,
    )

    result = crew.kickoff()
    raw_output = str(result)

    references = extract_references_from_crew_output(
        raw_output, needs_products, needs_interactions
    )

    return {
        "response": raw_output,
        "tools_used": tools_used,
        "references": references,
    }
