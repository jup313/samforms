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

// Seed default templates if none exist
function seedDefaultTemplates() {
    const count = db.prepare('SELECT COUNT(*) as cnt FROM templates').get();
    if (count.cnt === 0) {
        const defaultTemplates = [
            { form_type: 'W-9', form_name: 'Request for Taxpayer Identification Number and Certification', version_year: '2024' },
            { form_type: 'W-2', form_name: 'Wage and Tax Statement', version_year: '2024' },
            { form_type: 'W-4', form_name: "Employee's Withholding Certificate", version_year: '2024' },
            { form_type: '1099-NEC', form_name: 'Nonemployee Compensation', version_year: '2024' },
            { form_type: '1099-MISC', form_name: 'Miscellaneous Information', version_year: '2024' },
            { form_type: '8821', form_name: 'Tax Information Authorization', version_year: '2024' },
            { form_type: '2848', form_name: 'Power of Attorney and Declaration of Representative', version_year: '2024' },
            { form_type: 'ENGAGEMENT', form_name: 'Letter of Engagement', version_year: '2024' },
        ];

        const insert = db.prepare(`
            INSERT INTO templates (form_type, form_name, version_year, file_path, field_mappings, active)
            VALUES (@form_type, @form_name, @version_year, @file_path, @field_mappings, 1)
        `);

        const insertMany = db.transaction((templates) => {
            for (const t of templates) {
                insert.run({
                    form_type: t.form_type,
                    form_name: t.form_name,
                    version_year: t.version_year,
                    file_path: '',
                    field_mappings: JSON.stringify(getDefaultFieldMappings(t.form_type))
                });
            }
        });

        insertMany(defaultTemplates);
        console.log('Default templates seeded.');
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
