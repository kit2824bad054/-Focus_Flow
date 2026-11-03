const axios = require('axios');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
const ML_SERVICE_TIMEOUT_MS = parseInt(process.env.ML_SERVICE_TIMEOUT_MS, 10) || 3000;

const DAYS_OF_WEEK = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

// In-memory cache for user suggestions (TTL: 10 minutes)
const suggestionsCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Checks in-memory cache for user's cached suggestions
 */
function getCachedSuggestions(userId) {
  if (!userId) return null;
  const key = String(userId);
  const entry = suggestionsCache.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    suggestionsCache.delete(key);
    return null;
  }

  return entry.data;
}

/**
 * Stores suggestions in memory cache with 10-minute TTL
 */
function setCachedSuggestions(userId, data) {
  if (!userId) return;
  const key = String(userId);
  suggestionsCache.set(key, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

/**
 * Invalidates cached suggestions for a specific user.
 * Must be called whenever the user completes a new session.
 */
function invalidateUserCache(userId) {
  if (!userId) return;
  const key = String(userId);
  const existed = suggestionsCache.has(key);
  suggestionsCache.delete(key);
  if (existed) {
    console.log(`[mlService] Cache invalidated for user ${key}`);
  }
}

/**
 * Maps a MongoDB session document (or raw session object) into the format
 * expected by the FastAPI /predict endpoint.
 */
function mapSessionToPredictPayload(session) {
  // 1. time_of_day: formatted 'HH:MM'
  let timeOfDay = session.timeOfDay || session.time_of_day;
  if (!timeOfDay && session.startTime) {
    const d = new Date(session.startTime);
    timeOfDay = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  timeOfDay = timeOfDay || '10:00';

  // 2. day_of_week: 'Monday', 'Tuesday', etc.
  let dayOfWeek = session.dayOfWeek || session.day_of_week;
  if (!dayOfWeek && session.startTime) {
    dayOfWeek = DAYS_OF_WEEK[new Date(session.startTime).getDay()];
  }
  dayOfWeek = dayOfWeek || 'Monday';

  // 3. task_priority: 'High', 'Medium', 'Low', 'None'
  const taskPriority = session.taskPriority || session.task_priority || 'Medium';

  // 4. duration_minutes: number
  const durationMinutes = Number(
    session.durationMinutes || session.duration_minutes || session.duration || 25
  );

  // 5. completed: 1 (completed) or 0 (abandoned)
  let completed = session.completed;
  if (completed === true || completed === 1 || completed === '1') {
    completed = 1;
  } else if (completed === false || completed === 0 || completed === '0') {
    completed = 0;
  } else {
    completed = session.status === 'completed' ? 1 : 0;
  }

  return {
    time_of_day: timeOfDay,
    day_of_week: dayOfWeek,
    task_priority: taskPriority,
    duration_minutes: durationMinutes,
    completed,
  };
}

/**
 * Calls FastAPI /predict endpoint with Axios and maps the response.
 * Handles timeouts, network failure, and response statuses.
 */
async function getSuggestionsForUser(userId, sessions) {
  // 1. Check in-memory cache first
  const cached = getCachedSuggestions(userId);
  if (cached) {
    console.log(`[mlService] Returning cached suggestions for user ${userId}`);
    return { ...cached, cached: true };
  }

  // 2. Fast check: if user has fewer than 10 sessions, return not_enough_data
  if (!sessions || sessions.length < 10) {
    const fallbackResult = {
      status: 'not_enough_data',
      windows: [],
    };
    setCachedSuggestions(userId, fallbackResult);
    return fallbackResult;
  }

  // 3. Map sessions to the expected ML payload
  const mappedSessions = sessions.map(mapSessionToPredictPayload);
  const endpointUrl = `${ML_SERVICE_URL.replace(/\/$/, '')}/predict`;

  try {
    const response = await axios.post(
      endpointUrl,
      { sessions: mappedSessions },
      {
        timeout: ML_SERVICE_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const mlResponse = response.data;

    // Handle 'not_enough_data' from ML service
    if (mlResponse.status === 'not_enough_data') {
      const result = {
        status: 'not_enough_data',
        windows: [],
      };
      setCachedSuggestions(userId, result);
      return result;
    }

    // Handle successful prediction
    const windows = mlResponse.suggested_windows || mlResponse.windows || [];
    const result = {
      status: 'ok',
      windows,
    };

    // Cache the successful result
    setCachedSuggestions(userId, result);
    return result;
  } catch (err) {
    // 5. Failure handling: ML service down, timeout, or HTTP error
    // Log error and return status 'unavailable' with empty windows array
    console.error(
      `[mlService] Error communicating with ML Service at ${endpointUrl}:`,
      err.message
    );
    return {
      status: 'unavailable',
      windows: [],
    };
  }
}

module.exports = {
  getSuggestionsForUser,
  mapSessionToPredictPayload,
  getCachedSuggestions,
  setCachedSuggestions,
  invalidateUserCache,
};

