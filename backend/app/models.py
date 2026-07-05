from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

Direction = Literal["N", "E", "S", "W"]
Size = Literal["small", "medium", "large"]
Shape = Literal["rect", "circle", "octagon"]
LLMProvider = Literal["local", "api"]
DoorState = Literal["open", "closed"]
DoorMaterial = Literal["wood", "iron", "stone", "bone", "arcane"]
DoorLock = Literal["none", "locked",  "sealed", "magicSealed", "puzzleSealed"]

class Door(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    parent_id: int = Field(alias="parentId")
    child_id: int = Field(alias="childId")
    room_id: int = Field(alias="roomId")
    other_room_id: int = Field(alias="otherRoomId")
    state: DoorState = "open"
    material: DoorMaterial = "wood"
    lock: DoorLock = "none"
    reason: str = ""

class Room(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: int
    x: int
    y: int
    w: int
    h: int
    parent_id: Optional[int] = Field(None, alias="parentId")
    entrance_dir: Optional[Direction] = Field(None, alias="entranceDir")
    depth: int
    shape: Shape = "rect"
    accent: bool = False

class Opening(BaseModel):
    """A wall opening to the outside world -- the dungeon's entrance or exit."""

    model_config = ConfigDict(populate_by_name=True)

    room_id: int = Field(alias="roomId")
    direction: Direction

class Corridor(BaseModel):
    """Centerline waypoints of a corridor, from the parent room's wall to the child room's wall."""

    model_config = ConfigDict(populate_by_name=True)

    parent_id: int = Field(alias="parentId")
    child_id: int = Field(alias="childId")
    points: list[list[float]]
    branches_from_corridor: bool = Field(False, alias="branchesFromCorridor")

class GenerateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    seed: Optional[str] = None
    size: Size = "medium"
    symmetry_break: int = Field(30, ge=0, le=80, alias="symmetryBreak")
    rect_pct: int = Field(60, ge=0, le=100, alias="rectPct")
    circle_pct: int = Field(20, ge=0, le=100, alias="circlePct")
    octagon_pct: int = Field(20, ge=0, le=100, alias="octagonPct")
    accent_pct: int = Field(15, ge=0, le=100, alias="accentPct")
    llm_provider: LLMProvider = Field("local", alias="llmProvider")
    closed_door_pct: int = Field(45, ge=0, le=100, alias="closedDoorPct")


class GenerateResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    seed: str
    target: int
    max_depth: int = Field(alias="maxDepth")
    rooms: list[Room]
    corridors: list[Corridor]
    entrance: Opening
    exit: Opening
    doors: list[Door] = Field(default_factory=list)

