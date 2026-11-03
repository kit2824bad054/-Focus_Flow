"""FocusFlow - Train and compare Pomodoro completion prediction models."""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Tuple

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score
from sklearn.model_selection import train_test_split
from sklearn.tree import DecisionTreeClassifier


# Day of week mapping: Monday=0, Sunday=6
DAY_MAP = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}

# Task priority ordinal mapping: Low=0, Medium=1, High=2
PRIORITY_MAP = {
    "low": 0,
    "medium": 1,
    "high": 2,
    "none": 1,
}

FEATURE_COLUMNS = ["time_of_day", "day_of_week", "task_priority", "duration_minutes"]


def resolve_data_path(custom_path: str = None) -> Path:
    """Finds the Phase 1 synthetic sessions CSV across potential working directories."""
    if custom_path:
        p = Path(custom_path)
        if p.exists():
            return p

    candidates = [
        Path.cwd() / "exports" / "synthetic_sessions.csv",
        Path.cwd() / ".." / "exports" / "synthetic_sessions.csv",
        Path(__file__).resolve().parent.parent.parent / "exports" / "synthetic_sessions.csv",
        Path(__file__).resolve().parent.parent / "exports" / "synthetic_sessions.csv",
    ]

    for cand in candidates:
        if cand.exists():
            return cand.resolve()

    raise FileNotFoundError(
        "Could not locate synthetic_sessions.csv in standard locations. "
        "Please provide --data-path <path_to_csv>."
    )


def resolve_models_dir(custom_dir: str = None) -> Path:
    """Finds or creates the target models directory (ml-service/models) for saving artifacts."""
    if custom_dir:
        p = Path(custom_dir)
        p.mkdir(parents=True, exist_ok=True)
        return p

    # Specifically resolve to ml-service/models
    ml_models = Path(__file__).resolve().parent.parent / "models"
    ml_models.mkdir(parents=True, exist_ok=True)
    return ml_models


def preprocess_data(df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.Series]:
    """Preprocesses raw synthetic session CSV rows into model-ready numerical features."""
    clean_df = df.copy()

    # 1. Feature: time_of_day (hour 0-23)
    def parse_hour(val):
        s = str(val).strip()
        if ":" in s:
            return int(s.split(":")[0])
        return int(float(s))

    clean_df["time_of_day"] = clean_df["time_of_day"].apply(parse_hour)

    # 2. Feature: day_of_week (0-6)
    def parse_day(val):
        s = str(val).strip().lower()
        if s in DAY_MAP:
            return DAY_MAP[s]
        return int(float(s))

    clean_df["day_of_week"] = clean_df["day_of_week"].apply(parse_day)

    # 3. Feature: task_priority (Low=0, Medium=1, High=2)
    def parse_priority(val):
        s = str(val).strip().lower()
        if s in PRIORITY_MAP:
            return PRIORITY_MAP[s]
        return int(float(s))

    clean_df["task_priority"] = clean_df["task_priority"].apply(parse_priority)

    # 4. Feature: duration_minutes (numeric)
    clean_df["duration_minutes"] = clean_df["duration_minutes"].astype(float)

    # 5. Target: completed (0 or 1)
    clean_df["completed"] = clean_df["completed"].astype(int)

    X = clean_df[FEATURE_COLUMNS]
    y = clean_df["completed"]

    return X, y


def train_and_evaluate(data_path: Path, models_dir: Path):
    """Loads CSV, trains 3 scikit-learn models, prints comparison, and saves the best model."""
    print("=" * 88)
    print("        FOCUSFLOW SMART SESSION SUGGESTIONS - MODEL TRAINING & COMPARISON")
    print("=" * 88)
    print(f"Loading dataset from : {data_path}")

    raw_df = pd.read_csv(data_path)
    print(f"Total session records: {len(raw_df)}")
    print(f"Columns present      : {list(raw_df.columns)}")

    X, y = preprocess_data(raw_df)
    class_counts = y.value_counts().to_dict()
    print(f"Class distribution   : Completed (1) = {class_counts.get(1, 0)}, Abandoned (0) = {class_counts.get(0, 0)}")

    # 80/20 train/test split with stratification
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=42, stratify=y
    )
    print(f"Train set size       : {len(X_train)} samples")
    print(f"Test set size        : {len(X_test)} samples (20%)")
    print("-" * 88)

    # Models to compare
    candidate_models = {
        "Logistic Regression": LogisticRegression(
            max_iter=1000,
            random_state=42,
        ),
        "Decision Tree": DecisionTreeClassifier(
            max_depth=5,
            min_samples_leaf=4,
            random_state=42,
        ),
        "Random Forest": RandomForestClassifier(
            n_estimators=100,
            max_depth=6,
            min_samples_leaf=3,
            random_state=42,
        ),
    }

    results: Dict[str, Dict[str, float]] = {}

    for name, model in candidate_models.items():
        # Fit on training partition
        model.fit(X_train, y_train)

        # Predict on held-out test partition
        y_pred = model.predict(X_test)

        acc = accuracy_score(y_test, y_pred)
        prec = precision_score(y_test, y_pred, zero_division=0)
        rec = recall_score(y_test, y_pred, zero_division=0)
        f1 = f1_score(y_test, y_pred, zero_division=0)

        results[name] = {
            "accuracy": round(float(acc), 4),
            "precision": round(float(prec), 4),
            "recall": round(float(rec), 4),
            "f1_score": round(float(f1), 4),
            "model_instance": model,
        }

    # Format and print the comparison table
    print("\n" + "=" * 88)
    print("                              MODEL PERFORMANCE COMPARISON")
    print("=" * 88)
    header = f"{'Model':<24} | {'Accuracy':<10} | {'Precision':<10} | {'Recall':<10} | {'F1-Score':<10} | {'Selection'}"
    print(header)
    print("-" * 88)

    # Selection: rank by F1-Score, breaking ties by accuracy
    ranked_names = sorted(
        results.keys(),
        key=lambda k: (results[k]["f1_score"], results[k]["accuracy"]),
        reverse=True,
    )
    best_name = ranked_names[0]

    for name in results:
        res = results[name]
        is_best = (name == best_name)
        flag = "* SELECTED BEST" if is_best else ""
        row = (
            f"{name:<24} | "
            f"{res['accuracy']:<10.4f} | "
            f"{res['precision']:<10.4f} | "
            f"{res['recall']:<10.4f} | "
            f"{res['f1_score']:<10.4f} | "
            f"{flag}"
        )
        print(row)

    print("=" * 88)
    print(f"\nBest Model: '{best_name}'")
    print(f"Metrics   : Accuracy={results[best_name]['accuracy']}, "
          f"Precision={results[best_name]['precision']}, "
          f"Recall={results[best_name]['recall']}, "
          f"F1={results[best_name]['f1_score']}")

    # Save best model and metadata
    best_model_obj = results[best_name]["model_instance"]
    model_save_path = models_dir / "best_model.joblib"
    meta_save_path = models_dir / "metadata.json"

    joblib.dump(best_model_obj, model_save_path)
    print(f"\nSaved best model to : {model_save_path}")

    # Build metadata summary
    comparison_summary = {}
    for name, d in results.items():
        comparison_summary[name] = {
            "accuracy": d["accuracy"],
            "precision": d["precision"],
            "recall": d["recall"],
            "f1_score": d["f1_score"],
        }

    metadata = {
        "model_name": best_name,
        "model_class": type(best_model_obj).__name__,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "dataset_rows": len(raw_df),
        "features": FEATURE_COLUMNS,
        "best_metrics": {
            "accuracy": results[best_name]["accuracy"],
            "precision": results[best_name]["precision"],
            "recall": results[best_name]["recall"],
            "f1_score": results[best_name]["f1_score"],
        },
        "comparison": comparison_summary,
    }

    with open(meta_save_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    print(f"Saved metadata to   : {meta_save_path}")
    print("\nTraining completed successfully.")


def main():
    parser = argparse.ArgumentParser(description="Train and evaluate FocusFlow session models.")
    parser.add_argument("--data-path", type=str, default=None, help="Path to synthetic_sessions.csv")
    parser.add_argument("--models-dir", type=str, default=None, help="Directory to save trained model artifacts")
    args = parser.parse_args()

    data_path = resolve_data_path(args.data_path)
    models_dir = resolve_models_dir(args.models_dir)
    train_and_evaluate(data_path, models_dir)


if __name__ == "__main__":
    main()
