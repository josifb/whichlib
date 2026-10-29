from sqlalchemy import text


def count_active_users(engine, country: str) -> int:
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT count(*) FROM users WHERE active = 1 AND country = :country"),
            {"country": country},
        ).scalar_one()


def active_emails(engine) -> list[str]:
    with engine.connect() as conn:
        return list(conn.execute(text("SELECT email FROM users WHERE active = 1 ORDER BY email")).scalars())
