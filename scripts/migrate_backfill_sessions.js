/**
 * FocusFlow - Database Migration & Backfill Script
 * ---------------------------------------------------------------------------
 * Backfills missing ML/analytics fields on existing session documents:
 *  - startTime (backfilled from createdAt or Date.now)
 *  - dayOfWeek (computed from startTime)
 *  - taskPriority (looked up from linked Task, or defaulted to 'Medium')
 *  - durationMinutes (migrated from legacy 'duration' or defaulted to 25)
 *  - completed (defaulted to true for legacy saved sessions)
 *  - status ('completed' or 'abandoned')
 *  - actualDurationMinutes (set to durationMinutes for completed sessions)
 *
 * Usage:
 *   node scripts/migrate_backfill_sessions.js [--dry-run]
 * ---------------------------------------------------------------------------
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Session = require('../models/Session');
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

async function migrateAndBackfill() {
  const isDryRun = process.argv.includes('--dry-run');

  console.log('='.repeat(70));
  console.log('  FOCUSFLOW SESSION SCHEMA MIGRATION & BACKFILL');
  console.log('='.repeat(70));
  console.log(`Target Database: ${MONGO_URI}`);
  console.log(`Execution Mode : ${isDryRun ? 'DRY RUN (No writes)' : 'LIVE MIGRATION'}`);
  console.log('-'.repeat(70));

  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB successfully.');

    // Find sessions that lack any of the new fields
    const query = {
      $or: [
        { startTime: { $exists: false } },
        { dayOfWeek: { $exists: false } },
        { taskPriority: { $exists: false } },
        { durationMinutes: { $exists: false } },
        { completed: { $exists: false } },
        { status: { $exists: false } },
      ],
    };

    const legacySessions = await Session.find(query);
    console.log(`Found ${legacySessions.length} legacy session document(s) requiring backfill.\n`);

    if (legacySessions.length === 0) {
      console.log('All session documents already conform to the updated schema. No migration needed.');
      await mongoose.disconnect();
      return;
    }

    let updatedCount = 0;
    for (const session of legacySessions) {
      // 1. Resolve startTime
      const startTime = session.startTime || session.createdAt || new Date();

      // 2. Resolve dayOfWeek
      const dayIndex = new Date(startTime).getDay();
      const dayOfWeek = session.dayOfWeek || DAYS_OF_WEEK[dayIndex];

      // 3. Resolve durationMinutes
      const durationMinutes = session.durationMinutes || session.duration || 25;

      // 4. Resolve taskPriority (populate from Task if available)
      let taskPriority = session.taskPriority;
      if (!taskPriority) {
        if (session.task) {
          try {
            const linkedTask = await Task.findById(session.task);
            taskPriority = linkedTask ? linkedTask.priority : 'Medium';
          } catch (e) {
            taskPriority = 'Medium';
          }
        } else {
          taskPriority = 'Medium';
        }
      }

      // 5. Resolve completed & status
      const completed = session.completed !== undefined ? session.completed : true;
      const status = session.status || (completed ? 'completed' : 'abandoned');
      const actualDurationMinutes =
        session.actualDurationMinutes || (completed ? durationMinutes : Math.floor(durationMinutes * 0.5));

      const updatePayload = {
        startTime,
        dayOfWeek,
        durationMinutes,
        taskPriority,
        completed,
        status,
        actualDurationMinutes,
        duration: durationMinutes,
      };

      if (!isDryRun) {
        await Session.updateOne({ _id: session._id }, { $set: updatePayload });
      }

      updatedCount++;
      if (updatedCount <= 5 || updatedCount === legacySessions.length) {
        console.log(`[Session ${session._id}]`);
        console.log(`  -> startTime: ${startTime.toISOString()}`);
        console.log(`  -> dayOfWeek: ${dayOfWeek}`);
        console.log(`  -> taskPriority: ${taskPriority}`);
        console.log(`  -> durationMinutes: ${durationMinutes}`);
        console.log(`  -> completed: ${completed} (${status})`);
      }
    }

    console.log('-'.repeat(70));
    console.log(`Migration Summary:`);
    console.log(`  Total scanned : ${legacySessions.length}`);
    console.log(`  Total modified: ${updatedCount} ${isDryRun ? '(simulated)' : '(committed to DB)'}`);
    console.log('='.repeat(70));
  } catch (err) {
    console.error('Migration failed with error:', err.message);
  } finally {
    await mongoose.disconnect();
    console.log('Database connection closed.');
  }
}

if (require.main === module) {
  migrateAndBackfill();
}

module.exports = migrateAndBackfill;
