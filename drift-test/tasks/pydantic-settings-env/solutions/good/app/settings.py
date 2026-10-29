from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="APP_")

    database_url: str
    debug: bool = False
    allowed_hosts: list[str] = []
    request_timeout: float = 10.0


def get_settings() -> Settings:
    return Settings()
