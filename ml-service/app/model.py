"""Machine Learning model management, preprocessing, scoring, and window extraction."""

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import joblib
import numpy as np
import pandas as pd


# Day mapping: Monday=0, Sunday=6 (standard calendar convention)
DAY_MAP: Dict[str, int] = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}

INT_TO_DAY: Dict[int, str] = {
    0: "Monday",
    1: "Tuesday",
    2: "Wednesday",
    3: "Thursday",
    4: "Friday",
    5: "Saturday",
    6: "Sunday",
}

# Priority mapping: Low=0, Medium=1, High=2
PRIORITY_MAP: Dict[str, int] = {
    "low": 0,
    "medium": 1,
    "high": 2,
    "none": 1,
}

INT_TO_PRIORITY: Dict[int, str] = {
    0: "Low",
    1: "Medium",
    2: "High",
}

FEATURE_COLUMNS: List[str] = [
    "time_of_day",
    "day_of_week",
    "task_priority",
    "duration_minutes",
]

# Cached model and metadata
_LOADED_MODEL: Optional[Any] = None
_LOADED_METADATA: Optional[Dict[str, Any]] = None


def get_default_models_dir() -> Path:
    """Finds the models directory specifically inside ml-service/models."""
    current_file = Path(__file__).resolve()
    candidate = current_file.parent.parent / "models"
    candidate.mkdir(parents=True, exist_ok=True)
    return candidate


def load_best_model(model_dir: Optional[Union[str, Path]] = None, force_reload: bool = False) -> Tuple[Optional[Any], Optional[Dict[str, Any]]]:
    """Loads the best model and metadata from disk, caching in memory."""
    global _LOADED_MODEL, _LOADED_METADATA

    if _LOADED_MODEL is not None and not force_reload:
        return _LOADED_MODEL, _LOADED_METADATA

    directory = Path(model_dir) if model_dir else get_default_models_dir()
    model_path = directory / "best_model.joblib"
    meta_path = directory / "metadata.json"

    if not model_path.exists():
        _LOADED_MODEL = None
        _LOADED_METADATA = None
        return None, None

    try:
        _LOADED_MODEL = joblib.load(model_path)
    except Exception as e:
        print(f"Error loading model from {model_path}: {e}")
        _LOADED_MODEL = None
        return None, None

    if meta_path.exists():
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                _LOADED_METADATA = json.load(f)
        except Exception:
            _LOADED_METADATA = {"model_name": type(_LOADED_MODEL).__name__}
    else:
        _LOADED_METADATA = {"model_name": type(_LOADED_MODEL).__name__}

    return _LOADED_MODEL, _LOADED_METADATA


def get_model_name() -> str:
    """Returns the human-readable model name."""
    global _LOADED_MODEL, _LOADED_METADATA
    if _LOADED_METADATA and "model_name" in _LOADED_METADATA:
        return _LOADED_METADATA["model_name"]
    if _LOADED_MODEL is not None:
        return type(_LOADED_MODEL).__name__
    return "None (Model not trained or loaded)"


def is_model_loaded() -> bool:
    """Checks if model is currently loaded."""
    global _LOADED_MODEL
    return _LOADED_MODEL is not None


def parse_time_of_day(val: Union[str, int]) -> int:
    """Parses 'HH:MM' string or int into hour 0-23."""
    if isinstance(val, str):
        parts = val.strip().split(":")
        hour = int(parts[0])
    else:
        hour = int(val)
    if not (0 <= hour <= 23):
        raise ValueError(f"Hour must be between 0 and 23, got {hour}")
    return hour


def parse_day_of_week(val: Union[str, int]) -> int:
    """Parses day name or index into 0-6 (0=Monday, 6=Sunday)."""
    if isinstance(val, str):
        clean = val.strip().lower()
        if clean not in DAY_MAP:
            raise ValueError(f"Unknown day of week: {val}")
        return DAY_MAP[clean]
    day = int(val)
    if not (0 <= day <= 6):
        raise ValueError(f"Day of week index must be 0-6, got {day}")
    return day


def parse_task_priority(val: Union[str, int]) -> int:
    """Parses priority string ('High', 'Medium', 'Low') or int into 0-2."""
    if isinstance(val, str):
        clean = val.strip().lower()
        if clean not in PRIORITY_MAP:
            return 1  # Default to Medium
        return PRIORITY_MAP[clean]
    priority = int(val)
    if not (0 <= priority <= 2):
        return 1
    return priority


def score_hours_for_user(
    model: Any,
    sessions: List[Any],
    target_day: Optional[Union[str, int]] = None,
    target_priority: Optional[Union[str, int]] = None,
    target_duration: Optional[float] = None,
) -> List[float]:
    """
    Scores each hour of the day (0-23) for that specific user.
    Uses the user's historical sessions to extract typical profile parameters,
    evaluates model predictions across hours, and blends personal empirical
    hourly completion rates via Bayesian shrinkage.
    """
    hours_list: List[int] = []
    days_list: List[int] = []
    priorities_list: List[int] = []
    durations_list: List[float] = []
    completions_by_hour: Dict[int, int] = {}
    attempts_by_hour: Dict[int, int] = {}

    for s in sessions:
        # Support both Pydantic model and raw dict
        s_tod = getattr(s, "time_of_day", None) if hasattr(s, "time_of_day") else s.get("time_of_day")
        s_dow = getattr(s, "day_of_week", None) if hasattr(s, "day_of_week") else s.get("day_of_week")
        s_pri = getattr(s, "task_priority", None) if hasattr(s, "task_priority") else s.get("task_priority")
        s_dur = getattr(s, "duration_minutes", None) if hasattr(s, "duration_minutes") else s.get("duration_minutes")
        s_cmp = getattr(s, "completed", None) if hasattr(s, "completed") else s.get("completed")

        h = parse_time_of_day(s_tod)
        d = parse_day_of_week(s_dow)
        p = parse_task_priority(s_pri)
        dur = float(s_dur) if s_dur is not None else 25.0
        comp = 1 if (s_cmp is True or s_cmp == 1) else 0

        hours_list.append(h)
        days_list.append(d)
        priorities_list.append(p)
        durations_list.append(dur)

        attempts_by_hour[h] = attempts_by_hour.get(h, 0) + 1
        completions_by_hour[h] = completions_by_hour.get(h, 0) + comp

    # Determine user typical parameters
    user_duration = float(target_duration) if target_duration is not None else (
        float(np.median(durations_list)) if durations_list else 25.0
    )
    user_priority = parse_task_priority(target_priority) if target_priority is not None else (
        max(set(priorities_list), key=priorities_list.count) if priorities_list else 1
    )

    if target_day is not None:
        eval_days = [parse_day_of_week(target_day)]
    elif days_list:
        # Use user's unique active days from history
        eval_days = sorted(list(set(days_list)))
    else:
        eval_days = list(range(7))

    # Construct batch evaluation DataFrame with exact feature columns
    batch_rows = []
    row_meta = []  # tracks (hour, day)
    for h in range(24):
        for d in eval_days:
            batch_rows.append({
                "time_of_day": h,
                "day_of_week": d,
                "task_priority": user_priority,
                "duration_minutes": user_duration,
            })
            row_meta.append((h, d))

    batch_df = pd.DataFrame(batch_rows)[FEATURE_COLUMNS]

    # Predict probabilities with scikit-learn model
    probs_matrix = model.predict_proba(batch_df)
    # Binary classification: positive class probability (completed=1)
    if probs_matrix.shape[1] == 2:
        pos_probs = probs_matrix[:, 1]
    else:
        pos_probs = probs_matrix[:, 0]

    # Aggregate model probability by hour
    hour_model_probs: Dict[int, List[float]] = {h: [] for h in range(24)}
    for (h, _), prob in zip(row_meta, pos_probs):
        hour_model_probs[h].append(float(prob))

    # Empirical Bayesian blending with user history
    # Prior weight w balances prior ML model against user's specific sample count
    w = 3.0
    hour_final_scores: List[float] = []

    for h in range(24):
        model_p = float(np.mean(hour_model_probs[h]))
        n_h = attempts_by_hour.get(h, 0)
        c_h = completions_by_hour.get(h, 0)

        if n_h > 0:
            user_empirical = c_h / n_h
            # Shrinkage towards model prior
            blended = (n_h * user_empirical + w * model_p) / (n_h + w)
        else:
            blended = model_p

        # Keep strictly bounded in [0.0, 1.0]
        hour_final_scores.append(float(np.clip(blended, 0.0, 1.0)))

    return hour_final_scores


def extract_top_focus_windows(
    hour_scores: List[float],
    target_count: int = 3,
    min_length: int = 2,
    max_length: int = 4,
) -> List[Dict[str, Any]]:
    """
    Groups adjacent high-scoring hours into suggested focus windows.
    Returns the top windows formatted as:
      {
        "start_hour": int,
        "end_hour": int,
        "completion_probability": float
      }
    """
    candidates: List[Dict[str, Any]] = []

    # Generate candidate contiguous windows of length min_length to max_length
    for length in range(min_length, max_length + 1):
        for start in range(len(hour_scores) - length + 1):
            end = start + length - 1
            w_scores = hour_scores[start : end + 1]
            avg_prob = float(np.mean(w_scores))
            candidates.append({
                "start_hour": start,
                "end_hour": end,
                "completion_probability": round(avg_prob, 4),
                "length": length,
            })

    # Sort candidates by probability descending, preferring longer windows on ties
    candidates.sort(key=lambda x: (x["completion_probability"], x["length"]), reverse=True)

    # Greedily pick non-overlapping windows
    selected: List[Dict[str, Any]] = []
    covered_hours: set = set()

    for cand in candidates:
        cand_hours = set(range(cand["start_hour"], cand["end_hour"] + 1))
        if not cand_hours.intersection(covered_hours):
            selected.append({
                "start_hour": cand["start_hour"],
                "end_hour": cand["end_hour"],
                "completion_probability": cand["completion_probability"],
            })
            covered_hours.update(cand_hours)
            if len(selected) == target_count:
                break

    # If fewer than target_count non-overlapping windows exist, backfill with partial overlap
    if len(selected) < target_count:
        for cand in candidates:
            # Check if this exact start/end window is already added
            if any(s["start_hour"] == cand["start_hour"] and s["end_hour"] == cand["end_hour"] for s in selected):
                continue
            selected.append({
                "start_hour": cand["start_hour"],
                "end_hour": cand["end_hour"],
                "completion_probability": cand["completion_probability"],
            })
            if len(selected) == target_count:
                break

    # Sort final selected windows by completion_probability descending
    selected.sort(key=lambda x: x["completion_probability"], reverse=True)
    return selected[:target_count]
