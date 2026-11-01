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

const AI_WAKE_TIMEOUT_MS = Number(process.env.AI_WAKE_TIMEOUT_MS) || 240000;

/**
 * Wait until the AI service answers /health. Free hosting tiers (e.g. Render) put
 * idle services to sleep and answer 429/502/503 while they boot, which can take
 * a minute or more. Returns true once healthy, false if it never woke up in time.
 */
async function waitForAiService({ timeoutMs = AI_WAKE_TIMEOUT_MS, onWaiting } = {}) {
    const deadline = Date.now() + timeoutMs;
    let notified = false;
    while (Date.now() < deadline) {
        try {
            const res = await axios.get(`${aiServiceUrl()}/health`, { timeout: 20000 });
            if (res.status === 200) return true;
        } catch (_) {
            // still booting / unreachable — keep polling
        }
        if (!notified && onWaiting) {
            notified = true;
            await onWaiting();
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    return false;
}

module.exports = { aiServiceUrl, aiAuthHeaders, waitForAiService };
