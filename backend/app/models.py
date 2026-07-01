from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

Direction = Literal["N", "E", "S", "W"]
Size = Literal["small", "medium", "large"]


class Room(BaseModel):
    """A single rectangular room in grid units."""

    model_config = ConfigDict(populate_by_name=True)

    id: int
    x: int
    y: int
    w: int
    h: int
    parent_id: Optional[int] = Field(None, alias="parentId")
    entrance_dir: Optional[Direction] = Field(None, alias="entranceDir")
    depth: int


class GenerateRequest(BaseModel):
    """Request body for POST /api/dungeon/generate."""

    model_config = ConfigDict(populate_by_name=True)

    seed: Optional[str] = None
    size: Size = "medium"
    symmetry_break: int = Field(30, ge=0, le=80, alias="symmetryBreak")


class Corridor(BaseModel):
    """Centerline waypoints of a corridor, from the parent room's wall to the child room's wall."""

    model_config = ConfigDict(populate_by_name=True)

    parent_id: int = Field(alias="parentId")
    child_id: int = Field(alias="childId")
    points: list[list[int]]


class GenerateResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    seed: str
    target: int
    max_depth: int = Field(alias="maxDepth")
    rooms: list[Room]
    corridors: list[Corridor]

