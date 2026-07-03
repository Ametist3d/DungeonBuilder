# app/narrative/llm.py
from __future__ import annotations

import json

from anthropic import Anthropic
from pydantic import BaseModel, Field

client = Anthropic()

SYSTEM_PROMPT = """You are writing content for a fantasy tabletop dungeon crawl.
You'll receive a JSON description of the dungeon's room graph: shapes, sizes,
depth from the entrance, and how rooms connect (tree corridors, loop-closing
corridors, and branches off other corridors). Use the topology to guide tone:
hub rooms (3+ connections) work well as junctions or social spaces; dead ends
suit secrets, treasure, or a final confrontation; rooms on the main path are
what most parties will see, branch rooms are optional detours. Keep each
room description to 1-3 sentences of evocative, GM-readable boxed text."""


class RoomNarrative(BaseModel):
    id: int
    label: str = Field(description="3-5 word room name, e.g. 'Flooded Cistern'")
    description: str = Field(description="1-3 sentence read-aloud description")


class DungeonNarrative(BaseModel):
    title: str
    premise: str = Field(description="2-4 sentence dungeon hook/backstory")
    rooms: list[RoomNarrative]


def generate_narrative(context: dict) -> DungeonNarrative:
    response = client.messages.parse(
        model="claude-sonnet-5",
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": json.dumps(context)}],
        output_format=DungeonNarrative,
    )
    result = response.parsed_output

    # structured outputs guarantees the *shape*, not that every id we sent
    # comes back -- backfill anything missing so the UI never has a hole
    returned_ids = {r.id for r in result.rooms}
    missing = [r["id"] for r in context["rooms"] if r["id"] not in returned_ids]
    if missing:
        result.rooms.extend(
            RoomNarrative(id=rid, label="Unnamed Chamber", description="") for rid in missing
        )
    return result
