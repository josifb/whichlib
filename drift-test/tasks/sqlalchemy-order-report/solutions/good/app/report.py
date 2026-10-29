from sqlalchemy import func, select

from app.db import customers, orders


def orders_per_customer(engine) -> list[tuple[str, int]]:
    count = func.count(orders.c.id)
    stmt = (
        select(customers.c.name, count)
        .select_from(customers.outerjoin(orders))
        .group_by(customers.c.id, customers.c.name)
        .order_by(count.desc(), customers.c.name)
    )
    with engine.connect() as conn:
        return [(name, n) for name, n in conn.execute(stmt)]


def big_spenders(engine, minimum) -> list[str]:
    stmt = (
        select(customers.c.name)
        .join(orders)
        .group_by(customers.c.id, customers.c.name)
        .having(func.sum(orders.c.total) > minimum)
        .order_by(customers.c.name)
    )
    with engine.connect() as conn:
        return list(conn.execute(stmt).scalars())
