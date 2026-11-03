# FocusFlow - Smart Pomodoro Study Tracker with ML Suggestions

> 🌐 **Live Demo Website**: [https://kit2824bad054.github.io/-Focus_Flow/](https://kit2824bad054.github.io/-Focus_Flow/)  
> 🔗 **GitHub Repository**: [https://github.com/kit2824bad054/-Focus_Flow](https://github.com/kit2824bad054/-Focus_Flow)

FocusFlow is a cloud-based MERN-stack Pomodoro study tracker augmented with an autonomous **Python Machine Learning Microservice**. It analyzes historical study sessions (circadian rhythms, fatigue curves, task priorities, and completion trends) to recommend the **top 3 optimal focus time windows** for each user.

---

## 🌟 Key Features

- ⏱️ **Interactive Pomodoro Timer**: Seamless switching between Focus (25m), Short Break (5m), and Long Break (15m), complete with a circular progress dial and audio chime.
- 🧠 **AI Smart Session Suggestions**: Evaluates 24-hour completion probabilities using a trained classification model blended with empirical Bayesian shrinkage.
- 📋 **Task Management**: Prioritized study tasks (High, Medium, Low) integrated with active focus timers.
- 🔒 **Secure Multi-User Architecture**: JWT-based authentication ensuring complete user data isolation.
- ⚡ **High Performance Caching**: In-memory caching with 10-minute TTL and automatic cache invalidation upon session completion.
- 🛡️ **Fault-Tolerant Resilience**: If the ML service is down or times out, the backend gracefully responds with status `"unavailable"` (HTTP 200) without ever failing.

---

## 🏗️ Architecture Overview

```text
[ Browser / Client ] 
        │
        ├──▶ [ Express Backend API (Port 5000) ]
        │         ├── JWT Authentication Middleware
        │         ├── MongoDB Mongoose (Sessions, Tasks, Users)
        │         └── In-Memory Suggestions Cache (10-min TTL)
        │                     │
        │                     ▼ Axios (3000ms timeout)
        │
        └──▶ [ Python ML Microservice (FastAPI - Port 8000) ]
                  ├── Scikit-Learn Model (Random Forest / Logistic Regression)
                  ├── 24-Hour Circadian Focus Scoring
                  └── Adjacent Window Extraction Engine
```

---

## 🚀 Quick Start Guide

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/kit2824bad054/-Focus_Flow.git
cd -Focus_Flow

# Install Node.js backend dependencies
npm install

# Install Python ML dependencies
cd ml-service
pip install -r requirements.txt
cd ..
```

### 2. Configure Environment

Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

```env
PORT=5000
NODE_ENV=development
MONGO_URI=mongodb://127.0.0.1:27017/focusflow
ML_SERVICE_URL=http://localhost:8000
ML_SERVICE_TIMEOUT_MS=3000
JWT_SECRET=focusflow_jwt_secret_key_2026
```

### 3. One-Click Launcher (Windows)
Double-click `start_focusflow.bat` or run:
```bash
.\start_focusflow.bat
```

### Or Start Manually:
```bash
# Terminal 1: Start ML Microservice
cd ml-service
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

# Terminal 2: Start Express Backend & Web App
npm start
```

Open your browser at:
- **Web App**: [http://localhost:5000](http://localhost:5000)
- **ML API Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **Live Demo**: [https://kit2824bad054.github.io/-Focus_Flow/](https://kit2824bad054.github.io/-Focus_Flow/)

---

## 📊 ML Microservice & Model Performance

The Python microservice trains and compares three scikit-learn models on synthetic and empirical Pomodoro session histories:

| Model | Accuracy | Precision | Recall | F1-Score | Status |
|---|---|---|---|---|---|
| **Logistic Regression** | 84.17% | 84.03% | 100.00% | **0.9132** | Selected Best |
| **Random Forest** | 83.33% | 84.48% | 98.00% | 0.9074 | Candidate |
| **Decision Tree** | 79.17% | 84.40% | 92.00% | 0.8804 | Baseline |

### Retrain Model:
```bash
python ml-service/training/train.py
```

---

## 📡 Key API Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | None | System health and MongoDB status |
| `POST` | `/api/auth/register` | None | User registration with JWT generation |
| `POST` | `/api/auth/login` | None | User login and token authentication |
| `GET` | `/api/suggestions` | **JWT** | Returns top 3 suggested focus windows for authenticated user |
| `GET` | `/api/tasks` | Optional | Retrieve user tasks |
| `POST` | `/api/tasks` | Optional | Create new study task |
| `GET` | `/api/sessions` | Optional | Retrieve session history |
| `POST` | `/api/sessions` | Optional | Record session and invalidate ML suggestion cache |

---

## ⚙️ Enabling GitHub Pages

To make the live URL active on GitHub:
1. Go to your GitHub repository: `https://github.com/kit2824bad054/-Focus_Flow`
2. Click **Settings** > **Pages** (under Code and automation)
3. Under **Build and deployment** > **Branch**:
   - Select branch: **`main`**
   - Select folder: **`/docs`**
4. Click **Save**.
5. Your website will be live at: **`https://kit2824bad054.github.io/-Focus_Flow/`**!
