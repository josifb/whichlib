from datetime import date

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Booking(BaseModel):
    model_config = ConfigDict(frozen=True)

    guest_email: str
    check_in: date
    check_out: date
    guests: int = Field(ge=1, le=8)

    @field_validator("guest_email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()

    @model_validator(mode="after")
    def check_dates(self) -> "Booking":
        if self.check_out <= self.check_in:
            raise ValueError("check_out must be after check_in")
        return self


def parse_booking(data: dict) -> Booking:
    return Booking.model_validate(data)
