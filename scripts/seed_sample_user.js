/**
 * FocusFlow - Seed Sample User & Sessions
 * ---------------------------------------------------------------------------
 * Creates a sample FocusFlow user with realistic study tasks and past
 * Pomodoro sessions in the primary 'sessions' collection.
 * Includes both legacy-formatted sessions (to demonstrate backfill) and
 * modern sessions with all 5 new ML fields.
 *
 * Usage:
 *   node scripts/seed_sample_user.js
 * ---------------------------------------------------------------------------
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Task = require('../models/Task');
const Session = require('../models/Session');

const MONGO_URI =
  process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/focusflow';

const DAYS_OF_WEEK = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

async function seedSampleUser() {
  console.log('='.repeat(70));
  console.log('  FOCUSFLOW SEED: SAMPLE USER & SESSION HISTORY');
  console.log('='.repeat(70));
  console.log(`Target: ${MONGO_URI}`);

  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB.');

    // 1. Create or retrieve test user
    const email = 'haridharani.focus@example.com';
    let user = await User.findOne({ email });
    if (!user) {
      const hashedPassword = await bcrypt.hash('FocusFlow@2026', 10);
      user = await User.create({
        name: 'Haridharani B',
        email,
        password: hashedPassword,
      });
      console.log(`Created sample user: ${user.name} (${user.email}) [_id: ${user._id}]`);
    } else {
      console.log(`Found existing user: ${user.name} (${user.email}) [_id: ${user._id}]`);
    }

    // 2. Create sample tasks with varying priorities
    await Task.deleteMany({ user: user._id });
    const tasks = await Task.insertMany([
      {
        user: user._id,
        title: 'Review Mongoose Schemas & Backfill Migrations',
        description: 'Prepare schemas for ML Smart Session Suggestions',
        priority: 'High',
        estimatedPomodoros: 4,
        completedPomodoros: 3,
        completed: false,
      },
      {
        user: user._id,
        title: 'Cloud Architecture & Docker Compose Setup',
        description: 'Deploy backend on Render and frontend on Netlify',
        priority: 'High',
        estimatedPomodoros: 3,
        completedPomodoros: 3,
        completed: true,
      },
      {
        user: user._id,
        title: 'Data Preprocessing & Feature Engineering',
        description: 'Convert timestamps to categorical time buckets and cyclical hours',
        priority: 'Medium',
        estimatedPomodoros: 2,
        completedPomodoros: 2,
        completed: false,
      },
      {
        user: user._id,
        title: 'Write Weekly Progress Log',
        description: 'Summarize Pomodoro stats for internship review',
        priority: 'Low',
        estimatedPomodoros: 1,
        completedPomodoros: 1,
        completed: true,
      },
    ]);
    console.log(`Created ${tasks.length} tasks across High, Medium, and Low priorities.`);

    // 3. Clear previous sessions for clean repeatable testing
    await Session.deleteMany({ user: user._id });

    // 4. Generate realistic sessions for the past 3 weeks
    const sessionDocs = [];
    const now = new Date();

    // Schedule 30 sessions across different days and hours
    for (let i = 0; i < 30; i++) {
      const daysAgo = Math.floor(i / 1.5);
      const sessionDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);

      // Varied hours (some morning peak, some afternoon, some late night)
      let hour;
      if (i % 5 === 0) {
        hour = 23; // Late night session (higher probability of abandonment)
      } else if (i % 3 === 0) {
        hour = 14; // Afternoon post-lunch
      } else {
        hour = 10; // Morning prime time
      }
      const minute = (i * 17) % 60;
      sessionDate.setHours(hour, minute, 0, 0);

      const dayOfWeek = DAYS_OF_WEEK[sessionDate.getDay()];
      const linkedTask = tasks[i % tasks.length];
      const priority = linkedTask.priority;

      // Realistic outcome: morning high-priority sessions complete; late night low-priority drop
      let completed = true;
      let status = 'completed';
      let abandonReason = 'none';
      let actualDurationMinutes = 25;

      if (hour >= 23 || hour <= 4) {
        completed = i % 2 === 0; // 50% drop at night
        if (!completed) {
          status = 'abandoned';
          abandonReason = 'fatigue';
          actualDurationMinutes = 11;
        }
      } else if (hour === 14 && priority === 'Low') {
        completed = i % 3 !== 0;
        if (!completed) {
          status = 'abandoned';
          abandonReason = 'distraction';
          actualDurationMinutes = 15;
        }
      }

      const endTime = new Date(sessionDate.getTime() + actualDurationMinutes * 60 * 1000);

      sessionDocs.push({
        user: user._id,
        task: linkedTask._id,
        startTime: sessionDate,
        endTime,
        dayOfWeek,
        taskPriority: priority,
        durationMinutes: 25,
        actualDurationMinutes,
        completed,
        status,
        abandonReason,
        duration: 25,
      });
    }

    const insertedSessions = await Session.insertMany(sessionDocs);
    console.log(`Created ${insertedSessions.length} realistic session history records for ${user.name}.`);
    console.log('='.repeat(70) + '\n');

    return { user, tasks, sessions: insertedSessions };
  } catch (err) {
    console.error('Seeding failed:', err);
    throw err;
  } finally {
    await mongoose.disconnect();
    console.log('Database connection closed.');
  }
}

if (require.main === module) {
  seedSampleUser().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = seedSampleUser;
