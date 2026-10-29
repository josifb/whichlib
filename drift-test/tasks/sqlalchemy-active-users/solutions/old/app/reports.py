def count_active_users(engine, country: str) -> int:
    with engine.connect() as conn:
        return conn.execute(
            "SELECT count(*) FROM users WHERE active = 1 AND country = :country",
            country=country,
        ).scalar()


def active_emails(engine) -> list[str]:
    return [row.email for row in engine.execute("SELECT email FROM users WHERE active = 1 ORDER BY email")]
