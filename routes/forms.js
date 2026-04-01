const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
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
                const existing = db.prepare(
                    'SELECT id FROM customers WHERE first_name = ? AND last_name = ?'
                ).get(form_data.first_name, form_data.last_name);

                if (existing) {
                    finalCustomerId = existing.id;
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

        // Auto-download IRS PDF if template doesn't have one yet
        if (generate_pdf && (!template.file_path || !fs.existsSync(path.join(req.app.locals.rootDir, template.file_path)))) {
            const irsPdfUrls = req.app.locals.irsPdfUrls || {};
            const irsUrl = irsPdfUrls[template.form_type];
            if (irsUrl) {
                try {
                    console.log(`Auto-downloading IRS PDF for ${template.form_type}...`);
                    const filename = `${template.form_type.replace(/[^a-zA-Z0-9-]/g, '_')}_IRS_${Date.now()}.pdf`;
                    const filePath = path.join(req.app.locals.rootDir, 'pdf-templates', 'active', filename);
                    const relativePath = path.join('pdf-templates', 'active', filename);
                    await downloadFile(irsUrl, filePath);
                    db.prepare('UPDATE templates SET file_path = ?, upload_date = CURRENT_TIMESTAMP WHERE id = ?')
                        .run(relativePath, template.id);
                    template.file_path = relativePath;
                    console.log(`Auto-downloaded ${template.form_type} from IRS.gov`);
                } catch (dlErr) {
                    console.error(`Failed to auto-download ${template.form_type} from IRS:`, dlErr.message);
                }
            }
        }

        // Generate PDF if requested and template has a PDF
        // Special forms (ENGAGEMENT) get their own generator regardless of file_path
        if (generate_pdf && template.form_type === 'ENGAGEMENT') {
            try {
                pdfPath = await generateEngagementLetterPDF(req.app.locals.rootDir, template, form_data, submissionId);
                db.prepare('UPDATE form_submissions SET pdf_path = ? WHERE id = ?').run(pdfPath, submissionId);
            } catch (pdfErr) {
                console.error('Engagement letter generation error:', pdfErr.message);
            }
        } else if (generate_pdf && template.file_path && fs.existsSync(path.join(req.app.locals.rootDir, template.file_path))) {
            try {
                pdfPath = await generateFilledPDF(req.app.locals.rootDir, template, form_data, submissionId);
                db.prepare('UPDATE form_submissions SET pdf_path = ? WHERE id = ?').run(pdfPath, submissionId);
            } catch (pdfErr) {
                console.error('PDF generation error:', pdfErr.message);
            }
        }

        // If no PDF template or PDF generation failed, generate a simple text-based PDF
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

// ==================== HEURISTIC FIELD MATCHING ====================
// Tries to match IRS PDF field names (often cryptic like "f1_01", "topmostSubform[0].Page1[0].f1_1[0]")
// to our human-readable data keys (like "first_name", "ssn", "address")
function heuristicMatchField(pdfFieldName, formData) {
    // CRITICAL: Split CamelCase BEFORE lowercasing so "TaxpayerAddress" → "Taxpayer Address"
    const lower = pdfFieldName
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ' ');
    
    // Keyword patterns — ordered by specificity
    const patterns = [
        // Name fields
        { match: (s) => /first.?name|fname|given.?name/.test(s), key: 'first_name' },
        { match: (s) => /last.?name|lname|surname|family.?name/.test(s), key: 'last_name' },
        { match: (s) => /full.?name|your.?name|taxpayer.?name|name.*shown|name.*return|name.*line|print.?name/.test(s), key: null, combine: ['first_name', 'last_name'] },
        // Business
        { match: (s) => /business.?name|company.?name|entity.?name|dba|trade.?name|organization.?name|corporation/.test(s), key: 'business_name' },
        // Tax IDs — very specific patterns first
        { match: (s) => /social.?security|ssn|soc.*sec|taxpayer.*id.*ssn/.test(s), key: 'ssn' },
        { match: (s) => /employer.*id.*number|ein(?![a-z])|taxpayer.*id.*ein/.test(s), key: 'ein' },
        { match: (s) => /identifying.?number|ident.*no/.test(s), key: 'ssn' },
        // Address — broader matching (excludes payer/employer/representative addresses)
        { match: (s) => /city.*state.*zip/.test(s), key: 'city_state_zip' },
        { match: (s) => (/(street|mailing|home|taxpayer|your)\s*(address|addr)/.test(s) || /address\s*(line|street|number)/.test(s)) && !/email|web|url/.test(s), key: 'address' },
        { match: (s) => /\baddress\b/.test(s) && !/payer|employer|represent|firm|email|web|url|filer/.test(s), key: 'address' },
        { match: (s) => /\bcity\b/.test(s) && !/payer|employer/.test(s), key: 'city' },
        { match: (s) => /\bstate\b/.test(s) && !/united|payer|employer/.test(s), key: 'state' },
        { match: (s) => /\bzip\b|postal/.test(s) && !/payer|employer/.test(s), key: 'zip' },
        // Contact
        { match: (s) => /\bphone\b|\btelephone\b|daytime.*number/.test(s) && !/fax|payer|employer|represent/.test(s), key: 'phone' },
        { match: (s) => /email|e.?mail/.test(s), key: 'email' },
        // Filing
        { match: (s) => /filing.?status/.test(s), key: 'filing_status' },
        { match: (s) => /date.*birth|dob|birth.*date/.test(s), key: 'date_of_birth' },
        // W-9 specific
        { match: (s) => /tax.?class|federal.?tax.?class/.test(s), key: 'federal_tax_classification' },
        { match: (s) => /exempt.*payee/.test(s), key: 'exempt_payee_code' },
        { match: (s) => /fatca/.test(s), key: 'exemption_fatca_code' },
        { match: (s) => /account.?num/.test(s), key: 'account_numbers' },
        // W-2 / 1099 fields
        { match: (s) => /wages.*tips|compensation/.test(s), key: 'wages_tips' },
        { match: (s) => /federal.*tax.*with|fed.*withh/.test(s), key: 'federal_tax_withheld' },
        { match: (s) => /employer.*name/.test(s), key: 'employer_name' },
        { match: (s) => /payer.*name/.test(s), key: 'payer_name' },
        { match: (s) => /payer.*address|payer.*street/.test(s), key: 'payer_address' },
        // Engagement letter fields
        { match: (s) => /client.?name/.test(s), key: 'client_name' },
        { match: (s) => /services|scope/.test(s), key: 'services_description' },
        { match: (s) => /fee|payment/.test(s), key: 'fee_arrangement' },
        // Power of Attorney / 2848 / 8821
        { match: (s) => /representative.*name|designee.*name/.test(s), key: 'representative_name' },
        { match: (s) => /representative.*address/.test(s), key: 'representative_address' },
        { match: (s) => /representative.*phone|representative.*tel/.test(s), key: 'representative_phone' },
        { match: (s) => /representative.*fax/.test(s), key: 'representative_fax' },
        { match: (s) => /\bcaf\b.*number/.test(s), key: 'caf_number' },
        { match: (s) => /\bptin\b/.test(s), key: 'ptin' },
        { match: (s) => /tax.?matters/.test(s), key: 'tax_matters' },
        { match: (s) => /tax.?form/.test(s), key: 'tax_form_number' },
        { match: (s) => /tax.?year|year.*period/.test(s), key: 'tax_years' },
        { match: (s) => /plan.?number/.test(s), key: 'plan_number' },
    ];

    for (const pattern of patterns) {
        if (pattern.match(lower)) {
            if (pattern.combine) {
                // Combine multiple fields
                const parts = pattern.combine.map(k => formData[k] || '').filter(Boolean);
                return parts.length > 0 ? parts.join(' ') : null;
            }
            if (pattern.key && formData[pattern.key] && formData[pattern.key] !== '') {
                return formData[pattern.key];
            }
        }
    }

    return null;
}

// ==================== KNOWN IRS FORM FIELD MAPPINGS ====================
// Hard-coded mappings for common IRS forms where PDF field names are cryptic
// Format: { form_type: { pdf_field_name: our_data_key } }
const KNOWN_IRS_FIELD_MAPS = {
    'W-9': {
        'f1_01': 'full_name',           // Line 1: Name
        'f1_02': 'business_name',       // Line 2: Business name / disregarded entity
        'f1_05': 'exempt_payee_code',   // Exemptions: payee code
        'f1_06': 'exemption_fatca_code',// Exemptions: FATCA code
        'f1_07': 'address',             // Line 5: Address (street, apt)
        'f1_08': 'city_state_zip',      // Line 6: City, state, ZIP
        'f1_09': 'requester_name',      // Requester's name
        'f1_10': 'account_numbers',     // Account number(s)
        'f1_11': 'ssn_1',              // SSN first 3 digits
        'f1_12': 'ssn_2',              // SSN middle 2 digits
        'f1_13': 'ssn_3',              // SSN last 4 digits
        'f1_14': 'ein_1',             // EIN first 2 digits
        'f1_15': 'ein_2',             // EIN last 7 digits
    },
    'W-4': {
        'f1_01': 'first_name',
        'f1_02': 'last_name',
        'f1_03': 'ssn',
        'f1_04': 'address',
        'f1_05': 'city_state_zip',
    },
    '8283': {
        'f1_1': 'full_name',            // Name(s) shown on your tax return
        'f1_2': 'ssn',                  // Identifying number
        'f1_3': 'full_name',            // Donor name (if different)
        'f1_4': 'ein',                  // Donor identifying number
        // Section A, Line 1 Row A - first donated property
        'f1_5': 'donation_description',  // (a) Description of donated property
        'f1_6': 'donation_date',         // (b) Date of the contribution - physical condition
        'f1_7': 'donation_date',         // (b) Date of the contribution
        // Section A, Line 1 Row A - columns D-I
        'f1_17': 'date_acquired',        // (d) Date acquired by donor
        'f1_18': 'how_acquired',         // (e) How acquired by donor
        'f1_19': 'donor_cost',           // (f) Donor's cost or adjusted basis
        'f1_20': 'fair_market_value',    // (g) Fair market value
        'f1_21': 'fmv_method',           // (h) Method used to determine FMV
        // Section A, Line 3 Row A - donee info
        'f1_42': 'donee_name',           // Name of charitable organization (donee)
        'f1_43': 'donee_address',        // Address of donee
        'f1_44': 'donee_city_state_zip', // City, state, ZIP of donee
        // Page 2 - Section B
        'f2_1': 'full_name',             // Name(s) on return
        'f2_2': 'ssn',                   // Identifying number
        'f2_3': 'property_description',  // Description of donated property
        'f2_4': 'appraised_fmv',         // Appraised fair market value
        'f2_5': 'date_acquired',         // Date acquired
        'f2_6': 'date_donated',          // Date donated
        'f2_7': 'donor_cost',            // Donor's cost or basis
    },
};

// Build composite values from form data
function buildCompositeValue(key, formData) {
    if (key === 'full_name') {
        const parts = [formData.first_name, formData.last_name].filter(Boolean);
        return parts.length > 0 ? parts.join(' ') : null;
    }
    if (key === 'city_state_zip') {
        const parts = [formData.city, formData.state, formData.zip].filter(Boolean);
        return parts.length > 0 ? parts.join(', ') : null;
    }
    // SSN split into 3 parts (xxx-xx-xxxx)
    if (key === 'ssn_1' && formData.ssn) {
        const digits = formData.ssn.replace(/\D/g, '');
        return digits.substring(0, 3) || null;
    }
    if (key === 'ssn_2' && formData.ssn) {
        const digits = formData.ssn.replace(/\D/g, '');
        return digits.substring(3, 5) || null;
    }
    if (key === 'ssn_3' && formData.ssn) {
        const digits = formData.ssn.replace(/\D/g, '');
        return digits.substring(5, 9) || null;
    }
    // EIN split into 2 parts (xx-xxxxxxx)
    if (key === 'ein_1' && formData.ein) {
        const digits = formData.ein.replace(/\D/g, '');
        return digits.substring(0, 2) || null;
    }
    if (key === 'ein_2' && formData.ein) {
        const digits = formData.ein.replace(/\D/g, '');
        return digits.substring(2, 9) || null;
    }
    return formData[key] || null;
}

// ==================== GENERATE FILLED PDF ====================
async function generateFilledPDF(rootDir, template, formData, submissionId) {
    const templatePath = path.join(rootDir, template.file_path);
    const pdfBytes = fs.readFileSync(templatePath);
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    
    const form = pdfDoc.getForm();
    const fieldMappings = JSON.parse(template.field_mappings || '{}');
    const fields = form.getFields();
    let filledCount = 0;
    const filledFields = [];

    if (fields.length > 0) {
        // Build reverse map from field_mappings: pdf_field_name -> data_value
        // fieldMappings format: { our_data_key: pdf_field_name }
        const pdfFieldToValue = {};
        
        for (const [dataKey, pdfFieldName] of Object.entries(fieldMappings)) {
            if (!pdfFieldName || pdfFieldName === '' || pdfFieldName === dataKey) continue;
            
            // First try direct form data lookup
            let val = formData[dataKey];
            
            // If no direct match, try building composite value (full_name, city_state_zip, ssn_p2, etc.)
            if (!val || val === '') {
                val = buildCompositeValue(dataKey, formData);
            }
            // Handle page 2 repeats: full_name_p2 -> full_name, ssn_p2 -> ssn
            if (!val || val === '') {
                const baseKey = dataKey.replace(/_p\d+$/, '');
                if (baseKey !== dataKey) {
                    val = formData[baseKey] || buildCompositeValue(baseKey, formData);
                }
            }
            
            if (val && val !== '') {
                pdfFieldToValue[pdfFieldName] = val;
            }
        }

        // Also check known IRS field maps for this form type
        const knownMap = KNOWN_IRS_FIELD_MAPS[template.form_type] || {};
        for (const [pdfField, dataKey] of Object.entries(knownMap)) {
            if (!pdfFieldToValue[pdfField]) {
                const val = buildCompositeValue(dataKey, formData);
                if (val) pdfFieldToValue[pdfField] = val;
            }
        }

        // Now fill each PDF field
        for (const field of fields) {
            const fieldName = field.getName();
            const fieldType = field.constructor.name;
            let value = null;

            // Priority 1: Explicit mapping from field_mappings
            if (pdfFieldToValue[fieldName]) {
                value = pdfFieldToValue[fieldName];
            }

            // Priority 2: Direct name match (our data key matches PDF field name exactly)
            if (!value && formData[fieldName]) {
                value = formData[fieldName];
            }

            // Priority 3: Partial/stripped name match
            if (!value) {
                const stripped = fieldName.replace(/^topmostSubform\[0\]\.Page\d+\[0\]\./, '')
                                          .replace(/\[\d+\]$/g, '')
                                          .replace(/\[\d+\]/g, '.')
                                          .toLowerCase();
                for (const [dataKey, dataVal] of Object.entries(formData)) {
                    if (dataVal && stripped === dataKey.toLowerCase()) {
                        value = dataVal;
                        break;
                    }
                }
            }

            // Priority 4: Known IRS field map (check short field name too)
            if (!value) {
                const shortName = fieldName.replace(/^.*\./, '').replace(/\[\d+\]$/g, '');
                if (knownMap[shortName]) {
                    value = buildCompositeValue(knownMap[shortName], formData);
                }
            }

            // Priority 5: Heuristic keyword matching
            if (!value) {
                value = heuristicMatchField(fieldName, formData);
            }

            // Fill the field
            if (value !== null && value !== undefined && value !== '') {
                try {
                    if (fieldType === 'PDFTextField') {
                        let textVal = String(value);
                        // Respect maxLength if set on the field
                        try {
                            const maxLen = field.getMaxLength();
                            if (maxLen && maxLen > 0 && textVal.length > maxLen) {
                                textVal = textVal.substring(0, maxLen);
                            }
                        } catch(ml) { /* no maxLength set */ }
                        field.setText(textVal);
                        filledCount++;
                        filledFields.push(fieldName);
                    } else if (fieldType === 'PDFCheckBox') {
                        if (value === true || value === 'true' || value === '1' || value === 'Yes') {
                            field.check();
                            filledCount++;
                            filledFields.push(fieldName);
                        }
                    } else if (fieldType === 'PDFDropdown') {
                        try { field.select(String(value)); filledCount++; filledFields.push(fieldName); } catch(e) {}
                    } else if (fieldType === 'PDFRadioGroup') {
                        try { field.select(String(value)); filledCount++; filledFields.push(fieldName); } catch(e) {}
                    }
                } catch (e) {
                    console.warn(`Could not fill field ${fieldName}:`, e.message);
                }
            }
        }

        // Flatten filled fields so they become permanent
        try {
            form.flatten();
        } catch (e) {
            console.warn('Could not flatten form:', e.message);
        }

        console.log(`PDF Fill: ${template.form_type} — ${filledCount}/${fields.length} fields filled`);
    }

    // ALWAYS append a data summary page with all entered information
    // This ensures the user's data is ALWAYS visible in the output PDF
    await appendDataSummaryPage(pdfDoc, template, formData, submissionId, filledCount, fields.length);

    const filledPdfBytes = await pdfDoc.save();
    const outputFilename = `${template.form_type}_${submissionId}_${Date.now()}.pdf`;
    const outputPath = path.join('generated', outputFilename);
    fs.writeFileSync(path.join(rootDir, outputPath), filledPdfBytes);

    return outputPath;
}

// ==================== DATA SUMMARY PAGE ====================
// Always appended to the end of generated PDFs so user data is visible
async function appendDataSummaryPage(pdfDoc, template, formData, submissionId, filledCount, totalFields) {
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let page = pdfDoc.addPage([612, 792]);
    const { width, height } = page.getSize();
    let y = height - 50;
    const margin = 50;
    const lineHeight = 16;
    const maxContentWidth = width - margin * 2;

    // ---- Header bar ----
    page.drawRectangle({
        x: margin - 5, y: y - 8, width: maxContentWidth + 10, height: 35,
        color: rgb(0.12, 0.20, 0.40)
    });
    page.drawText(`${template.form_type} — Completed Form Data`, {
        x: margin + 5, y: y - 2, size: 16, font: boldFont, color: rgb(1, 1, 1)
    });
    y -= 45;

    // ---- Sub-header ----
    page.drawText(template.form_name, {
        x: margin, y, size: 11, font: font, color: rgb(0.3, 0.3, 0.3)
    });
    y -= 14;
    page.drawText(`Generated: ${new Date().toLocaleString()} | Submission #${submissionId}`, {
        x: margin, y, size: 9, font: font, color: rgb(0.5, 0.5, 0.5)
    });
    y -= 12;
    if (totalFields > 0) {
        page.drawText(`PDF Form Fields: ${filledCount} of ${totalFields} auto-filled`, {
            x: margin, y, size: 9, font: font, 
            color: filledCount > 0 ? rgb(0, 0.5, 0) : rgb(0.7, 0.3, 0)
        });
        y -= 12;
        if (filledCount === 0) {
            page.drawText(`WARNING: No fields matched - use Template > Map Fields to configure field mappings`, {
                x: margin, y, size: 9, font: boldFont, color: rgb(0.8, 0.2, 0)
            });
            y -= 12;
        }
    }
    y -= 8;

    page.drawLine({
        start: { x: margin, y }, end: { x: width - margin, y },
        thickness: 1.5, color: rgb(0.12, 0.20, 0.40)
    });
    y -= 20;

    // ---- Form data entries ----
    const entries = Object.entries(formData).filter(([k, v]) => v && v !== '');
    const customerKeys = ['first_name', 'last_name', 'ssn', 'ein', 'business_name', 'address', 'city', 'state', 'zip', 'phone', 'email', 'date_of_birth', 'filing_status'];
    const custEntries = entries.filter(([k]) => customerKeys.includes(k));
    const otherEntries = entries.filter(([k]) => !customerKeys.includes(k));

    // Helper to draw section
    const drawSection = (title, sectionEntries) => {
        if (sectionEntries.length === 0) return;
        
        if (y < 80) { page = pdfDoc.addPage([612, 792]); y = height - 50; }

        // Section header
        page.drawRectangle({
            x: margin, y: y - 4, width: maxContentWidth, height: 20,
            color: rgb(0.92, 0.94, 0.97)
        });
        page.drawText(title, {
            x: margin + 5, y: y, size: 11, font: boldFont, color: rgb(0.12, 0.20, 0.40)
        });
        y -= 22;

        // Entries
        let rowAlternate = false;
        for (const [key, val] of sectionEntries) {
            const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            const text = String(val);

            // Word wrap for long values
            const labelWidth = 160;
            const valueMaxWidth = maxContentWidth - labelWidth - 10;
            const words = text.split(' ');
            let lines = [''];
            let lineIdx = 0;
            for (const word of words) {
                const test = lines[lineIdx] + (lines[lineIdx] ? ' ' : '') + word;
                if (font.widthOfTextAtSize(test, 10) > valueMaxWidth && lines[lineIdx]) {
                    lineIdx++;
                    lines[lineIdx] = word;
                } else {
                    lines[lineIdx] = test;
                }
            }

            const entryHeight = Math.max(lineHeight, lines.length * lineHeight);
            if (y - entryHeight < 50) { page = pdfDoc.addPage([612, 792]); y = height - 50; rowAlternate = false; }

            // Alternating row background
            if (rowAlternate) {
                page.drawRectangle({
                    x: margin, y: y - entryHeight + lineHeight - 4, 
                    width: maxContentWidth, height: entryHeight,
                    color: rgb(0.97, 0.97, 0.99)
                });
            }
            rowAlternate = !rowAlternate;

            // Label
            page.drawText(`${label}:`, { 
                x: margin + 5, y, size: 10, font: boldFont, color: rgb(0.2, 0.2, 0.2) 
            });

            // Value (with word wrap)
            for (let i = 0; i < lines.length; i++) {
                page.drawText(lines[i], { 
                    x: margin + labelWidth, y: y - (i * lineHeight), 
                    size: 10, font: font, color: rgb(0, 0, 0) 
                });
            }
            y -= entryHeight;
        }
        y -= 10;
    };

    drawSection('CLIENT INFORMATION', custEntries);
    drawSection('FORM DETAILS', otherEntries);

    // ---- Footer ----
    y -= 10;
    if (y < 60) { page = pdfDoc.addPage([612, 792]); y = height - 50; }
    page.drawLine({
        start: { x: margin, y }, end: { x: width - margin, y },
        thickness: 0.5, color: rgb(0.7, 0.7, 0.7)
    });
    y -= 12;
    page.drawText('This data summary page was generated by IRS Forms Manager.', {
        x: margin, y, size: 8, font: font, color: rgb(0.5, 0.5, 0.5)
    });
}

// ==================== SIMPLE PDF (no template) ====================
async function generateSimplePDF(rootDir, template, formData, submissionId) {
    // Special handling for ENGAGEMENT letters - generate a professional letter
    if (template.form_type === 'ENGAGEMENT') {
        return await generateEngagementLetterPDF(rootDir, template, formData, submissionId);
    }

    const pdfDoc = await PDFDocument.create();
    
    // Use the same data summary page as the main function
    await appendDataSummaryPage(pdfDoc, template, formData, submissionId, 0, 0);

    const pdfBytes = await pdfDoc.save();
    const outputFilename = `${template.form_type}_${submissionId}_${Date.now()}.pdf`;
    const outputPath = path.join('generated', outputFilename);
    fs.writeFileSync(path.join(rootDir, outputPath), pdfBytes);

    return outputPath;
}

// ==================== ENGAGEMENT LETTER PDF ====================
async function generateEngagementLetterPDF(rootDir, template, formData, submissionId) {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.TimesRoman);
    const boldFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
    const italicFont = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);

    let page = pdfDoc.addPage([612, 792]);
    const { width, height } = page.getSize();
    const margin = 72; // 1 inch margins
    const maxWidth = width - margin * 2;
    let y = height - margin;

    // Helper: draw text with word wrap, returns new Y
    const drawWrappedText = (text, x, startY, fontSize, usedFont, lineHeight) => {
        const words = text.split(' ');
        let currentLine = '';
        let currentY = startY;
        for (const word of words) {
            const test = currentLine + (currentLine ? ' ' : '') + word;
            if (usedFont.widthOfTextAtSize(test, fontSize) > maxWidth - (x - margin)) {
                if (currentLine) {
                    page.drawText(currentLine, { x, y: currentY, size: fontSize, font: usedFont, color: rgb(0, 0, 0) });
                    currentY -= lineHeight;
                    if (currentY < margin + 40) { page = pdfDoc.addPage([612, 792]); currentY = height - margin; }
                }
                currentLine = word;
            } else {
                currentLine = test;
            }
        }
        if (currentLine) {
            page.drawText(currentLine, { x, y: currentY, size: fontSize, font: usedFont, color: rgb(0, 0, 0) });
            currentY -= lineHeight;
        }
        return currentY;
    };

    // Data references
    const firmName = formData.firm_name || 'Tax Professional Services';
    const firmAddress = formData.firm_address || '';
    const preparerName = formData.preparer_name || '';
    const preparerTitle = formData.preparer_title || '';
    const clientName = formData.client_name || [formData.first_name, formData.last_name].filter(Boolean).join(' ') || 'Client';
    const clientAddress = [formData.address, [formData.city, formData.state, formData.zip].filter(Boolean).join(', ')].filter(Boolean).join('\n');
    const engagementDate = formData.engagement_date || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const services = formData.services_description || 'Tax preparation and filing services';
    const fee = formData.fee_arrangement || 'To be determined based on complexity';
    const paymentTerms = formData.payment_terms || 'Payment due upon completion of services';
    const engagementPeriod = formData.engagement_period || `Tax Year ${formData.tax_year || new Date().getFullYear()}`;

    // ---- FIRM HEADER ----
    page.drawText(firmName, { x: margin, y, size: 18, font: boldFont, color: rgb(0.12, 0.20, 0.40) });
    y -= 18;
    if (firmAddress) {
        y = drawWrappedText(firmAddress, margin, y, 10, font, 14);
    }
    y -= 6;
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 2, color: rgb(0.12, 0.20, 0.40) });
    y -= 30;

    // ---- DATE ----
    page.drawText(engagementDate, { x: margin, y, size: 11, font: font, color: rgb(0, 0, 0) });
    y -= 28;

    // ---- CLIENT ADDRESS ----
    page.drawText(clientName, { x: margin, y, size: 11, font: boldFont, color: rgb(0, 0, 0) });
    y -= 15;
    if (clientAddress) {
        const addrLines = clientAddress.split('\n');
        for (const line of addrLines) {
            if (line.trim()) {
                page.drawText(line.trim(), { x: margin, y, size: 11, font: font, color: rgb(0, 0, 0) });
                y -= 15;
            }
        }
    }
    y -= 15;

    // ---- SALUTATION ----
    page.drawText(`Dear ${clientName},`, { x: margin, y, size: 11, font: font, color: rgb(0, 0, 0) });
    y -= 22;

    // ---- BODY ----
    const bodyParagraphs = [
        `This letter is to confirm our understanding of the terms and objectives of our engagement and the nature and limitations of the services we will provide.`,
        `SCOPE OF SERVICES`,
        `We will provide the following services for the period of ${engagementPeriod}:`,
        services,
        `RESPONSIBILITIES`,
        `We will perform the services described above in accordance with applicable professional standards. Our services are based on the information you provide to us. You are responsible for the accuracy and completeness of all information provided.`,
        `It is your responsibility to maintain adequate records and provide all documentation necessary for the preparation of complete and accurate returns and financial statements. You are also responsible for ensuring that all income is properly reported and that deductions claimed are supported by documentation.`,
        `FEE ARRANGEMENT`,
        `Our fees for these services will be: ${fee}`,
        `${paymentTerms}`,
        `ENGAGEMENT PERIOD`,
        `This engagement covers: ${engagementPeriod}. Either party may terminate this agreement with written notice. However, fees for services rendered prior to termination will remain due and payable.`,
        `CONFIDENTIALITY`,
        `We will maintain the confidentiality of your information in accordance with professional standards and applicable laws and regulations. We will not disclose your information to third parties without your consent, except as required by law.`,
        `AGREEMENT`,
        `If this letter correctly sets forth your understanding of the terms of our engagement, please sign below and return a copy to us. Your signature confirms that you have read, understand, and agree to the terms of this engagement letter.`,
    ];

    for (const para of bodyParagraphs) {
        if (y < margin + 80) { page = pdfDoc.addPage([612, 792]); y = height - margin; }
        
        // Section headers in bold
        if (['SCOPE OF SERVICES', 'RESPONSIBILITIES', 'FEE ARRANGEMENT', 'ENGAGEMENT PERIOD', 'CONFIDENTIALITY', 'AGREEMENT'].includes(para)) {
            y -= 8;
            page.drawText(para, { x: margin, y, size: 11, font: boldFont, color: rgb(0.12, 0.20, 0.40) });
            y -= 18;
        } else {
            y = drawWrappedText(para, margin, y, 11, font, 15);
            y -= 8;
        }
    }

    // ---- SIGNATURE BLOCKS ----
    if (y < margin + 180) { page = pdfDoc.addPage([612, 792]); y = height - margin; }
    y -= 20;

    page.drawText('Sincerely,', { x: margin, y, size: 11, font: font, color: rgb(0, 0, 0) });
    y -= 40;

    // Preparer signature line
    page.drawLine({ start: { x: margin, y }, end: { x: margin + 200, y }, thickness: 1, color: rgb(0, 0, 0) });
    y -= 14;
    if (preparerName) {
        page.drawText(preparerName, { x: margin, y, size: 11, font: boldFont, color: rgb(0, 0, 0) });
        y -= 14;
    }
    if (preparerTitle) {
        page.drawText(preparerTitle, { x: margin, y, size: 10, font: italicFont, color: rgb(0.3, 0.3, 0.3) });
        y -= 14;
    }
    page.drawText(firmName, { x: margin, y, size: 10, font: font, color: rgb(0.3, 0.3, 0.3) });
    y -= 40;

    // Client acceptance
    page.drawText('ACCEPTED AND AGREED:', { x: margin, y, size: 11, font: boldFont, color: rgb(0.12, 0.20, 0.40) });
    y -= 30;

    // Client signature line
    page.drawLine({ start: { x: margin, y }, end: { x: margin + 200, y }, thickness: 1, color: rgb(0, 0, 0) });
    // Date line
    page.drawLine({ start: { x: margin + 260, y }, end: { x: margin + 400, y }, thickness: 1, color: rgb(0, 0, 0) });
    y -= 14;
    page.drawText('Client Signature', { x: margin, y, size: 9, font: font, color: rgb(0.5, 0.5, 0.5) });
    page.drawText('Date', { x: margin + 260, y, size: 9, font: font, color: rgb(0.5, 0.5, 0.5) });
    y -= 22;

    page.drawLine({ start: { x: margin, y }, end: { x: margin + 200, y }, thickness: 1, color: rgb(0, 0, 0) });
    y -= 14;
    page.drawText('Print Name', { x: margin, y, size: 9, font: font, color: rgb(0.5, 0.5, 0.5) });

    // Save
    const pdfBytes = await pdfDoc.save();
    const outputFilename = `${template.form_type}_${submissionId}_${Date.now()}.pdf`;
    const outputPath = path.join('generated', outputFilename);
    fs.writeFileSync(path.join(rootDir, outputPath), pdfBytes);

    console.log(`Engagement Letter generated for ${clientName}`);
    return outputPath;
}

// ==================== DOWNLOAD FILE HELPER ====================
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const makeRequest = (requestUrl, redirectCount = 0) => {
            if (redirectCount > 5) return reject(new Error('Too many redirects'));
            const protocol = requestUrl.startsWith('https') ? https : http;
            protocol.get(requestUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; IRS-Forms-Manager/1.0)' }
            }, (response) => {
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
                fileStream.on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
            }).on('error', reject);
        };
        makeRequest(url);
    });
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
