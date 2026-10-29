from datetime import date

import pytest
from pydantic import ValidationError

from app.booking import Booking, parse_booking

VALID = {"guest_email": "  Ada@Example.COM ", "check_in": "2026-11-02", "check_out": "2026-11-05", "guests": 2}


def test_parses_and_normalizes_a_booking():
    booking = parse_booking(VALID)
    assert isinstance(booking, Booking)
    assert booking.guest_email == "ada@example.com"
    assert booking.check_in == date(2026, 11, 2)
    assert booking.check_out == date(2026, 11, 5)
    assert booking.guests == 2


def test_check_out_must_be_after_check_in():
    for check_out in ["2026-11-02", "2026-11-01"]:
        with pytest.raises(ValidationError, match="check_out must be after check_in"):
            parse_booking({**VALID, "check_out": check_out})


@pytest.mark.parametrize("guests", [0, 9])
def test_guests_between_one_and_eight(guests):
    with pytest.raises(ValidationError):
        parse_booking({**VALID, "guests": guests})


def test_bookings_are_immutable():
    booking = parse_booking(VALID)
    with pytest.raises((TypeError, ValueError)):
        booking.guests = 3
    assert booking.guests == 2
