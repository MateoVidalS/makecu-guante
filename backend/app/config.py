from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=Path(__file__).parents[1] / ".env", extra="ignore")
    gemini_api_key: str = ""
    gemini_live_model: str = "gemini-3.8-live"
    gemini_live_thinking_level: str = "medium"
    gemini_live_voice: str = "Puck"
    gemini_text_model: str = "gemini-4-argon"
    gemini_text_fallback_models: str = "gemini-3.8-flash,gemini-3.5-flash,gemini-3.5-flash-lite"
    # Longest wait for one summary model before trying the next (the last one gets what is left).
    gemini_text_attempt_timeout_s: float = 20
    rehab_db_path: str = "data/rehab.db"
    rehab_port: int = 8000


settings = Settings()
