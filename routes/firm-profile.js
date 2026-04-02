const express = require('express');
const router = express.Router();

// All columns in the firm_profile table (excluding id and updated_at)
const PROFILE_COLUMNS = [
    'firm_name', 'firm_address', 'firm_city', 'firm_state', 'firm_zip',
    'firm_phone', 'firm_fax', 'firm_email', 'firm_ein', 'firm_ptin',
    'preparer_name', 'preparer_title',
    'representative_name', 'representative_address',
    'representative_phone', 'representative_fax', 'representative_ptin',
    'representative_designation', 'representative_jurisdiction',
    'representative_bar_number', 'caf_number'
];

// GET /api/firm-profile — return the single firm profile row
router.get('/', (req, res) => {
    const db = req.app.locals.db;
    try {
        const profile = db.prepare('SELECT * FROM firm_profile WHERE id = 1').get();
        if (!profile) {
            // Table exists but no row — shouldn't happen since schema seeds it
            db.prepare('INSERT OR IGNORE INTO firm_profile (id) VALUES (1)').run();
            return res.json(db.prepare('SELECT * FROM firm_profile WHERE id = 1').get());
        }
        res.json(profile);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/firm-profile — update the firm profile
router.put('/', (req, res) => {
    const db = req.app.locals.db;
    try {
        const updates = [];
        const values = [];

        for (const col of PROFILE_COLUMNS) {
            if (req.body[col] !== undefined) {
                updates.push(`${col} = ?`);
                values.push(req.body[col] || null);
            }
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No valid fields provided' });
        }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(1); // WHERE id = 1

        db.prepare(`UPDATE firm_profile SET ${updates.join(', ')} WHERE id = ?`).run(...values);

        const profile = db.prepare('SELECT * FROM firm_profile WHERE id = 1').get();
        res.json(profile);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
