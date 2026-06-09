const { spawn } = require('child_process');
const axios = require('axios');
const path = require('path');

const PORT = 5555;
const serverPath = path.join(__dirname, '../server.js');

console.log('🚀 Starting Express backend server on test port:', PORT);

// Set test env variables
const env = { 
  ...process.env, 
  PORT: PORT,
  NODE_ENV: 'test',
  ENABLE_ANALYSIS_QUEUE: 'false' // disable redis during tests
};

const server = spawn('node', [serverPath], { env });

let stdoutData = '';
server.stdout.on('data', (data) => {
  stdoutData += data.toString();
  console.log('[Server stdout]:', data.toString().trim());
});

server.stderr.on('data', (data) => {
  console.error('[Server stderr]:', data.toString().trim());
});

// Wait 3 seconds for server to boot, then make assertions
setTimeout(async () => {
  try {
    console.log('\n🔍 Running API Assertions...');

    // Assertion 1: Root route
    console.log('Asserting GET / ...');
    const rootRes = await axios.get(`http://localhost:${PORT}/`);
    if (rootRes.status === 200 && rootRes.data.includes('Backend Running')) {
      console.log('✅ Root endpoint passed');
    } else {
      throw new Error(`GET / failed. Status: ${rootRes.status}, Data: ${rootRes.data}`);
    }

    // Assertion 2: Health check endpoint
    console.log('Asserting GET /api/health ...');
    const healthRes = await axios.get(`http://localhost:${PORT}/api/health`);
    if (healthRes.status === 200 && healthRes.data.status === 'ok') {
      console.log('✅ Health check endpoint passed');
    } else {
      throw new Error(`GET /api/health failed. Status: ${healthRes.status}`);
    }

    // Assertion 3: Auth Login with seeded demo credentials
    console.log('Asserting POST /api/auth/login ...');
    try {
      const loginRes = await axios.post(`http://localhost:${PORT}/api/auth/login`, {
        email: 'demo@crickbuddy.com',
        password: 'demo123'
      });
      if (loginRes.status === 200 && loginRes.data.success && loginRes.data.token) {
        console.log('✅ Auth Login passed (Demo User token obtained)');
      } else {
        throw new Error(`POST /api/auth/login failed. Status: ${loginRes.status}`);
      }
    } catch (loginErr) {
      throw new Error(`Login request failed: ${loginErr.response?.data?.message || loginErr.message}`);
    }

    console.log('\n🎉 All backend server endpoint checks passed successfully! ✅\n');
    server.kill();
    process.exit(0);

  } catch (err) {
    console.error('\n❌ Assertions failed:', err.message);
    server.kill();
    process.exit(1);
  }
}, 3000);
