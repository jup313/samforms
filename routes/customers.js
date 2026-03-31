const express = require('express');
const router = express.Router();

// Get all customers (sorted by last_name, first_name)
router.get('/', (req, res) => {
    const db = req.app.locals.db;
    try {
        const { search } = req.query;
        let customers;
        if (search) {
            customers = db.prepare(`
                SELECT * FROM customers 
                WHERE first_name LIKE ? OR last_name LIKE ? OR business_name LIKE ? OR email LIKE ?
                ORDER BY last_name, first_name
            `).all(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
        } else {
            customers = db.prepare('SELECT * FROM customers ORDER BY last_name, first_name').all();
        }
        res.json(customers);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get single customer
router.get('/:id', (req, res) => {
    const db = req.app.locals.db;
    try {
        const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
        if (!customer) return res.status(404).json({ error: 'Customer not found' });
        res.json(customer);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create customer
router.post('/', (req, res) => {
    const db = req.app.locals.db;
    try {
        const { first_name, last_name, ssn, ein, business_name, address, city, state, zip, phone, email, date_of_birth, filing_status, notes } = req.body;
        
        if (!first_name || !last_name) {
            return res.status(400).json({ error: 'First name and last name are required' });
        }

        const result = db.prepare(`
            INSERT INTO customers (first_name, last_name, ssn, ein, business_name, address, city, state, zip, phone, email, date_of_birth, filing_status, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(first_name, last_name, ssn || null, ein || null, business_name || null, address || null, city || null, state || null, zip || null, phone || null, email || null, date_of_birth || null, filing_status || null, notes || null);

        const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid);
        res.status(201).json(customer);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update customer
router.put('/:id', (req, res) => {
    const db = req.app.locals.db;
    try {
        const { first_name, last_name, ssn, ein, business_name, address, city, state, zip, phone, email, date_of_birth, filing_status, notes } = req.body;
        
        db.prepare(`
            UPDATE customers SET 
                first_name = COALESCE(?, first_name),
                last_name = COALESCE(?, last_name),
                ssn = COALESCE(?, ssn),
                ein = COALESCE(?, ein),
                business_name = COALESCE(?, business_name),
                address = COALESCE(?, address),
                city = COALESCE(?, city),
                state = COALESCE(?, state),
                zip = COALESCE(?, zip),
                phone = COALESCE(?, phone),
                email = COALESCE(?, email),
                date_of_birth = COALESCE(?, date_of_birth),
                filing_status = COALESCE(?, filing_status),
                notes = COALESCE(?, notes),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(first_name, last_name, ssn, ein, business_name, address, city, state, zip, phone, email, date_of_birth, filing_status, notes, req.params.id);

        const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
        res.json(customer);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete customer
router.delete('/:id', (req, res) => {
    const db = req.app.locals.db;
    try {
        db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get customer's form history
router.get('/:id/forms', (req, res) => {
    const db = req.app.locals.db;
    try {
        const forms = db.prepare(`
            SELECT fs.*, t.form_name, t.version_year 
            FROM form_submissions fs
            LEFT JOIN templates t ON fs.template_id = t.id
            WHERE fs.customer_id = ?
            ORDER BY fs.created_at DESC
        `).all(req.params.id);
        res.json(forms);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
