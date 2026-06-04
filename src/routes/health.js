const express = require('express');
const router = express.Router();
const axios = require('axios');
const dns = require('dns').promises;
const url = require('url');

// GET /api/health — Simple backend self health check
router.get('/health', async (req, res) => {
    res.json({
        status: 'ok',
        service: 'crick-buddy-backend',
        timestamp: new Date().toISOString()
    });
});

// GET /api/status — Detailed diagnosis of backend + AI service
router.get('/status', async (req, res) => {
    const aiUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
    const statusInfo = {
        backend: {
            status: 'ok',
            timestamp: new Date().toISOString(),
        },
        aiService: {
            url: aiUrl,
            status: 'unknown',
            details: null
        }
    };

    try {
        const parsed = url.parse(aiUrl);
        // DNS lookup
        try {
            await dns.lookup(parsed.hostname);
        } catch (dnsErr) {
            statusInfo.aiService.status = 'connection_refused';
            statusInfo.aiService.details = `DNS resolution failed: ${dnsErr.message}`;
            return res.json({ success: true, status: statusInfo });
        }

        // Call AI Service /health endpoint
        const start = Date.now();
        const response = await axios.get(`${aiUrl}/health`, { timeout: 15000 });
        const latency = Date.now() - start;

        if (response.status === 200) {
            if (latency > 10000) {
                statusInfo.aiService.status = 'service_sleeping';
                statusInfo.aiService.details = `Service responded but latency was high (${(latency / 1000).toFixed(1)}s)`;
            } else {
                statusInfo.aiService.status = 'ok';
                statusInfo.aiService.details = `Active (Latency: ${latency}ms)`;
            }
        } else {
            statusInfo.aiService.status = 'invalid_response';
            statusInfo.aiService.details = `Status code: ${response.status}`;
        }
    } catch (err) {
        if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
            statusInfo.aiService.status = 'timeout';
            statusInfo.aiService.details = `Connection timed out after 15s`;
        } else if (err.code === 'ECONNREFUSED') {
            statusInfo.aiService.status = 'connection_refused';
            statusInfo.aiService.details = `Port connection refused`;
        } else if (err.response) {
            statusInfo.aiService.status = 'invalid_response';
            statusInfo.aiService.details = `HTTP ${err.response.status}: ${err.message}`;
        } else {
            statusInfo.aiService.status = 'error';
            statusInfo.aiService.details = err.message;
        }
    }

    res.json({ success: true, status: statusInfo });
});

module.exports = router;
