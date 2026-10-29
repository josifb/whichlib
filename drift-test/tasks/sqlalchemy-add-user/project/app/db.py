from sqlalchemy import Boolean, Column, Integer, MetaData, String, Table, create_engine

metadata = MetaData()

users = Table(
    "users",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("email", String, nullable=False, unique=True),
    Column("name", String, nullable=False),
    Column("active", Boolean, nullable=False, default=True),
)


def make_engine(url: str = "sqlite:///app.db"):
    engine = create_engine(url)
    metadata.create_all(engine)
    return engine
