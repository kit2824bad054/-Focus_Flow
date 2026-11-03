@echo off
echo ========================================================
echo        STARTING FOCUSFLOW STUDY TRACKER
echo ========================================================
echo.

cd /d "%~dp0"

echo [1/2] Starting Python ML Microservice on port 8000...
start "FocusFlow ML Service" cmd /k "cd /d %~dp0ml-service && python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"

timeout /t 2 /nobreak >nul

echo [2/2] Starting Node.js Backend & Web App on port 5000...
start "FocusFlow Web Server" cmd /k "cd /d %~dp0 && npm start"

timeout /t 2 /nobreak >nul

echo Opening FocusFlow in your browser...
start http://localhost:5000

echo.
echo ========================================================
echo  FocusFlow is running!
echo  Website: http://localhost:5000
echo  ML Docs: http://localhost:8000/docs
echo ========================================================

