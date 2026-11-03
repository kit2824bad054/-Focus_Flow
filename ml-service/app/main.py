"""FastAPI entrypoint for FocusFlow Smart Session Suggestions ML microservice."""

from contextlib import asynccontextmanager
from typing import Any, Dict

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.model import (
    extract_top_focus_windows,
    get_model_name,
    is_model_loaded,
    load_best_model,
    score_hours_for_user,
)
from app.schemas import (
    FocusWindow,
    HealthResponse,
    PredictRequest,
    PredictResponse,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Loads the trained ML model on startup."""
    print("Initializing FocusFlow ML Microservice...")
    model, metadata = load_best_model()
    if model is not None:
        model_name = get_model_name()
        print(f"Loaded trained model: {model_name}")
    else:
        print("Warning: No pre-trained model found in /models. Run training/train.py first.")
    yield
    print("Shutting down FocusFlow ML Microservice...")


app = FastAPI(
    title="FocusFlow Smart Session Suggestions API",
    description="Python ML microservice providing optimal focus window predictions from Pomodoro session history.",
    version="1.0.0",
    lifespan=lifespan,
)

# Enable CORS for cross-origin requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Formats validation errors into clear, actionable 422 responses."""
    formatted_errors = []
    for err in exc.errors():
        loc = " -> ".join(str(l) for l in err.get("loc", []))
        msg = err.get("msg", "Validation error")
        formatted_errors.append({"field": loc, "error": msg})

    return JSONResponse(
        status_code=422,
        content={
            "status": "validation_error",
            "message": "Input validation failed. Please check the session fields.",
            "errors": formatted_errors,
        },
    )


@app.get("/health", response_model=HealthResponse, tags=["Monitoring"])
def health_check() -> HealthResponse:
    """Returns microservice health status and currently loaded model info."""
    model, metadata = load_best_model()
    loaded = model is not None
    return HealthResponse(
        status="ok" if loaded else "degraded",
        service="FocusFlow ML Microservice",
        model_name=get_model_name(),
        model_loaded=loaded,
        details=metadata,
    )


@app.post("/predict", response_model=PredictResponse, tags=["Inference"])
def predict_focus_windows(payload: PredictRequest) -> PredictResponse:
    """
    Accepts a user's session history and returns the top 3 suggested focus windows.
    - Fallback: returns status 'not_enough_data' if fewer than 10 sessions provided.
    - Scores every hour of the day (0-23) using the trained model and empirical Bayes.
    - Groups adjacent high-scoring hours into windows: {start_hour, end_hour, completion_probability}.
    """
    session_count = len(payload.sessions)

    # 1. Fallback check: Minimum 10 sessions required
    if session_count < 10:
        return PredictResponse(
            status="not_enough_data",
            message=(
                f"At least 10 historical sessions are required to generate personalized "
                f"focus windows (received {session_count})."
            ),
            session_count=session_count,
            suggested_windows=[],
            windows=[],
        )

    # 2. Check model readiness
    model, _ = load_best_model()
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Trained model is not available. Please run training/train.py first.",
        )

    # 3. Score every hour of the day (0-23) for this user
    try:
        hour_scores = score_hours_for_user(
            model=model,
            sessions=payload.sessions,
            target_day=payload.target_day_of_week,
            target_priority=payload.target_task_priority,
            target_duration=payload.target_duration_minutes,
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to score sessions for user: {str(e)}",
        )

    # 4. Group adjacent high-scoring hours into windows
    raw_windows = extract_top_focus_windows(hour_scores, target_count=3)
    windows = [FocusWindow(**w) for w in raw_windows]

    return PredictResponse(
        status="success",
        message="Top suggested focus windows computed successfully.",
        session_count=session_count,
        suggested_windows=windows,
        windows=windows,
    )
