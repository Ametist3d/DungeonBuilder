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

MAX_MAP_LABEL_CHARS = 220
MAX_DESCRIPTION_CHARS = 420

CONTENT_TYPES = ("loot", "enemy", "trap", "npc", "clue", "ritualObject", "hazard", "secret")

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

SYSTEM_PROMPT = """You are writing content for a fantasy tabletop dungeon crawl.

Step 1:
You'll receive a JSON description of the dungeon's room graph: shapes, sizes,
depth from the entrance, and how rooms connect: tree corridors, loop-closing
corridors, and branches off other corridors.

Step 2:
Create a fantasy tabletop DnD scenario based on the dungeon's room graph.
The scenario should have an intro, a main part with story twists, a climax,
and a few possible unexpected endings.

Step 3:
Based on the scenario from Step 2, create room descriptions. Use the topology
to guide tone: hub rooms with 3+ connections work well as junctions, social
spaces, or decision points; dead ends suit secrets, treasure, traps, prisoners,
or a final confrontation; rooms on the main path are what most parties will see;
branch rooms are optional detours.

Each room description must contain one cornerstone narrative element such as
loot, enemy, trap, NPC, clue, ritual object, environmental hazard, or secret.
That element must align with the scenario.

Keep each room description to 1-3 sentences of evocative, GM-readable boxed text.
Output only valid JSON when asked."""

class NarrativeContent(BaseModel):
    type: str = Field(description=f"One of: {', '.join(CONTENT_TYPES)}")
    quantity: int = Field(1, ge=1, le=3)
    description: str = Field(
        "",
        description="Brief description and purpose of this element, aligned with scenario lore",
    )

class RoomNarrative(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: int
    label: str = Field(description="3-5 word room name, e.g. 'Flooded Cistern'")
    map_label: str | None = Field(
        None,
        alias="mapLabel",
        description=f"Short map callout text narrative related to map label and story, max {MAX_MAP_LABEL_CHARS} characters, no line breaks",
    )
    description: str = Field(description="1-2 sentence read-aloud description")
    content: list[NarrativeContent] = Field(
        default_factory=list,
        description="Narrative elements placed in this room, each with type and quantity 1-3",
    )

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
Use the dungeon graph below to create a coherent fantasy tabletop DnD scenario.

Plan the scenario internally:
- intro / hook
- main conflict
- story twists
- climax
- a few possible unexpected endings
- how each room supports that scenario

Then return valid JSON matching this exact schema:

{{
  "title": "short dungeon title",
  "premise": "compact scenario summary with intro, main conflict, twists, climax, and possible endings",
  "rooms": [
    {{
      "id": 0,
      "label": "3-5 word room name",
      "mapLabel": "short map callout, max {MAX_MAP_LABEL_CHARS} characters",
      "description": "3-4 sentence GM-readable boxed text with one clear cornerstone element",
      "content": [
        {{
          "type": "loot",
          "quantity": 1,
          "description": "brief description and purpose aligned with scenario lore"
        }}
      ]
    }}
  ]
}}

Rules:
- Return JSON only.
- Do not include markdown.
- Do not include the internal planning text.
- "rooms" MUST be an array of objects, never strings.
- Every room object MUST contain id, label, mapLabel, description.
- Include exactly these room ids: {room_ids}
- Do not invent extra room ids.
- Do not skip any room ids.
- Do not return placeholders like "description_2".
- Do not return Unnamed Chamber, Unnamed Room, or empty strings.
- mapLabel must be max {MAX_MAP_LABEL_CHARS} characters, one compact sentence fragment, no line breaks.
- description must be max {MAX_DESCRIPTION_CHARS} characters.
- Each description must include one scenario-aligned cornerstone element: loot, enemy, trap, NPC, clue, ritual object, hazard, or secret.
- Hub rooms should feel important as junctions, social spaces, or decision points.
- Dead ends should contain secrets, treasure, traps, prisoners, clues, or final threats.
- Main-path rooms should advance the core scenario.
- Branch rooms should feel like optional detours with useful discoveries.
- Every room object MUST contain id, label, mapLabel, description, content.
- content must be an array of 1-3 objects.
- Each content object must contain type, quantity, and description.
- content.type must be one of: loot, enemy, trap, npc, clue, ritualObject, hazard, secret.
- content.quantity must be an integer from 1 to 3.
- content.description must be a brief practical GM note explaining what it is and why it matters in the scenario.
- The room description must mention or clearly imply each content type placed in that room.

Dungeon context:
{json.dumps(context, ensure_ascii=False)}
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
            "num_predict": 4096,
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
Use the dungeon graph below to create a coherent fantasy tabletop DnD scenario.

Plan the scenario internally:
- intro / hook
- main conflict
- story twists
- climax
- a few possible unexpected endings
- how each room supports that scenario

Then return ONLY valid JSON matching this schema:

{{
  "title": "short dungeon title",
  "premise": "compact scenario summary with intro, main conflict, twists, climax, and possible endings",
  "rooms": [
    {{
      "id": 0,
      "label": "3-5 word room name",
      "mapLabel": "short map callout, max {MAX_MAP_LABEL_CHARS} characters",
      "description": "3-4 sentence GM-readable boxed text with one clear cornerstone element",
      "content": [
        {{
          "type": "loot",
          "quantity": 1,
          "description": "brief description and purpose aligned with scenario lore"
        }}
      ]
    }}
  ]
}}

Rules:
- Return JSON only.
- No markdown.
- No prose before or after JSON.
- Do not include the internal planning text.
- Root value must be a JSON object.
- "rooms" must be an array of objects, never strings.
- Every room object must contain id, label, mapLabel, description.
- Include exactly these room ids: {room_ids}
- Do not invent extra ids.
- Do not skip any ids.
- Do not return placeholders.
- Do not use trailing commas.
- Do not return Unnamed Chamber, Unnamed Room, or empty strings.
- mapLabel max {MAX_MAP_LABEL_CHARS} characters, no line breaks.
- description max {MAX_DESCRIPTION_CHARS} characters.
- Each description must include one scenario-aligned cornerstone element: loot, enemy, trap, NPC, clue, ritual object, hazard, or secret.
- Hub rooms should feel important as junctions, social spaces, or decision points.
- Dead ends should contain secrets, treasure, traps, prisoners, clues, or final threats.
- Main-path rooms should advance the core scenario.
- Branch rooms should feel like optional detours with useful discoveries.
- Every room object MUST contain id, label, mapLabel, description, content.
- content must be an array of 1-3 objects.
- Each content object must contain type, quantity, and description.
- content.type must be one of: loot, enemy, trap, npc, clue, ritualObject, hazard, secret.
- content.quantity must be an integer from 1 to 3.
- content.description must be a brief practical GM note explaining what it is and why it matters in the scenario.
- The room description must mention or clearly imply each content type placed in that room.

Dungeon context:
{json.dumps(context, ensure_ascii=False)}
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
                max_tokens=4096,
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
