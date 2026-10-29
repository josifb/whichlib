from decimal import Decimal

import pytest
from sqlalchemy import insert

from app.db import customers, make_engine, orders
from app.report import big_spenders, orders_per_customer


@pytest.fixture
def engine(tmp_path):
    engine = make_engine(f"sqlite:///{tmp_path / 'test.db'}")
    with engine.begin() as conn:
        conn.execute(insert(customers), [{"id": 1, "name": "Cleo"}, {"id": 2, "name": "Ada"}, {"id": 3, "name": "Bob"}, {"id": 4, "name": "Dan"}])
        conn.execute(
            insert(orders),
            [
                {"customer_id": 1, "total": Decimal("10.00")},
                {"customer_id": 1, "total": Decimal("15.00")},
                {"customer_id": 2, "total": Decimal("100.00")},
                {"customer_id": 2, "total": Decimal("5.00")},
                {"customer_id": 3, "total": Decimal("30.00")},
            ],
        )
    yield engine
    engine.dispose()


def test_orders_per_customer_includes_customers_without_orders(engine):
    assert orders_per_customer(engine) == [("Ada", 2), ("Cleo", 2), ("Bob", 1), ("Dan", 0)]


def test_big_spenders(engine):
    assert big_spenders(engine, 20) == ["Ada", "Bob", "Cleo"]
    assert big_spenders(engine, 50) == ["Ada"]
