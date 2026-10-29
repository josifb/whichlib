import pytest
from pydantic import ValidationError

from app.settings import Settings, get_settings


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in ["APP_DATABASE_URL", "APP_DEBUG", "APP_ALLOWED_HOSTS", "APP_REQUEST_TIMEOUT"]:
        monkeypatch.delenv(name, raising=False)


def test_reads_prefixed_variables(monkeypatch):
    monkeypatch.setenv("APP_DATABASE_URL", "postgresql://db/app")
    monkeypatch.setenv("APP_DEBUG", "true")
    monkeypatch.setenv("APP_ALLOWED_HOSTS", '["a.com", "b.com"]')
    monkeypatch.setenv("APP_REQUEST_TIMEOUT", "2.5")

    settings = get_settings()

    assert isinstance(settings, Settings)
    assert settings.database_url == "postgresql://db/app"
    assert settings.debug is True
    assert settings.allowed_hosts == ["a.com", "b.com"]
    assert settings.request_timeout == 2.5


def test_defaults(monkeypatch):
    monkeypatch.setenv("APP_DATABASE_URL", "sqlite:///app.db")
    settings = get_settings()
    assert settings.debug is False
    assert settings.allowed_hosts == []
    assert settings.request_timeout == 10.0


def test_ignores_unprefixed_variables(monkeypatch):
    monkeypatch.setenv("APP_DATABASE_URL", "sqlite:///app.db")
    monkeypatch.setenv("DEBUG", "true")
    assert get_settings().debug is False


def test_database_url_is_required():
    with pytest.raises(ValidationError):
        get_settings()
