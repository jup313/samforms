const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

// Get all form submissions
router.get('/', (req, res) => {
    const db = req.app.locals.db;
    try {
        const { customer_id, form_type } = req.query;
        let query = `
            SELECT fs.*, t.form_name, t.version_year, t.form_type as template_form_type,
                   c.first_name, c.last_name, c.business_name as customer_business
            FROM form_submissions fs
            LEFT JOIN templates t ON fs.template_id = t.id
            LEFT JOIN customers c ON fs.customer_id = c.id
        `;
        const conditions = [];
        const params = [];

        if (customer_id) {
            conditions.push('fs.customer_id = ?');
            params.push(customer_id);
        }
        if (form_type) {
            conditions.push('fs.form_type = ?');
            params.push(form_type);
        }
        if (conditions.length) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        query += ' ORDER BY fs.created_at DESC';

        const submissions = db.prepare(query).all(...params);
        res.json(submissions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get single submission
router.get('/:id', (req, res) => {
    const db = req.app.locals.db;
    try {
        const submission = db.prepare(`
            SELECT fs.*, t.form_name, t.version_year,
                   c.first_name, c.last_name
            FROM form_submissions fs
            LEFT JOIN templates t ON fs.template_id = t.id
            LEFT JOIN customers c ON fs.customer_id = c.id
            WHERE fs.id = ?
        `).get(req.params.id);
        if (!submission) return res.status(404).json({ error: 'Submission not found' });
        res.json(submission);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Submit a form (save + optionally auto-create customer + generate PDF)
router.post('/', async (req, res) => {
    const db = req.app.locals.db;
    try {
        const { template_id, customer_id, form_data, save_customer, generate_pdf, tax_year } = req.body;
    const selectedTaxYear = tax_year || new Date().getFullYear().toString();

        // Get template
        const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(template_id);
        if (!template) return res.status(404).json({ error: 'Template not found' });

        let finalCustomerId = customer_id;

        // Auto-create or update customer if save_customer is true
        if (save_customer && form_data.first_name && form_data.last_name) {
            if (customer_id) {
                // Update existing customer with new data
                const customerFields = ['first_name', 'last_name', 'ssn', 'ein', 'business_name', 'address', 'city', 'state', 'zip', 'phone', 'email', 'date_of_birth', 'filing_status'];
                const updates = [];
                const values = [];
                
                for (const field of customerFields) {
                    if (form_data[field]) {
                        updates.push(`${field} = ?`);
                        values.push(form_data[field]);
                    }
                }
                
                if (updates.length > 0) {
                    updates.push('updated_at = CURRENT_TIMESTAMP');
                    values.push(customer_id);
                    db.prepare(`UPDATE customers SET ${updates.join(', ')} WHERE id = ?`).run(...values);
                }
            } else {
                // Check if customer already exists
                const existing = db.prepare(
                    'SELECT id FROM customers WHERE first_name = ? AND last_name = ?'
                ).get(form_data.first_name, form_data.last_name);

                if (existing) {
                    finalCustomerId = existing.id;
                    // Update their info
                    const customerFields = ['ssn', 'ein', 'business_name', 'address', 'city', 'state', 'zip', 'phone', 'email', 'date_of_birth', 'filing_status'];
                    const updates = [];
                    const values = [];
                    for (const field of customerFields) {
                        if (form_data[field]) {
                            updates.push(`${field} = ?`);
                            values.push(form_data[field]);
                        }
                    }
                    if (updates.length > 0) {
                        updates.push('updated_at = CURRENT_TIMESTAMP');
                        values.push(finalCustomerId);
                        db.prepare(`UPDATE customers SET ${updates.join(', ')} WHERE id = ?`).run(...values);
                    }
                } else {
                    // Create new customer
                    const result = db.prepare(`
                        INSERT INTO customers (first_name, last_name, ssn, ein, business_name, address, city, state, zip, phone, email, date_of_birth, filing_status)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(
                        form_data.first_name, form_data.last_name,
                        form_data.ssn || null, form_data.ein || null,
                        form_data.business_name || null, form_data.address || null,
                        form_data.city || null, form_data.state || null,
                        form_data.zip || null, form_data.phone || null,
                        form_data.email || null, form_data.date_of_birth || null,
                        form_data.filing_status || null
                    );
                    finalCustomerId = result.lastInsertRowid;
                }
            }
        }

        // Save form submission with tax year
        const submission = db.prepare(`
            INSERT INTO form_submissions (customer_id, template_id, form_type, tax_year, form_data, status)
            VALUES (?, ?, ?, ?, ?, 'completed')
        `).run(finalCustomerId || null, template_id, template.form_type, selectedTaxYear, JSON.stringify(form_data));

        const submissionId = submission.lastInsertRowid;
        let pdfPath = null;

        // Generate PDF if requested and template has a PDF
        if (generate_pdf && template.file_path && fs.existsSync(path.join(req.app.locals.rootDir, template.file_path))) {
            try {
                pdfPath = await generateFilledPDF(req.app.locals.rootDir, template, form_data, submissionId);
                db.prepare('UPDATE form_submissions SET pdf_path = ? WHERE id = ?').run(pdfPath, submissionId);
            } catch (pdfErr) {
                console.error('PDF generation error:', pdfErr.message);
            }
        }

        // If no PDF template, generate a simple text-based PDF
        if (generate_pdf && !pdfPath) {
            try {
                pdfPath = await generateSimplePDF(req.app.locals.rootDir, template, form_data, submissionId);
                db.prepare('UPDATE form_submissions SET pdf_path = ? WHERE id = ?').run(pdfPath, submissionId);
            } catch (pdfErr) {
                console.error('Simple PDF generation error:', pdfErr.message);
            }
        }

        const result_submission = db.prepare('SELECT * FROM form_submissions WHERE id = ?').get(submissionId);
        res.status(201).json({
            submission: result_submission,
            customer_id: finalCustomerId,
            pdf_path: pdfPath
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Generate filled PDF from template
async function generateFilledPDF(rootDir, template, formData, submissionId) {
    const templatePath = path.join(rootDir, template.file_path);
    const pdfBytes = fs.readFileSync(templatePath);
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    
    const form = pdfDoc.getForm();
    const fieldMappings = JSON.parse(template.field_mappings || '{}');
    const fields = form.getFields();

    if (fields.length > 0) {
        // PDF has fillable form fields — fill them
        for (const field of fields) {
            const fieldName = field.getName();
            const fieldType = field.constructor.name;

            let value = null;
            
            if (formData[fieldName]) {
                value = formData[fieldName];
            }
            
            for (const [mappingKey, mappingValue] of Object.entries(fieldMappings)) {
                if (mappingValue === fieldName && formData[mappingKey]) {
                    value = formData[mappingKey];
                    break;
                }
                if (mappingKey === fieldName && formData[mappingValue]) {
                    value = formData[mappingValue];
                    break;
                }
            }

            if (value !== null && value !== undefined && value !== '') {
                try {
                    if (fieldType === 'PDFTextField') {
                        field.setText(String(value));
                    } else if (fieldType === 'PDFCheckBox') {
                        if (value === true || value === 'true' || value === '1' || value === 'Yes') {
                            field.check();
                        } else {
                            field.uncheck();
                        }
                    } else if (fieldType === 'PDFDropdown') {
                        field.select(String(value));
                    } else if (fieldType === 'PDFRadioGroup') {
                        field.select(String(value));
                    }
                } catch (e) {
                    console.warn(`Could not fill field ${fieldName}:`, e.message);
                }
            }
        }

        try {
            form.flatten();
        } catch (e) {
            // Some forms can't be flattened
        }
    } else {
        // PDF has NO fillable fields (flat PDF like engagement letters)
        // Append a data summary page with all the filled-in information
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        let page = pdfDoc.addPage([612, 792]);
        const { width, height } = page.getSize();
        let y = height - 50;
        const margin = 50;
        const lineHeight = 18;

        // Header
        page.drawText(`${template.form_type} — Completed Form Data`, {
            x: margin, y, size: 18, font: boldFont, color: rgb(0, 0, 0.5)
        });
        y -= 25;

        page.drawText(template.form_name, {
            x: margin, y, size: 12, font: font, color: rgb(0.3, 0.3, 0.3)
        });
        y -= 10;

        page.drawText(`Generated: ${new Date().toLocaleDateString()} | Submission #${submissionId}`, {
            x: margin, y, size: 10, font: font, color: rgb(0.5, 0.5, 0.5)
        });
        y -= 25;

        page.drawLine({
            start: { x: margin, y }, end: { x: width - margin, y },
            thickness: 1, color: rgb(0, 0, 0.5)
        });
        y -= 20;

        // Customer info section
        const customerFields = ['first_name', 'last_name', 'ssn', 'ein', 'business_name', 'address', 'city', 'state', 'zip', 'phone', 'email', 'date_of_birth', 'filing_status'];
        const custData = {};
        const otherData = {};

        for (const [key, val] of Object.entries(formData)) {
            if (!val || val === '') continue;
            if (customerFields.includes(key)) {
                custData[key] = val;
            } else {
                otherData[key] = val;
            }
        }

        if (Object.keys(custData).length > 0) {
            page.drawText('Client Information', {
                x: margin, y, size: 14, font: boldFont, color: rgb(0, 0, 0.4)
            });
            y -= 20;

            for (const [key, val] of Object.entries(custData)) {
                if (y < 60) { page = pdfDoc.addPage([612, 792]); y = height - 50; }
                const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                page.drawText(`${label}:`, { x: margin, y, size: 10, font: boldFont, color: rgb(0, 0, 0) });
                page.drawText(String(val), { x: margin + 180, y, size: 10, font: font, color: rgb(0, 0, 0) });
                y -= lineHeight;
            }
            y -= 10;
        }

        if (Object.keys(otherData).length > 0) {
            if (y < 100) { page = pdfDoc.addPage([612, 792]); y = height - 50; }
            page.drawText('Form Details', {
                x: margin, y, size: 14, font: boldFont, color: rgb(0, 0, 0.4)
            });
            y -= 20;

            for (const [key, val] of Object.entries(otherData)) {
                const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                
                // Handle long text values (wrap)
                const maxLineWidth = width - margin * 2 - 180;
                const words = String(val).split(' ');
                let lines = [''];
                let lineIdx = 0;

                for (const word of words) {
                    const testLine = lines[lineIdx] + (lines[lineIdx] ? ' ' : '') + word;
                    const testWidth = font.widthOfTextAtSize(testLine, 10);
                    if (testWidth > maxLineWidth && lines[lineIdx]) {
                        lineIdx++;
                        lines[lineIdx] = word;
                    } else {
                        lines[lineIdx] = testLine;
                    }
                }

                if (y < 60 + (lines.length * lineHeight)) { page = pdfDoc.addPage([612, 792]); y = height - 50; }

                page.drawText(`${label}:`, { x: margin, y, size: 10, font: boldFont, color: rgb(0, 0, 0) });
                
                for (let i = 0; i < lines.length; i++) {
                    page.drawText(lines[i], { 
                        x: margin + 180, y: y - (i * lineHeight), 
                        size: 10, font: font, color: rgb(0, 0, 0) 
                    });
                }
                y -= lineHeight * lines.length;
            }
        }
    }

    const filledPdfBytes = await pdfDoc.save();
    const outputFilename = `${template.form_type}_${submissionId}_${Date.now()}.pdf`;
    const outputPath = path.join('generated', outputFilename);
    fs.writeFileSync(path.join(rootDir, outputPath), filledPdfBytes);

    return outputPath;
}

// Generate a simple text-based PDF when no template PDF exists
async function generateSimplePDF(rootDir, template, formData, submissionId) {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let page = pdfDoc.addPage([612, 792]); // Letter size
    const { width, height } = page.getSize();
    let y = height - 50;
    const margin = 50;
    const lineHeight = 18;

    // Title
    page.drawText(`IRS Form ${template.form_type}`, {
        x: margin,
        y,
        size: 20,
        font: boldFont,
        color: rgb(0, 0, 0.5)
    });
    y -= 25;

    page.drawText(template.form_name, {
        x: margin,
        y,
        size: 12,
        font: font,
        color: rgb(0.3, 0.3, 0.3)
    });
    y -= 10;

    page.drawText(`Version: ${template.version_year}`, {
        x: margin,
        y,
        size: 10,
        font: font,
        color: rgb(0.5, 0.5, 0.5)
    });
    y -= 30;

    // Draw a line
    page.drawLine({
        start: { x: margin, y },
        end: { x: width - margin, y },
        thickness: 1,
        color: rgb(0, 0, 0.5)
    });
    y -= 20;

    // Form data
    const fieldMappings = JSON.parse(template.field_mappings || '{}');
    const allKeys = new Set([...Object.keys(fieldMappings), ...Object.keys(formData)]);

    for (const key of allKeys) {
        const value = formData[key];
        if (!value || value === '') continue;

        const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        
        if (y < 60) {
            page = pdfDoc.addPage([612, 792]);
            y = height - 50;
        }

        page.drawText(`${label}:`, {
            x: margin,
            y,
            size: 10,
            font: boldFont,
            color: rgb(0, 0, 0)
        });

        page.drawText(String(value), {
            x: margin + 200,
            y,
            size: 10,
            font: font,
            color: rgb(0, 0, 0)
        });

        y -= lineHeight;
    }

    // Footer
    y -= 20;
    if (y < 60) {
        page = pdfDoc.addPage([612, 792]);
        y = height - 50;
    }
    page.drawLine({
        start: { x: margin, y },
        end: { x: width - margin, y },
        thickness: 0.5,
        color: rgb(0.7, 0.7, 0.7)
    });
    y -= 15;
    page.drawText(`Generated on ${new Date().toLocaleDateString()} | Submission #${submissionId}`, {
        x: margin,
        y,
        size: 8,
        font: font,
        color: rgb(0.5, 0.5, 0.5)
    });

    const pdfBytes = await pdfDoc.save();
    const outputFilename = `${template.form_type}_${submissionId}_${Date.now()}.pdf`;
    const outputPath = path.join('generated', outputFilename);
    fs.writeFileSync(path.join(rootDir, outputPath), pdfBytes);

    return outputPath;
}

// Delete submission
router.delete('/:id', (req, res) => {
    const db = req.app.locals.db;
    try {
        const submission = db.prepare('SELECT * FROM form_submissions WHERE id = ?').get(req.params.id);
        if (submission && submission.pdf_path) {
            const pdfFullPath = path.join(req.app.locals.rootDir, submission.pdf_path);
            if (fs.existsSync(pdfFullPath)) {
                fs.unlinkSync(pdfFullPath);
            }
        }
        db.prepare('DELETE FROM form_submissions WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
