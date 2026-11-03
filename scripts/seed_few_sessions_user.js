/**
 * FocusFlow - Seed User with Few Sessions (< 10)
 * ---------------------------------------------------------------------------
 * Creates a test user 'few.sessions@example.com' with only 3 sessions
 * to verify the 'not_enough_data' fallback behavior.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Session = require('../models/Session');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/focusflow';

async function seedFewSessionsUser() {
  console.log(`Connecting to MongoDB at: ${MONGO_URI}`);
  await mongoose.connect(MONGO_URI);

  const email = 'few.sessions@example.com';
  let user = await User.findOne({ email });

  if (!user) {
    const hashedPassword = await bcrypt.hash('FocusFlow@2026', 10);
    user = await User.create({
      name: 'Alex (New Student)',
      email,
      password: hashedPassword,
    });
    console.log(`Created user: ${user.name} (${user.email}) [_id: ${user._id}]`);
  } else {
    console.log(`Found existing user: ${user.name} (${user.email}) [_id: ${user._id}]`);
  }

  // Delete existing sessions for this user and insert exactly 3 sessions
  await Session.deleteMany({ user: user._id });

  const sampleSessions = [
    {
      user: user._id,
      startTime: new Date(Date.now() - 2 * 24 * 3600 * 1000), // 2 days ago
      dayOfWeek: 'Monday',
      taskPriority: 'High',
      durationMinutes: 25,
      actualDurationMinutes: 25,
      completed: true,
      status: 'completed',
    },
    {
      user: user._id,
      startTime: new Date(Date.now() - 1 * 24 * 3600 * 1000), // 1 day ago
      dayOfWeek: 'Tuesday',
      taskPriority: 'Medium',
      durationMinutes: 25,
      actualDurationMinutes: 25,
      completed: true,
      status: 'completed',
    },
    {
      user: user._id,
      startTime: new Date(), // Today
      dayOfWeek: 'Wednesday',
      taskPriority: 'Low',
      durationMinutes: 25,
      actualDurationMinutes: 12,
      completed: false,
      status: 'abandoned',
    },
  ];

  await Session.insertMany(sampleSessions);
  console.log(`Seeded exactly ${sampleSessions.length} sessions for ${user.email} (below the 10-session threshold).`);

  await mongoose.disconnect();
}

seedFewSessionsUser().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});

