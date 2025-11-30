"""
Custom agent wrapper that logs token usage.
"""
from google.adk.agents.llm_agent import Agent
from .token_logger import token_logger
import logging

logger = logging.getLogger(__name__)


class TokenLoggingAgent(Agent):
    """Agent wrapper that logs token consumption for each query."""
    
    async def run_async(self, *args, **kwargs):
        """Override run_async to log token usage."""
        # Get the user query if available
        query = ""
        if args and len(args) > 0:
            query = str(args[0])
        
        # Run the agent
        async for event in super().run_async(*args, **kwargs):
            # Check if this is the final response with usage metadata
            if hasattr(event, 'usage_metadata') and event.usage_metadata:
                token_logger.log_usage(event.usage_metadata, query)
            
            yield event
