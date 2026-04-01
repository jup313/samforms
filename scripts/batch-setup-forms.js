#!/usr/bin/env node
/**
 * Batch IRS Form Setup Script
 * 
 * Downloads all IRS PDFs, inspects their fields, and auto-generates
 * field mappings for every template in the database.
 * 
 * Usage: node scripts/batch-setup-forms.js
 */

const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { PDFDocument } = require('pdf-lib');
const Database = require('better-sqlite3');

const ROOT_DIR = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT_DIR, 'database', 'irs_forms.db');
const PDF_DIR = path.join(ROOT_DIR, 'pdf-templates', 'active');

// Ensure directories exist
if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true });

const IRS_PDF_URLS = {
    'W-2': 'https://www.irs.gov/pub/irs-pdf/fw2.pdf',
    'W-4': 'https://www.irs.gov/pub/irs-pdf/fw4.pdf',
    'W-9': 'https://www.irs.gov/pub/irs-pdf/fw9.pdf',
    'W-7': 'https://www.irs.gov/pub/irs-pdf/fw7.pdf',
    'W-8BEN': 'https://www.irs.gov/pub/irs-pdf/fw8ben.pdf',
    '1040': 'https://www.irs.gov/pub/irs-pdf/f1040.pdf',
    '1040-SR': 'https://www.irs.gov/pub/irs-pdf/f1040s.pdf',
    '1040-ES': 'https://www.irs.gov/pub/irs-pdf/f1040es.pdf',
    '1040-X': 'https://www.irs.gov/pub/irs-pdf/f1040x.pdf',
    '1040-V': 'https://www.irs.gov/pub/irs-pdf/f1040v.pdf',
    '1040-Schedule-A': 'https://www.irs.gov/pub/irs-pdf/f1040sa.pdf',
    '1040-Schedule-B': 'https://www.irs.gov/pub/irs-pdf/f1040sb.pdf',
    '1040-Schedule-C': 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf',
    '1040-Schedule-D': 'https://www.irs.gov/pub/irs-pdf/f1040sd.pdf',
    '1040-Schedule-E': 'https://www.irs.gov/pub/irs-pdf/f1040se.pdf',
    '1040-Schedule-SE': 'https://www.irs.gov/pub/irs-pdf/f1040sse.pdf',
    '1065': 'https://www.irs.gov/pub/irs-pdf/f1065.pdf',
    '1120': 'https://www.irs.gov/pub/irs-pdf/f1120.pdf',
    '1120-S': 'https://www.irs.gov/pub/irs-pdf/f1120s.pdf',
    '1099-NEC': 'https://www.irs.gov/pub/irs-pdf/f1099nec.pdf',
    '1099-MISC': 'https://www.irs.gov/pub/irs-pdf/f1099msc.pdf',
    '1099-INT': 'https://www.irs.gov/pub/irs-pdf/f1099int.pdf',
    '1099-DIV': 'https://www.irs.gov/pub/irs-pdf/f1099div.pdf',
    '1099-R': 'https://www.irs.gov/pub/irs-pdf/f1099r.pdf',
    '1099-G': 'https://www.irs.gov/pub/irs-pdf/f1099g.pdf',
    '1099-K': 'https://www.irs.gov/pub/irs-pdf/f1099k.pdf',
    '1099-B': 'https://www.irs.gov/pub/irs-pdf/f1099b.pdf',
    '1099-S': 'https://www.irs.gov/pub/irs-pdf/f1099s.pdf',
    '1098': 'https://www.irs.gov/pub/irs-pdf/f1098.pdf',
    '1098-T': 'https://www.irs.gov/pub/irs-pdf/f1098t.pdf',
    '1098-E': 'https://www.irs.gov/pub/irs-pdf/f1098e.pdf',
    '940': 'https://www.irs.gov/pub/irs-pdf/f940.pdf',
    '941': 'https://www.irs.gov/pub/irs-pdf/f941.pdf',
    '943': 'https://www.irs.gov/pub/irs-pdf/f943.pdf',
    '944': 'https://www.irs.gov/pub/irs-pdf/f944.pdf',
    '945': 'https://www.irs.gov/pub/irs-pdf/f945.pdf',
    '2848': 'https://www.irs.gov/pub/irs-pdf/f2848.pdf',
    '4506-T': 'https://www.irs.gov/pub/irs-pdf/f4506t.pdf',
    '4868': 'https://www.irs.gov/pub/irs-pdf/f4868.pdf',
    '7004': 'https://www.irs.gov/pub/irs-pdf/f7004.pdf',
    '8821': 'https://www.irs.gov/pub/irs-pdf/f8821.pdf',
    '8822': 'https://www.irs.gov/pub/irs-pdf/f8822.pdf',
    '8822-B': 'https://www.irs.gov/pub/irs-pdf/f8822b.pdf',
    '8829': 'https://www.irs.gov/pub/irs-pdf/f8829.pdf',
    '8862': 'https://www.irs.gov/pub/irs-pdf/f8862.pdf',
    '8863': 'https://www.irs.gov/pub/irs-pdf/f8863.pdf',
    '8867': 'https://www.irs.gov/pub/irs-pdf/f8867.pdf',
    '8879': 'https://www.irs.gov/pub/irs-pdf/f8879.pdf',
    '8888': 'https://www.irs.gov/pub/irs-pdf/f8888.pdf',
    '8995': 'https://www.irs.gov/pub/irs-pdf/f8995.pdf',
    '9465': 'https://www.irs.gov/pub/irs-pdf/f9465.pdf',
    'SS-4': 'https://www.irs.gov/pub/irs-pdf/fss4.pdf',
    'SS-8': 'https://www.irs.gov/pub/irs-pdf/fss8.pdf',
    '2553': 'https://www.irs.gov/pub/irs-pdf/f2553.pdf',
    '2210': 'https://www.irs.gov/pub/irs-pdf/f2210.pdf',
    '3903': 'https://www.irs.gov/pub/irs-pdf/f3903.pdf',
    '5695': 'https://www.irs.gov/pub/irs-pdf/f5695.pdf',
    '6251': 'https://www.irs.gov/pub/irs-pdf/f6251.pdf',
    '8283': 'https://www.irs.gov/pub/irs-pdf/f8283.pdf',
    '8332': 'https://www.irs.gov/pub/irs-pdf/f8332.pdf',
    '8379': 'https://www.irs.gov/pub/irs-pdf/f8379.pdf',
    '8453': 'https://www.irs.gov/pub/irs-pdf/f8453.pdf',
    '8606': 'https://www.irs.gov/pub/irs-pdf/f8606.pdf',
    '8889': 'https://www.irs.gov/pub/irs-pdf/f8889.pdf',
    '8936': 'https://www.irs.gov/pub/irs-pdf/f8936.pdf',
    '8938': 'https://www.irs.gov/pub/irs-pdf/f8938.pdf',
    '8949': 'https://www.irs.gov/pub/irs-pdf/f8949.pdf',
    '8959': 'https://www.irs.gov/pub/irs-pdf/f8959.pdf',
    '8960': 'https://www.irs.gov/pub/irs-pdf/f8960.pdf',
    '14039': 'https://www.irs.gov/pub/irs-pdf/f14039.pdf',
    '56': 'https://www.irs.gov/pub/irs-pdf/f56.pdf',
    '706': 'https://www.irs.gov/pub/irs-pdf/f706.pdf',
    '709': 'https://www.irs.gov/pub/irs-pdf/f709.pdf',
    '990': 'https://www.irs.gov/pub/irs-pdf/f990.pdf',
    '990-EZ': 'https://www.irs.gov/pub/irs-pdf/f990ez.pdf',
    '1310': 'https://www.irs.gov/pub/irs-pdf/f1310.pdf',
};

// ==================== DOWNLOAD HELPER ====================
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
                    return reject(new Error(`HTTP ${response.statusCode}`));
                }
                const fileStream = fs.createWriteStream(destPath);
                response.pipe(fileStream);
                fileStream.on('finish', () => {
                    fileStream.close();
                    try {
                        const header = Buffer.alloc(5);
                        const fd = fs.openSync(destPath, 'r');
                        fs.readSync(fd, header, 0, 5, 0);
                        fs.closeSync(fd);
                        if (header.toString() !== '%PDF-') {
                            fs.unlinkSync(destPath);
                            return reject(new Error('Not a valid PDF'));
                        }
                    } catch(e) {
                        return reject(new Error('File validation failed'));
                    }
                    resolve();
                });
                fileStream.on('error', (err) => { try { fs.unlinkSync(destPath); } catch(e) {} reject(err); });
            }).on('error', reject);
        };
        makeRequest(url);
    });
}

// ==================== AUTO-MAP FIELDS ====================
// Analyzes PDF field names and auto-generates mappings to our data keys
function autoMapFields(formType, fieldInfos) {
    const mappings = {};
    
    // Get only Page 1 text fields sorted by field number
    const page1TextFields = fieldInfos
        .filter(f => f.type === 'PDFTextField' && /page1|page\[0\]|\.f1_/i.test(f.fullName))
        .sort((a, b) => {
            const numA = parseInt((a.shortName.match(/\d+$/) || ['999'])[0]);
            const numB = parseInt((b.shortName.match(/\d+$/) || ['999'])[0]);
            return numA - numB;
        });
    
    // Get Page 2 text fields
    const page2TextFields = fieldInfos
        .filter(f => f.type === 'PDFTextField' && /page2|page\[1\]|\.f2_/i.test(f.fullName))
        .sort((a, b) => {
            const numA = parseInt((a.shortName.match(/\d+$/) || ['999'])[0]);
            const numB = parseInt((b.shortName.match(/\d+$/) || ['999'])[0]);
            return numA - numB;
        });

    // ==================== FORM-SPECIFIC PATTERNS ====================
    // Most IRS forms follow conventions where the first few fields are:
    // Field 1: Name / Taxpayer name
    // Field 2: SSN or EIN or secondary name
    // Field 3-4: Address info or secondary ID
    
    // Determine form category for mapping strategy
    const isIndividualForm = ['1040', '1040-SR', '1040-X', '1040-ES', '1040-V',
        '1040-Schedule-A', '1040-Schedule-B', '1040-Schedule-C', '1040-Schedule-D',
        '1040-Schedule-E', '1040-Schedule-SE',
        '2210', '3903', '4868', '5695', '6251', '8283', '8332', '8379',
        '8453', '8606', '8829', '8862', '8863', '8879', '8888', '8889',
        '8936', '8938', '8949', '8959', '8960', '8995', '9465', '14039',
        '1310', '8867'].includes(formType);
    
    const isBusinessForm = ['1065', '1120', '1120-S', '2553', 'SS-4', 'SS-8',
        '940', '941', '943', '944', '945', '7004', '990', '990-EZ'].includes(formType);
    
    const isEmployerInfoForm = ['W-2', '1099-NEC', '1099-MISC', '1099-INT', '1099-DIV',
        '1099-R', '1099-G', '1099-K', '1099-B', '1099-S',
        '1098', '1098-T', '1098-E'].includes(formType);
    
    const isAuthForm = ['2848', '8821', '4506-T'].includes(formType);
    const isWForm = ['W-4', 'W-7', 'W-8BEN', 'W-9'].includes(formType);

    // For each field, try to match by examining field name patterns
    for (const field of fieldInfos) {
        const fn = field.fullName.toLowerCase();
        const sn = field.shortName.toLowerCase();
        
        // Skip non-text fields for primary mapping
        if (field.type !== 'PDFTextField') continue;
        
        // ---- Universal keyword matching on field names ----
        // Many IRS PDFs have descriptive field names in their full path
        
        // Name patterns
        if (/taxpayer.*name|your.*name|name.*return|name.*shown/i.test(fn) && !mappings.full_name) {
            mappings.full_name = field.fullName;
        }
        if (/first.*name/i.test(fn) && !mappings.first_name) {
            mappings.first_name = field.fullName;
        }
        if (/last.*name/i.test(fn) && !mappings.last_name) {
            mappings.last_name = field.fullName;
        }
        
        // SSN patterns
        if (/social.*security|your.*ssn|taxpayer.*ssn/i.test(fn) && !mappings.ssn) {
            mappings.ssn = field.fullName;
        }
        if (/identifying.*number|ident.*no/i.test(fn) && !mappings.ssn) {
            mappings.ssn = field.fullName;
        }
        
        // EIN patterns
        if (/employer.*ident|ein\b/i.test(fn) && !mappings.ein) {
            mappings.ein = field.fullName;
        }
        
        // Address patterns
        if (/address|street/i.test(fn) && !/email|web|url/i.test(fn) && !mappings.address) {
            mappings.address = field.fullName;
        }
        if (/\bcity\b/i.test(fn) && !mappings.city) {
            mappings.city = field.fullName;
        }
        if (/\bstate\b/i.test(fn) && !mappings.state) {
            mappings.state = field.fullName;
        }
        if (/\bzip\b|postal/i.test(fn) && !mappings.zip) {
            mappings.zip = field.fullName;
        }
        if (/city.*state.*zip/i.test(fn) && !mappings.city_state_zip) {
            mappings.city_state_zip = field.fullName;
        }
        
        // Business name
        if (/business.*name|company|corporation|entity|organization/i.test(fn) && !mappings.business_name) {
            mappings.business_name = field.fullName;
        }
        
        // Phone
        if (/phone|telephone|daytime/i.test(fn) && !mappings.phone) {
            mappings.phone = field.fullName;
        }
        
        // Email
        if (/email|e-mail/i.test(fn) && !mappings.email) {
            mappings.email = field.fullName;
        }
    }

    // ---- Positional mapping for cryptic field names (f1_1, f1_2, etc.) ----
    // Only apply if we haven't already matched descriptive names
    if (page1TextFields.length > 0 && Object.keys(mappings).length < 3) {
        // Most IRS forms: first field = name, second = SSN/EIN or business name
        
        if (isIndividualForm) {
            // Individual forms: Name, SSN
            if (page1TextFields[0] && !hasMapping(mappings, 'full_name')) {
                mappings.full_name = page1TextFields[0].fullName;
            }
            if (page1TextFields[1] && !hasMapping(mappings, 'ssn')) {
                mappings.ssn = page1TextFields[1].fullName;
            }
            // Fields 3-4 often address or additional info
            if (page1TextFields.length > 2 && !hasMapping(mappings, 'address')) {
                mappings.address = page1TextFields[2].fullName;
            }
            if (page1TextFields.length > 3 && !hasMapping(mappings, 'city_state_zip')) {
                mappings.city_state_zip = page1TextFields[3].fullName;
            }
        } else if (isBusinessForm) {
            // Business forms: Business Name, EIN, Address
            if (page1TextFields[0] && !hasMapping(mappings, 'business_name')) {
                mappings.business_name = page1TextFields[0].fullName;
            }
            if (page1TextFields[1] && !hasMapping(mappings, 'ein')) {
                mappings.ein = page1TextFields[1].fullName;
            }
            if (page1TextFields.length > 2 && !hasMapping(mappings, 'address')) {
                mappings.address = page1TextFields[2].fullName;
            }
            if (page1TextFields.length > 3 && !hasMapping(mappings, 'city_state_zip')) {
                mappings.city_state_zip = page1TextFields[3].fullName;
            }
        } else if (isEmployerInfoForm) {
            // 1099/1098/W-2: Payer info first, then recipient
            // These are typically pre-printed by employer, but we map recipient fields
            // Recipient fields are usually in the middle/second section
            const halfIdx = Math.floor(page1TextFields.length / 3);
            if (page1TextFields[0] && !hasMapping(mappings, 'payer_name')) {
                mappings.payer_name = page1TextFields[0].fullName;
            }
            if (page1TextFields[1] && !hasMapping(mappings, 'payer_ein')) {
                mappings.payer_ein = page1TextFields[1].fullName;
            }
            // Try to find recipient section
            for (let i = 2; i < page1TextFields.length && i < 8; i++) {
                const fn = page1TextFields[i].fullName.toLowerCase();
                if (/recip|payee|employee|borrower|student/i.test(fn)) {
                    if (!hasMapping(mappings, 'full_name')) {
                        mappings.full_name = page1TextFields[i].fullName;
                    }
                    if (i + 1 < page1TextFields.length && !hasMapping(mappings, 'ssn')) {
                        mappings.ssn = page1TextFields[i + 1].fullName;
                    }
                    break;
                }
            }
            // Fallback: if no keyword match, use positional for recipient
            if (!hasMapping(mappings, 'full_name') && halfIdx < page1TextFields.length) {
                mappings.full_name = page1TextFields[halfIdx].fullName;
            }
            if (!hasMapping(mappings, 'ssn') && halfIdx + 1 < page1TextFields.length) {
                mappings.ssn = page1TextFields[halfIdx + 1].fullName;
            }
        } else if (isAuthForm) {
            // Authorization forms: Taxpayer name, SSN/EIN, Address first
            if (page1TextFields[0] && !hasMapping(mappings, 'full_name')) {
                mappings.full_name = page1TextFields[0].fullName;
            }
            if (page1TextFields[1]) {
                // Could be SSN, EIN, or address depending on form
                if (!hasMapping(mappings, 'ssn')) {
                    mappings.ssn = page1TextFields[1].fullName;
                }
            }
            if (page1TextFields.length > 2 && !hasMapping(mappings, 'address')) {
                mappings.address = page1TextFields[2].fullName;
            }
        } else if (isWForm) {
            // W-forms have specific structures - handled by KNOWN_IRS_FIELD_MAPS mostly
            // But add generic positional as fallback
            if (page1TextFields[0] && !hasMapping(mappings, 'full_name')) {
                mappings.full_name = page1TextFields[0].fullName;
            }
        } else {
            // Generic: first field = name, second = SSN or EIN
            if (page1TextFields[0] && !hasMapping(mappings, 'full_name')) {
                mappings.full_name = page1TextFields[0].fullName;
            }
            if (page1TextFields[1] && !hasMapping(mappings, 'ssn')) {
                mappings.ssn = page1TextFields[1].fullName;
            }
        }
    }
    
    // Also map Page 2 first fields if they look like name/SSN repeat (common in IRS forms)
    if (page2TextFields.length >= 2) {
        // Many IRS forms repeat name + SSN at the top of page 2
        if (!mappings.full_name_p2) {
            mappings.full_name_p2 = page2TextFields[0].fullName;
        }
        if (!mappings.ssn_p2) {
            mappings.ssn_p2 = page2TextFields[1].fullName;
        }
    }

    return mappings;
}

function hasMapping(mappings, key) {
    return mappings[key] !== undefined;
}

// ==================== MAIN ====================
async function main() {
    console.log('=== IRS Form Batch Setup ===\n');
    
    const db = new Database(DB_PATH);
    const templates = db.prepare('SELECT * FROM templates ORDER BY id').all();
    
    console.log(`Found ${templates.length} templates in database`);
    console.log(`Found ${Object.keys(IRS_PDF_URLS).length} IRS PDF URLs\n`);
    
    let downloaded = 0;
    let mapped = 0;
    let failed = 0;
    let skipped = 0;
    
    for (const template of templates) {
        const formType = template.form_type;
        const irsUrl = IRS_PDF_URLS[formType];
        
        // Skip non-IRS forms (like ENGAGEMENT)
        if (!irsUrl) {
            console.log(`[SKIP] ${formType} — no IRS URL`);
            skipped++;
            continue;
        }
        
        let pdfPath = template.file_path;
        let fullPdfPath = pdfPath ? path.join(ROOT_DIR, pdfPath) : null;
        
        // Step 1: Download PDF if not already present
        if (!pdfPath || !fs.existsSync(fullPdfPath)) {
            const filename = `${formType.replace(/[^a-zA-Z0-9-]/g, '_')}_IRS.pdf`;
            fullPdfPath = path.join(PDF_DIR, filename);
            const relativePath = path.join('pdf-templates', 'active', filename);
            
            try {
                process.stdout.write(`[DL] ${formType}... `);
                await downloadFile(irsUrl, fullPdfPath);
                
                // Update DB with file path
                db.prepare('UPDATE templates SET file_path = ?, upload_date = CURRENT_TIMESTAMP WHERE id = ?')
                    .run(relativePath, template.id);
                pdfPath = relativePath;
                downloaded++;
                process.stdout.write('OK\n');
            } catch (err) {
                process.stdout.write(`FAILED: ${err.message}\n`);
                failed++;
                continue;
            }
        } else {
            console.log(`[OK] ${formType} — PDF exists`);
        }
        
        // Step 2: Inspect PDF fields and auto-map
        try {
            const pdfBytes = fs.readFileSync(fullPdfPath);
            const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
            const form = pdfDoc.getForm();
            const fields = form.getFields();
            
            const fieldInfos = fields.map(f => ({
                fullName: f.getName(),
                shortName: f.getName().replace(/^.*\./, '').replace(/\[\d+\]$/g, ''),
                type: f.constructor.name,
            }));
            
            const textFieldCount = fieldInfos.filter(f => f.type === 'PDFTextField').length;
            const checkBoxCount = fieldInfos.filter(f => f.type === 'PDFCheckBox').length;
            
            // Auto-generate mappings
            const autoMappings = autoMapFields(formType, fieldInfos);
            
            // Merge with existing mappings (don't overwrite manual ones)
            const existingMappings = JSON.parse(template.field_mappings || '{}');
            const mergedMappings = { ...autoMappings, ...existingMappings };
            
            // Save to DB
            db.prepare('UPDATE templates SET field_mappings = ? WHERE id = ?')
                .run(JSON.stringify(mergedMappings), template.id);
            
            const mapCount = Object.keys(mergedMappings).length;
            console.log(`  → ${fields.length} fields (${textFieldCount} text, ${checkBoxCount} check) → ${mapCount} mappings`);
            mapped++;
            
        } catch (err) {
            console.log(`  → Field inspection failed: ${err.message}`);
        }
    }
    
    console.log(`\n=== Summary ===`);
    console.log(`Downloaded: ${downloaded}`);
    console.log(`Mapped: ${mapped}`);
    console.log(`Failed: ${failed}`);
    console.log(`Skipped: ${skipped}`);
    
    db.close();
    console.log('\nDone!');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
