"""Pydantic schemas and input validation for FocusFlow ML microservice."""

from typing import List, Optional, Union
from pydantic import BaseModel, Field, field_validator


VALID_DAYS = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}

VALID_PRIORITIES = {
    "low": 0,
    "medium": 1,
    "high": 2,
    "none": 1,
}


class SessionItem(BaseModel):
    """Represents a single Pomodoro focus session from user history."""

    time_of_day: Union[str, int] = Field(
        ...,
        description="Session start time formatted as 'HH:MM' (e.g., '14:30') or integer hour (0-23)",
        examples=["14:30", 14],
    )
    day_of_week: Union[str, int] = Field(
        ...,
        description="Day of week as name (e.g., 'Monday') or index (0=Monday to 6=Sunday)",
        examples=["Monday", 0],
    )
    task_priority: Union[str, int] = Field(
        ...,
        description="Task priority level: 'High', 'Medium', 'Low', 'None' (or encoded 0-2)",
        examples=["High", 2],
    )
    duration_minutes: float = Field(
        ...,
        gt=0,
        le=240,
        description="Session duration in minutes (e.g. 25)",
        examples=[25.0],
    )
    completed: Union[int, bool] = Field(
        ...,
        description="Completion indicator: 1/True (completed), 0/False (abandoned)",
        examples=[1, True],
    )

    @field_validator("time_of_day")
    @classmethod
    def validate_time_of_day(cls, v: Union[str, int]) -> Union[str, int]:
        if isinstance(v, str):
            parts = v.strip().split(":")
            try:
                hour = int(parts[0])
                if len(parts) > 1:
                    minute = int(parts[1])
                    if not (0 <= minute <= 59):
                        raise ValueError(f"Minute must be between 0 and 59, got {minute}")
                if not (0 <= hour <= 23):
                    raise ValueError(f"Hour must be between 0 and 23, got {hour}")
                return v
            except ValueError as e:
                raise ValueError(f"Invalid time_of_day format '{v}'. Expected 'HH:MM' (00:00-23:59): {e}")
        elif isinstance(v, int):
            if not (0 <= v <= 23):
                raise ValueError(f"Integer hour must be between 0 and 23, got {v}")
            return v
        raise ValueError(f"time_of_day must be string 'HH:MM' or integer hour 0-23, got {type(v)}")

    @field_validator("day_of_week")
    @classmethod
    def validate_day_of_week(cls, v: Union[str, int]) -> Union[str, int]:
        if isinstance(v, str):
            clean = v.strip().lower()
            if clean not in VALID_DAYS:
                valid_list = ", ".join(k.capitalize() for k in VALID_DAYS.keys())
                raise ValueError(f"Invalid day_of_week '{v}'. Must be one of: {valid_list}")
            return v
        elif isinstance(v, int):
            if not (0 <= v <= 6):
                raise ValueError(f"Integer day_of_week must be between 0 (Monday) and 6 (Sunday), got {v}")
            return v
        raise ValueError(f"day_of_week must be string day name or integer 0-6, got {type(v)}")

    @field_validator("task_priority")
    @classmethod
    def validate_task_priority(cls, v: Union[str, int]) -> Union[str, int]:
        if isinstance(v, str):
            clean = v.strip().lower()
            if clean not in VALID_PRIORITIES:
                valid_list = ", ".join(k.capitalize() for k in ["Low", "Medium", "High", "None"])
                raise ValueError(f"Invalid task_priority '{v}'. Must be one of: {valid_list}")
            return v
        elif isinstance(v, int):
            if not (0 <= v <= 2):
                raise ValueError(f"Integer task_priority must be 0 (Low), 1 (Medium), or 2 (High), got {v}")
            return v
        raise ValueError(f"task_priority must be string or integer 0-2, got {type(v)}")

    @field_validator("completed")
    @classmethod
    def validate_completed(cls, v: Union[int, bool]) -> int:
        if isinstance(v, bool):
            return 1 if v else 0
        if isinstance(v, int):
            if v in (0, 1):
                return v
            raise ValueError(f"completed must be 0 or 1, got {v}")
        raise ValueError(f"completed must be a boolean or 0/1 integer, got {type(v)}")


class PredictRequest(BaseModel):
    """Request payload for /predict endpoint."""

    sessions: List[SessionItem] = Field(
        ...,
        description="Historical Pomodoro sessions for the user (at least 10 required for full prediction)",
    )
    target_day_of_week: Optional[Union[str, int]] = Field(
        None,
        description="Optional day of week to evaluate focus windows for. If omitted, uses user's active days.",
    )
    target_task_priority: Optional[Union[str, int]] = Field(
        None,
        description="Optional task priority ('High', 'Medium', 'Low'). If omitted, uses user's typical priority.",
    )
    target_duration_minutes: Optional[float] = Field(
        None,
        gt=0,
        le=240,
        description="Optional session duration target in minutes. If omitted, uses user's median duration.",
    )


class FocusWindow(BaseModel):
    """Represents a suggested focus time window with predicted completion probability."""

    start_hour: int = Field(
        ...,
        ge=0,
        le=23,
        description="Start hour of focus window (0-23)",
        examples=[9],
    )
    end_hour: int = Field(
        ...,
        ge=0,
        le=23,
        description="End hour of focus window (0-23)",
        examples=[11],
    )
    completion_probability: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Predicted probability of successfully completing focus sessions in this window",
        examples=[0.9425],
    )


class PredictResponse(BaseModel):
    """Response returned by /predict endpoint."""

    status: str = Field(
        ...,
        description="Outcome status: 'success' when windows generated, 'not_enough_data' when < 10 sessions",
        examples=["success", "not_enough_data"],
    )
    message: Optional[str] = Field(
        None,
        description="Informative message about the prediction result or data threshold status",
    )
    session_count: int = Field(
        ...,
        description="Number of sessions provided in the request payload",
        examples=[31],
    )
    suggested_windows: List[FocusWindow] = Field(
        default_factory=list,
        description="Top 3 suggested focus windows grouped from high-scoring adjacent hours",
    )
    windows: List[FocusWindow] = Field(
        default_factory=list,
        description="Convenience alias for suggested_windows",
    )


class HealthResponse(BaseModel):
    """Response returned by /health endpoint."""

    status: str = Field(..., description="Service status: 'ok' or 'degraded'")
    service: str = Field("FocusFlow ML Microservice", description="Service identifier")
    model_name: str = Field(..., description="Name of the loaded scikit-learn model")
    model_loaded: bool = Field(..., description="Whether a trained model is loaded in memory")
    details: Optional[dict] = Field(default=None, description="Additional model metadata if available")

