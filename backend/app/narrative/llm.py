import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Literal
from groq import Groq

from pydantic import BaseModel, ConfigDict, Field, ValidationError
import logging

logger = logging.getLogger("uvicorn.error")

def _load_dotenv() -> None:
    root = Path(__file__).resolve().parents[3]
    env_path = root / ".env"

    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")

        os.environ.setdefault(key, value)


_load_dotenv()

LLMProvider = Literal["local", "api"]

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gemma4:12b")

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_CLIENT = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

MAX_MAP_LABEL_CHARS = 320
MAX_DESCRIPTION_CHARS = 620
MAX_CONTENT_DESCRIPTION_CHARS = 120
GROQ_MAX_TOKENS = int(os.getenv("GROQ_MAX_TOKENS", "3000"))
OLLAMA_NUM_PREDICT = int(os.getenv("OLLAMA_NUM_PREDICT", "3200"))

CONTENT_TYPES = ("loot", "enemy", "trap", "npc", "clue", "ritualObject", "hazard", "secret")

BANNED_GEOMETRY_PHRASES = (
    "small room",
    "medium room",
    "large room",
    "rectangular room",
    "circular room",
    "octagonal room",
    "corridor leads",
    "entrance is",
    "exit is",
)

CONTENT_TYPE_ALIASES = {
    "loot": "loot",
    "treasure": "loot",
    "enemy": "enemy",
    "monster": "enemy",
    "creature": "enemy",
    "trap": "trap",
    "npc": "npc",
    "character": "npc",
    "nonplayercharacter": "npc",
    "clue": "clue",
    "hint": "clue",
    "ritualobject": "ritualObject",
    "ritual_object": "ritualObject",
    "ritual-object": "ritualObject",
    "ritual": "ritualObject",
    "artifact": "ritualObject",
    "relic": "ritualObject",
    "hazard": "hazard",
    "danger": "hazard",
    "secret": "secret",
    "hidden": "secret",
}

# SYSTEM_PROMPT = """Write compact fantasy tabletop dungeon content.
# Use the dungeon graph to create one coherent scenario with hook, twist, climax, and possible endings.
# Then create room notes from topology: hubs are junctions/decision/social spaces; dead ends hide secrets, treasure, traps, prisoners, or final threats; main-path rooms advance the core plot; branch rooms are optional discoveries.
# Each room needs scenario-aligned content: loot, enemy, trap, npc, clue, ritualObject, hazard, or secret.
# Closed doors are intentional obstacles and must affect lore/tactics.
# Return valid JSON only."""

SYSTEM_PROMPT = """You are a fantasy tabletop dungeon writer.

You receive a compact dungeon graph only as STRUCTURE, not as content.
Use it to understand pacing, importance, and flow, but do not describe visible
geometry, room size, compass directions, corridor layout, or entrances unless
it has story meaning.

Your job:
1. Create one coherent DnD-style scenario with a strong hook, rising mystery,
   story twist, climax, and a few possible unexpected endings.
2. Turn the dungeon into story locations, not architectural descriptions.
3. Make every room feel like part of the same plot.
4. Each room must contain at least one meaningful narrative element:
   loot, enemy, trap, npc, clue, ritualObject, hazard, or secret.
5. Closed doors are story obstacles: locked, barred, sealed, cursed,
   guarded, puzzle-gated, or magic-sealed. Use them to create tension,
   foreshadowing, keys, rituals, clues, or tactical choices.

Topology guidance:
- hub rooms are social spaces, decision points, ritual centers, ambush zones,
  or places where factions collide.
- dead ends hide secrets, treasure, prisoners, traps, revelations, or final threats.
- main-path rooms advance the core story.
- branch rooms are optional discoveries, side clues, risks, or rewards.

Write evocative GM-facing prose.
Prioritize story, atmosphere, motives, discoveries, consequences, and playable hooks.
Avoid wasting words on size, shape, coordinates, geometry, exits, or visible layout.
Return only valid JSON when asked."""

class NarrativeContent(BaseModel):
    type: str
    quantity: int = Field(1, ge=1, le=3)
    description: str = ""

class RoomNarrative(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: int
    label: str
    map_label: str | None = Field(None, alias="mapLabel")
    description: str
    content: list[NarrativeContent] = Field(default_factory=list)

class DungeonNarrative(BaseModel):
    title: str
    premise: str = Field(description="2-4 sentence dungeon hook/backstory")
    rooms: list[RoomNarrative]


def _compact_text(value: Any, limit: int) -> str:
    text = _text(value)
    text = " ".join(text.split())

    if len(text) <= limit:
        return text

    cut = text[: limit - 1].rsplit(" ", 1)[0]
    return f"{cut or text[: limit - 1]}…"

def _preview(text: str, limit: int = 1200) -> str:
    text = text.replace("\n", "\\n")
    return text[:limit] + ("..." if len(text) > limit else "")

def _context_json(context: dict) -> str:
    return json.dumps(context, ensure_ascii=False, separators=(",", ":"))

def _extract_json(text: str) -> dict:
    original = text or ""
    text = original.strip()

    if not text:
        raise RuntimeError("LLM returned empty response")

    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)

    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            return json.loads(match.group(0))

        logger.error("Non-JSON LLM response preview: %s", _preview(original))
        raise RuntimeError(f"LLM returned non-JSON response: {_preview(original)}") from exc


def _ollama_chat(context: dict) -> str:
    room_ids = [r["id"] for r in context["rooms"]]

    prompt = f"""
Create a story-first fantasy tabletop dungeon scenario from this compact graph.

Use the graph only to infer pacing and room importance.
Do NOT describe room geometry, size, shape, coordinates, corridors, entrances, or visible layout.
The player already sees the map.

Return JSON only:

{{
  "title": "short evocative dungeon title",
  "premise": "story summary with hook, conflict, twist, climax, and possible endings",
  "rooms": [
    {{
      "id": 0,
      "label": "3-5 word story/location name",
      "mapLabel": "short in-world callout, max {MAX_MAP_LABEL_CHARS} chars",
      "description": "1-3 story-rich GM sentences, max {MAX_DESCRIPTION_CHARS} chars",
      "content": [
        {{
          "type": "loot",
          "quantity": 1,
          "description": "max {MAX_CONTENT_DESCRIPTION_CHARS} chars, what it is and why it matters"
        }}
      ]
    }}
  ]
}}

Rules:
- Return valid JSON only. No markdown. No prose outside JSON.
- Include exactly these room ids: {room_ids}
- Every room must have id, label, mapLabel, description, content.
- Do not invent, skip, rename, or duplicate room ids.
- Do not return placeholders or generic names like Unnamed Room.
- Focus on story events, secrets, threats, NPC motives, clues, rituals, consequences, and rewards.
- Avoid describing room size, shape, coordinates, doors, entrances, exits, corridors, or map layout unless needed for story.
- mapLabel should be an atmospheric clue or hook, not a geometry note.
- description should tell what happens here, what can be discovered, and why it matters.
- content must contain 1-3 objects.
- content.type must be one of: loot, enemy, trap, npc, clue, ritualObject, hazard, secret.
- content.quantity must be integer 1-3.
- content.description should be a practical GM note tied to scenario lore.
- Mention or clearly imply each content item in the room description.
- Use hub/dead/main/depth/connectivity only to decide narrative role, not to describe layout.
- If room.closedDoors exists, make those doors meaningful obstacles: key, seal, curse, guard, puzzle, ritual, or clue.
- Never describe the dungeon entrance as closed.

Dungeon graph:
{_context_json(context)}
""".strip()

    payload = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "format": DungeonNarrative.model_json_schema(),
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "options": {
            "temperature": 0.8,
            "num_predict": OLLAMA_NUM_PREDICT,
        },
    }

    req = urllib.request.Request(
        f"{OLLAMA_BASE_URL}/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            data = json.loads(res.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Ollama request failed: {exc}") from exc

    content = data.get("message", {}).get("content", "")
    logger.warning("Ollama raw response preview: %s", _preview(content))
    return content


def _groq_chat(context: dict) -> str:
    if GROQ_CLIENT is None:
        raise RuntimeError("GROQ_API_KEY is missing in .env")

    room_ids = [r["id"] for r in context["rooms"]]

    prompt = f"""
Create a story-first fantasy tabletop dungeon scenario from this compact graph.

Use the graph only to infer pacing and room importance.
Do NOT describe room geometry, size, shape, coordinates, corridors, entrances, or visible layout.
The player already sees the map.

Return JSON only:

{{
  "title": "short evocative dungeon title",
  "premise": "story summary with hook, conflict, twist, climax, and possible endings",
  "rooms": [
    {{
      "id": 0,
      "label": "3-5 word story/location name",
      "mapLabel": "short in-world callout, max {MAX_MAP_LABEL_CHARS} chars",
      "description": "1-3 story-rich GM sentences, max {MAX_DESCRIPTION_CHARS} chars",
      "content": [
        {{
          "type": "loot",
          "quantity": 1,
          "description": "max {MAX_CONTENT_DESCRIPTION_CHARS} chars, what it is and why it matters"
        }}
      ]
    }}
  ]
}}

Rules:
- Return valid JSON only. No markdown. No prose outside JSON.
- Include exactly these room ids: {room_ids}
- Every room must have id, label, mapLabel, description, content.
- Do not invent, skip, rename, or duplicate room ids.
- Do not return placeholders or generic names like Unnamed Room.
- Focus on story events, secrets, threats, NPC motives, clues, rituals, consequences, and rewards.
- Avoid describing room size, shape, coordinates, doors, entrances, exits, corridors, or map layout unless needed for story.
- mapLabel should be an atmospheric clue or hook, not a geometry note.
- description should tell what happens here, what can be discovered, and why it matters.
- content must contain 1-3 objects.
- content.type must be one of: loot, enemy, trap, npc, clue, ritualObject, hazard, secret.
- content.quantity must be integer 1-3.
- content.description should be a practical GM note tied to scenario lore.
- Mention or clearly imply each content item in the room description.
- Use hub/dead/main/depth/connectivity only to decide narrative role, not to describe layout.
- If room.closedDoors exists, make those doors meaningful obstacles: key, seal, curse, guard, puzzle, ritual, or clue.
- Never describe the dungeon entrance as closed.

Dungeon graph:
{_context_json(context)}
""".strip()

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ]

    logger.warning("Groq narrative request model=%s rooms=%s", GROQ_MODEL, room_ids)

    try:
        response = GROQ_CLIENT.chat.completions.create(
            model=GROQ_MODEL,
            messages=messages,
            temperature=0.2,
            max_tokens=4096,
            response_format={"type": "json_object"},
        )
    except Exception as strict_exc:
        logger.warning("Groq JSON mode failed, retrying without response_format: %s", strict_exc)

        try:
            response = GROQ_CLIENT.chat.completions.create(
                model=GROQ_MODEL,
                messages=messages,
                temperature=0.2,
                max_tokens=GROQ_MAX_TOKENS,
            )
        except Exception as fallback_exc:
            raise RuntimeError(f"Groq request failed: {fallback_exc}") from fallback_exc

    content = response.choices[0].message.content or ""
    logger.warning("Groq raw response preview: %s", _preview(content))

    if not content.strip():
        raise RuntimeError("Groq returned empty response")

    return content


def _text(value: Any, fallback: str = "") -> str:
    if value is None:
        return fallback
    return str(value).strip() or fallback

def _content_type(value: Any) -> str | None:
    key = str(value or "").strip().lower().replace(" ", "").replace("-", "").replace("_", "")
    return CONTENT_TYPE_ALIASES.get(key)


def _coerce_quantity(value: Any) -> int:
    try:
        return max(1, min(3, int(value)))
    except (TypeError, ValueError):
        return 1


def _coerce_content(value: Any) -> list[NarrativeContent]:
    if not value:
        return []

    items = value if isinstance(value, list) else [value]
    result: list[NarrativeContent] = []

    for item in items:
        description = ""

        if isinstance(item, str):
            kind = _content_type(item)
            quantity = 1

        elif isinstance(item, dict):
            kind = _content_type(item.get("type") or item.get("kind") or item.get("element"))
            quantity = _coerce_quantity(item.get("quantity", 1))
            description = _compact_text(
                item.get("description")
                or item.get("desc")
                or item.get("purpose")
                or "",
                180,
            )

        else:
            continue

        if kind:
            result.append(
                NarrativeContent(
                    type=kind,
                    quantity=quantity,
                    description=description,
                )
            )

    return result[:4]

def _coerce_room(item: Any, fallback_id: int | None = None) -> RoomNarrative | None:
    if not isinstance(item, dict):
        return None

    rid = item.get("id", fallback_id)
    try:
        rid = int(rid)
    except (TypeError, ValueError):
        return None

    label = _compact_text(
        item.get("label")
        or item.get("name")
        or item.get("title")
        or "Unnamed Chamber",
        42,
    )

    description = _compact_text(
        item.get("description")
        or item.get("desc")
        or item.get("text")
        or item.get("boxedText"),
        MAX_DESCRIPTION_CHARS,
    )

    map_label = _compact_text(
        item.get("mapLabel")
        or item.get("map_label")
        or item.get("callout")
        or description,
        MAX_MAP_LABEL_CHARS,
    )

    return RoomNarrative(
        id=rid,
        label=label,
        map_label=map_label,
        description=description,
        content=_coerce_content(item.get("content")),
    )


def _normalize_narrative(parsed: dict, context: dict) -> DungeonNarrative:
    expected_ids = [int(r["id"]) for r in context["rooms"]]
    expected_set = set(expected_ids)

    title = _text(parsed.get("title"), "Unnamed Dungeon")
    premise = _text(parsed.get("premise") or parsed.get("hook"), "A newly discovered dungeon waits below.")

    raw_rooms = parsed.get("rooms", [])
    rooms: list[RoomNarrative] = []

    if isinstance(raw_rooms, dict):
        for rid in expected_ids:
            item = raw_rooms.get(str(rid)) or raw_rooms.get(rid)
            room = _coerce_room(item, rid)
            if room:
                rooms.append(room)

    elif isinstance(raw_rooms, list):
        for idx, item in enumerate(raw_rooms):
            fallback_id = expected_ids[idx] if idx < len(expected_ids) else None
            room = _coerce_room(item, fallback_id)
            if room:
                rooms.append(room)

    rooms = [r for r in rooms if r.id in expected_set]

    returned_ids = {r.id for r in rooms}
    rooms.extend(
        RoomNarrative(
            id=rid,
            label="Unnamed Chamber",
            map_label="",
            description="",
            content=[],
        )
        for rid in expected_ids
        if rid not in returned_ids
    )

    rooms.sort(key=lambda r: r.id)
    return DungeonNarrative(title=title, premise=premise, rooms=rooms)

def generate_narrative(context: dict, provider: LLMProvider = "local") -> DungeonNarrative:
    logger.warning("Generating narrative with provider=%s", provider)

    raw = _groq_chat(context) if provider == "api" else _ollama_chat(context)
    parsed = _extract_json(raw)

    try:
        result = DungeonNarrative.model_validate(parsed)
    except ValidationError:
        return _normalize_narrative(parsed, context)
    for room in result.rooms:
        room.label = _compact_text(room.label, 42)
        room.description = _compact_text(room.description, MAX_DESCRIPTION_CHARS)
        room.map_label = _compact_text(room.map_label or room.description, MAX_MAP_LABEL_CHARS)
        room.content = _coerce_content([item.model_dump() for item in room.content])
        for phrase in BANNED_GEOMETRY_PHRASES:
            room.description = room.description.replace(phrase, "")
            room.map_label = room.map_label.replace(phrase, "")

    expected_ids = {r["id"] for r in context["rooms"]}
    result.rooms = [r for r in result.rooms if r.id in expected_ids]

    returned_ids = {r.id for r in result.rooms}
    missing = [r["id"] for r in context["rooms"] if r["id"] not in returned_ids]
    if missing:
        result.rooms.extend(
            RoomNarrative(
                id=rid,
                label="Unnamed Chamber",
                map_label="",
                description="",
                content=[],
            )
            for rid in missing
        )

    result.rooms.sort(key=lambda r: r.id)
    return result
