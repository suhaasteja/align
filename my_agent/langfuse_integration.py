"""
Langfuse observability integration for the Align agent.
"""
import os
import logging
from typing import Optional
from langfuse import get_client, propagate_attributes
from openinference.instrumentation.google_adk import GoogleADKInstrumentor

logger = logging.getLogger(__name__)


class LangfuseObservability:
    """Manages Langfuse observability for the Align agent."""
    
    def __init__(self):
        self.client: Optional[object] = None
        self.instrumentor: Optional[GoogleADKInstrumentor] = None
        self.enabled = False
        
    def initialize(self) -> bool:
        """
        Initialize Langfuse client and instrumentation.
        Returns True if successful, False otherwise.
        """
        # Check if Langfuse credentials are available
        public_key = os.getenv("LANGFUSE_PUBLIC_KEY")
        secret_key = os.getenv("LANGFUSE_SECRET_KEY")
        base_url = os.getenv("LANGFUSE_BASE_URL", "https://cloud.langfuse.com")
        
        if not public_key or not secret_key:
            logger.info("Langfuse credentials not found. Observability disabled.")
            return False
        
        try:
            # Initialize Langfuse client
            self.client = get_client()
            
            # Verify authentication
            if not self.client.auth_check():
                logger.error("Langfuse authentication failed. Please check your credentials.")
                return False
            
            logger.info("✅ Langfuse client authenticated successfully!")
            
            # Initialize OpenTelemetry instrumentation for Google ADK
            self.instrumentor = GoogleADKInstrumentor()
            self.instrumentor.instrument()
            
            logger.info("✅ Google ADK instrumentation enabled!")
            
            self.enabled = True
            return True
            
        except Exception as e:
            logger.error(f"Failed to initialize Langfuse: {e}")
            return False
    
    def add_trace_attributes(
        self,
        user_id: Optional[str] = None,
        session_id: Optional[str] = None,
        tags: Optional[list] = None,
        metadata: Optional[dict] = None,
        version: Optional[str] = None
    ):
        """
        Add attributes to the current trace context.
        This should be called within the execution scope of your agent.
        """
        if not self.enabled:
            return
        
        return propagate_attributes(
            user_id=user_id,
            session_id=session_id,
            tags=tags or [],
            metadata=metadata or {},
            version=version
        )
    
    def update_trace(self, input_data=None, output_data=None):
        """Update the current trace with input/output data."""
        if not self.enabled or not self.client:
            return
        
        try:
            self.client.update_current_trace(
                input=input_data,
                output=output_data
            )
        except Exception as e:
            logger.warning(f"Failed to update trace: {e}")
    
    def flush(self):
        """Flush any pending events to Langfuse."""
        if self.enabled and self.client:
            try:
                self.client.flush()
            except Exception as e:
                logger.warning(f"Failed to flush Langfuse events: {e}")
    
    def shutdown(self):
        """Cleanup and shutdown Langfuse instrumentation."""
        if self.instrumentor:
            try:
                self.instrumentor.uninstrument()
                logger.info("Langfuse instrumentation stopped.")
            except Exception as e:
                logger.warning(f"Error during Langfuse shutdown: {e}")
        
        self.flush()


# Global Langfuse observability instance
langfuse_observability = LangfuseObservability()
