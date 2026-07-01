import hashlib
import random


def make_rng(seed: str) -> random.Random:
    """Build a Random instance deterministically derived from a string seed.

    Python's built-in hash() is randomized per-process unless PYTHONHASHSEED
    is fixed, so we go through hashlib instead -- same seed string always
    produces the same integer, on any machine, in any process.
    """
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    seed_int = int.from_bytes(digest[:8], "big")
    return random.Random(seed_int)
