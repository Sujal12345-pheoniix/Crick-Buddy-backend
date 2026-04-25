const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');

const equipmentData = {
    bat: [
        {
            id: 1, name: 'SG Sunny Tonny Cricket Bat', brand: 'SG', type: 'English Willow',
            weight: '1180g', price: '₹4,500', rating: 4.5,
            for: ['beginner', 'intermediate'],
            image: 'https://placehold.co/300x400/1a1a2e/00ff88?text=SG+Bat',
            amazonLink: '#', decathlonLink: '#',
            description: 'Perfect for beginners. Good balance and medium weight.'
        },
        {
            id: 2, name: 'GM Original 606 Cricket Bat', brand: 'GM', type: 'English Willow',
            weight: '1210g', price: '₹12,000', rating: 4.8,
            for: ['intermediate', 'professional'],
            image: 'https://placehold.co/300x400/1a1a2e/00ff88?text=GM+Bat',
            amazonLink: '#', decathlonLink: '#',
            description: 'Pro-level bat with thick edge and premium grip.'
        },
        {
            id: 3, name: 'MRF Genius Grand Edition', brand: 'MRF', type: 'English Willow',
            weight: '1240g', price: '₹18,500', rating: 4.9,
            for: ['professional'],
            image: 'https://placehold.co/300x400/1a1a2e/00ff88?text=MRF+Bat',
            amazonLink: '#', decathlonLink: '#',
            description: 'Used by Virat Kohli. Maximum power and precision.'
        }
    ],
    gloves: [
        {
            id: 4, name: 'SG Club Cricket Gloves', brand: 'SG', price: '₹800', rating: 4.2,
            for: ['beginner'],
            image: 'https://placehold.co/300x400/1a1a2e/00ff88?text=SG+Gloves',
            amazonLink: '#', description: 'Comfortable foam padding for club players.'
        },
        {
            id: 5, name: 'Kookaburra Pro 600 Batting Gloves', brand: 'Kookaburra', price: '₹3,200', rating: 4.7,
            for: ['intermediate', 'professional'],
            image: 'https://placehold.co/300x400/1a1a2e/00ff88?text=KK+Gloves',
            amazonLink: '#', description: 'Premium leather, excellent grip and protection.'
        }
    ],
    training: [
        {
            id: 6, name: 'Hanging Cricket Ball Trainer', brand: 'Generic', price: '₹350', rating: 4.3,
            for: ['beginner', 'intermediate'],
            image: 'https://placehold.co/300x400/1a1a2e/00ff88?text=Ball+Trainer',
            description: 'Practice shots at home with elastic hanging ball.'
        },
        {
            id: 7, name: 'Speed Gun Radar Cricket', brand: 'Bushnell', price: '₹4,800', rating: 4.6,
            for: ['intermediate', 'professional'],
            image: 'https://placehold.co/300x400/1a1a2e/00ff88?text=Radar+Gun',
            description: 'Measure ball speed accurately during training.'
        },
        {
            id: 8, name: 'Resistance Band Set for Bowlers', brand: 'Decathlon', price: '₹990', rating: 4.4,
            for: ['beginner', 'intermediate', 'professional'],
            image: 'https://placehold.co/300x400/1a1a2e/00ff88?text=Resistance+Band',
            description: 'Strengthen shoulder and wrist for better bowling.'
        }
    ]
};

// GET /api/equipment?level=beginner&playerType=batsman
router.get('/', protect, async (req, res) => {
    try {
        const { level, playerType } = req.query;
        const userLevel = level || req.user.experienceLevel || 'beginner';

        const filterItems = (items) => items.filter(i => !i.for || i.for.includes(userLevel));

        res.json({
            success: true,
            recommendations: {
                bats: filterItems(equipmentData.bat),
                gloves: filterItems(equipmentData.gloves),
                training: filterItems(equipmentData.training)
            },
            userLevel
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
