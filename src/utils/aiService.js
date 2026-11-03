const axios = require('axios');

// Base URL of the AI service without trailing slashes — "https://host/" would
// otherwise produce "https://host//analyze/batting", which the service answers with 404.
const aiServiceUrl = () => (process.env.AI_SERVICE_URL || '').trim().replace(/\/+$/, '');

// Headers that authenticate backend → AI service calls.
// AI_SERVICE_SECRET must match the value configured on the AI service.
const aiAuthHeaders = () => {
    const secret = process.env.AI_SERVICE_SECRET;
    return secret ? { 'X-Internal-Secret': secret } : {};
};

// A sleeping Render free instance has to boot and load the pose models before it answers;
// that regularly takes 1.5–4 minutes, so allow 6.
const AI_WAKE_TIMEOUT_MS = Number(process.env.AI_WAKE_TIMEOUT_MS) || 360000;

/**
 * Wait until the AI service answers /health. Free hosting tiers (e.g. Render) put
 * idle services to sleep and answer 429/502/503 while they boot, which can take
 * a minute or more. Returns true once healthy, false if it never woke up in time.
 */
async function waitForAiService({ timeoutMs = AI_WAKE_TIMEOUT_MS, onWaiting } = {}) {
    const deadline = Date.now() + timeoutMs;
    let notified = false;
    let warnedWrongService = false;
    while (Date.now() < deadline) {
        try {
            // Render holds requests while a sleeping service boots, so give each poll room to wait.
            const res = await axios.get(`${aiServiceUrl()}/health`, { timeout: 60000 });
            if (res.status === 200 && res.data?.service === 'crick-buddy-ai') return true;
            if (res.status === 200 && !warnedWrongService) {
                warnedWrongService = true;
                console.error(`❌ AI_SERVICE_URL (${aiServiceUrl()}) answered /health but is not the CrickBuddy AI service. Check the port.`);
            }
        } catch (err) {
            // A 404 on /health means some other app owns this port.
            if (err.response?.status === 404 && !warnedWrongService) {
                warnedWrongService = true;
                console.error(`❌ AI_SERVICE_URL (${aiServiceUrl()}) has no /health route — another app is using this port. Point AI_SERVICE_URL at the CrickBuddy AI service.`);
            }
            // otherwise still booting / unreachable — keep polling
        }
        if (!notified && onWaiting) {
            notified = true;
            await onWaiting();
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    return false;
}

/**
 * Fire-and-forget ping that starts a sleeping AI service booting. Called when a user
 * opens the app so the boot overlaps with them picking and uploading a video.
 * Throttled to one ping per minute.
 */
let lastWakeAt = 0;
function wakeAiService() {
    if (!aiServiceUrl() || Date.now() - lastWakeAt < 60000) return;
    lastWakeAt = Date.now();
    axios.get(`${aiServiceUrl()}/health`, { timeout: 180000 }).catch(() => {});
}

/**
 * Keep-alive: ping the AI service every AI_KEEPALIVE_MINUTES (default 10) so it does
 * not fall asleep while people are using the app. The timer only runs while this
 * backend is awake, and the backend itself sleeps 15 minutes after the last user
 * request, so this does not keep either free instance up around the clock.
 * Set AI_KEEPALIVE_MINUTES=0 to disable.
 */
function startAiKeepAlive() {
    const raw = process.env.AI_KEEPALIVE_MINUTES;
    const minutes = raw === undefined || raw === '' ? 10 : Number(raw);
    if (!minutes || minutes <= 0) return;
    console.log(`ℹ️  AI keep-alive enabled: pinging every ${minutes} min`);
    setInterval(() => {
        axios.get(`${aiServiceUrl()}/health`, { timeout: 180000 }).catch(() => {});
    }, minutes * 60000).unref();
}

module.exports = { aiServiceUrl, aiAuthHeaders, waitForAiService, wakeAiService, startAiKeepAlive };
