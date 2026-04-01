#!/usr/bin/env node
/**
 * Batch IRS Form Setup Script v2 — Improved Field Mapping
 * 
 * Downloads all IRS PDFs, inspects their fields, and auto-generates
 * field mappings for every template in the database.
 * 
 * KEY IMPROVEMENT: CamelCase-aware keyword matching on ALL fields,
 * not just positional guesses on the first few.
 * 
 * Mapping format: { our_data_key: pdf_full_field_name }
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

// ==================== NORMALIZE FIELD NAME ====================
// Convert any PDF field name into searchable lowercase text
// Handles CamelCase, underscores, dots, brackets
function normalizeFieldName(fieldName) {
    return fieldName
        // Split CamelCase: "TaxpayerAddress" -> "Taxpayer Address"
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        // Remove array indices and common prefixes
        .replace(/\[\d+\]/g, ' ')
        .replace(/topmostSubform|form1|Form\d+/gi, ' ')
        .replace(/Page\d+/gi, ' ')
        // Replace separators
        .replace(/[._\-]/g, ' ')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

// ==================== DETERMINE PAGE NUMBER ====================
function getPageNumber(fieldName) {
    const match = fieldName.match(/Page(\d+)|page\[(\d+)\]|\.f(\d+)_/i);
    if (match) {
        if (match[1]) return parseInt(match[1]);
        if (match[2]) return parseInt(match[2]) + 1;
        if (match[3]) return parseInt(match[3]);
    }
    // Check for Copy sections (1099/W-2 style)
    if (/CopyA|Copy\s*A/i.test(fieldName)) return 1;
    if (/Copy1|CopyB|Copy\s*B/i.test(fieldName)) return 2;
    return 1;
}

// ==================== KEYWORD-BASED FIELD MATCHER ====================
// Returns the data key for a given normalized field name, or null
function matchFieldToDataKey(normalized, fullName, formType) {
    const s = normalized;
    
    // ---- Name fields ----
    if (/taxpayer\s*name|your\s*name|name\s*shown|name\s*on\s*(your|the)\s*(return|tax)/.test(s)) return 'full_name';
    if (/first\s*name|fname|given\s*name/.test(s)) return 'first_name';
    if (/last\s*name|lname|surname|family\s*name/.test(s)) return 'last_name';
    if (/print\s*name\s*taxpayer/.test(s)) return 'full_name';
    if (/print\s*name/.test(s)) return 'full_name';

    // ---- Business name ----
    if (/business\s*name|company|entity\s*name|organization\s*name|corporation\s*name|trade\s*name|dba/.test(s)) return 'business_name';

    // ---- Tax IDs ----
    if (/taxpayer\s*id\s*ssn/.test(s)) return 'ssn';
    if (/taxpayer\s*id\s*itin/.test(s)) return 'ssn';
    if (/taxpayer\s*id\s*ein/.test(s)) return 'ein';
    if (/social\s*security|your\s*ssn|taxpayer\s*ssn/.test(s)) return 'ssn';
    if (/identifying\s*number|ident\s*no/.test(s)) return 'ssn';
    if (/employer\s*id\s*number|employer\s*identification|\bein\b/.test(s)) return 'ein';
    // For W-2/1099 payer TIN
    if (/payer.?s?\s*tin|payer.?s?\s*federal|payer.?s?\s*id/.test(s)) return 'payer_ein';

    // ---- Addresses ----
    if (/taxpayer\s*address/.test(s)) return 'address';
    if (/city\s*state\s*zip|city\s*town\s*state/.test(s)) return 'city_state_zip';
    // Taxpayer/personal address - not payer/employer/representative
    if (/\baddress\b/.test(s) && !/payer|employer|represent|filer|lender|issuer|donee/.test(s)) {
        // Check if part of address read order or main address
        if (/address\s*read\s*order/.test(s) || /home|mailing|street|your|taxpayer/.test(s) || 
            (/\baddress\b/.test(s) && !/read\s*order/.test(s))) return 'address';
    }
    if (/\bcity\b/.test(s) && !/payer|employer|donee/.test(s)) return 'city';
    if (/\bstate\b/.test(s) && !/united|payer|employer|donee/.test(s)) return 'state';
    if (/\bzip\b|postal\s*code/.test(s) && !/payer|employer|donee/.test(s)) return 'zip';

    // ---- Contact ----
    if (/taxpayer\s*telephone|your\s*phone|daytime\s*phone|home\s*phone|\btelephone\b/.test(s) && !/fax|payer|employer|represent/.test(s)) return 'phone';
    if (/\bemail\b|\be\s*mail\b/.test(s)) return 'email';

    // ---- Filing status ----
    if (/filing\s*status/.test(s)) return 'filing_status';
    if (/date\s*of?\s*birth|dob|birth\s*date/.test(s)) return 'date_of_birth';

    // ---- Payer/employer fields (for 1099s, W-2s, 1098s) ----
    if (/payer\s*name|payer.?s\s*name|filer\s*name|lender\s*name|issuer\s*name/.test(s)) return 'payer_name';
    if (/payer\s*address|payer.?s\s*address|filer\s*address/.test(s)) return 'payer_address';
    if (/employer\s*name/.test(s)) return 'employer_name';
    if (/employer\s*address/.test(s)) return 'employer_address';

    // ---- Recipient fields (for 1099s, W-2s) ----
    if (/recipient\s*name|payee\s*name|employee\s*name|borrower\s*name|student\s*name/.test(s)) return 'full_name';
    if (/recipient\s*tin|recipient.?s?\s*id|payee.?s?\s*tin|employee.?s?\s*ssn/.test(s)) return 'ssn';
    if (/recipient\s*address|payee\s*address|employee\s*address|borrower\s*address/.test(s)) return 'address';

    // ---- POA / 2848 / 8821 specific ----
    if (/representative.?s?\s*name\s*\d?$/.test(s)) return 'representative_name';
    if (/representative.?s?\s*address/.test(s)) return 'representative_address';
    if (/\bcaf\s*number/.test(s)) return 'caf_number';
    if (/\bptin\b/.test(s)) return 'ptin';
    if (/telephone\s*no|phone\s*no/.test(s) && /represent|\d/.test(s)) return 'representative_phone';
    if (/fax\s*no/.test(s)) return 'representative_fax';
    if (/description\s*\d/.test(s) && /line\s*3|table\s*line\s*3/.test(s)) return 'tax_matters';
    if (/tax\s*form\s*\d/.test(s)) return 'tax_form_number';
    if (/years?\s*\d/.test(s) && /line\s*3|table\s*line\s*3/.test(s)) return 'tax_years';
    if (/designation\s*\d/.test(s)) return 'representative_designation';
    if (/jurisdiction\s*\d/.test(s)) return 'representative_jurisdiction';
    if (/\bbar\s*\d/.test(s)) return 'representative_bar_number';
    if (/additional\s*acts/.test(s)) return 'specific_acts';
    if (/other\s*acts/.test(s)) return 'specific_acts';
    if (/specific\s*deletion/.test(s)) return 'specific_deletions';
    if (/taxpayer\s*plan\s*number/.test(s)) return 'plan_number';

    // ---- Designee fields (8821) ----
    if (/designee\s*name/.test(s)) return 'designee_name';
    if (/designee\s*phone|\bdesignee\b.*telephone/.test(s)) return 'designee_phone';
    if (/designee\s*fax/.test(s)) return 'designee_fax';

    // ---- W-9 specific ----
    if (/tax\s*class|federal\s*tax\s*class/.test(s)) return 'federal_tax_classification';
    if (/exempt\s*payee/.test(s)) return 'exempt_payee_code';
    if (/fatca/.test(s)) return 'exemption_fatca_code';
    if (/account\s*num/.test(s)) return 'account_numbers';
    if (/requester/.test(s)) return 'requester_name';

    // ---- Section info ----
    if (/section\s*(a|b|c|d|e)/.test(s) && /signature/.test(s)) return null; // skip signature fields

    return null;
}

// ==================== HARD-CODED FORM MAPS (cryptic field names) ====================
// For forms where field names are totally cryptic (f1_01, f1_02, etc.)
// Format: { short_field_name: our_data_key }
const KNOWN_POSITIONAL_MAPS = {
    'W-9': {
        'f1_01': 'full_name',
        'f1_02': 'business_name',
        'f1_05': 'exempt_payee_code',
        'f1_06': 'exemption_fatca_code',
        'f1_07': 'address',
        'f1_08': 'city_state_zip',
        'f1_09': 'requester_name',
        'f1_10': 'account_numbers',
        'f1_11': 'ssn_1',
        'f1_12': 'ssn_2',
        'f1_13': 'ssn_3',
        'f1_14': 'ein_1',
        'f1_15': 'ein_2',
    },
    'W-4': {
        'f1_01': 'first_name',
        'f1_02': 'last_name',
        'f1_03': 'ssn',
        'f1_04': 'address',
        'f1_05': 'city_state_zip',
        'f1_06': 'extra_withholding',
        'f2_01': 'employer_name',
        'f2_02': 'employer_ein',
        'f2_03': 'first_date_of_employment',
    },
    '1040': {
        'f1_01': 'full_name',
        'f1_02': 'full_name',      // Spouse name (can be re-mapped later)
        'f1_03': 'ssn',
        'f1_04': 'city_state_zip',
        'f1_05': 'ssn',            // Spouse SSN
        'f1_20': 'address',        // Address line
        'f1_21': 'address',        // Apt number
        'f1_22': 'city',
        'f1_23': 'state',
        'f1_24': 'zip',
        'f1_25': 'foreign_country',
        'f1_26': 'foreign_province',
        'f1_27': 'foreign_postal',
        'f2_01': 'full_name',      // Page 2 repeat
        'f2_02': 'ssn',            // Page 2 repeat
    },
    '1040-SR': {
        'f1_01': 'full_name',
        'f1_02': 'full_name',
        'f1_03': 'ssn',
        'f1_04': 'city_state_zip',
        'f2_01': 'full_name',
        'f2_02': 'ssn',
    },
    '1040-X': {
        'f1_01': 'full_name',
        'f1_02': 'full_name',
        'f1_03': 'ssn',
        'f1_04': 'city_state_zip',
    },
    '1040-V': {
        'f1_1': 'full_name',
        'f1_2': 'ssn',
        'f1_3': 'full_name',       // Spouse name
        'f1_4': 'ssn',             // Spouse SSN
        'f1_5': 'city_state_zip',
        'f1_6': 'address',
    },
    '8283': {
        'f1_1': 'full_name',
        'f1_2': 'ssn',
        'f1_4': 'city_state_zip',
        'f2_1': 'full_name',
        'f2_2': 'ssn',
    },
    '8821': {
        'f1_1': 'full_name',
        'f1_2': 'ssn',
        'f1_3': 'address',
        'f1_4': 'city_state_zip',
        'f1_5': 'phone',
        'f1_6': 'designee_name',
        'f1_7': 'designee_phone',
        'f1_8': 'designee_fax',
        'f1_9': 'caf_number',
        // Line 3 table rows
        'f1_20': 'tax_matters',
        'f1_21': 'tax_form_number',
        'f1_22': 'tax_years',
    },
    '4506-T': {
        'f1_1': 'full_name',
        'f1_2': 'ssn',
        'f1_3': 'full_name',      // Spouse
        'f1_4': 'ssn',            // Spouse SSN
        'f1_5': 'address',
        'f1_6': 'city_state_zip',
    },
    '8822': {
        'f1_1': 'full_name',
        'f1_2': 'ssn',
        'f1_3': 'full_name',
        'f1_4': 'ssn',
        'f1_5': 'address',        // Old address
        'f1_6': 'city_state_zip', // Old city/state/zip
    },
    '8822-B': {
        'f1_1': 'business_name',
        'f1_2': 'ein',
        'f1_3': 'address',
        'f1_4': 'city_state_zip',
    },
};

// ==================== AUTO-MAP FIELDS (v2) ====================
function autoMapFields(formType, fieldInfos) {
    const mappings = {};
    const usedPdfFields = new Set();  // Track which PDF fields are already mapped

    // Step 1: Try keyword matching on ALL text fields
    for (const field of fieldInfos) {
        if (field.type !== 'PDFTextField') continue;

        const normalized = normalizeFieldName(field.fullName);
        const pageNum = getPageNumber(field.fullName);
        
        let dataKey = matchFieldToDataKey(normalized, field.fullName, formType);
        
        if (dataKey) {
            // If this key is already mapped, add page suffix for page 2+
            const mappingKey = (pageNum > 1 && mappings[dataKey]) ? `${dataKey}_p${pageNum}` : dataKey;
            
            if (!mappings[mappingKey]) {
                mappings[mappingKey] = field.fullName;
                usedPdfFields.add(field.fullName);
            }
        }
    }

    // Step 2: Apply known positional maps for forms with cryptic names
    const knownMap = KNOWN_POSITIONAL_MAPS[formType];
    if (knownMap) {
        for (const field of fieldInfos) {
            if (field.type !== 'PDFTextField') continue;
            if (usedPdfFields.has(field.fullName)) continue;
            
            const shortName = field.shortName;
            if (knownMap[shortName]) {
                const dataKey = knownMap[shortName];
                if (!mappings[dataKey]) {
                    mappings[dataKey] = field.fullName;
                    usedPdfFields.add(field.fullName);
                }
            }
        }
    }

    // Step 3: Positional fallback for common form patterns
    // Separate fields by page
    const page1Fields = fieldInfos
        .filter(f => f.type === 'PDFTextField' && getPageNumber(f.fullName) === 1 && !usedPdfFields.has(f.fullName))
        .sort((a, b) => {
            const numA = parseInt((a.shortName.match(/\d+$/) || ['999'])[0]);
            const numB = parseInt((b.shortName.match(/\d+$/) || ['999'])[0]);
            return numA - numB;
        });
    
    const page2Fields = fieldInfos
        .filter(f => f.type === 'PDFTextField' && getPageNumber(f.fullName) === 2 && !usedPdfFields.has(f.fullName))
        .sort((a, b) => {
            const numA = parseInt((a.shortName.match(/\d+$/) || ['999'])[0]);
            const numB = parseInt((b.shortName.match(/\d+$/) || ['999'])[0]);
            return numA - numB;
        });

    // Form category detection
    const isIndividualForm = /^(1040|Schedule|2210|3903|4868|5695|6251|8283|8332|8379|8453|8606|8829|8862|8863|8867|8879|8888|8889|8936|8938|8949|8959|8960|8995|9465|14039|1310|56|706|709)/i.test(formType);
    const isBusinessForm = /^(1065|1120|2553|SS-4|SS-8|940|941|943|944|945|7004|990)/.test(formType);
    const isInfoReturn = /^(1099|1098|W-2$)/.test(formType);

    // Only apply positional if we have very few keyword matches
    if (Object.keys(mappings).length < 3 && page1Fields.length > 0) {
        if (isIndividualForm && !knownMap) {
            // Standard individual: field 1 = name, field 2 = SSN, field 3 = address, field 4 = city/state/zip
            if (page1Fields[0] && !mappings.full_name) {
                mappings.full_name = page1Fields[0].fullName;
            }
            if (page1Fields[1] && !mappings.ssn) {
                mappings.ssn = page1Fields[1].fullName;
            }
            if (page1Fields.length > 2 && !mappings.address) {
                mappings.address = page1Fields[2].fullName;
            }
            if (page1Fields.length > 3 && !mappings.city_state_zip) {
                mappings.city_state_zip = page1Fields[3].fullName;
            }
        } else if (isBusinessForm && !knownMap) {
            if (page1Fields[0] && !mappings.business_name) {
                mappings.business_name = page1Fields[0].fullName;
            }
            if (page1Fields[1] && !mappings.ein) {
                mappings.ein = page1Fields[1].fullName;
            }
            if (page1Fields.length > 2 && !mappings.address) {
                mappings.address = page1Fields[2].fullName;
            }
            if (page1Fields.length > 3 && !mappings.city_state_zip) {
                mappings.city_state_zip = page1Fields[3].fullName;
            }
        } else if (isInfoReturn && !knownMap) {
            // 1099/1098/W-2: first = payer name, second = payer EIN
            if (page1Fields[0] && !mappings.payer_name) {
                mappings.payer_name = page1Fields[0].fullName;
            }
            if (page1Fields[1] && !mappings.payer_ein) {
                mappings.payer_ein = page1Fields[1].fullName;
            }
        }
    }

    // Page 2 repeat (name + SSN at top of page 2 is very common)
    if (page2Fields.length >= 2) {
        if (!mappings.full_name_p2) {
            mappings.full_name_p2 = page2Fields[0].fullName;
        }
        if (!mappings.ssn_p2) {
            mappings.ssn_p2 = page2Fields[1].fullName;
        }
    }

    return mappings;
}

// ==================== MAIN ====================
async function main() {
    console.log('=== IRS Form Batch Setup v2 — Improved Field Mapping ===\n');
    
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
            
            // Auto-generate NEW mappings (complete replacement)
            const newMappings = autoMapFields(formType, fieldInfos);
            
            // Count how many mappings actually point to real PDF fields
            const realMappings = Object.entries(newMappings).filter(([k, v]) => v && v !== '' && v !== k);
            
            // Save to DB (REPLACE old mappings entirely)
            db.prepare('UPDATE templates SET field_mappings = ? WHERE id = ?')
                .run(JSON.stringify(newMappings), template.id);
            
            console.log(`  → ${fields.length} fields (${textFieldCount} text, ${checkBoxCount} check) → ${realMappings.length} real mappings`);
            
            // Show the mappings
            for (const [dataKey, pdfField] of Object.entries(newMappings)) {
                const shortField = pdfField.replace(/^.*\./, '');
                console.log(`    ${dataKey} → ${shortField}`);
            }
            
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
