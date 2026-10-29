from sqlalchemy import insert, update

from app.db import users


def add_user(engine, email: str, name: str) -> int:
    with engine.begin() as conn:
        result = conn.execute(insert(users).values(email=email, name=name, active=True))
        return result.inserted_primary_key[0]


def deactivate_user(engine, user_id: int) -> None:
    with engine.begin() as conn:
        conn.execute(update(users).where(users.c.id == user_id).values(active=False))


def rename_user(engine, user_id: int, name: str) -> None:
    with engine.begin() as conn:
        conn.execute(update(users).where(users.c.id == user_id).values(name=name))
