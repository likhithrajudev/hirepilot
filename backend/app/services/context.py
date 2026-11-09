"""Who is making the current request. Services deep in the stack (the OpenAI key lookup, for one) read this instead of
threading a user id through every signature. Set by the auth dependency and by the background task runner."""
from contextvars import ContextVar
from typing import Optional

current_user_id: ContextVar[Optional[int]] = ContextVar("current_user_id", default=None)

# What the AI call is for ("tailor", "ats", "review", "apply_kit"); recorded with its cost.
current_purpose: ContextVar[str] = ContextVar("current_purpose", default="ai")
