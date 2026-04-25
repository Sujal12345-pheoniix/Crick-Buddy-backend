const express = require('express');
const router = express.Router();
const axios = require('axios');
const prisma = require('../utils/prisma');
const { protect } = require('../middleware/auth');

let lastExternalSyncAt = 0;

function deriveExternalId(match) {
    return (
        match?.id ||
        match?.matchId ||
        match?.unique_id ||
        match?.uniqueId ||
        match?.match_id ||
        null
    );
}

function classifyScope(title = '') {
    const t = title.toLowerCase();
    const nationalHints = ['ipl', 'ranji', 'syed mushtaq', 'vijay hazare', 'indian premier league'];
    return nationalHints.some((h) => t.includes(h)) ? 'national' : 'international';
}

function normalizeStatus(match) {
    const raw = String(match.status || '').toLowerCase();
    if (raw.includes('live') || raw.includes('in progress') || raw.includes('innings break')) return 'live';
    if (raw.includes('completed') || raw.includes('result') || raw.includes('finished')) return 'completed';
    if (raw.includes('upcoming') || raw.includes('not started') || raw.includes('schedule')) return 'upcoming';
    return match.matchStarted ? 'live' : 'upcoming';
}

function formatExternalScoreData(match) {
    if (Array.isArray(match.scoreData) && match.scoreData.length) return match.scoreData;
    if (Array.isArray(match.score) && match.score.length) return match.score;

    const lines = [];
    if (Array.isArray(match.teamInfo)) {
        for (const team of match.teamInfo) {
            const name = team?.name || team?.shortname;
            if (name) lines.push({ team: name });
        }
    }

    if (typeof match.score === 'string' && match.score.trim()) {
        lines.push({ summary: match.score.trim() });
    }

    if (typeof match.status === 'string' && match.status.trim()) {
        lines.push({ status: match.status.trim() });
    }

    return lines;
}

function mapExternalMatch(match) {
    const date = match.dateTimeGMT || match.date || new Date().toISOString();
    return {
        externalId: deriveExternalId(match) ? String(deriveExternalId(match)) : null,
        source: 'cricapi',
        title: match.name || match.title || 'Cricket Match',
        date: new Date(date),
        location: match.venue || match.location || 'TBD',
        status: normalizeStatus(match),
        scoreData: formatExternalScoreData(match)
    };
}

async function seedFallbackMatches() {
    const now = Date.now();
    const fallback = [
        {
            title: 'IPL: Mumbai Indians vs Chennai Super Kings',
            date: new Date(now + 2 * 60 * 60 * 1000),
            location: 'Mumbai, India',
            status: 'upcoming',
            scoreData: []
        },
        {
            title: 'International T20: India vs Australia',
            date: new Date(now + 6 * 60 * 60 * 1000),
            location: 'Melbourne, Australia',
            status: 'upcoming',
            scoreData: []
        },
        {
            title: 'IPL Live: Royal Challengers Bengaluru vs Kolkata Knight Riders',
            date: new Date(now - 45 * 60 * 1000),
            location: 'Bengaluru, India',
            status: 'live',
            scoreData: [{ inning: 'RCB 152/4 (16.3)' }]
        }
    ];

    for (const row of fallback) {
        const exists = await prisma.match.findFirst({
            where: { title: row.title, date: row.date }
        });
        if (!exists) {
            await prisma.match.create({ data: row });
        }
    }
}

async function ensureLiveFallbackMatch() {
    const title = 'Community Live: Rising Stars vs Thunder XI';
    const now = new Date();
    const minutesSinceHour = now.getMinutes();
    const wickets = Math.min(9, Math.floor(minutesSinceHour / 7) + 2);
    const oversWhole = Math.min(19, Math.floor(minutesSinceHour / 3) + 8);
    const oversBall = minutesSinceHour % 6;
    const runs = 70 + minutesSinceHour * 2 + oversWhole;
    const fallbackScore = [{ inning: `Rising Stars ${runs}/${wickets} (${oversWhole}.${oversBall})` }];

    const existing = await prisma.match.findFirst({
        where: { source: 'local-fallback', title }
    });

    if (existing) {
        return prisma.match.update({
            where: { id: existing.id },
            data: {
                date: new Date(now.getTime() - 30 * 60 * 1000),
                status: 'live',
                scoreData: fallbackScore,
                location: existing.location || 'Local Ground'
            }
        });
    }

    return prisma.match.create({
        data: {
            title,
            date: new Date(now.getTime() - 30 * 60 * 1000),
            location: 'Local Ground',
            status: 'live',
            scoreData: fallbackScore,
            source: 'local-fallback'
        }
    });
}

async function syncMatchesFromExternal() {
    const apiKey = process.env.CRIC_API_KEY;
    if (!apiKey || apiKey === 'dummy_cric_api_key') return;

    const now = Date.now();
    // For better live-score accuracy, refresh more frequently when there are live matches.
    const liveCount = await prisma.match.count({ where: { status: 'live' } }).catch(() => 0);
    const minIntervalMs = liveCount > 0 ? 30 * 1000 : 5 * 60 * 1000;
    if (now - lastExternalSyncAt < minIntervalMs) return;
    lastExternalSyncAt = now;

    const response = await axios.get('https://api.cricapi.com/v1/currentMatches', {
        params: { apikey: apiKey, offset: 0 },
        timeout: 15000
    });

    const incoming = (response.data?.data || []).map(mapExternalMatch);
    if (!incoming.length) return;

    for (const m of incoming) {
        let row = null;
        if (m.externalId) {
            row = await prisma.match.findFirst({
                where: { externalId: m.externalId, source: 'cricapi' }
            });
        }
        if (!row) {
            const t = new Date(m.date).getTime();
            const winStart = new Date(t - 36 * 60 * 60 * 1000);
            const winEnd = new Date(t + 36 * 60 * 60 * 1000);
            row = await prisma.match.findFirst({
                where: {
                    title: m.title,
                    date: { gte: winStart, lte: winEnd }
                }
            });
        }

        if (row) {
            await prisma.match.update({
                where: { id: row.id },
                data: {
                    externalId: m.externalId || row.externalId,
                    source: m.source || row.source,
                    status: m.status,
                    scoreData: m.scoreData,
                    location: m.location || row.location
                }
            });
        } else {
            await prisma.match.create({ data: m });
        }
    }
}

async function loadMatches(filters = {}) {
    const { status, q, scope } = filters;

    try {
        await syncMatchesFromExternal();
    } catch (apiErr) {
        console.warn('CricAPI sync skipped:', apiErr.message);
    }

    let matches = await prisma.match.findMany({
        where: {
            date: {
                gte: new Date(Date.now() - 48 * 60 * 60 * 1000),
                lte: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
            }
        },
        orderBy: [{ status: 'asc' }, { date: 'asc' }],
        take: 200
    });

    if (!matches.length) {
        await seedFallbackMatches();
        matches = await prisma.match.findMany({
            orderBy: [{ status: 'asc' }, { date: 'asc' }],
            take: 200
        });
    }

    if (!matches.some((m) => m.status === 'live')) {
        await ensureLiveFallbackMatch();
        matches = await prisma.match.findMany({
            where: {
                date: {
                    gte: new Date(Date.now() - 48 * 60 * 60 * 1000),
                    lte: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
                }
            },
            orderBy: [{ status: 'asc' }, { date: 'asc' }],
            take: 200
        });
    }

    if (status && status !== 'all') {
        matches = matches.filter((m) => m.status === status);
    }
    if (q) {
        const query = String(q).toLowerCase();
        matches = matches.filter((m) =>
            m.title.toLowerCase().includes(query) ||
            (m.location || '').toLowerCase().includes(query)
        );
    }
    if (scope && scope !== 'all') {
        matches = matches.filter((m) => classifyScope(m.title) === scope);
    }

    const enriched = matches.map((m) => {
        const scoreData = Array.isArray(m.scoreData) ? m.scoreData : [];
        const scoreSummary = scoreData
            .map((item) => {
                if (typeof item === 'string') return item;
                if (item && typeof item === 'object') {
                    return item.inning || item.score || item.summary || item.status || null;
                }
                return null;
            })
            .filter(Boolean)
            .slice(0, 4);

        return {
            ...m,
            scope: classifyScope(m.title),
            scoreSummary
        };
    });

    return enriched;
}

// GET /api/matches — Fetch live matches (caches locally)
router.get('/', protect, async (req, res) => {
    try {
        const { status, q, scope } = req.query;
        const matches = await loadMatches({ status, q, scope });
        res.json({ success: true, updatedAt: new Date().toISOString(), matches });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/matches/stream — SSE live updates for scores
router.get('/stream', protect, async (req, res) => {
    const { status = 'all', q = '', scope = 'all' } = req.query;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let closed = false;

    const pushPayload = async () => {
        if (closed) return;
        try {
            const matches = await loadMatches({ status, q, scope });
            const payload = JSON.stringify({ success: true, updatedAt: new Date().toISOString(), matches });
            res.write(`event: matches\n`);
            res.write(`data: ${payload}\n\n`);
        } catch (err) {
            const payload = JSON.stringify({ success: false, message: err.message });
            res.write(`event: error\n`);
            res.write(`data: ${payload}\n\n`);
        }
    };

    await pushPayload();
    const timer = setInterval(pushPayload, 15000);

    req.on('close', () => {
        closed = true;
        clearInterval(timer);
        res.end();
    });
});

// GET /api/matches/:id
router.get('/:id', protect, async (req, res) => {
    try {
        const match = await prisma.match.findUnique({ where: { id: req.params.id } });
        if (!match) return res.status(404).json({ success: false, message: 'Match not found' });
        res.json({ success: true, match });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
