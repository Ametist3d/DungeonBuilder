import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Literal
from groq import Groq

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from .context import CONTENT_TYPE_ALIASES, GROQ_JSON_SCHEMA
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

MAX_MAP_LABEL_CHARS = 180
MAX_DESCRIPTION_CHARS = 360
MAX_CONTENT_DESCRIPTION_CHARS = 90
GROQ_MAX_TOKENS = int(os.getenv("GROQ_MAX_TOKENS", "6096"))
OLLAMA_NUM_PREDICT = int(os.getenv("OLLAMA_NUM_PREDICT", "8192"))

GROQ_IS_GPT_OSS = GROQ_MODEL.lower().startswith("openai/gpt-oss")

CONTENT_TYPES = (
    "loot",
    "enemy",
    "trap",
    "npc",
    "clue",
    "ritualObject",
    "hazard",
    "secret",
)
ENEMY_TYPES = ("melee", "ranged", "mage")
ENEMY_DIFFICULTIES = ("normal", "elite", "boss")
ENEMY_HP = {"normal": 6, "elite": 12, "boss": 24}

LOOT_TYPES = (
    "armor",
    "weapon",
    "treasure",
    "spell",
    "hpPotion",
    "manaPotion",
)

LOOT_TYPE_ALIASES = {
    "armor": "armor",
    "armour": "armor",
    "weapon": "weapon",
    "treasure": "treasure",
    "gold": "treasure",
    "coins": "treasure",
    "spell": "spell",
    "hppotion": "hpPotion",
    "healthpotion": "hpPotion",
    "manapotion": "manaPotion",
    "mannapotion": "manaPotion",
    "mppotion": "manaPotion",
}

LOOT_VALUE_LIMITS = {
    "armor": (1, 5),
    "weapon": (2, 10),
    "treasure": (5, 200),
    "spell": (0, 0),
    "hpPotion": (2, 20),
    "manaPotion": (2, 10),
}

STORY_CONTENT_TYPES = {"loot", "enemy", "trap", "npc", "hazard"}
UNLOCK_CONTENT_TYPES = {"secret", "clue", "ritualObject"}

UNLOCK_WORD_RE = re.compile(
    r"\b(key|keys|scroll|scrolls|mechanism|mechanisms|unlock|unlocks|opens?|seal|seals|sealed|puzzle)\b",
    re.IGNORECASE,
)

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


# SYSTEM_PROMPT = """Write compact fantasy tabletop dungeon JSON.

# Use the compact graph only for pacing and room importance.
# Do not describe size, shape, coordinates, corridors, exits, or visible layout.

# Create one coherent dungeon story with hook, mystery, twist, climax, and possible endings.
# Each room must support that story and include 1-3 meaningful elements:
# loot, enemy, trap, npc, clue, ritualObject, hazard, or secret.

# Closed doors are story obstacles. Unlock tools must be in a different room
# than the closed door they unlock.

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
6. Each closed door should have corresponding key placed in any accessible room before that locked door.
7. Keys, unlock mechanisms or other unlock tools shold have name matching its door.

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


class NarrativeLootItem(BaseModel):
    name: str
    type: Literal[
        "armor",
        "weapon",
        "treasure",
        "spell",
        "hpPotion",
        "manaPotion",
    ]
    value: int = Field(0, ge=0)
    description: str = ""


class NarrativeContent(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    type: str
    quantity: int = Field(1, ge=1, le=3)
    description: str = ""

    enemy_type: Literal["melee", "ranged", "mage"] | None = Field(
        None,
        alias="enemyType",
    )
    difficulty: Literal["normal", "elite", "boss"] | None = None
    hp: int | None = Field(None, ge=1)

    loot: list[NarrativeLootItem] = Field(default_factory=list)


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


def _main_prompt(context: dict) -> str:
    room_ids = _room_ids_csv(context)

    return f"""
Return one valid JSON object matching the provided schema.

The root must be:
{{
  "title": "...",
  "premise": "...",
  "rooms": [...]
}}

Never return the rooms array directly.

Room ids exactly: [{room_ids}]

Rules:
- JSON only. No markdown.
- Do not add fields outside the schema.
- Every room needs id, label, mapLabel, description, content.
- Do not return flags inside room objects.
- Each room has 1-3 content items.
- content.type: loot, enemy, trap, npc, hazard.
- Every content item needs:
  type, quantity, description, enemyType, difficulty, hp, loot.

Enemy items:
- enemyType: melee, ranged, or mage.
- difficulty: normal, elite, or boss.
- HP: normal=6, elite=12, boss=24.
- loot must be [].

Non-enemy items:
- enemyType must be null.
- difficulty must be null.
- hp must be null.

Loot items:
- quantity must be 1.
- loot contains 1-3 objects.
- loot type: armor, weapon, treasure, spell, hpPotion, manaPotion.
- armor value: 1-5 defence.
- weapon value: 2-10 attack.
- treasure value: 5-200 gold.
- spell value: 0.
- hpPotion value: 2-20 restored HP.
- manaPotion value: 2-10 restored MP.

Non-loot content:
- loot must be [].

Never create keys, scrolls, mechanisms, seals, puzzle tools,
secret items, clue items, or ritualObject items.

Tell story, motives, threats, rewards, and consequences.
Do not describe geometry, size, shape, coordinates, exits,
corridors, or visible layout.

{_lock_rule(context)}

Keep all strings short.

Compact graph:
{_context_json(_llm_context(context))}
""".strip()


def _retry_prompt(context: dict) -> str:
    room_ids = _room_ids_csv(context)

    return f"""
Return one complete valid JSON object only.

Root format:
{{
  "title": "short title",
  "premise": "short premise",
  "rooms": [...]
}}

Never return an array as the root.

Room ids exactly: [{room_ids}]

Every room:
{{
  "id": 0,
  "label": "room name",
  "mapLabel": "short label",
  "description": "short description",
  "content": [...]
}}

Every content item:
{{
  "type": "loot|enemy|trap|npc|hazard",
  "quantity": 1,
  "description": "short description",
  "enemyType": null,
  "difficulty": null,
  "hp": null,
  "loot": []
}}

Enemy content:
- enemyType: melee, ranged, or mage.
- difficulty: normal, elite, or boss.
- hp: 6, 12, or 24.
- loot: [].

Loot content:
- enemyType, difficulty, hp: null.
- quantity: 1.
- loot contains 1-3 items.

Loot item:
{{
  "name": "item name",
  "type": "armor|weapon|treasure|spell|hpPotion|manaPotion",
  "value": 0,
  "description": "short description"
}}

Do not include flags or additional fields.
Keep descriptions under 120 characters.

{_lock_rule(context)}

Graph:
{_context_json(_llm_context(context))}
""".strip()


def _groq_kwargs(
    messages: list[dict[str, str]], *, response_format: dict | None = None
) -> dict:
    kwargs: dict[str, Any] = {
        "model": GROQ_MODEL,
        "messages": messages,
        "temperature": 0.2,
    }

    if GROQ_IS_GPT_OSS:
        kwargs["max_completion_tokens"] = GROQ_MAX_TOKENS
        kwargs["reasoning_format"] = "hidden"
        kwargs["reasoning_effort"] = "low"
    else:
        kwargs["max_tokens"] = GROQ_MAX_TOKENS

    if response_format:
        kwargs["response_format"] = response_format

    return kwargs


def _groq_content(response: Any) -> str:
    message = response.choices[0].message
    content = message.content or ""

    if not content.strip():
        logger.warning(
            "Groq empty content finish_reason=%s reasoning_preview=%s",
            getattr(response.choices[0], "finish_reason", ""),
            _preview(getattr(message, "reasoning", "") or "", 800),
        )

    return content


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


def _extract_json(text: str) -> Any:
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
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass

        logger.error("Invalid JSON LLM response preview: %s", _preview(original))
        raise exc


def _room_ids(context: dict) -> list[int]:
    return [int(row[0]) for row in context["r"]]


def _room_ids_csv(context: dict) -> str:
    return ",".join(str(rid) for rid in _room_ids(context))


def _lock_rows(context: dict) -> list[list[Any]]:
    return [row for row in context.get("l", []) if len(row) >= 8]


def _lock_rule(context: dict) -> str:
    return (
        "- Do not create keys, scrolls, mechanisms, seals, puzzle tools, or unlock items.\n"
        "- Do not create secret, clue, or ritualObject content.\n"
        "- Unlock pickups are generated by the system after your response."
    )


def _llm_context(context: dict) -> dict:
    story_context = dict(context)
    story_context.pop("l", None)

    story_context["k"] = (
        "room=[id,depth,flags,links]; "
        "flags m=main h=hub d=dead a=accent; "
        "links 5c=corridor to room5, 5b=branch to room5"
    )

    story_context["r"] = [row[:4] for row in context.get("r", [])]

    return story_context


def _ollama_chat(context: dict) -> str:
    # room_ids = _room_ids_csv(context)

    #     prompt = f"""
    # Create a story-first fantasy tabletop dungeon scenario from this compact graph.

    # Use the graph only to infer pacing and room importance.
    # Do NOT describe room geometry, size, shape, coordinates, corridors, entrances, or visible layout.
    # The player already sees the map.

    # Return JSON only:

    # {{
    #   "title": "short evocative dungeon title",
    #   "premise": "story summary with hook, conflict, twist, climax, and possible endings",
    #   "rooms": [
    #     {{
    #       "id": 0,
    #       "label": "3-5 word story/location name",
    #       "mapLabel": "short in-world callout, max {MAX_MAP_LABEL_CHARS} chars",
    #       "description": "1-3 story-rich GM sentences, max {MAX_DESCRIPTION_CHARS} chars",
    #       "content": [Dungeon graph:
    #         {{
    #           "type": "loot",
    #           "quantity": 1,
    #           "description": "max {MAX_CONTENT_DESCRIPTION_CHARS} chars, what it is and why it matters"
    #         }}
    #       ]
    #     }}
    #   ]
    # }}

    # Rules:
    # - Return valid JSON only. No markdown. No prose outside JSON.
    # - Include exactly these room ids: [{room_ids}]
    # - Every room must have id, label, mapLabel, description, content.
    # - Do not invent, skip, rename, or duplicate room ids.
    # - Do not return placeholders or generic names like Unnamed Room.
    # - Focus on story events, secrets, threats, NPC motives, clues, rituals, consequences, and rewards.
    # - Avoid describing room size, shape, coordinates, doors, entrances, exits, corridors, or map layout unless needed for story.
    # - mapLabel should be an atmospheric clue or hook, not a geometry note.
    # - description should tell what happens here, what can be discovered, and why it matters.
    # - content must contain 1-3 objects.
    # - content.type must be one of: loot, enemy, trap, npc, clue, ritualObject, hazard, secret.
    # - content.quantity must be integer 1-3.
    # - content.description should be a practical GM note tied to scenario lore.
    # - Mention or clearly imply each content item in the room description.
    # - Use hub/dead/main/depth/connectivity only to decide narrative role, not to describe layout.
    # - If room.closedDoors exists, make those doors meaningful obstacles: key, seal, curse, guard, puzzle, ritual, or clue.
    # - Place keys, unlock mechanisms, or other unlock tools in any room with ID different from the room with closed doors they unlock.
    # - Never put keys, unlock mechanisms or other unlock tools in same room ID that contains those closed doors they should unlock.
    # - Never describe the dungeon entrance as closed.

    # Compact graph:
    # {_context_json(context)}
    # """.strip()

    prompt = _main_prompt(context)

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

    logger.warning(
        "Local narrative request model=%s prompt=%s",
        OLLAMA_MODEL,
        _preview(prompt, 8192),
    )

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
    logger.warning("Ollama raw response preview: %s", _preview(content, 8192))
    return content


def _retry_groq_json(context: dict) -> str:
    # room_ids = _room_ids_csv(context)

    prompt = _retry_prompt(context)

    messages = [
        {"role": "system", "content": "Return complete valid JSON only."},
        {"role": "user", "content": prompt},
    ]

    try:
        response = GROQ_CLIENT.chat.completions.create(
            **_groq_kwargs(messages, response_format=GROQ_JSON_SCHEMA)
        )
    except Exception as exc:
        logger.warning("Groq compact strict retry failed, retrying plain: %s", exc)
        response = GROQ_CLIENT.chat.completions.create(**_groq_kwargs(messages))

    return _groq_content(response)


def _groq_chat(context: dict) -> str:
    if GROQ_CLIENT is None:
        raise RuntimeError("GROQ_API_KEY is missing in .env")

    prompt = _main_prompt(context)

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ]

    logger.warning(
        "Groq narrative request model=%s prompt=%s",
        GROQ_MODEL,
        _preview(prompt, 8192),
    )

    try:
        response = GROQ_CLIENT.chat.completions.create(
            **_groq_kwargs(messages, response_format=GROQ_JSON_SCHEMA)
        )
    except Exception as strict_exc:
        logger.warning(
            "Groq strict JSON failed, retrying plain completion: %s", strict_exc
        )

        try:
            response = GROQ_CLIENT.chat.completions.create(**_groq_kwargs(messages))
        except Exception as fallback_exc:
            raise RuntimeError(f"Groq request failed: {fallback_exc}") from fallback_exc

    content = _groq_content(response)
    logger.warning("Groq raw response preview: %s", _preview(content, 8192))

    if not content.strip():
        logger.warning("Groq returned empty response, retrying ultra-compact prompt")
        content = _retry_groq_json(context)

    if not content.strip():
        raise RuntimeError("Groq returned empty response after retry")

    return content


def _text(value: Any, fallback: str = "") -> str:
    if value is None:
        return fallback
    return str(value).strip() or fallback


def _content_type(value: Any) -> str | None:
    key = (
        str(value or "")
        .strip()
        .lower()
        .replace(" ", "")
        .replace("-", "")
        .replace("_", "")
    )
    return CONTENT_TYPE_ALIASES.get(key)


def _coerce_quantity(value: Any) -> int:
    try:
        return max(1, min(3, int(value)))
    except (TypeError, ValueError):
        return 1


def _coerce_enemy_type(value: Any) -> str:
    enemy_type = str(value or "").strip().lower()
    return enemy_type if enemy_type in ENEMY_TYPES else "melee"


def _coerce_enemy_difficulty(value: Any) -> str:
    difficulty = str(value or "").strip().lower()
    return difficulty if difficulty in ENEMY_DIFFICULTIES else "normal"


def _coerce_loot_type(value: Any) -> str | None:
    key = re.sub(r"[^a-z]", "", str(value or "").lower())
    return LOOT_TYPE_ALIASES.get(key)


def _coerce_loot_value(kind: str, value: Any) -> int:
    minimum, maximum = LOOT_VALUE_LIMITS[kind]

    if minimum == maximum:
        return minimum

    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = minimum

    return max(minimum, min(maximum, parsed))


def _coerce_loot_items(
    value: Any,
    fallback_description: str,
) -> list[NarrativeLootItem]:
    raw_items = value if isinstance(value, list) else []
    result: list[NarrativeLootItem] = []

    for item in raw_items[:3]:
        if not isinstance(item, dict):
            continue

        kind = _coerce_loot_type(item.get("type"))
        if not kind:
            continue

        result.append(
            NarrativeLootItem(
                name=_compact_text(
                    item.get("name") or kind,
                    48,
                ),
                type=kind,
                value=_coerce_loot_value(
                    kind,
                    item.get("value"),
                ),
                description=_compact_text(
                    item.get("description") or "",
                    MAX_CONTENT_DESCRIPTION_CHARS,
                ),
            )
        )

    if result:
        return result

    return [
        NarrativeLootItem(
            name=_compact_text(
                fallback_description or "Forgotten coin cache",
                48,
            ),
            type="treasure",
            value=10,
            description="A small cache of valuables.",
        )
    ]


def _coerce_content(value: Any) -> list[NarrativeContent]:
    if not value:
        return []

    items = value if isinstance(value, list) else [value]
    result: list[NarrativeContent] = []
    loot: list[NarrativeLootItem] = []

    for item in items:
        description = ""
        enemy_type = None
        difficulty = None
        hp = None

        if isinstance(item, str):
            kind = _content_type(item)
            quantity = 1

        elif isinstance(item, dict):
            kind = _content_type(
                item.get("type") or item.get("kind") or item.get("element")
            )
            quantity = _coerce_quantity(item.get("quantity", 1))
            description = _compact_text(
                item.get("description")
                or item.get("desc")
                or item.get("purpose")
                or "",
                MAX_CONTENT_DESCRIPTION_CHARS,
            )

            if kind == "loot":
                quantity = 1
                loot = _coerce_loot_items(
                    item.get("loot"),
                    description,
                )

            if kind == "enemy":
                enemy_type = _coerce_enemy_type(
                    item.get("enemyType") or item.get("enemy_type")
                )
                difficulty = _coerce_enemy_difficulty(item.get("difficulty"))
                hp = ENEMY_HP[difficulty]

        else:
            continue

        if kind in STORY_CONTENT_TYPES and not UNLOCK_WORD_RE.search(description):
            result.append(
                NarrativeContent(
                    type=kind,
                    quantity=quantity,
                    description=description,
                    enemy_type=enemy_type,
                    difficulty=difficulty,
                    hp=hp,
                    loot=loot,
                )
            )

    return result


def _lock_content_type(lock: str) -> str:
    if lock == "magicSealed":
        return "clue"

    if lock == "puzzleSealed":
        return "ritualObject"

    return "secret"


def _is_generated_unlock_duplicate(
    item: NarrativeContent, required_names: set[str], required_door_ids: set[str]
) -> bool:
    text = (item.description or "").lower()

    if any(name and name in text for name in required_names):
        return True

    if any(door_id and door_id in text for door_id in required_door_ids):
        return True

    if re.search(r"\broom\s+\d+\s+door\b", text):
        return True

    if re.search(
        r"\b(unlock|opens?|seals?|sealed|mechanism|key|scroll)\b.*\bdoor\b", text
    ):
        return True

    if re.search(r"\bdoor\b.*\b(room|key|scroll|mechanism)\b", text):
        return True

    return False


def _ensure_lock_content(result: DungeonNarrative, context: dict) -> None:
    required_by_room: dict[int, list[NarrativeContent]] = {}

    for row in _lock_rows(context):
        (
            door_id,
            door_room,
            other_room,
            key_room,
            key_name,
            key_type,
            material,
            lock,
            gate,
        ) = row

        key_room_id = int(key_room)
        key_name = _compact_text(
            key_name or f"Room {door_room} door {door_id} {material} key",
            64,
        )
        key_type = str(key_type or _lock_content_type(str(lock)))

        required_by_room.setdefault(key_room_id, []).append(
            NarrativeContent(
                type=key_type,
                quantity=1,
                description=key_name,
            )
        )

    for room in result.rooms:
        story_content = [
            item
            for item in room.content
            if item.type in STORY_CONTENT_TYPES
            and not UNLOCK_WORD_RE.search(item.description or "")
        ]

        room.content = required_by_room.get(room.id, []) + story_content


def _coerce_room(item: Any, fallback_id: int | None = None) -> RoomNarrative | None:
    if not isinstance(item, dict):
        return None

    rid = item.get("id", fallback_id)
    try:
        rid = int(rid)
    except (TypeError, ValueError):
        return None

    label = _compact_text(
        item.get("label") or item.get("name") or item.get("title") or "Unnamed Chamber",
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


def _coerce_narrative_root(parsed: Any) -> dict[str, Any]:
    if isinstance(parsed, dict):
        return parsed

    if isinstance(parsed, list):
        return {
            "title": "Unnamed Dungeon",
            "premise": "A newly discovered dungeon waits below.",
            "rooms": parsed,
        }

    raise RuntimeError(f"Invalid narrative root type: {type(parsed).__name__}")


def _normalize_narrative(
    parsed: Any,
    context: dict,
) -> DungeonNarrative:
    parsed = _coerce_narrative_root(parsed)

    expected_ids = _room_ids(context)
    expected_set = set(expected_ids)

    title = _text(
        parsed.get("title"),
        "Unnamed Dungeon",
    )

    premise = _text(
        parsed.get("premise") or parsed.get("hook"),
        "A newly discovered dungeon waits below.",
    )

    raw_rooms = parsed.get("rooms", [])
    rooms: list[RoomNarrative] = []

    if isinstance(raw_rooms, dict):
        for rid in expected_ids:
            item = raw_rooms.get(str(rid)) or raw_rooms.get(rid)

            room = _coerce_room(item, rid)

            if room:
                rooms.append(room)

    elif isinstance(raw_rooms, list):
        for index, item in enumerate(raw_rooms):
            fallback_id = expected_ids[index] if index < len(expected_ids) else None

            room = _coerce_room(
                item,
                fallback_id,
            )

            if room:
                rooms.append(room)

    rooms = [room for room in rooms if room.id in expected_set]

    returned_ids = {room.id for room in rooms}

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

    rooms.sort(
        key=lambda room: room.id,
    )

    return DungeonNarrative(
        title=title,
        premise=premise,
        rooms=rooms,
    )


def generate_narrative(
    context: dict, provider: LLMProvider = "local"
) -> DungeonNarrative:
    logger.warning("Generating narrative with provider=%s", provider)

    raw = _groq_chat(context) if provider == "api" else _ollama_chat(context)

    try:
        parsed = _extract_json(raw)
    except json.JSONDecodeError:
        if provider != "api":
            raise

        logger.warning("Groq returned invalid JSON, retrying compact JSON")
        raw = _retry_groq_json(context)
        parsed = _extract_json(raw)
    parsed = _coerce_narrative_root(parsed)
    try:
        result = DungeonNarrative.model_validate(parsed)
    except ValidationError:
        result = _normalize_narrative(parsed, context)
    for room in result.rooms:
        room.label = _compact_text(room.label, 42)
        room.description = _compact_text(room.description, MAX_DESCRIPTION_CHARS)
        room.map_label = _compact_text(
            room.map_label or room.description, MAX_MAP_LABEL_CHARS
        )
        room.content = _coerce_content([item.model_dump() for item in room.content])
        for phrase in BANNED_GEOMETRY_PHRASES:
            room.description = room.description.replace(phrase, "")
            room.map_label = room.map_label.replace(phrase, "")

    expected_ids = set(_room_ids(context))
    result.rooms = [r for r in result.rooms if r.id in expected_ids]

    returned_ids = {r.id for r in result.rooms}
    missing = [rid for rid in _room_ids(context) if rid not in returned_ids]
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

    _ensure_lock_content(result, context)
    expected_unlocks = len(_lock_rows(context))
    actual_unlocks = sum(
        1
        for room in result.rooms
        for item in room.content
        if item.type in UNLOCK_CONTENT_TYPES
    )

    if actual_unlocks != expected_unlocks:
        raise RuntimeError(
            f"Unlock item mismatch: expected {expected_unlocks}, got {actual_unlocks}"
        )
    result.rooms.sort(key=lambda r: r.id)
    return result
