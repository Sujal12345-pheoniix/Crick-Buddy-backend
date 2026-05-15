const express = require('express');
const router = express.Router();
const axios = require('axios');
const { protect } = require('../middleware/auth');

const cricketKnowledge = {
    'batting stance': 'A good batting stance requires feet shoulder-width apart, knees slightly bent, weight balanced on balls of feet, bat held near the crease with soft hands.',
    'bowling action': 'Perfect bowling action: aligned run-up, side-on or front-on, high arm release, full follow-through. Consistency is key.',
    'improve batting': 'Focus on: 1) Playing with soft hands 2) Head still when playing shots 3) Watch ball closely 4) Practice with a stump facing throwdowns.',
    'improve bowling': 'Focus on: 1) Consistent release point 2) Strong wrist position 3) Hip drive in delivery stride 4) Strong follow-through.'
};

// POST /api/chatbot
router.post('/', protect, async (req, res) => {
    try {
        const { message, history = [] } = req.body;
        if (!message) return res.status(400).json({ success: false, message: 'Message is required' });

        // Try to forward to AI service
        try {
            const aiUrl = process.env.AI_SERVICE_URL;
            const response = await axios.post(`${aiUrl}/chatbot`, {
                message,
                history,
                user_profile: {
                    name: req.user.name,
                    playerType: req.user.playerType,
                    experienceLevel: req.user.experienceLevel,
                    battingStyle: req.user.battingStyle,
                    bowlingStyle: req.user.bowlingStyle
                }
            }, { timeout: 30000 });

            return res.json({ success: true, reply: response.data.reply, source: 'ai' });
        } catch (aiErr) {
            // Fallback: rule-based responses
            const lowerMsg = message.toLowerCase();
            let reply = `Hello ${req.user.name}! As your AI cricket coach, I'm here to help. `;

            for (const [key, val] of Object.entries(cricketKnowledge)) {
                if (lowerMsg.includes(key)) {
                    reply = val;
                    break;
                }
            }

            if (reply.startsWith('Hello')) {
                const tips = [
                    `For a ${req.user.playerType} at ${req.user.experienceLevel} level, focus on mastering the basics first.`,
                    'Practice net sessions 3x per week for consistent improvement.',
                    'Video analysis helps you identify technical flaws invisible to the naked eye.',
                    'Fitness training is just as important as technical skills in modern cricket.',
                    'Mental strength separates good players from great players.'
                ];
                reply += tips[Math.floor(Math.random() * tips.length)];
            }

            return res.json({ success: true, reply, source: 'fallback' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
