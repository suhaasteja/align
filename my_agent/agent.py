import os
from pathlib import Path

from dotenv import load_dotenv
from google.adk.agents.llm_agent import Agent
from google.adk.tools.google_api_tool import CalendarToolset

load_dotenv()

client_id = os.getenv("GOOGLE_OAUTH_CLIENT_ID")
client_secret = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET")

if not client_id or not client_secret:
    raise RuntimeError(
        "Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET in the environment/.env"
    )

import asyncio
import nest_asyncio

nest_asyncio.apply()

calendar_toolset = CalendarToolset(
    client_id=client_id,
    client_secret=client_secret
)

calendar_tools = asyncio.run(calendar_toolset.get_tools())

root_agent = Agent(
    model='gemini-2.5-flash',
    name='root_agent',
    description="A helpful assistant that can manage your Google Calendar.",
    instruction="You are a helpful assistant that can help users manage their Google Calendar. You can create, read, update, and delete calendar events.",
    tools=calendar_tools,
)