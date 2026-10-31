// Headers that authenticate backend → AI service calls.
// AI_SERVICE_SECRET must match the value configured on the AI service.
const aiAuthHeaders = () => {
    const secret = process.env.AI_SERVICE_SECRET;
    return secret ? { 'X-Internal-Secret': secret } : {};
};

module.exports = { aiAuthHeaders };
