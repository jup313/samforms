const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/generated', express.static(path.join(__dirname, 'generated')));
app.use('/pdf-templates', express.static(path.join(__dirname, 'pdf-templates')));

// Ensure directories exist
['generated', 'pdf-templates/active', 'pdf-templates/archive'].forEach(dir => {
    const fullPath = path.join(__dirname, dir);
    if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
});

// Initialize Database
const dbPath = path.join(__dirname, 'database', 'irs_forms.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Run schema
const schema = fs.readFileSync(path.join(__dirname, 'database', 'schema.sql'), 'utf8');
db.exec(schema);

// Migration: add tax_year column to form_submissions if not exists
try {
    db.prepare("SELECT tax_year FROM form_submissions LIMIT 1").get();
} catch (e) {
    db.exec("ALTER TABLE form_submissions ADD COLUMN tax_year TEXT DEFAULT '2025'");
    console.log('Migration: added tax_year column to form_submissions');
}

// Make db available to routes
app.locals.db = db;
app.locals.rootDir = __dirname;

// Routes
app.use('/api/customers', require('./routes/customers'));
app.use('/api/templates', require('./routes/templates'));
app.use('/api/forms', require('./routes/forms'));

// Serve main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// IRS PDF URL mappings — direct links to IRS.gov PDFs
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
    '3520': 'https://www.irs.gov/pub/irs-pdf/f3520.pdf',
    '3903': 'https://www.irs.gov/pub/irs-pdf/f3903.pdf',
    '5471': 'https://www.irs.gov/pub/irs-pdf/f5471.pdf',
    '5695': 'https://www.irs.gov/pub/irs-pdf/f5695.pdf',
    '6251': 'https://www.irs.gov/pub/irs-pdf/f6251.pdf',
    '8283': 'https://www.irs.gov/pub/irs-pdf/f8283.pdf',
    '8332': 'https://www.irs.gov/pub/irs-pdf/f8332.pdf',
    '8379': 'https://www.irs.gov/pub/irs-pdf/f8379.pdf',
    '8453': 'https://www.irs.gov/pub/irs-pdf/f8453.pdf',
    '8606': 'https://www.irs.gov/pub/irs-pdf/f8606.pdf',
    '8615': 'https://www.irs.gov/pub/irs-pdf/f8615.pdf',
    '8814': 'https://www.irs.gov/pub/irs-pdf/f8814.pdf',
    '8889': 'https://www.irs.gov/pub/irs-pdf/f8889.pdf',
    '8936': 'https://www.irs.gov/pub/irs-pdf/f8936.pdf',
    '8938': 'https://www.irs.gov/pub/irs-pdf/f8938.pdf',
    '8949': 'https://www.irs.gov/pub/irs-pdf/f8949.pdf',
    '8959': 'https://www.irs.gov/pub/irs-pdf/f8959.pdf',
    '8960': 'https://www.irs.gov/pub/irs-pdf/f8960.pdf',
    '14039': 'https://www.irs.gov/pub/irs-pdf/f14039.pdf',
    '14157': 'https://www.irs.gov/pub/irs-pdf/f14157.pdf',
    '56': 'https://www.irs.gov/pub/irs-pdf/f56.pdf',
    '706': 'https://www.irs.gov/pub/irs-pdf/f706.pdf',
    '709': 'https://www.irs.gov/pub/irs-pdf/f709.pdf',
    '990': 'https://www.irs.gov/pub/irs-pdf/f990.pdf',
    '990-EZ': 'https://www.irs.gov/pub/irs-pdf/f990ez.pdf',
    '1023': 'https://www.irs.gov/pub/irs-pdf/f1023.pdf',
    '1023-EZ': 'https://www.irs.gov/pub/irs-pdf/f1023ez.pdf',
    '1024': 'https://www.irs.gov/pub/irs-pdf/f1024.pdf',
    '1310': 'https://www.irs.gov/pub/irs-pdf/f1310.pdf',
    '433-A': 'https://www.irs.gov/pub/irs-pdf/f433a.pdf',
    '433-B': 'https://www.irs.gov/pub/irs-pdf/f433b.pdf',
    '433-D': 'https://www.irs.gov/pub/irs-pdf/f433d.pdf',
    '433-F': 'https://www.irs.gov/pub/irs-pdf/f433f.pdf',
};
app.locals.irsPdfUrls = IRS_PDF_URLS;

// Seed default templates — additive (adds new forms without duplicating)
function seedDefaultTemplates() {
    const allTemplates = [
        // Original 8
        { form_type: 'W-9', form_name: 'Request for Taxpayer Identification Number and Certification', version_year: '2024' },
        { form_type: 'W-2', form_name: 'Wage and Tax Statement', version_year: '2024' },
        { form_type: 'W-4', form_name: "Employee's Withholding Certificate", version_year: '2024' },
        { form_type: '1099-NEC', form_name: 'Nonemployee Compensation', version_year: '2024' },
        { form_type: '1099-MISC', form_name: 'Miscellaneous Information', version_year: '2024' },
        { form_type: '8821', form_name: 'Tax Information Authorization', version_year: '2024' },
        { form_type: '2848', form_name: 'Power of Attorney and Declaration of Representative', version_year: '2024' },
        { form_type: 'ENGAGEMENT', form_name: 'Letter of Engagement', version_year: '2024' },
        // Individual Income Tax
        { form_type: '1040', form_name: 'U.S. Individual Income Tax Return', version_year: '2024' },
        { form_type: '1040-SR', form_name: 'U.S. Tax Return for Seniors', version_year: '2024' },
        { form_type: '1040-ES', form_name: 'Estimated Tax for Individuals', version_year: '2024' },
        { form_type: '1040-X', form_name: 'Amended U.S. Individual Income Tax Return', version_year: '2024' },
        { form_type: '1040-V', form_name: 'Payment Voucher', version_year: '2024' },
        // Schedules
        { form_type: '1040-Schedule-A', form_name: 'Itemized Deductions', version_year: '2024' },
        { form_type: '1040-Schedule-B', form_name: 'Interest and Ordinary Dividends', version_year: '2024' },
        { form_type: '1040-Schedule-C', form_name: 'Profit or Loss From Business', version_year: '2024' },
        { form_type: '1040-Schedule-D', form_name: 'Capital Gains and Losses', version_year: '2024' },
        { form_type: '1040-Schedule-E', form_name: 'Supplemental Income and Loss', version_year: '2024' },
        { form_type: '1040-Schedule-SE', form_name: 'Self-Employment Tax', version_year: '2024' },
        // Business
        { form_type: '1065', form_name: 'U.S. Return of Partnership Income', version_year: '2024' },
        { form_type: '1120', form_name: 'U.S. Corporation Income Tax Return', version_year: '2024' },
        { form_type: '1120-S', form_name: 'U.S. Income Tax Return for an S Corporation', version_year: '2024' },
        { form_type: '2553', form_name: 'Election by a Small Business Corporation', version_year: '2024' },
        { form_type: 'SS-4', form_name: 'Application for Employer Identification Number', version_year: '2024' },
        { form_type: 'SS-8', form_name: 'Determination of Worker Status', version_year: '2024' },
        // More 1099s
        { form_type: '1099-INT', form_name: 'Interest Income', version_year: '2024' },
        { form_type: '1099-DIV', form_name: 'Dividends and Distributions', version_year: '2024' },
        { form_type: '1099-R', form_name: 'Distributions From Pensions, Annuities, etc.', version_year: '2024' },
        { form_type: '1099-G', form_name: 'Certain Government Payments', version_year: '2024' },
        { form_type: '1099-K', form_name: 'Payment Card and Third Party Network Transactions', version_year: '2024' },
        { form_type: '1099-B', form_name: 'Proceeds From Broker and Barter Exchange Transactions', version_year: '2024' },
        { form_type: '1099-S', form_name: 'Proceeds From Real Estate Transactions', version_year: '2024' },
        // 1098s
        { form_type: '1098', form_name: 'Mortgage Interest Statement', version_year: '2024' },
        { form_type: '1098-T', form_name: 'Tuition Statement', version_year: '2024' },
        { form_type: '1098-E', form_name: 'Student Loan Interest Statement', version_year: '2024' },
        // Employment Tax
        { form_type: '940', form_name: 'Employer\'s Annual Federal Unemployment (FUTA) Tax Return', version_year: '2024' },
        { form_type: '941', form_name: 'Employer\'s Quarterly Federal Tax Return', version_year: '2024' },
        { form_type: '943', form_name: 'Employer\'s Annual Federal Tax Return for Agricultural Employees', version_year: '2024' },
        { form_type: '944', form_name: 'Employer\'s Annual Federal Tax Return', version_year: '2024' },
        { form_type: '945', form_name: 'Annual Return of Withheld Federal Income Tax', version_year: '2024' },
        // Extensions & Payments
        { form_type: '4868', form_name: 'Application for Automatic Extension of Time To File', version_year: '2024' },
        { form_type: '7004', form_name: 'Application for Automatic Extension of Time To File (Business)', version_year: '2024' },
        { form_type: '9465', form_name: 'Installment Agreement Request', version_year: '2024' },
        // Other Common Forms
        { form_type: 'W-7', form_name: 'Application for IRS Individual Taxpayer Identification Number', version_year: '2024' },
        { form_type: 'W-8BEN', form_name: 'Certificate of Foreign Status of Beneficial Owner', version_year: '2024' },
        { form_type: '4506-T', form_name: 'Request for Transcript of Tax Return', version_year: '2024' },
        { form_type: '8822', form_name: 'Change of Address', version_year: '2024' },
        { form_type: '8822-B', form_name: 'Change of Address or Responsible Party — Business', version_year: '2024' },
        { form_type: '8829', form_name: 'Expenses for Business Use of Your Home', version_year: '2024' },
        { form_type: '8862', form_name: 'Information To Claim Certain Credits After Disallowance', version_year: '2024' },
        { form_type: '8863', form_name: 'Education Credits (American Opportunity and Lifetime Learning)', version_year: '2024' },
        { form_type: '8867', form_name: 'Paid Preparer\'s Due Diligence Checklist', version_year: '2024' },
        { form_type: '8879', form_name: 'IRS e-file Signature Authorization', version_year: '2024' },
        { form_type: '8888', form_name: 'Allocation of Refund', version_year: '2024' },
        { form_type: '8995', form_name: 'Qualified Business Income Deduction', version_year: '2024' },
        { form_type: '8889', form_name: 'Health Savings Accounts (HSAs)', version_year: '2024' },
        { form_type: '8949', form_name: 'Sales and Other Dispositions of Capital Assets', version_year: '2024' },
        { form_type: '8959', form_name: 'Additional Medicare Tax', version_year: '2024' },
        { form_type: '8960', form_name: 'Net Investment Income Tax', version_year: '2024' },
        { form_type: '8936', form_name: 'Clean Vehicle Credits', version_year: '2024' },
        { form_type: '8938', form_name: 'Statement of Specified Foreign Financial Assets', version_year: '2024' },
        { form_type: '5695', form_name: 'Residential Energy Credits', version_year: '2024' },
        { form_type: '6251', form_name: 'Alternative Minimum Tax — Individuals', version_year: '2024' },
        { form_type: '8606', form_name: 'Nondeductible IRAs', version_year: '2024' },
        { form_type: '2210', form_name: 'Underpayment of Estimated Tax by Individuals', version_year: '2024' },
        { form_type: '3903', form_name: 'Moving Expenses', version_year: '2024' },
        { form_type: '14039', form_name: 'Identity Theft Affidavit', version_year: '2024' },
        { form_type: '56', form_name: 'Notice Concerning Fiduciary Relationship', version_year: '2024' },
        { form_type: '706', form_name: 'United States Estate Tax Return', version_year: '2024' },
        { form_type: '709', form_name: 'United States Gift Tax Return', version_year: '2024' },
        { form_type: '990', form_name: 'Return of Organization Exempt From Income Tax', version_year: '2024' },
        { form_type: '990-EZ', form_name: 'Short Form Return of Organization Exempt From Income Tax', version_year: '2024' },
        { form_type: '1310', form_name: 'Statement of Person Claiming Refund Due a Deceased Taxpayer', version_year: '2024' },
        { form_type: '8283', form_name: 'Noncash Charitable Contributions', version_year: '2024' },
        { form_type: '8332', form_name: 'Release/Revocation of Release of Claim to Exemption', version_year: '2024' },
        { form_type: '8379', form_name: 'Injured Spouse Allocation', version_year: '2024' },
        { form_type: '8453', form_name: 'U.S. Individual Income Tax Transmittal for an IRS e-file Return', version_year: '2024' },
        // Collection / Installment Agreement forms
        { form_type: '433-A', form_name: 'Collection Information Statement for Wage Earners and Self-Employed Individuals', version_year: '2024' },
        { form_type: '433-B', form_name: 'Collection Information Statement for Businesses', version_year: '2024' },
        { form_type: '433-D', form_name: 'Installment Agreement', version_year: '2024' },
        { form_type: '433-F', form_name: 'Collection Information Statement', version_year: '2024' },
    ];

    const insert = db.prepare(`
        INSERT INTO templates (form_type, form_name, version_year, file_path, field_mappings, active)
        VALUES (@form_type, @form_name, @version_year, @file_path, @field_mappings, 1)
    `);

    const exists = db.prepare('SELECT COUNT(*) as cnt FROM templates WHERE form_type = ?');

    const syncTemplates = db.transaction((templates) => {
        let added = 0;
        for (const t of templates) {
            const count = exists.get(t.form_type);
            if (count.cnt === 0) {
                insert.run({
                    form_type: t.form_type,
                    form_name: t.form_name,
                    version_year: t.version_year,
                    file_path: '',
                    field_mappings: JSON.stringify(getDefaultFieldMappings(t.form_type))
                });
                added++;
            }
        }
        return added;
    });

    const added = syncTemplates(allTemplates);
    if (added > 0) {
        console.log(`Templates synced: ${added} new templates added.`);
    }
}

function getDefaultFieldMappings(formType) {
    const commonFields = {
        first_name: 'first_name',
        last_name: 'last_name',
        ssn: 'ssn',
        ein: 'ein',
        business_name: 'business_name',
        address: 'address',
        city: 'city',
        state: 'state',
        zip: 'zip'
    };

    const formSpecific = {
        'W-9': {
            ...commonFields,
            federal_tax_classification: '',
            exempt_payee_code: '',
            exemption_fatca_code: '',
            account_numbers: '',
            requester_name: '',
            certification_date: ''
        },
        'W-2': {
            ...commonFields,
            employer_name: '',
            employer_ein: '',
            employer_address: '',
            wages_tips: '',
            federal_tax_withheld: '',
            ss_wages: '',
            ss_tax_withheld: '',
            medicare_wages: '',
            medicare_tax_withheld: '',
            ss_tips: '',
            allocated_tips: '',
            dependent_care_benefits: '',
            nonqualified_plans: '',
            box_12a_code: '', box_12a_amount: '',
            box_12b_code: '', box_12b_amount: '',
            box_12c_code: '', box_12c_amount: '',
            box_12d_code: '', box_12d_amount: '',
            statutory_employee: '',
            retirement_plan: '',
            third_party_sick_pay: '',
            state: '', state_employer_id: '',
            state_wages: '', state_tax: '',
            local_wages: '', local_tax: '', locality_name: ''
        },
        'W-4': {
            ...commonFields,
            filing_status: '',
            multiple_jobs: '',
            claim_dependents: '',
            other_income: '',
            deductions: '',
            extra_withholding: '',
            exempt: '',
            first_date_of_employment: '',
            employer_name: '',
            employer_ein: ''
        },
        '1099-NEC': {
            ...commonFields,
            payer_name: '',
            payer_tin: '',
            payer_address: '',
            nonemployee_compensation: '',
            payer_made_direct_sales: '',
            federal_tax_withheld: '',
            state_tax_withheld: '',
            state: '',
            state_payer_number: '',
            state_income: ''
        },
        '1099-MISC': {
            ...commonFields,
            payer_name: '',
            payer_tin: '',
            payer_address: '',
            rents: '',
            royalties: '',
            other_income: '',
            federal_tax_withheld: '',
            fishing_boat_proceeds: '',
            medical_payments: '',
            substitute_payments: '',
            crop_insurance: '',
            gross_proceeds_attorney: '',
            excess_golden_parachute: '',
            nonqualified_deferred: '',
            fatca_filing: '',
            state_tax_withheld: '',
            state: '',
            state_payer_number: '',
            state_income: ''
        },
        '8821': {
            ...commonFields,
            taxpayer_name: '',
            taxpayer_id: '',
            designee_name: '',
            designee_phone: '',
            designee_fax: '',
            tax_matters: '',
            tax_form_number: '',
            tax_years: '',
            specific_use: '',
            retention_revocation: ''
        },
        '2848': {
            ...commonFields,
            taxpayer_name: '',
            taxpayer_id: '',
            representative_name: '',
            representative_address: '',
            representative_phone: '',
            representative_fax: '',
            representative_ptin: '',
            representative_designation: '',
            representative_jurisdiction: '',
            representative_bar_number: '',
            tax_matters: '',
            tax_form_number: '',
            tax_years: '',
            specific_use: '',
            specific_acts: '',
            retention_revocation: ''
        },
        'ENGAGEMENT': {
            ...commonFields,
            client_name: '',
            engagement_date: '',
            services_description: '',
            fee_arrangement: '',
            payment_terms: '',
            engagement_period: '',
            preparer_name: '',
            preparer_title: '',
            firm_name: '',
            firm_address: ''
        }
    };

    return formSpecific[formType] || commonFields;
}

seedDefaultTemplates();

app.listen(PORT, () => {
    console.log(`IRS Tax Forms Server running at http://localhost:${PORT}`);
});
