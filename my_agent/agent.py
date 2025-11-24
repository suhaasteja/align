import os
from pathlib import Path
import asyncio
import nest_asyncio
import datetime
from langchain_tavily import TavilySearch
from dotenv import load_dotenv
from google.adk.agents.llm_agent import Agent
from google.adk.tools.langchain_tool import LangchainTool
from langchain_core.tools import tool
from google.adk.tools.google_api_tool import CalendarToolset
from google.adk.tools.mcp_tool import McpToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StdioConnectionParams
from mcp import StdioServerParameters

load_dotenv()

client_id = os.getenv("GOOGLE_OAUTH_CLIENT_ID")
client_secret = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET")
canvas_api_token = os.getenv("CANVAS_API_TOKEN")
canvas_domain = os.getenv("CANVAS_DOMAIN")

if not client_id or not client_secret:
    raise RuntimeError(
        "Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET in the environment/.env"
    )

if not canvas_api_token or not canvas_domain:
    raise RuntimeError(
        "Missing CANVAS_API_TOKEN or CANVAS_DOMAIN in the environment/.env"
    )


nest_asyncio.apply()

today = datetime.datetime.now().strftime("%Y-%m-%d")

@tool
def web_search(query: str) -> str:
    """ 
    Used to perform web-search and fetch additional information

    Args:
        query: The search query to make web-search

    """
    tavily_search = TavilySearch(max_results=1, topic= "general")
    tool_response = tavily_search.invoke(query)
    return tool_response

web_search = LangchainTool(web_search)


# Initialize Google Calendar tools
calendar_toolset = CalendarToolset(
    client_id=client_id,
    client_secret=client_secret)

calendar_tools = asyncio.run(calendar_toolset.get_tools())

# Filter to essential calendar tools only
calendar_tools = [
    t for t in calendar_tools
    if t.name in [
        "calendar_events_list",
        "calendar_events_get",
        "calendar_events_insert",
        "calendar_events_update",
        "calendar_events_delete",
        "calendar_calendar_list_list"
    ]
]


# Initialize Canvas MCP client
canvas_mcp_client = McpToolset(
    connection_params=StdioConnectionParams(
        server_params=StdioServerParameters(
            command="npx",
            args=["-y", "canvas-mcp-server"],
            env={
                "CANVAS_API_TOKEN": canvas_api_token,
                "CANVAS_DOMAIN": canvas_domain,
                "PATH": os.environ["PATH"] # Ensure npx can be found
            }
        )
    ),
    tool_filter=[
        "canvas_list_courses",
        "canvas_list_assignments",
        "canvas_get_assignment",
        "canvas_get_upcoming_assignments",
        "canvas_get_user_grades",
        "canvas_get_syllabus"
    ]
)



# {
#   "mcpServers": {
#     "google-maps-platform-code-assist": {
#       "command": "npx",
#       "args": ["-y", "@googlemaps/code-assist-mcp@latest"]
#     }
#   }
# }

maps_mcp_client = McpToolset(
    connection_params=StdioConnectionParams(
        server_params=StdioServerParameters(
            command="npx",
            args=["-y", "@googlemaps/code-assist-mcp@latest"],
            env={
                "PATH": os.environ["PATH"] # Ensure npx can be found
            }
        )
    ),
    tool_filter=[
        "maps_list_locations"
    ]
)

# Combine all tools
# Note: McpToolset is passed as a single item, Calendar tools are a list
all_tools = [canvas_mcp_client, maps_mcp_client, web_search] + calendar_tools

root_agent = Agent(
    model='gemini-2.5-flash',
    name='root_agent',
    description=f"A helpful assistant that can manage your Google Calendar, Google Maps, and Canvas LMS. Today is {today}.",
    instruction="You are a helpful assistant that can help users manage their Google Calendar, Google Maps, and Canvas LMS. You can create, read, update, and delete calendar events, as well as manage courses, assignments, enrollments, and grades in Canvas. When scheduling a Google Meet or video conference, ensure you set the 'conferenceDataVersion' parameter to 1 and include 'conferenceData': {'createRequest': {'requestId': '<unique_string>', 'conferenceSolutionKey': {'type': 'hangoutsMeet'}}} in the event body.",
    tools=all_tools,
)


# connect with calendar - done
# pdf parser
# canvas lms mcp - done
# jinzcdev/markmap-mcp-server 📇 🏠 - An MCP server built on markmap that converts Markdown to interactive mind maps. Supports multi-format exports (PNG/JPG/SVG), live browser preview, one-click Markdown copy, and dynamic visualization features.
