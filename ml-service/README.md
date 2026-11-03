# FocusFlow - Smart Session Suggestions (ML Microservice)

This microservice provides machine learning capabilities for FocusFlow, predicting optimal focus windows based on historical Pomodoro study sessions.

It runs as an independent Python FastAPI service that ingests clean session history, evaluates 24-hour completion probabilities using a trained classification model blended with empirical Bayesian shrinkage, and groups peak focus hours into actionable study windows.

---

## 1. Directory Structure

```text
ml-service/
├── app/
│   ├── __init__.py
│   ├── main.py        # FastAPI entrypoint, routes (/health, /predict), and exception handlers
│   ├── model.py       # Model lifecycle, hour scoring, and window extraction algorithms
│   └── schemas.py     # Pydantic data schemas, validators, and serialization models
├── models/
│   ├── best_model.joblib # Serialized scikit-learn model artifact
│   └── metadata.json     # Training metrics, feature schema, and comparison history
├── training/
│   ├── __init__.py
│   └── train.py       # Training pipeline comparing Logistic Regression, Decision Tree & Random Forest
├── requirements.txt   # Python dependency specifications
└── README.md          # Setup and operational instructions
```

---

## 2. Installation & Setup

Ensure Python 3.10+ is installed. Navigate to the `ml-service` directory (or workspace root) and install dependencies:

```bash
cd ml-service
pip install -r requirements.txt
```

### Dependencies
- **FastAPI & Uvicorn**: High-performance asynchronous REST API framework
- **scikit-learn**: Classification models, metrics, and data splitting
- **pandas & numpy**: Tabular data manipulation and numerical operations
- **joblib**: Model serialization and disk persistence
- **pydantic**: Request payload parsing and strict validation

---

## 3. Training the Model

The training script loads the synthetic Pomodoro dataset from Phase 1 (`exports/synthetic_sessions.csv`), extracts the required feature dimensions, performs an 80/20 stratified split, and trains three candidate models:

1. **Logistic Regression**
2. **Decision Tree**
3. **Random Forest**

### Features Extracted:
- `time_of_day`: Hour of session initiation ($0 \dots 23$)
- `day_of_week`: Day index ($0 = \text{Monday} \dots 6 = \text{Sunday}$)
- `task_priority`: Ordinal encoding ($\text{Low} = 0, \text{Medium} = 1, \text{High} = 2$)
- `duration_minutes`: Planned session duration in minutes (e.g., $15, 25, 30, 45, 50$)

### Target:
- `completed`: Binary target ($1 = \text{Completed}, 0 = \text{Abandoned}$)

### Run Training:
```bash
# From workspace root:
python ml-service/training/train.py

# Or from within ml-service directory:
python training/train.py
```

### Output:
The script logs a model comparison table across Accuracy, Precision, Recall, and F1-Score, selects the best model, and saves:
- `ml-service/models/best_model.joblib`
- `ml-service/models/metadata.json`

---

## 4. Running the Server

Start the microservice using Uvicorn:

```bash
# From ml-service directory:
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Or from workspace root:
python -m uvicorn app.main:app --app-dir ml-service --host 0.0.0.0 --port 8000 --reload
```

The service will start on `http://localhost:8000`.
- Interactive API Docs (Swagger): [http://localhost:8000/docs](http://localhost:8000/docs)
- Alternate Docs (ReDoc): [http://localhost:8000/redoc](http://localhost:8000/redoc)

---

## 5. API Reference & Sample Requests

### A. Health Check (`GET /health`)
Returns service status, loaded model name, and metadata details.

#### Request:
```bash
curl -X GET http://localhost:8000/health
```

#### Response (`200 OK`):
```json
{
  "status": "ok",
  "service": "FocusFlow ML Microservice",
  "model_name": "Logistic Regression",
  "model_loaded": true,
  "details": {
    "model_name": "Logistic Regression",
    "dataset_rows": 600,
    "best_metrics": {
      "accuracy": 0.8417,
      "precision": 0.8403,
      "recall": 1.0,
      "f1_score": 0.9132
    }
  }
}
```

---

### B. Optimal Focus Windows Prediction (`POST /predict`)
Evaluates historical Pomodoro sessions and returns top 3 recommended focus windows.

#### Request (Normal User with $\ge 10$ sessions):
```bash
curl -X POST http://localhost:8000/predict \
  -H "Content-Type: application/json" \
  -d '{
    "sessions": [
      {"time_of_day": "10:13", "day_of_week": "Tuesday", "task_priority": "High", "duration_minutes": 25, "completed": 1},
      {"time_of_day": "10:56", "day_of_week": "Wednesday", "task_priority": "High", "duration_minutes": 25, "completed": 1},
      {"time_of_day": "14:39", "day_of_week": "Wednesday", "task_priority": "Low", "duration_minutes": 25, "completed": 0},
      {"time_of_day": "10:22", "day_of_week": "Thursday", "task_priority": "Medium", "duration_minutes": 25, "completed": 1},
      {"time_of_day": "14:48", "day_of_week": "Friday", "task_priority": "High", "duration_minutes": 25, "completed": 1},
      {"time_of_day": "23:05", "day_of_week": "Friday", "task_priority": "High", "duration_minutes": 25, "completed": 0},
      {"time_of_day": "10:31", "day_of_week": "Saturday", "task_priority": "Low", "duration_minutes": 25, "completed": 1},
      {"time_of_day": "10:14", "day_of_week": "Sunday", "task_priority": "Medium", "duration_minutes": 25, "completed": 1},
      {"time_of_day": "14:57", "day_of_week": "Sunday", "task_priority": "High", "duration_minutes": 25, "completed": 1},
      {"time_of_day": "23:40", "day_of_week": "Monday", "task_priority": "High", "duration_minutes": 25, "completed": 1},
      {"time_of_day": "10:23", "day_of_week": "Tuesday", "task_priority": "Low", "duration_minutes": 25, "completed": 1}
    ]
  }'
```

#### Response (`200 OK`):
```json
{
  "status": "success",
  "message": "Top suggested focus windows computed successfully.",
  "session_count": 11,
  "suggested_windows": [
    {
      "start_hour": 10,
      "end_hour": 11,
      "completion_probability": 0.9768
    },
    {
      "start_hour": 12,
      "end_hour": 13,
      "completion_probability": 0.9604
    },
    {
      "start_hour": 15,
      "end_hour": 17,
      "completion_probability": 0.9524
    }
  ],
  "windows": [
    {
      "start_hour": 10,
      "end_hour": 11,
      "completion_probability": 0.9768
    },
    {
      "start_hour": 12,
      "end_hour": 13,
      "completion_probability": 0.9604
    },
    {
      "start_hour": 15,
      "end_hour": 17,
      "completion_probability": 0.9524
    }
  ]
}
```

---

### C. Fallback: Cold Start / Insufficient Data (< 10 Sessions)
When a user has fewer than 10 sessions logged, the API returns a clean `not_enough_data` status without generating speculative predictions.

#### Request (< 10 Sessions):
```bash
curl -X POST http://localhost:8000/predict \
  -H "Content-Type: application/json" \
  -d '{
    "sessions": [
      {"time_of_day": "09:30", "day_of_week": "Monday", "task_priority": "High", "duration_minutes": 25, "completed": 1},
      {"time_of_day": "14:00", "day_of_week": "Tuesday", "task_priority": "Medium", "duration_minutes": 25, "completed": 1}
    ]
  }'
```

#### Response (`200 OK`):
```json
{
  "status": "not_enough_data",
  "message": "At least 10 historical sessions are required to generate personalized focus windows (received 2).",
  "session_count": 2,
  "suggested_windows": [],
  "windows": []
}
```

---

### D. Input Validation Error Handling (`422 Unprocessable Entity`)
Invalid input (e.g., negative duration, invalid priority, bad time format) triggers structured 422 JSON errors:

#### Request (Invalid Data):
```bash
curl -X POST http://localhost:8000/predict \
  -H "Content-Type: application/json" \
  -d '{
    "sessions": [
      {"time_of_day": "invalid-time", "day_of_week": "Funday", "task_priority": "Urgent", "duration_minutes": -10, "completed": 5}
    ]
  }'
```

#### Response (`422 Unprocessable Entity`):
```json
{
  "status": "validation_error",
  "message": "Input validation failed. Please check the session fields.",
  "errors": [
    {
      "field": "body -> sessions -> 0 -> time_of_day",
      "error": "Value error, Invalid time_of_day format 'invalid-time'. Expected 'HH:MM' (00:00-23:59)..."
    },
    {
      "field": "body -> sessions -> 0 -> day_of_week",
      "error": "Value error, Invalid day_of_week 'Funday'. Must be one of: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday"
    },
    {
      "field": "body -> sessions -> 0 -> duration_minutes",
      "error": "Input should be greater than 0"
    }
  ]
}
```

