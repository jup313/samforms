const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

// Configure multer for PDF uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(req.app.locals.rootDir, 'pdf-templates', 'active');
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const formType = req.body.form_type || 'unknown';
        const timestamp = Date.now();
        cb(null, `${formType.replace(/[^a-zA-Z0-9-]/g, '_')}_${timestamp}.pdf`);
    }
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'));
        }
    },
    limits: { fileSize: 50 * 1024 * 1024 }
});

// Get all templates
router.get('/', (req, res) => {
    const db = req.app.locals.db;
    try {
        const { active_only } = req.query;
        let templates;
        if (active_only === 'true') {
            templates = db.prepare('SELECT * FROM templates WHERE active = 1 ORDER BY form_type').all();
        } else {
            templates = db.prepare('SELECT * FROM templates ORDER BY form_type, active DESC').all();
        }
        res.json(templates);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get single template
router.get('/:id', (req, res) => {
    const db = req.app.locals.db;
    try {
        const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
        if (!template) return res.status(404).json({ error: 'Template not found' });
        res.json(template);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get PDF field names from uploaded template
router.get('/:id/fields', async (req, res) => {
    const db = req.app.locals.db;
    try {
        const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
        if (!template) return res.status(404).json({ error: 'Template not found' });
        
        if (!template.file_path || !fs.existsSync(path.join(req.app.locals.rootDir, template.file_path))) {
            // Return field mappings from DB if no PDF uploaded yet
            return res.json({ 
                fields: [], 
                mappings: JSON.parse(template.field_mappings || '{}'),
                hasPdf: false 
            });
        }

        const pdfBytes = fs.readFileSync(path.join(req.app.locals.rootDir, template.file_path));
        const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const form = pdfDoc.getForm();
        const fields = form.getFields().map(field => ({
            name: field.getName(),
            type: field.constructor.name
        }));

        res.json({ 
            fields, 
            mappings: JSON.parse(template.field_mappings || '{}'),
            hasPdf: true 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Upload/Update template PDF
router.post('/upload', upload.single('pdf'), async (req, res) => {
    const db = req.app.locals.db;
    try {
        const { template_id, form_type, form_name, version_year } = req.body;
        
        if (!req.file) {
            return res.status(400).json({ error: 'No PDF file uploaded' });
        }

        const relativePath = path.join('pdf-templates', 'active', req.file.filename);

        // Try to read PDF fields
        let pdfFields = [];
        try {
            const pdfBytes = fs.readFileSync(req.file.path);
            const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
            const form = pdfDoc.getForm();
            pdfFields = form.getFields().map(f => ({
                name: f.getName(),
                type: f.constructor.name
            }));
        } catch (e) {
            // PDF might not have form fields
        }

        if (template_id) {
            // Update existing template
            const existing = db.prepare('SELECT * FROM templates WHERE id = ?').get(template_id);
            
            if (existing && existing.file_path) {
                // Archive old PDF
                const oldPath = path.join(req.app.locals.rootDir, existing.file_path);
                if (fs.existsSync(oldPath)) {
                    const archivePath = path.join(req.app.locals.rootDir, 'pdf-templates', 'archive', 
                        `${existing.form_type}_${existing.version_year}_${Date.now()}.pdf`);
                    fs.copyFileSync(oldPath, archivePath);
                }
            }

            db.prepare(`
                UPDATE templates SET 
                    file_path = ?,
                    version_year = COALESCE(?, version_year),
                    form_name = COALESCE(?, form_name),
                    upload_date = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(relativePath, version_year, form_name, template_id);

            const updated = db.prepare('SELECT * FROM templates WHERE id = ?').get(template_id);
            res.json({ template: updated, pdfFields });
        } else {
            // Create new template
            if (!form_type) {
                return res.status(400).json({ error: 'form_type is required for new templates' });
            }

            // Deactivate any existing active template of this type
            db.prepare('UPDATE templates SET active = 0 WHERE form_type = ? AND active = 1').run(form_type);

            const result = db.prepare(`
                INSERT INTO templates (form_type, form_name, version_year, file_path, field_mappings, active)
                VALUES (?, ?, ?, ?, '{}', 1)
            `).run(form_type, form_name || form_type, version_year || new Date().getFullYear().toString(), relativePath);

            const newTemplate = db.prepare('SELECT * FROM templates WHERE id = ?').get(result.lastInsertRowid);
            res.status(201).json({ template: newTemplate, pdfFields });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update field mappings
router.put('/:id/mappings', (req, res) => {
    const db = req.app.locals.db;
    try {
        const { field_mappings } = req.body;
        db.prepare('UPDATE templates SET field_mappings = ? WHERE id = ?')
            .run(JSON.stringify(field_mappings), req.params.id);
        
        const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
        res.json(template);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update template metadata
router.put('/:id', (req, res) => {
    const db = req.app.locals.db;
    try {
        const { form_name, version_year, active } = req.body;
        db.prepare(`
            UPDATE templates SET 
                form_name = COALESCE(?, form_name),
                version_year = COALESCE(?, version_year),
                active = COALESCE(?, active)
            WHERE id = ?
        `).run(form_name, version_year, active, req.params.id);

        const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
        res.json(template);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete template (archive it)
router.delete('/:id', (req, res) => {
    const db = req.app.locals.db;
    try {
        const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
        if (template && template.file_path) {
            const oldPath = path.join(req.app.locals.rootDir, template.file_path);
            if (fs.existsSync(oldPath)) {
                const archivePath = path.join(req.app.locals.rootDir, 'pdf-templates', 'archive',
                    `${template.form_type}_${template.version_year}_archived_${Date.now()}.pdf`);
                fs.renameSync(oldPath, archivePath);
            }
        }
        db.prepare('UPDATE templates SET active = 0 WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
