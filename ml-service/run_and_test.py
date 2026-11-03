"""Test runner that starts Uvicorn and tests the API with curl.exe."""

import json
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

# Add ml-service directory to sys.path
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

import uvicorn
from app.main import app

PORT = 8000
HOST = "127.0.0.1"


def run_server(server: uvicorn.Server):
    server.run()


def wait_for_server(timeout=10.0):
    start = time.time()
    url = f"http://{HOST}:{PORT}/health"
    while time.time() - start < timeout:
        try:
            with urllib.request.urlopen(url, timeout=1.0) as response:
                if response.status == 200:
                    return True
        except Exception:
            time.sleep(0.3)
    return False


def run_curl(command_args: list) -> str:
    """Executes curl.exe and returns stdout/stderr."""
    # Ensure Windows curl.exe is used rather than any PowerShell alias
    cmd = ["curl.exe", "-s"] + command_args
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    return proc.stdout.strip() if proc.stdout else proc.stderr.strip()


def main():
    print("=" * 80)
    print("  FOCUSFLOW ML MICROSERVICE - STARTING UVICORN SERVER & CURL TEST SUITE")
    print("=" * 80)

    config = uvicorn.Config(app=app, host=HOST, port=PORT, log_level="warning")
    server = uvicorn.Server(config)

    server_thread = threading.Thread(target=run_server, args=(server,), daemon=True)
    server_thread.start()

    print(f"Waiting for server to become responsive on http://{HOST}:{PORT}...")
    if not wait_for_server(timeout=8.0):
        print("ERROR: Server failed to start within timeout.")
        server.should_exit = True
        sys.exit(1)

    print("Server is UP and HEALTHY!\n")

    try:
        # TEST 1: GET /health
        print("-" * 80)
        print("TEST 1: GET /health")
        print(f"Command: curl.exe http://{HOST}:{PORT}/health")
        print("-" * 80)
        health_out = run_curl([f"http://{HOST}:{PORT}/health"])
        try:
            parsed = json.loads(health_out)
            print(json.dumps(parsed, indent=2))
        except Exception:
            print(health_out)

        # TEST 2: POST /predict with < 10 sessions (FALLBACK TEST)
        print("\n" + "-" * 80)
        print("TEST 2: POST /predict with < 10 sessions (FALLBACK BEHAVIOR)")
        print(f"Command: curl.exe -X POST http://{HOST}:{PORT}/predict with 3 sessions")
        print("-" * 80)
        fallback_payload = {
            "sessions": [
                {
                    "time_of_day": "09:30",
                    "day_of_week": "Monday",
                    "task_priority": "High",
                    "duration_minutes": 25,
                    "completed": 1,
                },
                {
                    "time_of_day": "11:00",
                    "day_of_week": "Tuesday",
                    "task_priority": "Medium",
                    "duration_minutes": 25,
                    "completed": 1,
                },
                {
                    "time_of_day": "16:00",
                    "day_of_week": "Wednesday",
                    "task_priority": "Low",
                    "duration_minutes": 25,
                    "completed": 0,
                },
            ]
        }
        fallback_out = run_curl([
            "-X", "POST",
            f"http://{HOST}:{PORT}/predict",
            "-H", "Content-Type: application/json",
            "-d", json.dumps(fallback_payload),
        ])
        try:
            parsed = json.loads(fallback_out)
            print(json.dumps(parsed, indent=2))
        except Exception:
            print(fallback_out)

        # TEST 3: POST /predict with full session history (>= 10 sessions)
        print("\n" + "-" * 80)
        print("TEST 3: POST /predict with full user session history (>= 10 sessions)")
        print(f"Command: curl.exe -X POST http://{HOST}:{PORT}/predict with realistic study sessions")
        print("-" * 80)
        full_payload = {
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
                {"time_of_day": "10:23", "day_of_week": "Tuesday", "task_priority": "Low", "duration_minutes": 25, "completed": 1},
                {"time_of_day": "14:06", "day_of_week": "Tuesday", "task_priority": "Medium", "duration_minutes": 25, "completed": 1},
                {"time_of_day": "10:49", "day_of_week": "Wednesday", "task_priority": "High", "duration_minutes": 25, "completed": 1},
                {"time_of_day": "10:32", "day_of_week": "Thursday", "task_priority": "High", "duration_minutes": 25, "completed": 1},
                {"time_of_day": "23:15", "day_of_week": "Thursday", "task_priority": "Low", "duration_minutes": 25, "completed": 0},
            ]
        }
        predict_out = run_curl([
            "-X", "POST",
            f"http://{HOST}:{PORT}/predict",
            "-H", "Content-Type: application/json",
            "-d", json.dumps(full_payload),
        ])
        try:
            parsed = json.loads(predict_out)
            print(json.dumps(parsed, indent=2))
        except Exception:
            print(predict_out)

        # TEST 4: POST /predict with invalid data (VALIDATION ERROR TEST)
        print("\n" + "-" * 80)
        print("TEST 4: POST /predict with invalid payload (VALIDATION ERROR HANDLING)")
        print(f"Command: curl.exe -X POST http://{HOST}:{PORT}/predict with invalid fields")
        print("-" * 80)
        invalid_payload = {
            "sessions": [
                {
                    "time_of_day": "29:99",
                    "day_of_week": "Funday",
                    "task_priority": "Urgent",
                    "duration_minutes": -15,
                    "completed": 99,
                }
            ]
        }
        invalid_out = run_curl([
            "-X", "POST",
            f"http://{HOST}:{PORT}/predict",
            "-H", "Content-Type: application/json",
            "-d", json.dumps(invalid_payload),
        ])
        try:
            parsed = json.loads(invalid_out)
            print(json.dumps(parsed, indent=2))
        except Exception:
            print(invalid_out)

    finally:
        print("\n" + "=" * 80)
        print("Shutting down test Uvicorn server...")
        server.should_exit = True
        print("Test suite execution complete.")
        print("=" * 80)


if __name__ == "__main__":
    main()

