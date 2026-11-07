from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=Path(__file__).parents[1] / ".env", extra="ignore")
    gemini_api_key: str = ""
    gemini_live_model: str = "gemini-live-2.5-flash-preview"
    gemini_live_voice: str = "Puck"
    gemini_text_model: str = "gemini-2.5-flash"
    rehab_db_path: str = "data/rehab.db"
    rehab_port: int = 8000


settings = Settings()
