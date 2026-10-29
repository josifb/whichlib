import pytest
from sqlalchemy import insert

from app.db import make_engine, users
from app.reports import active_emails, count_active_users


@pytest.fixture
def engine(tmp_path):
    engine = make_engine(f"sqlite:///{tmp_path / 'test.db'}")
    with engine.begin() as conn:
        conn.execute(
            insert(users),
            [
                {"email": "ada@example.com", "country": "UK", "active": True},
                {"email": "bob@example.com", "country": "UK", "active": False},
                {"email": "cleo@example.com", "country": "FR", "active": True},
                {"email": "abe@example.com", "country": "UK", "active": True},
            ],
        )
    yield engine
    engine.dispose()


def test_counts_active_users_per_country(engine):
    assert count_active_users(engine, "UK") == 2
    assert count_active_users(engine, "FR") == 1
    assert count_active_users(engine, "DE") == 0


def test_lists_active_emails_in_order(engine):
    assert active_emails(engine) == ["abe@example.com", "ada@example.com", "cleo@example.com"]
