"""Shared, versioned score-source contract.

This module keeps the agent prompt and the service-level enforcer in sync.
Add new score-source keys to config/score_contract.json instead of editing
Python code.
"""

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Set


DEFAULT_CONTRACT = {
    "valid_score_keys": [
        "relevance_score", "relevanceScore", "score", "eval_score", "evalScore",
        "confidence", "confidence_score", "confidenceScore", "confidence_rating",
        "confidenceRating", "rating", "popularity_pct", "popularityPct", "pct",
        "percent", "percentage", "match_score", "matchScore", "relevance",
        "stars_count_pct", "starsCountPct",
    ],
    "raw_metric_score_keys": [
        "rating_out_of_5", "rating_out_of_10", "rating_out_of_100",
        "popularity_pct", "confidence", "relevance_score",
    ],
}


def _contract_path() -> Path:
    """Locate the JSON contract file, falling back to the repo root."""
    env_path = os.environ.get("SCORE_CONTRACT_PATH")
    if env_path:
        return Path(env_path)
    # Default: same directory as this module / config/score_contract.json
    return Path(__file__).resolve().parent / "config" / "score_contract.json"


_CONTRACT_CACHE: Dict[str, Any] = {"mtime": 0.0, "data": DEFAULT_CONTRACT}


def _get_contract_data() -> Dict[str, Any]:
    path = _contract_path()
    if path.exists():
        try:
            mtime = path.stat().st_mtime
            if mtime != _CONTRACT_CACHE["mtime"]:
                _CONTRACT_CACHE["mtime"] = mtime
                _CONTRACT_CACHE["data"] = json.loads(path.read_text(encoding="utf-8"))
            return _CONTRACT_CACHE["data"]
        except Exception:
            pass
    return DEFAULT_CONTRACT


def _ensure_config_file() -> None:
    """Persist the default contract file if it does not yet exist."""
    path = _contract_path()
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(DEFAULT_CONTRACT, indent=2), encoding="utf-8")


_ensure_config_file()


def normalize_score_key(key: str) -> str:
    """Normalize key to lowercase alphanumeric, stripping underscores and hyphens.
    Accepts any casing or separator style (e.g. confidenceScore, ConfidenceScore,
    confidence_score, CONFIDENCE_SCORE -> confidencescore).
    """
    return re.sub(r"[^a-z0-9]", "", str(key).lower())


def get_valid_score_keys() -> Set[str]:
    return set(_get_contract_data().get("valid_score_keys", DEFAULT_CONTRACT["valid_score_keys"]))


def get_raw_metric_score_keys() -> Set[str]:
    return set(_get_contract_data().get("raw_metric_score_keys", DEFAULT_CONTRACT["raw_metric_score_keys"]))


def get_normalized_valid_score_keys() -> Set[str]:
    return {normalize_score_key(k) for k in get_valid_score_keys()}


def get_normalized_raw_metric_score_keys() -> Set[str]:
    return {normalize_score_key(k) for k in get_raw_metric_score_keys()}


def is_valid_score_key(key: str) -> bool:
    return normalize_score_key(key) in get_normalized_valid_score_keys()


def is_valid_raw_metric_score_key(key: str) -> bool:
    return normalize_score_key(key) in get_normalized_raw_metric_score_keys()


def get_score_keys_prompt_fragment() -> str:
    """Return a comma-space separated list for the agent prompt."""
    return ", ".join(sorted(get_valid_score_keys()))

