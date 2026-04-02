const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const https = require('https');
const http = require('http');
const pdftk = require('../utils/pdftk');

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

// Get available IRS PDF URLs (must be before /:id routes)
router.get('/irs/available', (req, res) => {
    const irsPdfUrls = req.app.locals.irsPdfUrls || {};
    res.json(irsPdfUrls);
});

// Download all IRS PDFs for templates that don't have one yet (must be before /:id routes)
router.post('/irs/download-all', async (req, res) => {
    const db = req.app.locals.db;
    try {
        const irsPdfUrls = req.app.locals.irsPdfUrls || {};
        const templates = db.prepare('SELECT * FROM templates WHERE active = 1 AND (file_path IS NULL OR file_path = \'\')').all();
        
        const results = { success: [], failed: [], skipped: [] };

        for (const template of templates) {
            const irsUrl = irsPdfUrls[template.form_type];
            if (!irsUrl) {
                results.skipped.push({ form_type: template.form_type, reason: 'No IRS URL mapped' });
                continue;
            }

            try {
                const filename = `${template.form_type.replace(/[^a-zA-Z0-9-]/g, '_')}_IRS_${Date.now()}.pdf`;
                const filePath = path.join(req.app.locals.rootDir, 'pdf-templates', 'active', filename);
                const relativePath = path.join('pdf-templates', 'active', filename);

                await downloadFile(irsUrl, filePath);

                db.prepare(`
                    UPDATE templates SET file_path = ?, version_year = ?, upload_date = CURRENT_TIMESTAMP WHERE id = ?
                `).run(relativePath, new Date().getFullYear().toString(), template.id);

                results.success.push(template.form_type);
            } catch (err) {
                results.failed.push({ form_type: template.form_type, error: err.message });
            }

            // Small delay to be nice to IRS servers
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        res.json({
            message: `Downloaded ${results.success.length} PDFs, ${results.failed.length} failed, ${results.skipped.length} skipped`,
            results
        });
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

// Get PDF field names from uploaded template (uses pdftk if available, falls back to pdf-lib)
router.get('/:id/fields', async (req, res) => {
    const db = req.app.locals.db;
    try {
        const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
        if (!template) return res.status(404).json({ error: 'Template not found' });
        
        const pdfFullPath = template.file_path ? path.join(req.app.locals.rootDir, template.file_path) : null;
        if (!pdfFullPath || !fs.existsSync(pdfFullPath)) {
            return res.json({ 
                fields: [], 
                mappings: JSON.parse(template.field_mappings || '{}'),
                hasPdf: false,
                engine: null
            });
        }

        let fields = [];
        let engine = 'pdf-lib';

        // Try pdftk first (better XFA support)
        if (pdftk.isPdftkAvailable()) {
            const pdftkFields = pdftk.scanFields(pdfFullPath);
            if (pdftkFields && pdftkFields.length > 0) {
                fields = pdftkFields.map(f => ({
                    name: f.fullName,
                    shortName: f.shortName,
                    type: f.type,
                    maxLength: f.maxLength,
                    options: f.options
                }));
                engine = 'pdftk';
            }
        }

        // Fallback to pdf-lib
        if (fields.length === 0) {
            try {
                const pdfBytes = fs.readFileSync(pdfFullPath);
                const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
                const form = pdfDoc.getForm();
                fields = form.getFields().map(field => ({
                    name: field.getName(),
                    shortName: field.getName().replace(/^.*\./, '').replace(/\[\d+\]$/g, ''),
                    type: field.constructor.name,
                    maxLength: null,
                    options: null
                }));
            } catch (e) {
                // PDF might not have form fields
            }
        }

        res.json({ 
            fields, 
            mappings: JSON.parse(template.field_mappings || '{}'),
            hasPdf: true,
            engine,
            fieldCount: fields.length
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Scan PDF fields with pdftk and auto-suggest + optionally save field mappings
router.post('/:id/scan-fields', (req, res) => {
    const db = req.app.locals.db;
    try {
        const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
        if (!template) return res.status(404).json({ error: 'Template not found' });

        const pdfFullPath = template.file_path ? path.join(req.app.locals.rootDir, template.file_path) : null;
        if (!pdfFullPath || !fs.existsSync(pdfFullPath)) {
            return res.status(400).json({ error: 'Template has no PDF file uploaded' });
        }

        if (!pdftk.isPdftkAvailable()) {
            return res.status(503).json({ error: 'pdftk is not available on this system. Install pdftk-java to use auto-scanning.' });
        }

        const fields = pdftk.scanFields(pdfFullPath);
        if (!fields || fields.length === 0) {
            return res.json({ fields: [], suggestions: {}, message: 'No form fields found in PDF' });
        }

        // Auto-suggest mappings
        const suggestions = pdftk.suggestMappings(fields);

        // If auto_save is true, merge suggestions into existing field_mappings
        const { auto_save } = req.body || {};
        let savedMappings = JSON.parse(template.field_mappings || '{}');

        if (auto_save) {
            // Only add suggestions for keys not already mapped
            let newCount = 0;
            for (const [dataKey, fullFieldName] of Object.entries(suggestions)) {
                if (!savedMappings[dataKey] || savedMappings[dataKey] === '' || savedMappings[dataKey] === dataKey) {
                    savedMappings[dataKey] = fullFieldName;
                    newCount++;
                }
            }
            if (newCount > 0) {
                db.prepare('UPDATE templates SET field_mappings = ? WHERE id = ?')
                    .run(JSON.stringify(savedMappings), template.id);
            }

            return res.json({
                fields: fields.map(f => ({ fullName: f.fullName, shortName: f.shortName, type: f.type, maxLength: f.maxLength, options: f.options })),
                suggestions,
                savedMappings,
                message: `Scanned ${fields.length} fields. Auto-saved ${newCount} new mapping(s). Total mappings: ${Object.keys(savedMappings).length}.`
            });
        }

        res.json({
            fields: fields.map(f => ({ fullName: f.fullName, shortName: f.shortName, type: f.type, maxLength: f.maxLength, options: f.options })),
            suggestions,
            currentMappings: savedMappings,
            message: `Found ${fields.length} fields with ${Object.keys(suggestions).length} auto-suggested mapping(s). POST with { "auto_save": true } to save.`
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

// Download PDF from IRS.gov for a template
router.post('/:id/download-irs', async (req, res) => {
    const db = req.app.locals.db;
    try {
        const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
        if (!template) return res.status(404).json({ error: 'Template not found' });

        const irsPdfUrls = req.app.locals.irsPdfUrls || {};
        const irsUrl = irsPdfUrls[template.form_type];
        
        if (!irsUrl) {
            return res.status(400).json({ error: `No IRS URL mapped for form type: ${template.form_type}. You can manually upload a PDF instead.` });
        }

        // Download PDF from IRS
        const filename = `${template.form_type.replace(/[^a-zA-Z0-9-]/g, '_')}_IRS_${Date.now()}.pdf`;
        const filePath = path.join(req.app.locals.rootDir, 'pdf-templates', 'active', filename);
        const relativePath = path.join('pdf-templates', 'active', filename);

        await downloadFile(irsUrl, filePath);

        // Archive old PDF if exists
        if (template.file_path && template.file_path !== '') {
            const oldPath = path.join(req.app.locals.rootDir, template.file_path);
            if (fs.existsSync(oldPath)) {
                const archivePath = path.join(req.app.locals.rootDir, 'pdf-templates', 'archive',
                    `${template.form_type}_${template.version_year}_${Date.now()}.pdf`);
                fs.copyFileSync(oldPath, archivePath);
                fs.unlinkSync(oldPath);
            }
        }

        // Try to detect PDF form fields
        let pdfFields = [];
        try {
            const pdfBytes = fs.readFileSync(filePath);
            const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
            const form = pdfDoc.getForm();
            pdfFields = form.getFields().map(f => ({
                name: f.getName(),
                type: f.constructor.name
            }));
        } catch (e) {
            // PDF might not have form fields
        }

        // Update template with new file path
        db.prepare(`
            UPDATE templates SET 
                file_path = ?,
                version_year = ?,
                upload_date = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(relativePath, new Date().getFullYear().toString(), req.params.id);

        const updated = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
        res.json({ 
            success: true, 
            template: updated, 
            pdfFields,
            message: `Successfully downloaded ${template.form_type} PDF from IRS.gov (${pdfFields.length} form fields detected)`
        });
    } catch (err) {
        res.status(500).json({ error: `Failed to download from IRS: ${err.message}` });
    }
});

// Helper: download file from URL with redirect following
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const makeRequest = (requestUrl, redirectCount = 0) => {
            if (redirectCount > 5) return reject(new Error('Too many redirects'));
            
            const protocol = requestUrl.startsWith('https') ? https : http;
            protocol.get(requestUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; IRS-Forms-Manager/1.0)'
                }
            }, (response) => {
                // Handle redirects
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    return makeRequest(response.headers.location, redirectCount + 1);
                }

                if (response.statusCode !== 200) {
                    return reject(new Error(`HTTP ${response.statusCode}: Failed to download`));
                }

                const fileStream = fs.createWriteStream(destPath);
                response.pipe(fileStream);
                fileStream.on('finish', () => {
                    fileStream.close();
                    // Verify it's actually a PDF (check first bytes)
                    const header = Buffer.alloc(5);
                    const fd = fs.openSync(destPath, 'r');
                    fs.readSync(fd, header, 0, 5, 0);
                    fs.closeSync(fd);
                    if (header.toString() !== '%PDF-') {
                        fs.unlinkSync(destPath);
                        return reject(new Error('Downloaded file is not a valid PDF'));
                    }
                    resolve();
                });
                fileStream.on('error', (err) => {
                    fs.unlink(destPath, () => {});
                    reject(err);
                });
            }).on('error', reject);
        };

        makeRequest(url);
    });
}

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
