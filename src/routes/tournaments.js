const express = require('express');
const router = express.Router();
const axios = require('axios');
const prisma = require('../utils/prisma');
const { protect, authorize } = require('../middleware/auth');

function toRadians(v) {
    return (v * Math.PI) / 180;
}

function haversineKm(lat1, lon1, lat2, lon2) {
    const earthRadiusKm = 6371;
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusKm * c;
}

async function geocodeLocation(query) {
    const q = String(query || '').trim();
    if (!q) return null;

    try {
        const res = await axios.get('https://nominatim.openstreetmap.org/search', {
            params: { q, format: 'json', limit: 1 },
            timeout: 8000,
            headers: {
                // Nominatim requires a User-Agent and discourages heavy usage.
                'User-Agent': 'crick-buddy/1.0 (tournament-discovery)'
            }
        });
        const hit = Array.isArray(res.data) ? res.data[0] : null;
        if (!hit) return null;
        const lat = Number(hit.lat);
        const lon = Number(hit.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return { latitude: lat, longitude: lon };
    } catch (_) {
        return null;
    }
}

async function seedFallbackTournaments() {
    const now = Date.now();
    const rows = [
        {
            name: 'Indian Premier League 2026',
            startDate: new Date(now - 5 * 24 * 60 * 60 * 1000),
            endDate: new Date(now + 40 * 24 * 60 * 60 * 1000),
            location: 'Multiple Cities, India',
            latitude: 20.5937,
            longitude: 78.9629,
            description: 'Franchise T20 league across India (use city filters for local venues)',
            status: 'ongoing'
        },
        {
            name: 'Mumbai Collegiate T20 — Open Qualifiers',
            startDate: new Date(now + 3 * 24 * 60 * 60 * 1000),
            endDate: new Date(now + 10 * 24 * 60 * 60 * 1000),
            location: 'Mumbai, India',
            latitude: 19.0760,
            longitude: 72.8777,
            description: 'City and club qualifiers — search “Mumbai” in discovery',
            status: 'upcoming'
        },
        {
            name: 'Ranji Trophy Zone Stage',
            startDate: new Date(now + 20 * 24 * 60 * 60 * 1000),
            endDate: new Date(now + 80 * 24 * 60 * 60 * 1000),
            location: 'Delhi, India',
            latitude: 28.6139,
            longitude: 77.2090,
            description: 'Domestic first-class championship',
            status: 'upcoming'
        },
        {
            name: 'Bengaluru Premier T20 League',
            startDate: new Date(now + 7 * 24 * 60 * 60 * 1000),
            endDate: new Date(now + 15 * 24 * 60 * 60 * 1000),
            location: 'Bengaluru, India',
            latitude: 12.9716,
            longitude: 77.5946,
            description: 'City-level T20 tournament with club qualifiers',
            status: 'upcoming'
        },
        {
            name: 'Hyderabad District One-Day Cup',
            startDate: new Date(now + 10 * 24 * 60 * 60 * 1000),
            endDate: new Date(now + 18 * 24 * 60 * 60 * 1000),
            location: 'Hyderabad, India',
            latitude: 17.3850,
            longitude: 78.4867,
            description: 'Limited overs district competition',
            status: 'upcoming'
        },
        {
            name: 'Chennai Coastal Cricket Championship',
            startDate: new Date(now + 5 * 24 * 60 * 60 * 1000),
            endDate: new Date(now + 13 * 24 * 60 * 60 * 1000),
            location: 'Chennai, India',
            latitude: 13.0827,
            longitude: 80.2707,
            description: 'Open city tournament for senior players',
            status: 'upcoming'
        },
        {
            name: 'Pune Challenger Weekend League',
            startDate: new Date(now + 14 * 24 * 60 * 60 * 1000),
            endDate: new Date(now + 24 * 24 * 60 * 60 * 1000),
            location: 'Pune, India',
            latitude: 18.5204,
            longitude: 73.8567,
            description: 'Weekend red-ball + white-ball hybrid format',
            status: 'upcoming'
        },
        {
            name: 'Kolkata Monsoon Cricket Festival',
            startDate: new Date(now + 16 * 24 * 60 * 60 * 1000),
            endDate: new Date(now + 26 * 24 * 60 * 60 * 1000),
            location: 'Kolkata, India',
            latitude: 22.5726,
            longitude: 88.3639,
            description: 'Multi-club T20 cup',
            status: 'upcoming'
        },
        {
            name: 'ICC Champions Trophy Warmup Series',
            startDate: new Date(now + 12 * 24 * 60 * 60 * 1000),
            endDate: new Date(now + 25 * 24 * 60 * 60 * 1000),
            location: 'Dubai, UAE',
            latitude: 25.2048,
            longitude: 55.2708,
            description: 'International limited overs build-up fixtures',
            status: 'upcoming'
        }
    ];

    for (const row of rows) {
        const exists = await prisma.tournament.findFirst({
            where: { name: row.name, startDate: row.startDate }
        });
        if (!exists) {
            await prisma.tournament.create({ data: row });
        }
    }
}

// GET /api/tournaments
router.get('/', protect, async (req, res) => {
    try {
        const { status, q, location, limit } = req.query;

        const tournaments = await prisma.tournament.findMany({
            where: {
                ...(status && status !== 'all' ? { status: String(status) } : {}),
                ...(q ? {
                    OR: [
                        { name: { contains: String(q), mode: 'insensitive' } },
                        { description: { contains: String(q), mode: 'insensitive' } },
                        { location: { contains: String(q), mode: 'insensitive' } }
                    ]
                } : {}),
                ...(location ? { location: { contains: String(location), mode: 'insensitive' } } : {})
            },
            orderBy: { startDate: 'asc' }
        });

        if (!tournaments.length) {
            await seedFallbackTournaments();
        }

        let finalRows = tournaments;
        if (!finalRows.length) {
            finalRows = await prisma.tournament.findMany({
                orderBy: { startDate: 'asc' }
            });
        }

        const capped = Number(limit) > 0 ? finalRows.slice(0, Number(limit)) : finalRows;
        res.json({
            success: true,
            filters: {
                status: status || 'all',
                q: q || '',
                location: location || ''
            },
            tournaments: capped
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/tournaments/discover?location=Mumbai
router.get('/discover', protect, async (req, res) => {
    try {
        const location = String(req.query.location || '').trim();
        const latitude = Number(req.query.latitude);
        const longitude = Number(req.query.longitude);
        const radiusKm = Math.max(1, Math.min(500, Number(req.query.radiusKm) || 100));
        let hasGeoInput = Number.isFinite(latitude) && Number.isFinite(longitude);
        let geo = hasGeoInput ? { latitude, longitude } : null;

        let upcoming = await prisma.tournament.findMany({
            where: {
                status: { in: ['upcoming', 'ongoing'] }
            },
            orderBy: { startDate: 'asc' },
            take: 100
        });

        if (!upcoming.length) {
            await seedFallbackTournaments();
            upcoming = await prisma.tournament.findMany({
                where: { status: { in: ['upcoming', 'ongoing'] } },
                orderBy: { startDate: 'asc' },
                take: 100
            });
        }

        const rows = upcoming;

        // If user only provided city text (no GPS), try to geocode for "near me" sorting/filtering.
        if (!hasGeoInput && location) {
            const resolved = await geocodeLocation(location);
            if (resolved) {
                hasGeoInput = true;
                geo = resolved;
            }
        }

        let resultRows = rows;
        if (hasGeoInput) {
            const ranked = rows
                .map((t) => {
                    if (typeof t.latitude !== 'number' || typeof t.longitude !== 'number') {
                        return { ...t, distanceKm: null };
                    }
                    const distanceKm = haversineKm(geo.latitude, geo.longitude, t.latitude, t.longitude);
                    return { ...t, distanceKm: Math.round(distanceKm * 10) / 10 };
                });

            const withKnownDistance = ranked
                .filter((t) => t.distanceKm !== null)
                .sort((a, b) => a.distanceKm - b.distanceKm);

            const withinRadius = withKnownDistance.filter((t) => t.distanceKm <= radiusKm);
            if (withinRadius.length > 0) {
                resultRows = withinRadius;
            } else if (location) {
                resultRows = [];
            } else {
                const unknownDistance = ranked.filter((t) => t.distanceKm === null);
                resultRows = [...withKnownDistance, ...unknownDistance];
            }
        } else if (location) {
            const q = location.toLowerCase();
            resultRows = rows.filter((t) =>
                t.location.toLowerCase().includes(q) ||
                t.name.toLowerCase().includes(q) ||
                String(t.description || '').toLowerCase().includes(q)
            );
        }

        resultRows = resultRows
            .sort((a, b) => {
                const aStart = new Date(a.startDate).getTime();
                const bStart = new Date(b.startDate).getTime();
                if (aStart !== bStart) return aStart - bStart;
                if (a.distanceKm === null && b.distanceKm === null) return 0;
                if (a.distanceKm === null) return 1;
                if (b.distanceKm === null) return -1;
                return a.distanceKm - b.distanceKm;
            })
            .slice(0, 50);

        res.json({
            success: true,
            location: location || null,
            coordinates: hasGeoInput ? { latitude: geo.latitude, longitude: geo.longitude, radiusKm } : null,
            tournaments: resultRows
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/tournaments (Admin only)
router.post('/', protect, authorize('admin', 'coach'), async (req, res) => {
    try {
        const { name, startDate, endDate, location, description, latitude, longitude } = req.body;

        let lat = typeof latitude === 'number' ? latitude : null;
        let lon = typeof longitude === 'number' ? longitude : null;
        if ((!lat || !lon) && location) {
            const resolved = await geocodeLocation(location);
            if (resolved) {
                lat = lat ?? resolved.latitude;
                lon = lon ?? resolved.longitude;
            }
        }
        
        const tournament = await prisma.tournament.create({
            data: {
                name,
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                location,
                description,
                latitude: lat,
                longitude: lon
            }
        });

        res.status(201).json({ success: true, tournament });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
