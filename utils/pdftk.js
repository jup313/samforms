/**
 * pdftk utility module
 * Uses pdftk-java for accurate PDF form filling (handles XFA, proper field names)
 * and field scanning for auto-setup of templates.
 */
const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Check if pdftk is available on the system
 */
function isPdftkAvailable() {
    try {
        execSync('pdftk --version', { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

/**
 * Scan all form fields from a PDF using pdftk dump_data_fields
 * Returns array of { name, type, maxLength, options, value }
 */
function scanFields(pdfPath) {
    try {
        const output = execFileSync('pdftk', [pdfPath, 'dump_data_fields'], {
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
        });

        const fields = [];
        const blocks = output.split('---').filter(b => b.trim());

        for (const block of blocks) {
            const lines = block.trim().split('\n');
            const field = {};
            const stateOptions = [];

            for (const line of lines) {
                const match = line.match(/^(\w+):\s*(.*)$/);
                if (match) {
                    const [, key, val] = match;
                    if (key === 'FieldStateOption') {
                        stateOptions.push(val);
                    } else {
                        field[key] = val;
                    }
                }
            }

            if (field.FieldName) {
                const shortName = field.FieldName
                    .replace(/^topmostSubform\[0\]\.Page\d+\[0\]\./, '')
                    .replace(/\[\d+\]$/g, '')
                    .replace(/.*\./, '');

                fields.push({
                    fullName: field.FieldName,
                    shortName,
                    type: field.FieldType || 'Text',
                    maxLength: field.FieldMaxLength ? parseInt(field.FieldMaxLength) : null,
                    justification: field.FieldJustification || 'Left',
                    value: field.FieldValue || null,
                    options: stateOptions.length > 0 ? stateOptions : null,
                });
            }
        }

        return fields;
    } catch (err) {
        console.error('pdftk scanFields error:', err.message);
        return null;
    }
}

/**
 * Generate FDF (Forms Data Format) content from a field→value map
 * @param {Object} fieldValues - { 'topmostSubform[0].Page1[0].TaxpayerName[0]': 'John Doe', ... }
 * @returns {string} FDF file content
 */
function generateFDF(fieldValues) {
    const entries = [];
    for (const [fieldName, value] of Object.entries(fieldValues)) {
        if (value === null || value === undefined || value === '') continue;
        // Escape special FDF characters
        const escapedValue = String(value)
            .replace(/\\/g, '\\\\')
            .replace(/\(/g, '\\(')
            .replace(/\)/g, '\\)')
            .replace(/\n/g, '\\r');
        entries.push(`<< /T (${fieldName}) /V (${escapedValue}) >>`);
    }

    return `%FDF-1.2
1 0 obj
<< /FDF << /Fields [
${entries.join('\n')}
] >> >>
endobj
trailer
<< /Root 1 0 R >>
%%EOF`;
}

/**
 * Fill a PDF form using pdftk fill_form
 * @param {string} templatePath - Path to the template PDF
 * @param {Object} fieldValues - { 'full_field_name': 'value', ... }
 * @param {string} outputPath - Path to write the filled PDF
 * @param {boolean} flatten - Whether to flatten the form (default true)
 * @returns {boolean} Success
 */
function fillForm(templatePath, fieldValues, outputPath, flatten = true) {
    const tmpFdf = path.join(os.tmpdir(), `fdf_${Date.now()}_${Math.random().toString(36).substr(2, 8)}.fdf`);

    try {
        // Write FDF
        const fdfContent = generateFDF(fieldValues);
        fs.writeFileSync(tmpFdf, fdfContent, 'utf-8');

        // Build pdftk command
        const args = [templatePath, 'fill_form', tmpFdf, 'output', outputPath];
        if (flatten) args.push('flatten');

        execFileSync('pdftk', args, { maxBuffer: 50 * 1024 * 1024 });

        return true;
    } catch (err) {
        console.error('pdftk fillForm error:', err.message);
        return false;
    } finally {
        // Clean up temp FDF
        try { fs.unlinkSync(tmpFdf); } catch {}
    }
}

/**
 * Auto-suggest field mappings based on PDF field names
 * Maps common IRS PDF field name patterns to our data keys
 */
function suggestMappings(fields) {
    const suggestions = {};

    for (const field of fields) {
        if (field.type === 'Button') continue; // Skip buttons/checkboxes for now

        const short = field.shortName.toLowerCase();
        const full = field.fullName.toLowerCase();
        let dataKey = null;

        // Taxpayer info
        if (/taxpayername/.test(short)) dataKey = 'full_name';
        else if (/taxpayeraddress/.test(short)) dataKey = 'full_address';
        else if (/taxpayeridssn|taxpayeritidn/.test(short)) dataKey = 'ssn';
        else if (/taxpayeridein/.test(short)) dataKey = 'ein';
        else if (/taxpayertelephone/.test(short)) dataKey = 'phone';
        else if (/taxpayerplannumber|taxplayerplannumber/.test(short)) dataKey = 'plan_number';
        // Representative — slot 1 only
        else if (/^representativesname1$/.test(short)) dataKey = 'representative_name';
        else if (/^representativesaddress1$/.test(short)) dataKey = 'representative_address';
        else if (/^cafnumber1$/.test(short)) dataKey = 'caf_number';
        else if (/^ptin1$/.test(short)) dataKey = 'representative_ptin';
        else if (/^telephoneno1$/.test(short)) dataKey = 'representative_phone';
        else if (/^faxno1$/.test(short)) dataKey = 'representative_fax';
        // Tax matters — row 1 only
        else if (/^description1$/.test(short)) dataKey = 'tax_matters';
        else if (/^taxform1$/.test(short)) dataKey = 'tax_form_number';
        else if (/^years1$/.test(short)) dataKey = 'tax_years';
        // Page 2
        else if (/^printname$/.test(short) && /page2/.test(full)) dataKey = 'full_name_p2';
        else if (/^printnametaxpayer$/.test(short)) dataKey = 'full_name_taxpayer_p2';
        else if (/^designation1$/.test(short)) dataKey = 'representative_designation';
        else if (/^jurisdiction1$/.test(short)) dataKey = 'representative_jurisdiction';
        else if (/^bar1$/.test(short)) dataKey = 'representative_bar_number';
        else if (/^title$/.test(short)) dataKey = 'title';
        // Generic patterns
        else if (/f\d+_\d+/.test(short)) {
            // Cryptic field names - skip auto-suggestion
            dataKey = null;
        }
        // W-9 / general
        else if (/^name$|fullname/.test(short)) dataKey = 'full_name';
        else if (/firstname/.test(short)) dataKey = 'first_name';
        else if (/lastname/.test(short)) dataKey = 'last_name';
        else if (/\bssn\b/.test(short)) dataKey = 'ssn';
        else if (/\bein\b/.test(short)) dataKey = 'ein';
        else if (/address/.test(short) && !/represent|payer|employer/.test(short)) dataKey = 'address';
        else if (/city/.test(short)) dataKey = 'city';
        else if (/state/.test(short)) dataKey = 'state';
        else if (/zip/.test(short)) dataKey = 'zip';
        else if (/phone|telephone/.test(short) && !/fax|represent/.test(short)) dataKey = 'phone';
        else if (/email/.test(short)) dataKey = 'email';

        if (dataKey) {
            suggestions[dataKey] = field.fullName;
        }
    }

    return suggestions;
}

module.exports = {
    isPdftkAvailable,
    scanFields,
    generateFDF,
    fillForm,
    suggestMappings,
};
