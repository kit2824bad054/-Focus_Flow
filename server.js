require('dotenv').config();
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const { authMiddleware, generateToken } = require('./middleware/auth');
const mlService = require('./services/mlService');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI =
  process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/focusflow';

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Models
const User = require('./models/User');
const Task = require('./models/Task');
const Session = require('./models/Session');
const SyntheticSession = require('./models/SyntheticSession');

// Helper to check MongoDB connection status
const isMongoConnected = () => mongoose.connection.readyState === 1;

// ============================================================================
// AUTHENTICATION ROUTES
// ============================================================================

// Register a new user
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    if (isMongoConnected()) {
      let existing = await User.findOne({ email: cleanEmail });
      if (existing) {
        return res.status(400).json({ success: false, error: 'User already exists with this email' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await User.create({
        name: name ? name.trim() : 'FocusFlow User',
        email: cleanEmail,
        password: hashedPassword,
      });

      const token = generateToken(user);
      return res.status(201).json({
        success: true,
        token,
        user: { _id: user._id, name: user.name, email: user.email },
      });
    }

    // Standalone fallback
    const user = { _id: `user_${Date.now()}`, name: name || 'User', email: cleanEmail };
    const token = generateToken(user);
    res.status(201).json({ success: true, token, user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Login user and return JWT
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    if (isMongoConnected()) {
      const user = await User.findOne({ email: cleanEmail });
      if (!user) {
        return res.status(401).json({ success: false, error: 'Invalid email or password' });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ success: false, error: 'Invalid email or password' });
      }

      const token = generateToken(user);
      return res.json({
        success: true,
        token,
        user: { _id: user._id, name: user.name, email: user.email },
      });
    }

    // Standalone fallback for testing
    const fallbackUser = { _id: 'sample_user_id', name: 'Demo User', email: cleanEmail };
    const token = generateToken(fallbackUser);
    res.json({ success: true, token, user: fallbackUser });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Demo/Dev token generator endpoint (convenience for testing or frontend)
app.get('/api/auth/demo-token', async (req, res) => {
  try {
    const email = req.query.email || 'haridharani.focus@example.com';
    let user = null;
    if (isMongoConnected()) {
      user = await User.findOne({ email: email.toLowerCase().trim() });
    }
    if (!user) {
      user = { _id: '6ae7570f45d6abbc3c5550cc', name: 'Haridharani B', email };
    }
    const token = generateToken(user);
    res.json({ success: true, token, user: { _id: user._id, email: user.email, name: user.name } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// SYSTEM & HEALTH ROUTES
// ============================================================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'FocusFlow Backend API',
    mongoStatus: isMongoConnected() ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/sessions/summary', async (req, res) => {
  try {
    if (isMongoConnected()) {
      const totalSessions = await Session.countDocuments();
      const completedSessions = await Session.countDocuments({ completed: true });
      const abandonedSessions = await Session.countDocuments({ completed: false });
      const syntheticCount = await SyntheticSession.countDocuments();

      return res.json({
        success: true,
        data: {
          totalRealSessions: totalSessions,
          completedSessions,
          abandonedSessions,
          completionRate:
            totalSessions > 0
              ? `${((completedSessions / totalSessions) * 100).toFixed(1)}%`
              : '0%',
          syntheticSessionsReady: syntheticCount,
        },
      });
    }

    res.json({
      success: true,
      data: {
        totalRealSessions: 30,
        completedSessions: 26,
        abandonedSessions: 4,
        completionRate: '86.7%',
        syntheticSessionsReady: 600,
        mode: 'standalone',
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// SMART SESSION SUGGESTIONS ENDPOINT (PROTECTED BY JWT)
// ============================================================================

/**
 * GET /api/suggestions
 * Protected by JWT auth middleware.
 * Loads only the authenticated user's sessions from MongoDB, calls the ML service,
 * caches the result with 10-minute TTL, and returns:
 * { status: "ok" | "not_enough_data" | "unavailable", windows: [...] }
 *
 * Never returns 500 when the ML service is down or fails.
 */
app.get('/api/suggestions', authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id;

    // Load ONLY the authenticated user's sessions
    let userSessions = [];
    if (isMongoConnected()) {
      userSessions = await Session.find({ user: userId }).sort({ startTime: -1 });
    }

    // Call mlService with user isolation and in-memory caching
    const result = await mlService.getSuggestionsForUser(userId, userSessions);

    // Return exact status and windows
    return res.status(200).json(result);
  } catch (err) {
    console.error('[GET /api/suggestions] Internal handler error:', err.message);
    // Safe failure handling: never return 500 because of ML service integration
    return res.status(200).json({
      status: 'unavailable',
      windows: [],
    });
  }
});

// ============================================================================
// TASKS ROUTES
// ============================================================================

app.get('/api/tasks', async (req, res) => {
  try {
    if (isMongoConnected()) {
      const filter = req.query.user ? { user: req.query.user } : {};
      const tasks = await Task.find(filter).sort({ createdAt: -1 });
      return res.json({ success: true, tasks });
    }
    res.json({ success: true, tasks: [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/tasks', async (req, res) => {
  try {
    const { title, priority, estimatedPomodoros, userId } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'Task title is required' });
    }

    if (isMongoConnected()) {
      const newTask = await Task.create({
        user: userId || null,
        title: title.trim(),
        priority: priority || 'Medium',
        estimatedPomodoros: Number(estimatedPomodoros) || 1,
        completedPomodoros: 0,
        completed: false,
      });
      return res.json({ success: true, task: newTask });
    }

    res.json({ success: true, task: { _id: `task_${Date.now()}`, title, priority } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/tasks/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;
    if (isMongoConnected()) {
      const task = await Task.findById(id);
      if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
      task.completed = !task.completed;
      await task.save();
      return res.json({ success: true, task });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (isMongoConnected()) {
      await Task.findByIdAndDelete(id);
      return res.json({ success: true });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// SESSIONS ROUTES
// ============================================================================

app.get('/api/sessions', async (req, res) => {
  try {
    if (isMongoConnected()) {
      const filter = req.query.user ? { user: req.query.user } : {};
      const sessions = await Session.find(filter).sort({ startTime: -1 }).limit(30);
      return res.json({ success: true, sessions });
    }
    res.json({ success: true, sessions: [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/sessions
 * Creates a new session document and invalidates the user's ML suggestions cache.
 */
app.post('/api/sessions', async (req, res) => {
  try {
    // Extract userId from Authorization header if present, or from body
    let userId = null;
    const authHeader = req.header('Authorization');
    if (authHeader) {
      try {
        const token = authHeader.replace('Bearer ', '').trim();
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'focusflow_jwt_secret_key_2026');
        userId = decoded.id || decoded.userId || decoded._id;
      } catch (e) {
        // Continue if unauthenticated
      }
    }
    if (!userId && req.body.userId) {
      userId = req.body.userId;
    }

    const { durationMinutes, completed, taskPriority, timeOfDay, dayOfWeek, task } = req.body;
    const now = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const newSessionData = {
      user: userId || undefined,
      task: task || undefined,
      startTime: now,
      dayOfWeek: dayOfWeek || days[now.getDay()],
      taskPriority: taskPriority || 'Medium',
      durationMinutes: Number(durationMinutes) || 25,
      actualDurationMinutes: Number(durationMinutes) || 25,
      completed: completed !== false,
      status: completed !== false ? 'completed' : 'abandoned',
    };

    let savedSession = newSessionData;
    if (isMongoConnected() && userId) {
      savedSession = await Session.create(newSessionData);
    }

    // REQUIREMENT 4: Invalidate user's ML suggestion cache whenever a session is completed
    if (userId) {
      mlService.invalidateUserCache(userId);
    }

    res.status(201).json({ success: true, session: savedSession });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Root route fallback
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Express Server
const server = app.listen(PORT, () => {
  console.log('='.repeat(70));
  console.log(`  FOCUSFLOW BACKEND API WITH ML INTEGRATION LIVE`);
  console.log('='.repeat(70));
  console.log(`  -> Server URL       : http://localhost:${PORT}`);
  console.log(`  -> ML Service Target: ${process.env.ML_SERVICE_URL || 'http://localhost:8000'}`);
  console.log(`  -> ML Suggestions   : GET http://localhost:${PORT}/api/suggestions (JWT Protected)`);
  console.log('='.repeat(70));
});

// Attempt MongoDB connection asynchronously
mongoose
  .connect(MONGO_URI, { serverSelectionTimeoutMS: 2500 })
  .then(() => {
    console.log('MongoDB connected successfully.');
  })
  .catch((err) => {
    console.log(`MongoDB connection note: ${err.message}`);
  });

module.exports = app;
