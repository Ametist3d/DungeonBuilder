# app/narrative/context.py
from __future__ import annotations

from collections import deque

from ..generator.entities import Corridor, Opening, RoomNode, Door

CONTENT_TYPE_ALIASES = {
    # loot
    "loot": "loot", "treasure": "loot", "reward": "loot", "prize": "loot", "stash": "loot",
    "cache": "loot", "chest": "loot", "coffer": "loot", "reliquary": "loot", "valuables": "loot",
    "coins": "loot", "gold": "loot", "gems": "loot", "jewelry": "loot", "magicitem": "loot",
    "item": "loot", "weapon": "loot", "armor": "loot", "potion": "loot", "scroll": "loot",
    "tome": "loot",

    # enemy
    "enemy": "enemy", "foe": "enemy", "monster": "enemy", "creature": "enemy", "beast": "enemy",
    "guardian": "enemy", "guard": "enemy", "sentinel": "enemy", "minion": "enemy", "boss": "enemy",
    "undead": "enemy", "spirit": "enemy", "ghost": "enemy", "demon": "enemy", "fiend": "enemy",
    "cultist": "enemy", "bandit": "enemy", "golem": "enemy", "construct": "enemy", "swarm": "enemy",

    # trap
    "trap": "trap", "snare": "trap", "pitfall": "trap", "pit": "trap", "ambush": "trap",
    "deadfall": "trap", "alarm": "trap", "glyph": "trap", "runetrap": "trap",
    "pressureplate": "trap", "tripwire": "trap", "poisonneedle": "trap",

    # npc
    "npc": "npc", "character": "npc", "nonplayercharacter": "npc", "ally": "npc",
    "prisoner": "npc", "captive": "npc", "survivor": "npc", "merchant": "npc",
    "guide": "npc", "sage": "npc", "hermit": "npc", "acolyte": "npc", "priest": "npc",
    "spiritguide": "npc", "informant": "npc",

    # clue
    "clue": "clue", "hint": "clue", "evidence": "clue", "trace": "clue", "sign": "clue",
    "mark": "clue", "message": "clue", "note": "clue", "letter": "clue", "journal": "clue",
    "diary": "clue", "inscription": "clue", "symbol": "clue", "map": "clue", "prophecy": "clue",
    "vision": "clue", "memory": "clue", "omen": "clue", "trail": "clue",

    # ritual object
    "ritualobject": "ritualObject", "ritual": "ritualObject", "artifact": "ritualObject",
    "artefact": "ritualObject", "relic": "ritualObject", "idol": "ritualObject",
    "altar": "ritualObject", "shrine": "ritualObject", "totem": "ritualObject",
    "sigil": "ritualObject", "seal": "ritualObject", "focus": "ritualObject",
    "orb": "ritualObject", "crystal": "ritualObject", "chalice": "ritualObject",
    "censer": "ritualObject", "mask": "ritualObject", "keystone": "ritualObject",

    # hazard
    "hazard": "hazard", "danger": "hazard", "threat": "hazard", "obstacle": "hazard",
    "fire": "hazard", "flame": "hazard", "lava": "hazard", "acid": "hazard",
    "poison": "hazard", "gas": "hazard", "fumes": "hazard", "mist": "hazard",
    "curse": "hazard", "disease": "hazard", "rot": "hazard", "collapse": "hazard",
    "unstablefloor": "hazard", "fallingrocks": "hazard", "flood": "hazard",
    "darkness": "hazard", "void": "hazard",

    # secret
    "secret": "secret", "trigger": "secret", "key": "secret", "puzzle": "secret",
    "lever": "secret", "switch": "secret", "disenchant scroll": "secret", "bone-key": "secret",
    "hidden lever": "secret", "arcane key": "secret", "stone-key": "secret", "steel-key": "secret",
}

GROQ_JSON_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "dungeon_narrative",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                },
                "premise": {
                    "type": "string",
                },
                "rooms": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {
                                "type": "integer",
                            },
                            "label": {
                                "type": "string",
                            },
                            "mapLabel": {
                                "type": "string",
                            },
                            "description": {
                                "type": "string",
                            },
                            "content": {
                                "type": "array",
                                "minItems": 1,
                                "maxItems": 3,
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "type": {
                                            "type": "string",
                                            "enum": [
                                                "loot",
                                                "enemy",
                                                "trap",
                                                "npc",
                                                "hazard",
                                            ],
                                        },
                                        "quantity": {
                                            "type": "integer",
                                            "minimum": 1,
                                            "maximum": 3,
                                        },
                                        "description": {
                                            "type": "string",
                                        },
                                        "enemyType": {
                                            "anyOf": [
                                                {
                                                    "type": "string",
                                                    "enum": [
                                                        "melee",
                                                        "ranged",
                                                        "mage",
                                                    ],
                                                },
                                                {
                                                    "type": "null",
                                                },
                                            ],
                                        },
                                        "difficulty": {
                                            "anyOf": [
                                                {
                                                    "type": "string",
                                                    "enum": [
                                                        "normal",
                                                        "elite",
                                                        "boss",
                                                    ],
                                                },
                                                {
                                                    "type": "null",
                                                },
                                            ],
                                        },
                                        "hp": {
                                            "anyOf": [
                                                {
                                                    "type": "integer",
                                                    "minimum": 1,
                                                },
                                                {
                                                    "type": "null",
                                                },
                                            ],
                                        },
                                        "loot": {
                                            "type": "array",
                                            "maxItems": 3,
                                            "items": {
                                                "type": "object",
                                                "properties": {
                                                    "name": {
                                                        "type": "string",
                                                    },
                                                    "type": {
                                                        "type": "string",
                                                        "enum": [
                                                            "armor",
                                                            "weapon",
                                                            "treasure",
                                                            "spell",
                                                            "hpPotion",
                                                            "manaPotion",
                                                        ],
                                                    },
                                                    "value": {
                                                        "type": "integer",
                                                        "minimum": 0,
                                                    },
                                                    "description": {
                                                        "type": "string",
                                                    },
                                                },
                                                "required": [
                                                    "name",
                                                    "type",
                                                    "value",
                                                    "description",
                                                ],
                                                "additionalProperties": False,
                                            },
                                        },
                                    },
                                    "required": [
                                        "type",
                                        "quantity",
                                        "description",
                                        "enemyType",
                                        "difficulty",
                                        "hp",
                                        "loot",
                                    ],
                                    "additionalProperties": False,
                                },
                            },
                        },
                        "required": [
                            "id",
                            "label",
                            "mapLabel",
                            "description",
                            "content",
                        ],
                        "additionalProperties": False,
                    },
                },
            },
            "required": [
                "title",
                "premise",
                "rooms",
            ],
            "additionalProperties": False,
        },
    },
}

def _room_size(r: RoomNode) -> str:
    area = r.w * r.h
    if area <= 12:
        return "small"
    if area <= 25:
        return "medium"
    return "large"


def _shortest_path(start: int, goal: int, adjacency: dict[int, set[int]]) -> set[int]:
    if start == goal:
        return {start}
    parent: dict[int, int] = {start: start}
    queue = deque([start])
    while queue:
        node = queue.popleft()
        if node == goal:
            break
        for nxt in adjacency.get(node, ()):
            if nxt not in parent:
                parent[nxt] = node
                queue.append(nxt)
    if goal not in parent:
        return set()
    path = {goal}
    cur = goal
    while cur != start:
        cur = parent[cur]
        path.add(cur)
    return path


def build_narrative_context(
    rooms: list[RoomNode],
    corridors: list[Corridor],
    entrance: Opening,
    exit_opening: Opening,
    doors: list[Door] | None = None,
) -> dict:
    """Compact graph description for a text LLM -- topology, size, and depth
    are already known exactly from generation, so there's nothing a vision
    model reading the rendered map would add."""
    adjacency: dict[int, set[int]] = {r.id: set() for r in rooms}
    edges: dict[int, list[tuple[int, str]]] = {r.id: [] for r in rooms}
    for c in corridors:
        kind = "branch" if c.branches_from_corridor else "corridor"
        adjacency[c.parent_id].add(c.child_id)
        adjacency[c.child_id].add(c.parent_id)
        edges[c.parent_id].append((c.child_id, kind))
        edges[c.child_id].append((c.parent_id, kind))

    critical_path = _shortest_path(entrance.room_id, exit_opening.room_id, adjacency)
    
    doors = doors or []

    doors_by_room: dict[int, list[Door]] = {r.id: [] for r in rooms}
    for door in doors:
        doors_by_room.setdefault(door.room_id, []).append(door)

    def flags(room: RoomNode) -> str:
        value = ""
        if room.id in critical_path:
            value += "m"
        if len(edges[room.id]) >= 3:
            value += "h"
        if len(edges[room.id]) == 1:
            value += "d"
        if room.accent:
            value += "a"
        return value or "-"

    def compact_connections(room_id: int) -> str:
        return " ".join(
            f"{to}{kind[0]}"
            for to, kind in sorted(edges[room_id], key=lambda item: item[0])
        )

    def compact_closed_doors(room_id: int) -> str:
        return " ".join(
            f"{door.other_room_id}:{door.material}:{door.lock}:k{door.key_room_id}"
            for door in doors_by_room.get(room_id, [])
            if door.state == "closed"
        )
    
    def key_type_for(lock: str) -> str:
        if lock == "magicSealed":
            return "clue"

        if lock == "puzzleSealed":
            return "ritualObject"

        return "secret"
    
    return {
        "n": len(rooms),
        "e": entrance.room_id,
        "x": exit_opening.room_id,
        "k": "room=[id,depth,flags,links,closedDoors]; flags m=main h=hub d=dead a=accent; links 5c=corridor to room5, 5b=branch to room5; closedDoors to:material:lock:kKeyRoom; l=[doorId,doorRoom,otherRoom,keyRoom,keyName,keyType,material,lock,gate]",
        "r": [
            [
                room.id,
                room.depth,
                flags(room),
                compact_connections(room.id),
                compact_closed_doors(room.id),
            ]
            for room in rooms
        ],
        "l": [
            [
                door.id,
                door.room_id,
                door.other_room_id,
                door.key_room_id,
                door.key_name,
                key_type_for(door.lock),
                door.material,
                door.lock,
                door.gate,
            ]
            for door in doors
            if door.state == "closed" and door.key_room_id is not None
        ],
    }
