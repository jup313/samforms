-- Customers table
CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    ssn TEXT,
    ein TEXT,
    business_name TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    phone TEXT,
    email TEXT,
    date_of_birth TEXT,
    filing_status TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Templates table
CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    form_type TEXT NOT NULL,
    form_name TEXT NOT NULL,
    version_year TEXT,
    file_path TEXT NOT NULL,
    field_mappings TEXT DEFAULT '{}',
    active INTEGER DEFAULT 1,
    upload_date DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Form submissions table
CREATE TABLE IF NOT EXISTS form_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER,
    template_id INTEGER,
    form_type TEXT NOT NULL,
    tax_year TEXT DEFAULT '2025',
    form_data TEXT DEFAULT '{}',
    status TEXT DEFAULT 'draft',
    pdf_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (template_id) REFERENCES templates(id)
);

-- Firm profile — single-row table storing the tax preparer/representative defaults
CREATE TABLE IF NOT EXISTS firm_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    firm_name TEXT,
    firm_address TEXT,
    firm_city TEXT,
    firm_state TEXT,
    firm_zip TEXT,
    firm_phone TEXT,
    firm_fax TEXT,
    firm_email TEXT,
    firm_ein TEXT,
    firm_ptin TEXT,
    preparer_name TEXT,
    preparer_title TEXT,
    representative_name TEXT,
    representative_address TEXT,
    representative_phone TEXT,
    representative_fax TEXT,
    representative_ptin TEXT,
    representative_designation TEXT,
    representative_jurisdiction TEXT,
    representative_bar_number TEXT,
    caf_number TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed a single row so UPDATE always works
INSERT OR IGNORE INTO firm_profile (id) VALUES (1);

-- Index for fast customer lookup
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_templates_active ON templates(form_type, active);
CREATE INDEX IF NOT EXISTS idx_submissions_customer ON form_submissions(customer_id);
