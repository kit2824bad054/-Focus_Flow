/**
 * FocusFlow - User Session History Exporter
 * ---------------------------------------------------------------------------
 * Connects to MongoDB, retrieves session history for a specific user,
 * extracts and cleans features required for ML training:
 *   - time_of_day (e.g. "09:30" or time-slot bucket)
 *   - day_of_week (e.g. "Monday")
 *   - task_priority (e.g. "High", "Medium", "Low")
 *   - duration_minutes (e.g. 25)
 *   - completed (1 for completed, 0 for abandoned)
 *
 * Usage:
 *   node scripts/export_user_sessions.js [--userId=<id>] [--format=csv|json|both] [--timeFormat=hhmm|bucket]
 *
 * Options:
 *   --userId=<id>       Specific MongoDB User ObjectId (defaults to first user found)
 *   --email=<email>     Lookup user by email address
 *   --format=<type>     Output format: 'csv' (default), 'json', or 'both'
 *   --timeFormat=<type> 'hhmm' (e.g. "14:30", default) or 'bucket' (e.g. "afternoon")
 *   --output=<dir>      Destination directory (defaults to './exports')
 * ---------------------------------------------------------------------------
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Session = require('../models/Session');
const User = require('../models/User');
const Task = require('../models/Task');

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

// Helper to determine time slot bucket
function getTimeBucket(hours) {
  if (hours >= 5 && hours < 12) return 'morning';
  if (hours >= 12 && hours < 17) return 'afternoon';
  if (hours >= 17 && hours < 22) return 'evening';
  return 'night';
}

// Format 24-hr time as "HH:MM"
function formatHHMM(date) {
  const d = new Date(date);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// Convert dataset to RFC-4180 compliant CSV string
function convertToCSV(headers, rows) {
  const headerLine = headers.join(',');
  const dataLines = rows.map((row) =>
    headers
      .map((header) => {
        const val = row[header] !== undefined && row[header] !== null ? String(row[header]) : '';
        // Escape quotes and wrap in quotes if contains comma or quote
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      })
      .join(',')
  );
  return [headerLine, ...dataLines].join('\n');
}

async function exportUserSessions() {
  const args = process.argv.slice(2);
  const getArg = (name, fallback) => {
    const match = args.find((a) => a.startsWith(`--${name}=`));
    return match ? match.split('=')[1] : fallback;
  };

  const requestedUserId = getArg('userId', null);
  const requestedEmail = getArg('email', null);
  const format = (getArg('format', 'both')).toLowerCase();
  const timeFormat = (getArg('timeFormat', 'hhmm')).toLowerCase();
  const outputDir = path.resolve(process.cwd(), getArg('output', 'exports'));

  console.log('='.repeat(70));
  console.log('  FOCUSFLOW ML DATA EXPORT: USER SESSION HISTORY');
  console.log('='.repeat(70));
  console.log(`Connecting to: ${MONGO_URI}`);

  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 2500 });
    console.log('MongoDB connected successfully.');

    // 1. Locate the target user
    let targetUser = null;
    if (requestedUserId) {
      targetUser = await User.findById(requestedUserId);
      if (!targetUser) {
        console.warn(`User with _id ${requestedUserId} not found. Checking if any user exists...`);
      }
    } else if (requestedEmail) {
      targetUser = await User.findOne({ email: requestedEmail });
      if (!targetUser) {
        console.warn(`User with email ${requestedEmail} not found.`);
      }
    }

    if (!targetUser) {
      // Find a user who has recorded sessions
      const sessionWithUser = await Session.findOne().sort({ createdAt: -1 });
      if (sessionWithUser && sessionWithUser.user) {
        targetUser = await User.findById(sessionWithUser.user);
      }
      if (!targetUser) {
        targetUser = await User.findOne();
      }
    }

    if (!targetUser) {
      console.error('No users found in database to export. Please seed sample data first.');
      await mongoose.disconnect();
      process.exit(1);
    }

    console.log(`Exporting sessions for: ${targetUser.name} (${targetUser.email}) [ID: ${targetUser._id}]`);

    // 2. Fetch all sessions for this user, populating task if needed
    const rawSessions = await Session.find({ user: targetUser._id })
      .populate('task', 'priority title')
      .sort({ startTime: 1 })
      .lean();

    console.log(`Found ${rawSessions.length} total session record(s).\n`);

    if (rawSessions.length === 0) {
      console.warn('User has 0 sessions. Nothing to export.');
      await mongoose.disconnect();
      return;
    }

    // 3. Transform to ML-ready format
    // Columns required by prompt: time_of_day, day_of_week, task_priority, duration_minutes, completed
    const headers = [
      'time_of_day',
      'day_of_week',
      'task_priority',
      'duration_minutes',
      'completed',
    ];

    let completedCount = 0;
    const rows = rawSessions.map((s) => {
      const start = s.startTime || s.createdAt || new Date();
      const startDate = new Date(start);

      // time_of_day column
      let timeOfDayVal;
      if (timeFormat === 'bucket') {
        timeOfDayVal = getTimeBucket(startDate.getHours());
      } else {
        timeOfDayVal = formatHHMM(startDate);
      }

      // day_of_week column
      const dayOfWeekVal = s.dayOfWeek || DAYS_OF_WEEK[startDate.getDay()];

      // task_priority column
      let priorityVal = s.taskPriority;
      if (!priorityVal && s.task) {
        priorityVal = s.task.priority;
      }
      if (!priorityVal) {
        priorityVal = 'Medium';
      }

      // duration_minutes column
      const durationVal = s.durationMinutes || s.duration || 25;

      // completed column (1 for completed, 0 for abandoned - standard ML binary target)
      const isCompleted = s.completed !== undefined ? Boolean(s.completed) : s.status === 'completed';
      if (isCompleted) completedCount++;

      return {
        time_of_day: timeOfDayVal,
        day_of_week: dayOfWeekVal,
        task_priority: priorityVal,
        duration_minutes: durationVal,
        completed: isCompleted ? 1 : 0,
      };
    });

    // 4. Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const safeUserId = String(targetUser._id);
    const timestampStr = new Date().toISOString().slice(0, 10);
    const filesCreated = [];

    // 5. Write CSV file
    if (format === 'csv' || format === 'both') {
      const csvPath = path.join(outputDir, `user_sessions_${safeUserId}.csv`);
      const csvContent = convertToCSV(headers, rows);
      fs.writeFileSync(csvPath, csvContent, 'utf-8');
      filesCreated.push(csvPath);
    }

    // 6. Write JSON file
    if (format === 'json' || format === 'both') {
      const jsonPath = path.join(outputDir, `user_sessions_${safeUserId}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify(rows, null, 2), 'utf-8');
      filesCreated.push(jsonPath);
    }

    // 7. Output summary and sample data
    console.log('-'.repeat(70));
    console.log('EXPORT COMPLETED SUCCESSFULLY');
    console.log('-'.repeat(70));
    console.log(`Total Rows Exported : ${rows.length}`);
    console.log(`Completed Sessions  : ${completedCount} (${((completedCount / rows.length) * 100).toFixed(1)}%)`);
    console.log(`Abandoned Sessions  : ${rows.length - completedCount} (${(((rows.length - completedCount) / rows.length) * 100).toFixed(1)}%)`);
    console.log('Target Columns      : ' + headers.join(', '));
    console.log('\nGenerated Files:');
    filesCreated.forEach((f) => console.log(`  -> ${f}`));

    console.log('\n' + '='.repeat(70));
    console.log('SAMPLE EXPORTED DATA (First 5 records):');
    console.log('='.repeat(70));
    console.table(rows.slice(0, 5));
    console.log('='.repeat(70) + '\n');

    return { rows, filesCreated, targetUser };
  } catch (err) {
    console.error('Export failed with error:', err);
    throw err;
  } finally {
    await mongoose.disconnect();
    console.log('Database connection closed.');
  }
}

if (require.main === module) {
  exportUserSessions().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = exportUserSessions;
