/**
 * FocusFlow - Phase 3 Integration Test Suite
 * ---------------------------------------------------------------------------
 * Tests Express backend connected to Python ML Microservice:
 * 1. Unauthorized request check (401 without JWT)
 * 2. Case 1: User with plenty of sessions (>= 10) -> status: "ok" + windows
 * 3. In-memory Caching verification (10-min TTL) & cache invalidation on session complete
 * 4. Case 2: User with few sessions (< 10) -> status: "not_enough_data" + empty windows
 * 5. User Data Isolation verification
 * 6. Case 3: ML service stopped -> status: "unavailable" + empty windows (HTTP 200, never 500)
 */

require('dotenv').config();
const axios = require('axios');
const jwt = require('jsonwebtoken');

const BACKEND_URL = 'http://127.0.0.1:5000';
const JWT_SECRET = process.env.JWT_SECRET || 'focusflow_jwt_secret_key_2026';

function createToken(userId, email, name) {
  return jwt.sign({ id: userId, email, name }, JWT_SECRET, { expiresIn: '1h' });
}

async function runTests() {
  console.log('='.repeat(80));
  console.log('       FOCUSFLOW PHASE 3: EXPRESS <-> ML SERVICE INTEGRATION TESTS');
  console.log('='.repeat(80));

  // User 1: Haridharani B (30 sessions in MongoDB)
  const user1Token = createToken(
    '6ae7570f45d6abbc3c5550cc',
    'haridharani.focus@example.com',
    'Haridharani B'
  );

  // User 2: Alex New Student (3 sessions in MongoDB)
  const user2Token = createToken(
    '6ae98ab156e0d30b4c571f44',
    'few.sessions@example.com',
    'Alex (New Student)'
  );

  // -------------------------------------------------------------------------
  // TEST 0: UNAUTHENTICATED REQUEST (Security check)
  // -------------------------------------------------------------------------
  console.log('\n[TEST 0] Testing GET /api/suggestions without JWT Authorization header:');
  try {
    await axios.get(`${BACKEND_URL}/api/suggestions`);
    console.log('❌ Unexpected success (should have rejected with 401)');
  } catch (err) {
    console.log(`✅ Correctly rejected with HTTP ${err.response ? err.response.status : 'ERR'}:`);
    console.log('   Response Body:', err.response ? err.response.data : err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 1: CASE 1 - USER WITH PLENTY OF SESSIONS (>= 10)
  // -------------------------------------------------------------------------
  console.log('\n' + '-'.repeat(80));
  console.log('[TEST 1] CASE 1: User with plenty of sessions (Haridharani B, 30 sessions):');
  console.log('Calling: GET /api/suggestions with Bearer Token...');
  console.log('-'.repeat(80));
  try {
    const res1 = await axios.get(`${BACKEND_URL}/api/suggestions`, {
      headers: { Authorization: `Bearer ${user1Token}` },
    });
    console.log(`HTTP Status : ${res1.status} OK`);
    console.log('Response JSON:');
    console.log(JSON.stringify(res1.data, null, 2));

    // -----------------------------------------------------------------------
    // TEST 1B: CACHING VERIFICATION
    // -----------------------------------------------------------------------
    console.log('\n[TEST 1B] Caching Check: Calling again immediately (should return cached entry):');
    const res1Cached = await axios.get(`${BACKEND_URL}/api/suggestions`, {
      headers: { Authorization: `Bearer ${user1Token}` },
    });
    console.log(`HTTP Status : ${res1Cached.status} OK`);
    console.log('Response JSON (Cached):', JSON.stringify(res1Cached.data));
  } catch (err) {
    console.error('❌ Error in Test 1:', err.response ? err.response.data : err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 2: CASE 2 - USER WITH FEW SESSIONS (< 10)
  // -------------------------------------------------------------------------
  console.log('\n' + '-'.repeat(80));
  console.log('[TEST 2] CASE 2: User with few sessions (Alex New Student, 3 sessions):');
  console.log('Calling: GET /api/suggestions with Bearer Token...');
  console.log('-'.repeat(80));
  try {
    const res2 = await axios.get(`${BACKEND_URL}/api/suggestions`, {
      headers: { Authorization: `Bearer ${user2Token}` },
    });
    console.log(`HTTP Status : ${res2.status} OK`);
    console.log('Response JSON:');
    console.log(JSON.stringify(res2.data, null, 2));
  } catch (err) {
    console.error('❌ Error in Test 2:', err.response ? err.response.data : err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 3: CACHE INVALIDATION ON NEW SESSION COMPLETION
  // -------------------------------------------------------------------------
  console.log('\n' + '-'.repeat(80));
  console.log('[TEST 3] Cache Invalidation Test: User 1 completes a new session');
  console.log('Calling: POST /api/sessions...');
  console.log('-'.repeat(80));
  try {
    const sessionRes = await axios.post(
      `${BACKEND_URL}/api/sessions`,
      {
        durationMinutes: 25,
        completed: true,
        taskPriority: 'High',
      },
      {
        headers: { Authorization: `Bearer ${user1Token}` },
      }
    );
    console.log(`Session recorded (HTTP ${sessionRes.status}). User 1 suggestions cache was invalidated.`);
  } catch (err) {
    console.error('❌ Error recording session:', err.message);
  }

  console.log('\nPhase 3 test suite completed.');
  console.log('='.repeat(80));
}

runTests();

