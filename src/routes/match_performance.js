/**
 * Match Performance Route
 * =======================
 * Stores player match performance using the NEW MatchPerformanceEntry model.
 * All scores are calculated from deterministic formulas.
 * Column semantics are correct: runs are stored in `runs`, not in `stanceScore`.
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const prisma = require('../utils/prisma');

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Deterministic match performance scoring.
 * All formulas documented inline.
 * Input values come directly from user (no inference).
 */
function scoreMatchPerformance(input) {
    const runs = Number(input.runs || 0);
    const balls = Number(input.balls || 0);
    const wickets = Number(input.wickets || 0);
    const oversBowled = Number(input.oversBowled || 0);
    const runsConceded = Number(input.runsConceded || 0);
    const catches = Number(input.catches || 0);
    const stumpings = Number(input.stumpings || 0);

    // Formula: strikeRate = (runs / balls) * 100  [0 if no balls faced]
    const strikeRate = balls > 0 ? (runs / balls) * 100 : 0;
    // Formula: economy = runsConceded / oversBowled  [0 if no overs bowled]
    const economy = oversBowled > 0 ? runsConceded / oversBowled : 0;

    // Formula: battingScore = clamp(runs*1.3 + strikeRate*0.35 + (runs>=50?8:0) + (runs>=100?12:0), 0, 100)
    const battingScore = clamp(
        runs * 1.3 + strikeRate * 0.35 + (runs >= 50 ? 8 : 0) + (runs >= 100 ? 12 : 0),
        0, 100
    );

    // Formula: bowlingScore = clamp(wickets*20 + (oversBowled>0 ? (12-economy)*5 : 0), 0, 100)
    const bowlingScore = clamp(
        wickets * 20 + (oversBowled > 0 ? (12 - economy) * 5 : 0),
        0, 100
    );

    // Formula: fieldingScore = clamp(catches*12 + stumpings*15, 0, 100)
    const fieldingScore = clamp(catches * 12 + stumpings * 15, 0, 100);

    // Formula: overallScore = 0.45*batting + 0.40*bowling + 0.15*fielding
    const overallScore = Math.round((battingScore * 0.45 + bowlingScore * 0.40 + fieldingScore * 0.15) * 10) / 10;

    return {
        strikeRate: Math.round(strikeRate * 10) / 10,
        economy: Math.round(economy * 10) / 10,
        battingScore: Math.round(battingScore * 10) / 10,
        bowlingScore: Math.round(bowlingScore * 10) / 10,
        fieldingScore: Math.round(fieldingScore * 10) / 10,
        overallScore,
    };
}

function computeTrend(current, previous) {
    if (!previous) return 'stable';
    const delta = current.overallScore - previous.overallScore;
    if (delta >= 5) return 'improving';
    if (delta <= -5) return 'declining';
    return 'stable';
}

function generateFeedback(current, previous) {
    const strengths = [];
    const weaknesses = [];
    const suggestions = [];

    // Strengths from good scores
    if (current.battingScore >= 70)
        strengths.push(`Strong batting contribution (score: ${current.battingScore}/100, SR: ${current.strikeRate})`);
    if (current.bowlingScore >= 70)
        strengths.push(`Effective bowling spell (score: ${current.bowlingScore}/100)`);
    if (current.fieldingScore >= 50)
        strengths.push(`Good fielding contribution (score: ${current.fieldingScore}/100)`);

    // Weaknesses from low scores  
    if (current.strikeRate < 110 && current.battingScore < 60) {
        weaknesses.push(`Batting tempo below match-impact level (SR: ${current.strikeRate})`);
        suggestions.push('Powerplay acceleration drill: 24-ball scenario targeting SR 120+');
    }
    if (current.economy > 8 && current.bowlingScore < 60) {
        weaknesses.push(`Run containment needs improvement (economy: ${current.economy})`);
        suggestions.push('Death-overs accuracy: yorker + slower-ball at target zones (3 × 18 balls)');
    }
    if (current.fieldingScore < 30) {
        weaknesses.push(`Low fielding contribution (score: ${current.fieldingScore}/100)`);
        suggestions.push('15-min reaction catching + pickup/throw routine before nets');
    }

    // Trend-based feedback
    if (previous) {
        const delta = current.overallScore - previous.overallScore;
        const battingDelta = current.battingScore - previous.battingScore;
        const bowlingDelta = current.bowlingScore - previous.bowlingScore;

        if (battingDelta >= 5) strengths.push(`Batting improved +${battingDelta.toFixed(1)} vs previous match`);
        if (bowlingDelta >= 5) strengths.push(`Bowling improved +${bowlingDelta.toFixed(1)} vs previous match`);
        if (battingDelta <= -5) weaknesses.push(`Batting dropped ${Math.abs(battingDelta).toFixed(1)} vs previous match`);
        if (bowlingDelta <= -5) weaknesses.push(`Bowling dropped ${Math.abs(bowlingDelta).toFixed(1)} vs previous match`);
        if (delta >= 5) suggestions.push('Great progress — add pressure simulation (chase/defend scenarios)');
        if (delta <= -5) suggestions.push('Reset baseline — prioritize consistency for 1-2 games');
    }

    if (!strengths.length) strengths.push('Building consistency across match phases');
    if (!weaknesses.length) weaknesses.push('No major technical drop detected — focus on repeatable execution');
    if (!suggestions.length) suggestions.push('Maintain routine and review one key phase after each match');

    return { strengths, weaknesses, suggestions };
}

// POST /api/match-performance
router.post('/', protect, async (req, res) => {
    try {
        const {
            matchDate,
            runs = 0,
            balls = 0,
            wickets = 0,
            oversBowled = 0,
            runsConceded = 0,
            catches = 0,
            stumpings = 0,
        } = req.body;

        // Validate numeric inputs
        const parsedRuns = Math.max(0, parseInt(runs, 10) || 0);
        const parsedBalls = Math.max(0, parseInt(balls, 10) || 0);
        const parsedWickets = Math.max(0, parseInt(wickets, 10) || 0);
        const parsedOversBowled = Math.max(0, parseFloat(oversBowled) || 0);
        const parsedRunsConceded = Math.max(0, parseInt(runsConceded, 10) || 0);
        const parsedCatches = Math.max(0, parseInt(catches, 10) || 0);
        const parsedStumpings = Math.max(0, parseInt(stumpings, 10) || 0);

        // Calculate scores using deterministic formulas
        const scores = scoreMatchPerformance({
            runs: parsedRuns,
            balls: parsedBalls,
            wickets: parsedWickets,
            oversBowled: parsedOversBowled,
            runsConceded: parsedRunsConceded,
            catches: parsedCatches,
            stumpings: parsedStumpings,
        });

        // Get previous entry to compute trend
        const previous = await prisma.matchPerformanceEntry.findFirst({
            where: { userId: req.user.id },
            orderBy: { matchDate: 'desc' },
        });

        const trend = computeTrend(scores, previous);
        const feedback = generateFeedback(scores, previous);

        // Store in MatchPerformanceEntry with CORRECT semantics
        const entry = await prisma.matchPerformanceEntry.create({
            data: {
                userId: req.user.id,
                matchDate: matchDate ? new Date(matchDate) : new Date(),
                // Raw inputs stored in their correct typed columns
                runs: parsedRuns,
                balls: parsedBalls,
                wickets: parsedWickets,
                oversBowled: parsedOversBowled,
                runsConceded: parsedRunsConceded,
                catches: parsedCatches,
                stumpings: parsedStumpings,
                // Calculated scores
                strikeRate: scores.strikeRate,
                economy: scores.economy,
                battingScore: scores.battingScore,
                bowlingScore: scores.bowlingScore,
                fieldingScore: scores.fieldingScore,
                overallScore: scores.overallScore,
                trend,
            },
        });

        res.status(201).json({
            success: true,
            entry,
            computed: scores,
            trend,
            feedback,
        });
    } catch (err) {
        console.error('Match performance error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/match-performance — list user's match history
router.get('/', protect, async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
        const entries = await prisma.matchPerformanceEntry.findMany({
            where: { userId: req.user.id },
            orderBy: { matchDate: 'asc' },
            take: limit,
        });
        res.json({ success: true, entries, count: entries.length });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/match-performance/analysis — trend + feedback from history
router.get('/analysis', protect, async (req, res) => {
    try {
        const entries = await prisma.matchPerformanceEntry.findMany({
            where: { userId: req.user.id },
            orderBy: { matchDate: 'asc' },
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
                    suggestions: ['Submit your recent match: runs, balls, wickets, overs, fielding.'],
                },
            });
        }

        const latest = entries[entries.length - 1];
        const first = entries[0];
        const avg = entries.reduce((sum, e) => sum + (e.overallScore || 0), 0) / entries.length;
        const improvement = (latest.overallScore || 0) - (first.overallScore || 0);
        const previous = entries.length > 1 ? entries[entries.length - 2] : null;
        const feedback = generateFeedback(
            { battingScore: latest.battingScore, bowlingScore: latest.bowlingScore,
              fieldingScore: latest.fieldingScore, strikeRate: latest.strikeRate,
              economy: latest.economy, overallScore: latest.overallScore },
            previous ? { battingScore: previous.battingScore, bowlingScore: previous.bowlingScore,
              fieldingScore: previous.fieldingScore, overallScore: previous.overallScore } : null
        );

        res.json({
            success: true,
            analysis: {
                sessions: entries.length,
                averageScore: Math.round(avg * 10) / 10,
                latestScore: latest.overallScore || 0,
                improvement: Math.round(improvement * 10) / 10,
                trend: latest.trend || 'stable',
                ...feedback,
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
