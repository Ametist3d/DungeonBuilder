import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Literal
from groq import Groq

from pydantic import BaseModel, ConfigDict, Field, ValidationError


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

MAX_MAP_LABEL_CHARS = 160
MAX_DESCRIPTION_CHARS = 320

SYSTEM_PROMPT = """You are writing content for a fantasy tabletop dungeon crawl.
You'll receive a JSON description of the dungeon's room graph: shapes, sizes,
depth from the entrance, and how rooms connect (tree corridors, loop-closing
corridors, and branches off other corridors). Use the topology to guide tone:
hub rooms (3+ connections) work well as junctions or social spaces; dead ends
suit secrets, treasure, or a final confrontation; rooms on the main path are
what most parties will see, branch rooms are optional detours. Keep each
room description to 1-3 sentences of evocative, GM-readable boxed text."""


class RoomNarrative(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: int
    label: str = Field(description="3-5 word room name, e.g. 'Flooded Cistern'")
    map_label: str | None = Field(
        None,
        alias="mapLabel",
        description="Short map callout text narrative related to map label and story, max {MAX_MAP_LABEL_CHARS} characters, no line breaks",
    )
    description: str = Field(description="1-2 sentence read-aloud description")


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

def _extract_json(text: str) -> dict:
    text = text.strip()

    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(0))


def _ollama_chat(context: dict) -> str:
    room_ids = [r["id"] for r in context["rooms"]]

    prompt = f"""
Return valid JSON matching this exact schema:

{{
  "title": "short dungeon title",
  "premise": "2-4 sentence dungeon hook/backstory",
  "rooms": [
    {{
      "id": 0,
      "label": "3-5 word room name",
      "mapLabel": "short narrative related to map label and story, max {MAX_MAP_LABEL_CHARS} characters",
      "description": "1-2 sentence GM-readable boxed text"
    }}
  ]
}}

Rules:
- "rooms" MUST be an array of objects, never strings.
- Every room object MUST contain id, label, mapLabel, description.
- mapLabel must be max {MAX_MAP_LABEL_CHARS} characters, one compact sentence fragment, no line breaks.
- description must be max {MAX_DESCRIPTION_CHARS} characters.
- Include exactly these room ids: {room_ids}
- Do not return placeholders like "description_2".
- Do not invent extra ids.
- Do not return Unnamed Chamber, Unnamed Room or empty strings for room labels or descriptions.
- Return JSON only.

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

    return data["message"]["content"]


def _groq_chat(context: dict) -> str:
    if GROQ_CLIENT is None:
        raise RuntimeError("GROQ_API_KEY is missing in .env")

    room_ids = [r["id"] for r in context["rooms"]]

    prompt = f"""
Return valid JSON matching this exact schema:

{{
  "title": "short dungeon title",
  "premise": "2-4 sentence dungeon hook/backstory",
  "rooms": [
    {{
      "id": 0,
      "label": "3-5 word room name",
      "mapLabel": "short narrative related to map label and story, max {MAX_MAP_LABEL_CHARS} characters",
      "description": "1-2 sentence GM-readable boxed text"
    }}
  ]
}}

Rules:
- "rooms" MUST be an array of objects, never strings.
- Every room object MUST contain id, label, mapLabel, description.
- mapLabel must be max {MAX_MAP_LABEL_CHARS} characters, one compact sentence fragment, no line breaks.
- description must be max {MAX_DESCRIPTION_CHARS} characters.
- Include exactly these room ids: {room_ids}
- Do not return placeholders like "description_2".
- Do not invent extra ids.
- Return JSON only.

Dungeon context:
{json.dumps(context, ensure_ascii=False)}
""".strip()

    try:
        response = GROQ_CLIENT.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.8,
            max_tokens=4096,
            response_format={"type": "json_object"},
        )
    except Exception as exc:
        raise RuntimeError(f"Groq request failed: {exc}") from exc

    content = response.choices[0].message.content
    if not content:
        raise RuntimeError("Groq returned empty response")

    return content


def _text(value: Any, fallback: str = "") -> str:
    if value is None:
        return fallback
    return str(value).strip() or fallback


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
        )
        for rid in expected_ids
        if rid not in returned_ids
    )

    rooms.sort(key=lambda r: r.id)
    return DungeonNarrative(title=title, premise=premise, rooms=rooms)

def generate_narrative(context: dict, provider: LLMProvider = "local") -> DungeonNarrative:
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
            )
            for rid in missing
        )

    result.rooms.sort(key=lambda r: r.id)
    return result