import json
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.catalog import Catalog, dump_catalog, load_catalog

PRODUCTS = [
    {"sku": "TEE-0001", "name": "T-shirt", "price": "19.90"},
    {"sku": "MUG-0420", "name": "Mug", "price": "8"},
]


def test_round_trips_a_plain_json_array():
    catalog = load_catalog(json.dumps(PRODUCTS))
    assert isinstance(catalog, Catalog)

    dumped = json.loads(dump_catalog(catalog))

    assert isinstance(dumped, list)
    assert [(p["sku"], p["name"], Decimal(str(p["price"]))) for p in dumped] == [
        ("TEE-0001", "T-shirt", Decimal("19.90")),
        ("MUG-0420", "Mug", Decimal("8")),
    ]


def test_an_object_is_not_a_catalog():
    with pytest.raises(ValidationError):
        load_catalog(json.dumps({"products": PRODUCTS}))


@pytest.mark.parametrize("sku", ["tee-0001", "TEE-001", "TEES-0001", "TEE0001", " TEE-0001"])
def test_sku_format(sku):
    with pytest.raises(ValidationError):
        load_catalog(json.dumps([{**PRODUCTS[0], "sku": sku}]))


@pytest.mark.parametrize("price", ["0", "-1.50"])
def test_price_must_be_positive(price):
    with pytest.raises(ValidationError):
        load_catalog(json.dumps([{**PRODUCTS[0], "price": price}]))
