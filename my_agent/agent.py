import os
from pathlib import Path
import asyncio
import nest_asyncio
import datetime
import logging
from dotenv import load_dotenv

# Configure logging to see cache info
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
from google.adk.agents.llm_agent import Agent
from google.adk.tools.mcp_tool import McpToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StdioConnectionParams
from mcp import StdioServerParameters
from .instruction import ALIGN_INSTRUCTION
from google.adk.apps.app import App
from google.adk.agents.context_cache_config import ContextCacheConfig
from .logging_agent import TokenLoggingAgent

load_dotenv()

google_oauth_credentials = os.getenv("GOOGLE_OAUTH_CREDENTIALS")
canvas_api_token = os.getenv("CANVAS_API_TOKEN")
canvas_domain = os.getenv("CANVAS_DOMAIN")
coda_api_key = os.getenv("CODA_API_KEY")

exa_api_key = os.getenv("EXA_API_KEY")
tavily_api_key = os.getenv("TAVILY_API_KEY")

if not google_oauth_credentials:
    raise RuntimeError(
        "Missing GOOGLE_OAUTH_CREDENTIALS in the environment/.env"
    )

if not canvas_api_token or not canvas_domain:
    raise RuntimeError(
        "Missing CANVAS_API_TOKEN or CANVAS_DOMAIN in the environment/.env"
    )

if not coda_api_key:
    raise RuntimeError(
        "Missing CODA_API_KEY in the environment/.env"
    )



if not exa_api_key:
    raise RuntimeError(
        "Missing EXA_API_KEY in the environment/.env"
    )

if not tavily_api_key:
    raise RuntimeError(
        "Missing TAVILY_API_KEY in the environment/.env"
    )


nest_asyncio.apply()

today = datetime.datetime.now().strftime("%Y-%m-%d")


# Initialize Google Calendar MCP client
calendar_mcp_client = McpToolset(
    connection_params=StdioConnectionParams(
        server_params=StdioServerParameters(
            command="npx",
            args=["-y", "@cocal/google-calendar-mcp"],
            env={
                "GOOGLE_OAUTH_CREDENTIALS": google_oauth_credentials,
                "PATH": os.environ["PATH"]
            }
        )
    )
)


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



# Initialize Coda MCP client (full document management)
coda_mcp_client = McpToolset(
    connection_params=StdioConnectionParams(
        server_params=StdioServerParameters(
            command="npx",
            args=["-y", "coda-mcp@latest"],
            env={
                "API_KEY": coda_api_key,
                "PATH": os.environ["PATH"]
            }
        ),
        timeout=30,
    )
)



# Initialize Exa MCP client
exa_mcp_client = McpToolset(
    connection_params=StdioConnectionParams(
        server_params=StdioServerParameters(
            command="npx",
            args=["-y", "exa-mcp-server"],
            env={
                "EXA_API_KEY": exa_api_key,
                "PATH": os.environ["PATH"]
            }
        )
    ),
    tool_filter=["web_search_exa", "get_code_context_exa"]
)

# Initialize Tavily MCP client
tavily_mcp_client = McpToolset(
    connection_params=StdioConnectionParams(
        server_params=StdioServerParameters(
            command="npx",
            args=["-y", "tavily-mcp@0.1.3"],
            env={
                "TAVILY_API_KEY": tavily_api_key,
                "PATH": os.environ["PATH"]
            }
        )
    )
)








# Combine all tools
# Note: McpToolset is passed as a single item, Calendar tools are a list
all_tools = [canvas_mcp_client, coda_mcp_client, exa_mcp_client, tavily_mcp_client, calendar_mcp_client]

root_agent = TokenLoggingAgent(
    model='gemini-2.5-flash',
    name='root_agent',
    description=f"A helpful assistant that can manage your Google Calendar, Coda documents, and Canvas LMS. Today is {today}.",
    instruction=ALIGN_INSTRUCTION,
    tools=all_tools,
)

# Create the app with context caching configuration
app = App(
    name='my_agent',  # Must match the directory name
    root_agent=root_agent,
    context_cache_config=ContextCacheConfig(
        min_tokens=2048,    # Minimum tokens to trigger caching
        ttl_seconds=600,    # Store for up to 10 minutes
        cache_intervals=5,  # Refresh after 5 uses
    ),
)



# connect with calendar - done
# pdf parser
# canvas lms mcp - done
# jinzcdev/markmap-mcp-server 📇 🏠 - An MCP server built on markmap that converts Markdown to interactive mind maps. Supports multi-format exports (PNG/JPG/SVG), live browser preview, one-click Markdown copy, and dynamic visualization features.
