from decimal import Decimal
from typing import List

from pydantic import BaseModel, condecimal, constr

Sku = constr(regex=r"^[A-Z]{3}-\d{4}$")


class Product(BaseModel):
    sku: Sku
    name: str
    price: condecimal(gt=0)


class Catalog(BaseModel):
    __root__: List[Product]


def load_catalog(json_text: str) -> Catalog:
    return Catalog.parse_raw(json_text)


def dump_catalog(catalog: Catalog) -> str:
    return catalog.json()
