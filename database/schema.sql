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
    form_data TEXT DEFAULT '{}',
    status TEXT DEFAULT 'draft',
    pdf_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (template_id) REFERENCES templates(id)
);

-- Index for fast customer lookup
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_templates_active ON templates(form_type, active);
CREATE INDEX IF NOT EXISTS idx_submissions_customer ON form_submissions(customer_id);
