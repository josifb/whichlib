from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, Field, RootModel

Sku = Annotated[str, Field(pattern=r"^[A-Z]{3}-\d{4}$")]


class Product(BaseModel):
    sku: Sku
    name: str
    price: Decimal = Field(gt=0)


class Catalog(RootModel[list[Product]]):
    pass


def load_catalog(json_text: str) -> Catalog:
    return Catalog.model_validate_json(json_text)


def dump_catalog(catalog: Catalog) -> str:
    return catalog.model_dump_json()
