from sqlalchemy import Column, ForeignKey, Integer, MetaData, Numeric, String, Table, create_engine

metadata = MetaData()

customers = Table(
    "customers",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("name", String, nullable=False),
)

orders = Table(
    "orders",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("customer_id", ForeignKey("customers.id"), nullable=False),
    Column("total", Numeric(10, 2), nullable=False),
)


def make_engine(url: str = "sqlite:///shop.db"):
    engine = create_engine(url)
    metadata.create_all(engine)
    return engine
