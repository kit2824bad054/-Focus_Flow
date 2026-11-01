# FocusFlow - Smart Session Suggestions Data Preparation (Phase 1)

This phase prepares the data architecture for FocusFlow's upcoming **Smart Session Suggestions** machine learning feature. It upgrades the MongoDB Mongoose schema to capture fine-grained behavioral signals, provides backfill tooling for legacy documents, and establishes data export pipelines for real and synthetic sessions.

---

## 1. Schema Review & Audit

### Original (Baseline) Session Schema
```javascript
const sessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
  duration: { type: Number, default: 25 },
}, { timestamps: true });
```

### Audit of Required ML Signal Dimensions

| Required Signal | Baseline Schema Status | Upgraded Schema Implementation |
|---|---|---|
| **Session start timestamp** | ❌ Missing (`createdAt` only reflected DB insertion time) | Added `startTime: { type: Date, required: true, default: Date.now, index: true }` |
| **Day of week** | ❌ Missing (required manual runtime parsing) | Added `dayOfWeek: { type: String, enum: ['Sunday', ... 'Saturday'], index: true }` with auto-population pre-save hook |
| **Task priority** | ❌ Missing on Session (resided only in `Task` document) | Added `taskPriority: { type: String, enum: ['Low', 'Medium', 'High', 'None'], default: 'Medium', index: true }` (denormalized for direct ML queries) |
| **Session duration** | ⚠️ Ambiguous (`duration` had no explicit units or constraints) | Standardized to `durationMinutes: { type: Number, required: true, min: 1, default: 25 }` + `actualDurationMinutes` |
| **Completed vs. Abandoned** | ❌ Missing (only completed sessions were stored or no status recorded) | Added `completed: { type: Boolean, required: true, index: true }`, `status: { type: String, enum: ['completed', 'abandoned', 'interrupted'] }`, and `abandonReason` |

---

## 2. Updated Mongoose Schema

The updated schema is located at [`models/Session.js`](file:///c:/Users/Dharani/OneDrive/Documents/Cloud%20project/models/Session.js).
It includes:
- Strict validation and default fallbacks.
- Compound indexes (`{ user: 1, startTime: -1 }` and `{ dayOfWeek: 1, timeOfDay: 1 }`).
- Pre-save hooks to automatically compute `dayOfWeek` from `startTime` and sync legacy `duration` aliases.
- Virtual properties for formatted time strings and categorical time buckets.

---

## 3. Migration & Backfill Note for Existing Documents

For existing documents stored in MongoDB Atlas or local databases that lack these new fields, run:

```bash
npm run migrate:backfill
# Or preview without making changes:
npm run migrate:backfill -- --dry-run
```

### Backfill Logic:
1. **`startTime`**: Populated from `createdAt`, falling back to document timestamp or current date.
2. **`dayOfWeek`**: Derived via calendar index from `startTime`.
3. **`taskPriority`**: Retrieved by querying the linked `Task` document. If the task no longer exists or was unlinked, safely defaulted to `'Medium'`.
4. **`durationMinutes`**: Migrated from legacy `duration` (defaulting to 25 minutes).
5. **`completed` & `status`**: Set to `true` and `'completed'` for all legacy records (as FocusFlow historically only persisted finished sessions).
6. **`actualDurationMinutes`**: Equal to `durationMinutes` for completed sessions.

---

## 4. Scripts Overview

### A. Seed Sample User & Sessions
Creates a test user (`Haridharani B`), associated tasks across High/Medium/Low priorities, and 30 realistic sessions spanning the past 3 weeks.
```bash
npm run seed:sample
```

### B. User Session History Exporter
Connects to MongoDB, extracts a user's session history, cleans features, and exports clean CSV and JSON datasets.
```bash
npm run export:user
# Target specific user:
node scripts/export_user_sessions.js --email=haridharani.focus@example.com --format=both
```
- **Output files**:
  - `exports/user_sessions_<userId>.csv`
  - `exports/user_sessions_<userId>.json`
- **Columns**: `time_of_day,day_of_week,task_priority,duration_minutes,completed`

### C. Synthetic Session Data Generator
Generates realistic multi-user session datasets with behavioral variations (circadian focus curves, fatigue dips, user personas, task priorities).
```bash
npm run generate:synthetic
# Options:
node scripts/generate_synthetic_sessions.js --users=6 --sessionsPerUser=100
```
- **Output files**:
  - `exports/synthetic_sessions.csv` (clean ML features)
  - `exports/synthetic_sessions.json`
  - `exports/synthetic_sessions_full_metadata.json`
- **Database**: Populates the dedicated test collection `synthetic_sessions` in MongoDB without affecting production session data.
