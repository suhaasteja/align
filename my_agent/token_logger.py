"""
Token usage logging utilities for the Align agent.
"""
import logging
from typing import Any, Dict
from google.adk.agents.llm_agent import Agent

logger = logging.getLogger(__name__)


class TokenLogger:
    """Logs token consumption for each agent query."""
    
    def __init__(self):
        self.total_input_tokens = 0
        self.total_output_tokens = 0
        self.total_cached_tokens = 0
        self.query_count = 0
    
    def log_usage(self, usage_metadata: Any, query: str = ""):
        """Log token usage for a single query."""
        self.query_count += 1
        
        # Extract token counts from usage metadata (Pydantic object)
        prompt_tokens = getattr(usage_metadata, 'prompt_token_count', 0)
        candidates_tokens = getattr(usage_metadata, 'candidates_token_count', 0)
        cached_tokens = getattr(usage_metadata, 'cached_content_token_count', 0)
        
        # Update totals
        self.total_input_tokens += prompt_tokens
        self.total_output_tokens += candidates_tokens
        self.total_cached_tokens += cached_tokens
        
        # Calculate cost (approximate, based on Gemini 2.5 Flash pricing)
        # Input: $0.075 per 1M tokens, Output: $0.30 per 1M tokens
        # Cached: $0.01875 per 1M tokens (75% discount)
        input_cost = (prompt_tokens / 1_000_000) * 0.075
        output_cost = (candidates_tokens / 1_000_000) * 0.30
        cached_cost = (cached_tokens / 1_000_000) * 0.01875
        total_cost = input_cost + output_cost + cached_cost
        
        # Log the usage
        logger.info("=" * 80)
        logger.info(f"Query #{self.query_count}: {query[:50]}..." if query else f"Query #{self.query_count}")
        logger.info("-" * 80)
        logger.info(f"📥 Input tokens:    {prompt_tokens:,}")
        logger.info(f"📤 Output tokens:   {candidates_tokens:,}")
        if cached_tokens > 0:
            logger.info(f"💾 Cached tokens:   {cached_tokens:,} (75% discount!)")
        logger.info(f"💰 Query cost:      ${total_cost:.6f}")
        logger.info("-" * 80)
        logger.info(f"📊 Session totals:")
        logger.info(f"   Total input:     {self.total_input_tokens:,}")
        logger.info(f"   Total output:    {self.total_output_tokens:,}")
        logger.info(f"   Total cached:    {self.total_cached_tokens:,}")
        logger.info(f"   Total cost:      ${self._calculate_total_cost():.6f}")
        logger.info("=" * 80)
    
    def _calculate_total_cost(self) -> float:
        """Calculate total cost for the session."""
        input_cost = (self.total_input_tokens / 1_000_000) * 0.075
        output_cost = (self.total_output_tokens / 1_000_000) * 0.30
        cached_cost = (self.total_cached_tokens / 1_000_000) * 0.01875
        return input_cost + output_cost + cached_cost
    
    def get_summary(self) -> str:
        """Get a summary of token usage."""
        return (
            f"Total queries: {self.query_count} | "
            f"Input: {self.total_input_tokens:,} | "
            f"Output: {self.total_output_tokens:,} | "
            f"Cached: {self.total_cached_tokens:,} | "
            f"Cost: ${self._calculate_total_cost():.6f}"
        )


# Global token logger instance
token_logger = TokenLogger()
