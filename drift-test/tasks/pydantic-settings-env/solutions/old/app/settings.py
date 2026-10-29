from typing import List

from pydantic import BaseSettings


class Settings(BaseSettings):
    database_url: str
    debug: bool = False
    allowed_hosts: List[str] = []
    request_timeout: float = 10.0

    class Config:
        env_prefix = "APP_"


def get_settings() -> Settings:
    return Settings()
