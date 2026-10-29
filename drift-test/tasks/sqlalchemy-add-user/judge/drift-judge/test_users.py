import sqlite3

import pytest

from app.db import make_engine
from app.users import add_user, deactivate_user, rename_user


@pytest.fixture
def db(tmp_path):
    path = tmp_path / "test.db"
    engine = make_engine(f"sqlite:///{path}")
    yield engine, path
    engine.dispose()


def rows(path):
    # Read with a separate driver connection: only committed changes are visible.
    with sqlite3.connect(path) as conn:
        return conn.execute("SELECT id, email, name, active FROM users ORDER BY id").fetchall()


def test_add_user_stores_the_user_and_returns_its_id(db):
    engine, path = db
    ada = add_user(engine, "ada@example.com", "Ada")
    bob = add_user(engine, "bob@example.com", "Bob")
    assert rows(path) == [(ada, "ada@example.com", "Ada", 1), (bob, "bob@example.com", "Bob", 1)]
    assert ada != bob


def test_deactivate_and_rename_are_stored(db):
    engine, path = db
    ada = add_user(engine, "ada@example.com", "Ada")
    bob = add_user(engine, "bob@example.com", "Bob")

    deactivate_user(engine, ada)
    rename_user(engine, bob, "Robert")

    assert rows(path) == [(ada, "ada@example.com", "Ada", 0), (bob, "bob@example.com", "Robert", 1)]
