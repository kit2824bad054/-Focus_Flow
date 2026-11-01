require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI =
  process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/focusflow';

// Middleware
app.use(express.json());

// Models
const User = require('./models/User');
const Task = require('./models/Task');
const Session = require('./models/Session');
const SyntheticSession = require('./models/SyntheticSession');

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'FocusFlow Backend API',
    mongoStatus: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

// Quick Session Analytics / ML Readiness Endpoint
app.get('/api/sessions/summary', async (req, res) => {
  try {
    const totalSessions = await Session.countDocuments();
    const completedSessions = await Session.countDocuments({ completed: true });
    const abandonedSessions = await Session.countDocuments({ completed: false });
    const syntheticCount = await SyntheticSession.countDocuments();

    res.json({
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
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Connect to MongoDB and start server
async function startServer() {
  try {
    console.log(`Connecting to MongoDB at: ${MONGO_URI}`);
    await mongoose.connect(MONGO_URI);
    console.log('MongoDB connected successfully.');

    app.listen(PORT, () => {
      console.log(`FocusFlow Server running on http://localhost:${PORT}`);
      console.log(`Health Check: http://localhost:${PORT}/api/health`);
      console.log(`Session Summary: http://localhost:${PORT}/api/sessions/summary`);
    });
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
}

startServer();
