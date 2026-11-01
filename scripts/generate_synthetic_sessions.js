/**
 * FocusFlow - Synthetic Session Data Generator
 * ---------------------------------------------------------------------------
 * Generates realistic synthetic Pomodoro session data for multiple synthetic users.
 * Models human behavioral patterns:
 *   - Circadian focus curves (morning peak vs. late night fatigue)
 *   - User personas (Morning Lark, Night Owl, Afternoon Focuser, Weekend Warrior, etc.)
 *   - Task priority commitment differentials (High priority has higher completion rate)
 *   - Duration fatigue effects (50m sessions have higher drop rates than 25m)
 *
 * Targets:
 *   1. Inserts into MongoDB test collection 'synthetic_sessions'
 *   2. Exports clean CSV to exports/synthetic_sessions.csv with columns:
 *      time_of_day, day_of_week, task_priority, duration_minutes, completed
 *   3. Exports full JSON to exports/synthetic_sessions.json
 *
 * Usage:
 *   node scripts/generate_synthetic_sessions.js [--users=6] [--sessionsPerUser=80] [--no-db]
 * ---------------------------------------------------------------------------
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const SyntheticSession = require('../models/SyntheticSession');

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

const PRIORITIES = ['Low', 'Medium', 'High'];
const DURATIONS = [15, 25, 25, 25, 30, 45, 50]; // 25 is weighted most heavily (standard Pomodoro)

// Diverse behavioral profiles
const USER_PERSONAS = [
  {
    id: 'user_001_alex',
    name: 'Alex (Early Bird)',
    persona: 'morning_lark',
    preferredPeakHours: [7, 8, 9, 10, 11],
    troughHours: [22, 23, 0, 1, 2],
    baseCompletionRate: 0.82,
  },
  {
    id: 'user_002_sam',
    name: 'Sam (Night Owl)',
    persona: 'night_owl',
    preferredPeakHours: [20, 21, 22, 23, 0],
    troughHours: [6, 7, 8, 9],
    baseCompletionRate: 0.78,
  },
  {
    id: 'user_003_priya',
    name: 'Priya (Afternoon Focuser)',
    persona: 'afternoon_focuser',
    preferredPeakHours: [14, 15, 16, 17, 18],
    troughHours: [5, 6, 23, 0, 1],
    baseCompletionRate: 0.80,
  },
  {
    id: 'user_004_jordan',
    name: 'Jordan (Weekend Warrior)',
    persona: 'weekend_warrior',
    preferredDays: ['Saturday', 'Sunday'],
    preferredPeakHours: [10, 11, 14, 15, 16],
    troughHours: [1, 2, 3, 4],
    baseCompletionRate: 0.76,
  },
  {
    id: 'user_005_taylor',
    name: 'Taylor (Inconsistent Student)',
    persona: 'inconsistent',
    preferredPeakHours: [11, 16],
    troughHours: [0, 1, 2, 3, 4, 5],
    baseCompletionRate: 0.60,
  },
  {
    id: 'user_006_elena',
    name: 'Elena (High Performer)',
    persona: 'morning_lark',
    preferredPeakHours: [8, 9, 10, 14, 15],
    troughHours: [23, 0, 1, 2],
    baseCompletionRate: 0.90,
  },
];

/**
 * Calculates realistic completion probability based on:
 * - Hour of the day
 * - User persona
 * - Task priority
 * - Session duration
 */
function calculateCompletionProbability(user, hour, dayName, priority, duration) {
  let prob = user.baseCompletionRate;

  // 1. Circadian hour effect
  if (user.preferredPeakHours.includes(hour)) {
    prob += 0.15; // Peak focus window boost
  } else if (user.troughHours.includes(hour)) {
    prob -= 0.35; // Severe fatigue penalty
  } else if (hour >= 9 && hour <= 12) {
    prob += 0.08; // General morning alertness
  } else if (hour >= 13 && hour <= 15) {
    prob -= 0.12; // Post-lunch circadian dip
  } else if (hour >= 23 || hour <= 4) {
    prob -= 0.30; // General late-night fatigue
  }

  // 2. Persona specific day modifiers
  if (user.persona === 'weekend_warrior') {
    if (dayName === 'Saturday' || dayName === 'Sunday') {
      prob += 0.12;
    } else {
      prob -= 0.10;
    }
  }

  // 3. Task Priority effect (Higher commitment to high priority work)
  if (priority === 'High') {
    prob += 0.10;
  } else if (priority === 'Low') {
    prob -= 0.14;
  }

  // 4. Session duration fatigue effect
  if (duration >= 50) {
    prob -= 0.08; // Harder to sustain full 50 min
  } else if (duration <= 15) {
    prob += 0.06; // Quick sprints are easier to finish
  }

  // Clamp probability between 0.12 and 0.96
  return Math.max(0.12, Math.min(0.96, prob));
}

// Convert rows to RFC-4180 CSV
function convertToCSV(headers, rows) {
  const headerLine = headers.join(',');
  const dataLines = rows.map((r) =>
    headers
      .map((h) => {
        const val = r[h] !== undefined && r[h] !== null ? String(r[h]) : '';
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      })
      .join(',')
  );
  return [headerLine, ...dataLines].join('\n');
}

async function generateSyntheticData() {
  const args = process.argv.slice(2);
  const getArg = (name, fallback) => {
    const match = args.find((a) => a.startsWith(`--${name}=`));
    return match ? match.split('=')[1] : fallback;
  };

  const userCount = Math.min(parseInt(getArg('users', '6'), 10), USER_PERSONAS.length);
  const sessionsPerUser = parseInt(getArg('sessionsPerUser', '100'), 10);
  const skipDb = args.includes('--no-db');
  const outputDir = path.resolve(process.cwd(), getArg('output', 'exports'));

  console.log('='.repeat(70));
  console.log('  FOCUSFLOW SYNTHETIC SESSION DATA GENERATOR');
  console.log('='.repeat(70));
  console.log(`Users to simulate    : ${userCount}`);
  console.log(`Sessions per user    : ${sessionsPerUser}`);
  console.log(`Total sessions       : ${userCount * sessionsPerUser}`);
  console.log(`MongoDB Test Collect : ${skipDb ? 'SKIPPED (--no-db)' : 'synthetic_sessions'}`);
  console.log('-'.repeat(70));

  const allRecords = [];
  const exportRows = []; // ML columns: time_of_day, day_of_week, task_priority, duration_minutes, completed

  const abandonReasons = ['fatigue', 'distraction', 'interruption', 'timer_cancelled', 'manual_stop'];

  // Base date range: past 60 days
  const now = new Date();

  for (let u = 0; u < userCount; u++) {
    const user = USER_PERSONAS[u];
    let userCompleted = 0;

    for (let s = 0; s < sessionsPerUser; s++) {
      // Pick random date within past 60 days
      const daysAgo = Math.floor(Math.random() * 60);
      const sessionDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);

      // Determine hour based on persona preferences
      let hour;
      if (Math.random() < 0.65 && user.preferredPeakHours.length > 0) {
        hour = user.preferredPeakHours[Math.floor(Math.random() * user.preferredPeakHours.length)];
      } else {
        hour = Math.floor(Math.random() * 24);
      }

      const minute = Math.floor(Math.random() * 60);
      sessionDate.setHours(hour, minute, 0, 0);

      const dayOfWeek = DAYS_OF_WEEK[sessionDate.getDay()];
      const priority = PRIORITIES[Math.floor(Math.random() * PRIORITIES.length)];
      const durationMinutes = DURATIONS[Math.floor(Math.random() * DURATIONS.length)];

      // Calculate realistic probability
      const completionProb = calculateCompletionProbability(user, hour, dayOfWeek, priority, durationMinutes);
      const isCompleted = Math.random() < completionProb;

      if (isCompleted) userCompleted++;

      const actualDuration = isCompleted
        ? durationMinutes
        : Math.max(2, Math.floor(durationMinutes * (0.15 + Math.random() * 0.6)));

      const timeOfDayHHMM = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      let timeOfDayBucket = 'night';
      if (hour >= 5 && hour < 9) timeOfDayBucket = 'early_morning';
      else if (hour >= 9 && hour < 12) timeOfDayBucket = 'morning';
      else if (hour >= 12 && hour < 17) timeOfDayBucket = 'afternoon';
      else if (hour >= 17 && hour < 22) timeOfDayBucket = 'evening';

      const endTime = new Date(sessionDate.getTime() + actualDuration * 60 * 1000);
      const abandonReason = isCompleted ? 'none' : abandonReasons[Math.floor(Math.random() * abandonReasons.length)];

      // Record for MongoDB test collection
      const mongoRecord = {
        userId: user.id,
        userPersona: user.persona,
        taskId: `mock_task_${user.id}_${s % 10}`,
        taskPriority: priority,
        startTime: sessionDate,
        endTime,
        timeOfDay: timeOfDayHHMM,
        timeOfDayBucket,
        dayOfWeek,
        durationMinutes,
        actualDurationMinutes: actualDuration,
        completed: isCompleted,
        status: isCompleted ? 'completed' : 'abandoned',
        abandonReason,
      };
      allRecords.push(mongoRecord);

      // Clean ML Export Row (matches prompt requirement exactly)
      exportRows.push({
        time_of_day: timeOfDayHHMM,
        day_of_week: dayOfWeek,
        task_priority: priority,
        duration_minutes: durationMinutes,
        completed: isCompleted ? 1 : 0,
      });
    }

    console.log(
      `  - Generated ${sessionsPerUser} sessions for ${user.name.padEnd(28)} | Completion Rate: ${(
        (userCompleted / sessionsPerUser) *
        100
      ).toFixed(1)}%`
    );
  }

  // 1. Export Files
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const mlHeaders = ['time_of_day', 'day_of_week', 'task_priority', 'duration_minutes', 'completed'];
  const csvPath = path.join(outputDir, 'synthetic_sessions.csv');
  fs.writeFileSync(csvPath, convertToCSV(mlHeaders, exportRows), 'utf-8');

  const jsonPath = path.join(outputDir, 'synthetic_sessions.json');
  fs.writeFileSync(jsonPath, JSON.stringify(exportRows, null, 2), 'utf-8');

  // Also write full metadata version for advanced inspection
  const fullJsonPath = path.join(outputDir, 'synthetic_sessions_full_metadata.json');
  fs.writeFileSync(fullJsonPath, JSON.stringify(allRecords, null, 2), 'utf-8');

  console.log('\nGenerated Output Files:');
  console.log(`  -> ML Clean CSV : ${csvPath} (${exportRows.length} rows)`);
  console.log(`  -> ML Clean JSON: ${jsonPath}`);
  console.log(`  -> Full Metadata: ${fullJsonPath}`);

  // 2. Insert into MongoDB test collection 'synthetic_sessions'
  if (!skipDb) {
    try {
      console.log(`\nConnecting to MongoDB (${MONGO_URI}) to populate 'synthetic_sessions'...`);
      await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 2500 });
      console.log('Connected to MongoDB.');

      // Clear previous synthetic test collection to keep tests repeatable
      const deleted = await SyntheticSession.deleteMany({});
      console.log(`Cleared ${deleted.deletedCount} existing documents in 'synthetic_sessions' collection.`);

      // Bulk insert
      const insertResult = await SyntheticSession.insertMany(allRecords);
      console.log(`Inserted ${insertResult.length} synthetic sessions into collection 'synthetic_sessions'.`);
    } catch (dbErr) {
      console.warn('MongoDB insertion failed (continuing with CSV output):', dbErr.message);
    } finally {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
        console.log('MongoDB connection closed.');
      }
    }
  }

  // 3. Print Statistical Distribution Breakdown
  console.log('\n' + '='.repeat(70));
  console.log('REALISTIC BEHAVIORAL VARIATION METRICS (ML VALIDATION)');
  console.log('='.repeat(70));

  // Time Bucket Breakdown
  const bucketStats = {};
  allRecords.forEach((r) => {
    if (!bucketStats[r.timeOfDayBucket]) bucketStats[r.timeOfDayBucket] = { total: 0, completed: 0 };
    bucketStats[r.timeOfDayBucket].total++;
    if (r.completed) bucketStats[r.timeOfDayBucket].completed++;
  });

  console.log('Completion Rate by Time of Day Window:');
  const bucketTable = Object.keys(bucketStats).map((k) => ({
    'Time Window': k,
    'Total Sessions': bucketStats[k].total,
    'Completion %': `${((bucketStats[k].completed / bucketStats[k].total) * 100).toFixed(1)}%`,
    'Abandon %': `${(100 - (bucketStats[k].completed / bucketStats[k].total) * 100).toFixed(1)}%`,
  }));
  console.table(bucketTable);

  // Priority Breakdown
  const priorityStats = {};
  allRecords.forEach((r) => {
    if (!priorityStats[r.taskPriority]) priorityStats[r.taskPriority] = { total: 0, completed: 0 };
    priorityStats[r.taskPriority].total++;
    if (r.completed) priorityStats[r.taskPriority].completed++;
  });

  console.log('Completion Rate by Task Priority:');
  const priorityTable = Object.keys(priorityStats).map((k) => ({
    'Task Priority': k,
    'Total Sessions': priorityStats[k].total,
    'Completion %': `${((priorityStats[k].completed / priorityStats[k].total) * 100).toFixed(1)}%`,
  }));
  console.table(priorityTable);

  console.log('='.repeat(70));
  console.log('SAMPLE OF EXPORTED SYNTHETIC DATA (First 5 CSV rows):');
  console.log('='.repeat(70));
  console.table(exportRows.slice(0, 5));
  console.log('='.repeat(70) + '\n');

  return { exportRows, allRecords, csvPath, jsonPath };
}

if (require.main === module) {
  generateSyntheticData().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = generateSyntheticData;
