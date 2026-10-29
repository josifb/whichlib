from datetime import date

from pydantic import BaseModel, conint, root_validator, validator


class Booking(BaseModel):
    guest_email: str
    check_in: date
    check_out: date
    guests: conint(ge=1, le=8)

    class Config:
        allow_mutation = False

    @validator("guest_email")
    def normalize_email(cls, value):
        return value.strip().lower()

    @root_validator
    def check_dates(cls, values):
        check_in, check_out = values.get("check_in"), values.get("check_out")
        if check_in and check_out and check_out <= check_in:
            raise ValueError("check_out must be after check_in")
        return values


def parse_booking(data: dict) -> Booking:
    return Booking.parse_obj(data)
