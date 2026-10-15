"""Pydantic wire models for value objects.  Auto-generated."""

from typing import Annotated

from pydantic import Field, AfterValidator, BeforeValidator, StringConstraints, WithJsonSchema

UuidStr = Annotated[
    str,
    StringConstraints(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"),
    WithJsonSchema({"type": "string", "format": "uuid"}),
]

def _reject_non_number(value: object) -> object:
    if isinstance(value, (bool, str)):
        raise ValueError("Input should be a valid number")
    return value


WireNum = Annotated[float, BeforeValidator(_reject_non_number)]
WireInt = Annotated[int, BeforeValidator(_reject_non_number)]

Int32 = Annotated[
    int,
    BeforeValidator(_reject_non_number),
    Field(ge=-2147483648, le=2147483647),
    WithJsonSchema({"type": "integer", "format": "int32"}),
]

Int32Param = Annotated[
    int,
    Field(ge=-2147483648, le=2147483647),
    WithJsonSchema({"type": "integer", "format": "int32"}),
]

def _reject_nul(value: str) -> str:
    if "\x00" in value:
        raise ValueError("must not contain a NUL character")
    return value


WireStr = Annotated[str, AfterValidator(_reject_nul)]

