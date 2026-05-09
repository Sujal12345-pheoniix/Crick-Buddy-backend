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

function mapRapidMatch(match) {
    const info = match.matchInfo || {};
    const score = match.matchScore || {};
    const date = info.startDate ? new Date(parseInt(info.startDate)) : new Date();

    const scoreLines = [];
    
    // Team 1 Score
    if (score.team1Score) {
        const inngs = [];
        if (score.team1Score.inngs1) {
            const s = score.team1Score.inngs1;
            inngs.push(`${s.runs || 0}/${s.wickets || 0} (${s.overs || 0})`);
        }
        if (score.team1Score.inngs2) {
            const s = score.team1Score.inngs2;
            inngs.push(`${s.runs || 0}/${s.wickets || 0} (${s.overs || 0})`);
        }
        if (inngs.length) {
            scoreLines.push(`${info.team1?.teamSName || 'T1'}: ${inngs.join(' & ')}`);
        }
    }

    // Team 2 Score
    if (score.team2Score) {
        const inngs = [];
        if (score.team2Score.inngs1) {
            const s = score.team2Score.inngs1;
            inngs.push(`${s.runs || 0}/${s.wickets || 0} (${s.overs || 0})`);
        }
        if (score.team2Score.inngs2) {
            const s = score.team2Score.inngs2;
            inngs.push(`${s.runs || 0}/${s.wickets || 0} (${s.overs || 0})`);
        }
        if (inngs.length) {
            scoreLines.push(`${info.team2?.teamSName || 'T2'}: ${inngs.join(' & ')}`);
        }
    }

    // Status description
    const statusText = info.status || match.status || 'Upcoming';

    return {
        externalId: info.matchId ? String(info.matchId) : null,
        source: 'rapidapi-cricbuzz',
        title: `${info.team1?.teamName || 'Team 1'} vs ${info.team2?.teamName || 'Team 2'} (${info.matchDesc || 'Match'})`,
        date,
        location: info.venueInfo ? `${info.venueInfo.ground}, ${info.venueInfo.city}` : 'International Venue',
        status: normalizeStatus({ status: statusText, matchStarted: !!(score.team1Score || score.team2Score) }),
        scoreData: scoreLines.length ? scoreLines.map(line => ({ inning: line })) : [{ status: statusText }]
    };
}

async function syncMatchesFromExternal() {
    const rapidKey = process.env.RAPID_AI;
    const cricKey = process.env.CRIC_API_KEY;

    if (!rapidKey && (!cricKey || cricKey === 'dummy_cric_api_key')) return;

    const now = Date.now();
    const liveCount = await prisma.match.count({ where: { status: 'live' } }).catch(() => 0);
    const minIntervalMs = liveCount > 0 ? 25 * 1000 : 4 * 60 * 1000;
    if (now - lastExternalSyncAt < minIntervalMs) return;
    lastExternalSyncAt = now;

    let incoming = [];

    // Try RapidAPI Cricbuzz first if key exists
    if (rapidKey && rapidKey !== 'dummy') {
        try {
            console.log('Syncing from RapidAPI Cricbuzz...');
            
            // Fetch live, recent and upcoming to be comprehensive
            const endpoints = ['live', 'recent', 'upcoming'];
            for (const ep of endpoints) {
                try {
                    const response = await axios.get(`https://cricbuzz-cricket.p.rapidapi.com/matches/v1/${ep}`, {
                        headers: {
                            'x-rapidapi-key': rapidKey,
                            'x-rapidapi-host': 'cricbuzz-cricket.p.rapidapi.com'
                        },
                        timeout: 10000
                    });

                    const typeMatches = response.data?.typeMatches || [];
                    for (const type of typeMatches) {
                        for (const series of (type.seriesMatches || [])) {
                            // Check if it's a seriesAdWrapper or direct matches
                            const matches = series.seriesAdWrapper?.matches || series.matches || [];
                            for (const m of matches) {
                                incoming.push(mapRapidMatch(m));
                            }
                        }
                    }
                } catch (epErr) {
                    console.warn(`RapidAPI Cricbuzz ${ep} sync failed:`, epErr.message);
                }
            }
            console.log(`RapidAPI: Found ${incoming.length} matches across all categories`);
        } catch (err) {
            console.warn('RapidAPI Cricbuzz sync failed:', err.message);
        }
    }

    // Fallback or secondary sync from CricAPI if configured and incoming is still low
    if (incoming.length < 5 && cricKey && cricKey !== 'dummy_cric_api_key') {
        try {
            console.log('Syncing from CricAPI...');
            const response = await axios.get('https://api.cricapi.com/v1/currentMatches', {
                params: { apikey: cricKey, offset: 0 },
                timeout: 10000
            });
            const cricMatches = (response.data?.data || []).map(mapExternalMatch);
            incoming = [...incoming, ...cricMatches];
        } catch (err) {
            console.warn('CricAPI sync failed:', err.message);
        }
    }

    if (!incoming.length) return;

    for (const m of incoming) {
        if (!m.externalId) continue;

        const row = await prisma.match.findFirst({
            where: { externalId: m.externalId, source: m.source }
        });

        if (row) {
            await prisma.match.update({
                where: { id: row.id },
                data: {
                    status: m.status,
                    scoreData: m.scoreData,
                    location: m.location || row.location,
                    date: m.date || row.date
                }
            });
        } else {
            // Check for title/date similarity to avoid duplicates from different sources
            const t = new Date(m.date).getTime();
            const winStart = new Date(t - 12 * 60 * 60 * 1000);
            const winEnd = new Date(t + 12 * 60 * 60 * 1000);
            const duplicate = await prisma.match.findFirst({
                where: {
                    title: { contains: m.title.split(' vs ')[0] },
                    date: { gte: winStart, lte: winEnd }
                }
            });

            if (!duplicate) {
                await prisma.match.create({ data: m });
            }
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
