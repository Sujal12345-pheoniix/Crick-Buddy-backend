const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const prisma = require('../utils/prisma');
const axios = require('axios');

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function scoreMatchPerformance(input) {
    const runs = Number(input.runs || 0);
    const balls = Number(input.balls || 0);
    const wickets = Number(input.wickets || 0);
    const oversBowled = Number(input.oversBowled || 0);
    const runsConceded = Number(input.runsConceded || 0);
    const catches = Number(input.catches || 0);
    const stumpings = Number(input.stumpings || 0);

    const strikeRate = balls > 0 ? (runs / balls) * 100 : 0;
    const economy = oversBowled > 0 ? runsConceded / oversBowled : 0;

    const battingScore = clamp(
        runs * 1.3 + strikeRate * 0.35 + (runs >= 50 ? 8 : 0) + (runs >= 100 ? 12 : 0),
        0,
        100
    );

    const bowlingScore = clamp(
        wickets * 20 + (oversBowled > 0 ? (12 - economy) * 5 : 0),
        0,
        100
    );

    const fieldingScore = clamp(catches * 12 + stumpings * 15, 0, 100);
    const overallScore = Math.round((battingScore * 0.45 + bowlingScore * 0.4 + fieldingScore * 0.15) * 10) / 10;

    return {
        battingScore: Math.round(battingScore * 10) / 10,
        bowlingScore: Math.round(bowlingScore * 10) / 10,
        fieldingScore: Math.round(fieldingScore * 10) / 10,
        strikeRate: Math.round(strikeRate * 10) / 10,
        economy: Math.round(economy * 10) / 10,
        overallScore
    };
}

function generateGrowthFeedback(current, previous) {
    const strengths = [];
    const weaknesses = [];
    const suggestions = [];

    const areaScores = [
        { key: 'batting', value: current.battingScore || 0 },
        { key: 'bowling', value: current.bowlingScore || 0 },
        { key: 'fielding', value: current.fieldingScore || 0 }
    ].sort((a, b) => a.value - b.value);
    const weakestArea = areaScores[0];

    if (current.battingScore >= 70) strengths.push('Strong batting contribution with stable run conversion.');
    if (current.bowlingScore >= 70) strengths.push('Bowling spells are impactful with wicket-taking intent.');
    if (current.fieldingScore >= 50) strengths.push('Fielding involvement is helping the team in key moments.');

    if (current.strikeRate < 110 && current.battingScore < 60) {
        weaknesses.push('Batting tempo is below match-impact level.');
        suggestions.push('Add powerplay acceleration drills: 24-ball scenario with intent targets.');
    }

    if (current.economy > 8 && current.bowlingScore < 60) {
        weaknesses.push('Run containment during bowling spells needs improvement.');
        suggestions.push('Practice yorker + slower-ball accuracy: 3 sets x 18 deliveries at death zones.');
    }

    if (current.fieldingScore < 30) {
        weaknesses.push('Low fielding impact in recent match updates.');
        suggestions.push('Do 15-minute reaction catching and one-hand pickup drills before nets.');
    }

    let trend = 'stable';
    if (previous) {
        const delta = current.overallScore - previous.overallScore;
        if (delta >= 3) trend = 'improving';
        else if (delta <= -3) trend = 'declining';

        const battingDelta = (current.battingScore || 0) - (previous.battingScore || 0);
        const bowlingDelta = (current.bowlingScore || 0) - (previous.bowlingScore || 0);
        const fieldingDelta = (current.fieldingScore || 0) - (previous.fieldingScore || 0);

        if (battingDelta >= 4) strengths.push('Batting impact improved compared to the previous match.');
        if (bowlingDelta >= 4) strengths.push('Bowling impact improved compared to the previous match.');
        if (fieldingDelta >= 4) strengths.push('Fielding contribution is trending upward.');

        if (battingDelta <= -4) weaknesses.push('Batting output dipped versus your previous match.');
        if (bowlingDelta <= -4) weaknesses.push('Bowling control/impact dropped from the last game.');
        if (fieldingDelta <= -4) weaknesses.push('Fielding impact dipped compared with the previous match.');

        if (delta >= 5) suggestions.push('Great progress. Increase difficulty with pressure simulation sessions.');
        if (delta <= -5) suggestions.push('Reset baseline: focus on consistency and reduce high-risk shot selection.');
    }

    if (weakestArea.key === 'batting') {
        suggestions.push(`Priority area: batting (${Math.round(weakestArea.value)}/100). Run 2 controlled powerplay tempo drills before your next match.`);
    } else if (weakestArea.key === 'bowling') {
        suggestions.push(`Priority area: bowling (${Math.round(weakestArea.value)}/100). Add line-length repeat sets and death-over accuracy reps.`);
    } else {
        suggestions.push(`Priority area: fielding (${Math.round(weakestArea.value)}/100). Add reaction catches and pickup-release drills in warm-up.`);
    }

    if (!strengths.length) strengths.push('Building consistency across match phases.');
    if (!weaknesses.length) weaknesses.push('No major technical drop detected; focus on repeatable execution.');
    if (!suggestions.length) suggestions.push('Maintain current routine and review one match clip after every game.');

    return { trend, strengths, weaknesses, suggestions };
}

// GET /api/progress?type=batting
router.get('/', protect, async (req, res) => {
    try {
        const { type, limit = 30 } = req.query;
        
        const query = { userId: req.user.id };
        if (type) query.type = type;

        const entries = await prisma.progressEntry.findMany({
            where: query,
            orderBy: { date: 'asc' },
            take: Number(limit)
        });

        res.json({ success: true, entries });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/progress/summary
router.get('/summary', protect, async (req, res) => {
    try {
        const [batting, bowling, posture] = await Promise.all([
            prisma.progressEntry.findFirst({ where: { userId: req.user.id, type: 'batting' }, orderBy: { date: 'desc' } }),
            prisma.progressEntry.findFirst({ where: { userId: req.user.id, type: 'bowling' }, orderBy: { date: 'desc' } }),
            prisma.progressEntry.findFirst({ where: { userId: req.user.id, type: 'posture' }, orderBy: { date: 'desc' } })
        ]);

        res.json({
            success: true,
            summary: {
                batting: batting || null,
                bowling: bowling || null,
                posture: posture || null
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/progress/match-performance
router.get('/match-performance', protect, async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
        const latestFirst = await prisma.progressEntry.findMany({
            where: { userId: req.user.id, type: 'match' },
            orderBy: { date: 'desc' },
            take: limit
        });
        const entries = latestFirst.reverse();
        res.json({ success: true, entries });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/progress/match-performance/analysis
router.get('/match-performance/analysis', protect, async (req, res) => {
    try {
        const entries = await prisma.progressEntry.findMany({
            where: { userId: req.user.id, type: 'match' },
            orderBy: { date: 'asc' }
        });

        if (!entries.length) {
            return res.json({
                success: true,
                analysis: {
                    sessions: 0,
                    averageScore: 0,
                    latestScore: 0,
                    improvement: 0,
                    trend: 'stable',
                    strengths: ['No match performance submitted yet.'],
                    weaknesses: ['Start adding match stats to unlock growth analysis.'],
                    suggestions: ['Submit your recent match runs, balls, wickets and fielding stats.']
                }
            });
        }

        const latest = entries[entries.length - 1];
        const first = entries[0];
        const avg = entries.reduce((sum, e) => sum + (e.overallScore || 0), 0) / entries.length;
        const improvement = (latest.overallScore || 0) - (first.overallScore || 0);

        const previous = entries.length > 1 ? entries[entries.length - 2] : null;
        const feedback = generateGrowthFeedback(
            {
                battingScore: latest.stanceScore || 0,
                bowlingScore: latest.releasePointScore || 0,
                fieldingScore: latest.balanceScore || 0,
                strikeRate: latest.batSwingAngle || 0,
                economy: latest.armRotationAngle || 0,
                overallScore: latest.overallScore || 0
            },
            previous
                ? {
                    battingScore: previous.stanceScore || 0,
                    bowlingScore: previous.releasePointScore || 0,
                    fieldingScore: previous.balanceScore || 0,
                    strikeRate: previous.batSwingAngle || 0,
                    economy: previous.armRotationAngle || 0,
                    overallScore: previous.overallScore || 0
                }
                : null
        );

        res.json({
            success: true,
            analysis: {
                sessions: entries.length,
                averageScore: Math.round(avg * 10) / 10,
                latestScore: latest.overallScore || 0,
                improvement: Math.round(improvement * 10) / 10,
                ...feedback
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/progress/match-performance
router.post('/match-performance', protect, async (req, res) => {
    try {
        const {
            matchDate,
            runs = 0,
            balls = 0,
            wickets = 0,
            oversBowled = 0,
            runsConceded = 0,
            catches = 0,
            stumpings = 0
        } = req.body;

        const scores = scoreMatchPerformance({
            runs,
            balls,
            wickets,
            oversBowled,
            runsConceded,
            catches,
            stumpings
        });

        const previous = await prisma.progressEntry.findFirst({
            where: { userId: req.user.id, type: 'match' },
            orderBy: { date: 'desc' }
        });

        const previousComputed = previous
            ? {
                battingScore: previous.stanceScore || 0,
                bowlingScore: previous.releasePointScore || 0,
                fieldingScore: previous.balanceScore || 0,
                strikeRate: previous.batSwingAngle || 0,
                economy: previous.armRotationAngle || 0,
                overallScore: previous.overallScore || 0
            }
            : null;

        let feedback = generateGrowthFeedback(scores, previousComputed);
        try {
            const aiUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
            const aiResp = await axios.post(`${aiUrl}/match-growth`, {
                latest: { matchDate, runs, balls, wickets, oversBowled, runsConceded, catches, stumpings, computed: scores },
                previous: previousComputed ? { computed: previousComputed } : null,
                history: []
            }, { timeout: 15000 });
            if (aiResp.data?.analysis) {
                feedback = aiResp.data.analysis;
            }
        } catch (_) {
            // silent fallback to local heuristic feedback
        }

        const entry = await prisma.progressEntry.create({
            data: {
                userId: req.user.id,
                type: 'match',
                date: matchDate ? new Date(matchDate) : new Date(),
                // Reusing numeric columns for match KPIs to avoid schema change.
                stanceScore: scores.battingScore,
                releasePointScore: scores.bowlingScore,
                balanceScore: scores.fieldingScore,
                batSwingAngle: scores.strikeRate,
                armRotationAngle: scores.economy,
                overallScore: scores.overallScore
            }
        });

        res.status(201).json({
            success: true,
            entry,
            computed: scores,
            feedback
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
