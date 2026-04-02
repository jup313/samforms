// ==================== GLOBALS ====================
let allCustomers = [];
let allTemplates = [];
let currentTemplate = null;
let currentPage = 'dashboard';

// ==================== NAVIGATION ====================
function navigateTo(page) {
    currentPage = page;
    // Hide all sections
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    // Show target
    document.getElementById(`page-${page}`).classList.add('active');
    // Update nav
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');

    // Load page data
    switch (page) {
        case 'dashboard': loadDashboard(); break;
        case 'forms': loadFormTemplates(); break;
        case 'firm-profile': loadFirmProfile(); break;
        case 'customers': loadCustomers(); break;
        case 'templates': loadTemplates(); break;
        case 'history': loadHistory(); break;
    }
}

// ==================== TOAST NOTIFICATIONS ====================
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// ==================== MODAL HELPERS ====================
function openModal(id) {
    document.getElementById(id).classList.add('show');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('show');
}

// ==================== API HELPERS ====================
async function api(url, options = {}) {
    try {
        const res = await fetch(url, {
            headers: { 'Content-Type': 'application/json', ...options.headers },
            ...options
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'API Error');
        return data;
    } catch (err) {
        console.error('API Error:', err);
        throw err;
    }
}

// ==================== DASHBOARD ====================
async function loadDashboard() {
    try {
        const [customers, templates, forms] = await Promise.all([
            api('/api/customers'),
            api('/api/templates'),
            api('/api/forms')
        ]);

        allCustomers = customers;
        allTemplates = templates;

        document.getElementById('statCustomers').textContent = customers.length;
        document.getElementById('statTemplates').textContent = templates.filter(t => t.active).length;
        document.getElementById('statForms').textContent = forms.length;
        document.getElementById('statPdfs').textContent = templates.filter(t => t.file_path && t.file_path !== '').length;

        // Recent forms
        const container = document.getElementById('recentFormsContainer');
        if (forms.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📋</div>
                    <p>No forms generated yet</p>
                    <button class="btn btn-primary" onclick="navigateTo('forms')">Fill Out a Form</button>
                </div>`;
        } else {
            const recent = forms.slice(0, 5);
            container.innerHTML = recent.map(f => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--border);">
                    <div>
                        <strong>${f.form_type}</strong>
                        <span style="color: var(--text-light); font-size: 12px;">
                            ${f.first_name ? `— ${f.last_name}, ${f.first_name}` : ''}
                        </span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span class="badge badge-success">${f.status}</span>
                        <span style="font-size: 12px; color: var(--text-light);">${new Date(f.created_at).toLocaleDateString()}</span>
                        ${f.pdf_path ? `<a href="/${f.pdf_path}" target="_blank" class="btn btn-sm btn-outline">📥 PDF</a>` : ''}
                    </div>
                </div>
            `).join('');
        }
    } catch (err) {
        showToast('Error loading dashboard: ' + err.message, 'error');
    }
}

// ==================== FORM FILLING ====================
async function loadFormTemplates() {
    try {
        const templates = await api('/api/templates?active_only=true');
        allTemplates = templates;
        const grid = document.getElementById('formTemplateGrid');

        if (templates.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📄</div>
                    <p>No templates available</p>
                </div>`;
            return;
        }

        grid.innerHTML = templates.map(t => `
            <div class="template-card" onclick="selectFormTemplate(${t.id})">
                <div class="form-type">${t.form_type}</div>
                <div class="form-name">${t.form_name}</div>
                <div class="form-meta">
                    <span>Version: ${t.version_year || 'N/A'}</span>
                    <span>
                        <span class="has-pdf ${t.file_path ? 'yes' : 'no'}"></span>
                        ${t.file_path ? 'PDF Ready' : 'No PDF'}
                    </span>
                </div>
            </div>
        `).join('');
    } catch (err) {
        showToast('Error loading templates: ' + err.message, 'error');
    }
}

async function selectFormTemplate(templateId) {
    try {
        currentTemplate = await api(`/api/templates/${templateId}`);
        allCustomers = await api('/api/customers');

        document.getElementById('formStep1').style.display = 'none';
        document.getElementById('formStep2').style.display = 'block';
        document.getElementById('formStep3').style.display = 'none';

        document.getElementById('formTitle').textContent = `${currentTemplate.form_type} — ${currentTemplate.form_name}`;
        document.getElementById('formTypeBadge').textContent = '';
        document.getElementById('selectedCustomerId').value = '';
        document.getElementById('customerPickerInput').value = '';

        // Populate tax year dropdown (2025-2200)
        populateTaxYearDropdown();

        // Build dynamic form fields
        buildFormFields(currentTemplate);
        setupCustomerPicker();
    } catch (err) {
        showToast('Error loading template: ' + err.message, 'error');
    }
}

function populateTaxYearDropdown() {
    const select = document.getElementById('taxYearSelect');
    select.innerHTML = '';
    const currentYear = new Date().getFullYear();
    for (let year = 2025; year <= 2200; year++) {
        const opt = document.createElement('option');
        opt.value = year.toString();
        opt.textContent = year.toString();
        if (year === currentYear) opt.selected = true;
        select.appendChild(opt);
    }
}

function buildFormFields(template) {
    const container = document.getElementById('dynamicFormFields');
    const mappings = JSON.parse(template.field_mappings || '{}');
    const fields = Object.keys(mappings);

    // Group fields into sections
    const customerFields = ['first_name', 'last_name', 'ssn', 'ein', 'business_name', 'address', 'city', 'state', 'zip', 'phone', 'email', 'date_of_birth', 'filing_status'];
    const custFields = fields.filter(f => customerFields.includes(f));
    const formFields = fields.filter(f => !customerFields.includes(f));

    let html = '';

    // Customer Info Section
    if (custFields.length > 0) {
        html += '<h4 style="color: var(--primary); margin-bottom: 12px;">👤 Customer Information</h4>';
        html += '<div class="form-row">';
        custFields.forEach(field => {
            html += buildFieldInput(field);
        });
        html += '</div>';
        html += '<hr style="margin: 20px 0; border: none; border-top: 1px solid var(--border);">';
    }

    // Form-Specific Fields
    if (formFields.length > 0) {
        html += `<h4 style="color: var(--primary); margin-bottom: 12px;">📝 ${template.form_type} Specific Fields</h4>`;
        html += '<div class="form-row">';
        formFields.forEach(field => {
            html += buildFieldInput(field);
        });
        html += '</div>';
    }

    container.innerHTML = html;
}

function buildFieldInput(field) {
    const label = field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    const isRequired = (field === 'first_name' || field === 'last_name');

    // Determine input type
    let inputType = 'text';
    let inputHtml = '';

    if (field === 'state') {
        inputHtml = `<select class="form-control" id="field_${field}" data-field="${field}">
            <option value="">Select State...</option>
            ${getStateOptions()}
        </select>`;
    } else if (field === 'filing_status') {
        inputHtml = `<select class="form-control" id="field_${field}" data-field="${field}">
            <option value="">Select...</option>
            <option value="Single">Single</option>
            <option value="Married Filing Jointly">Married Filing Jointly</option>
            <option value="Married Filing Separately">Married Filing Separately</option>
            <option value="Head of Household">Head of Household</option>
            <option value="Qualifying Widow(er)">Qualifying Widow(er)</option>
        </select>`;
    } else if (field === 'federal_tax_classification') {
        inputHtml = `<select class="form-control" id="field_${field}" data-field="${field}">
            <option value="">Select...</option>
            <option value="Individual/sole proprietor or single-member LLC">Individual/sole proprietor or single-member LLC</option>
            <option value="C Corporation">C Corporation</option>
            <option value="S Corporation">S Corporation</option>
            <option value="Partnership">Partnership</option>
            <option value="Trust/estate">Trust/estate</option>
            <option value="LLC - C">LLC - C Corporation</option>
            <option value="LLC - S">LLC - S Corporation</option>
            <option value="LLC - P">LLC - Partnership</option>
            <option value="Other">Other</option>
        </select>`;
    } else if (field.includes('date') || field === 'date_of_birth') {
        inputType = 'date';
        inputHtml = `<input type="date" class="form-control" id="field_${field}" data-field="${field}">`;
    } else if (field.includes('email')) {
        inputType = 'email';
        inputHtml = `<input type="email" class="form-control" id="field_${field}" data-field="${field}" placeholder="${label}">`;
    } else if (field.includes('description') || field.includes('services') || field.includes('matters') || field.includes('acts') || field.includes('notes')) {
        inputHtml = `<textarea class="form-control" id="field_${field}" data-field="${field}" placeholder="${label}" rows="3"></textarea>`;
    } else if (field.includes('statutory') || field.includes('retirement') || field.includes('third_party') || field.includes('exempt') || field.includes('fatca') || field.includes('direct_sales') || field.includes('multiple_jobs')) {
        inputHtml = `<div style="padding-top: 4px;">
            <label class="form-check" style="margin: 0;">
                <input type="checkbox" id="field_${field}" data-field="${field}" data-type="checkbox">
                <span>${label}</span>
            </label>
        </div>`;
    } else {
        inputHtml = `<input type="${inputType}" class="form-control" id="field_${field}" data-field="${field}" placeholder="${label}">`;
    }

    return `
        <div class="form-group">
            <label>${label} ${isRequired ? '<span class="required">*</span>' : ''}</label>
            ${inputHtml}
        </div>
    `;
}

function getStateOptions() {
    const states = [
        'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
        'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
        'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
        'VA','WA','WV','WI','WY','DC'
    ];
    return states.map(s => `<option value="${s}">${s}</option>`).join('');
}

// ==================== CUSTOMER PICKER ====================
function setupCustomerPicker() {
    const input = document.getElementById('customerPickerInput');
    const dropdown = document.getElementById('customerPickerDropdown');

    input.addEventListener('input', () => {
        const query = input.value.toLowerCase().trim();
        if (query.length === 0) {
            dropdown.classList.remove('show');
            return;
        }

        const filtered = allCustomers.filter(c =>
            `${c.last_name}, ${c.first_name}`.toLowerCase().includes(query) ||
            (c.business_name && c.business_name.toLowerCase().includes(query)) ||
            (c.email && c.email.toLowerCase().includes(query))
        );

        let html = filtered.map(c => `
            <div class="customer-picker-item" onclick="selectCustomer(${c.id})">
                <div>
                    <span class="customer-name">${c.last_name}, ${c.first_name}</span>
                    ${c.business_name ? `<br><span class="customer-detail">${c.business_name}</span>` : ''}
                </div>
                <span class="customer-detail">
                    ${c.ssn ? 'SSN: ***-**-' + c.ssn.slice(-4) : ''}
                    ${c.ein ? 'EIN: ' + c.ein : ''}
                </span>
            </div>
        `).join('');

        html += `
            <div class="customer-picker-item new-customer" onclick="clearCustomerSelection()">
                ➕ New Customer — enter details below
            </div>
        `;

        dropdown.innerHTML = html;
        dropdown.classList.add('show');
    });

    input.addEventListener('focus', () => {
        if (input.value.length > 0) {
            input.dispatchEvent(new Event('input'));
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.customer-picker')) {
            dropdown.classList.remove('show');
        }
    });
}

async function selectCustomer(customerId) {
    try {
        const customer = await api(`/api/customers/${customerId}`);
        document.getElementById('selectedCustomerId').value = customerId;
        document.getElementById('customerPickerInput').value = `${customer.last_name}, ${customer.first_name}`;
        document.getElementById('customerPickerDropdown').classList.remove('show');

        // Auto-fill customer fields
        const customerFields = ['first_name', 'last_name', 'ssn', 'ein', 'business_name', 'address', 'city', 'state', 'zip', 'phone', 'email', 'date_of_birth', 'filing_status'];
        customerFields.forEach(field => {
            const el = document.getElementById(`field_${field}`);
            if (el && customer[field]) {
                if (el.type === 'checkbox') {
                    el.checked = !!customer[field];
                } else {
                    el.value = customer[field];
                }
            }
        });

        showToast(`Loaded customer: ${customer.first_name} ${customer.last_name}`, 'info');
    } catch (err) {
        showToast('Error loading customer: ' + err.message, 'error');
    }
}

function clearCustomerSelection() {
    document.getElementById('selectedCustomerId').value = '';
    document.getElementById('customerPickerInput').value = '';
    document.getElementById('customerPickerDropdown').classList.remove('show');
    clearForm();
}

function backToFormSelection() {
    document.getElementById('formStep1').style.display = 'block';
    document.getElementById('formStep2').style.display = 'none';
    document.getElementById('formStep3').style.display = 'none';
    currentTemplate = null;
}

function clearForm() {
    document.querySelectorAll('#dynamicFormFields .form-control, #dynamicFormFields textarea, #dynamicFormFields select').forEach(el => {
        el.value = '';
    });
    document.querySelectorAll('#dynamicFormFields input[type="checkbox"]').forEach(el => {
        el.checked = false;
    });
}

async function submitForm() {
    if (!currentTemplate) return;

    // Collect form data
    const formData = {};
    document.querySelectorAll('#dynamicFormFields [data-field]').forEach(el => {
        const field = el.dataset.field;
        if (el.dataset.type === 'checkbox' || el.type === 'checkbox') {
            formData[field] = el.checked ? 'Yes' : '';
        } else {
            formData[field] = el.value;
        }
    });

    // Validate required fields
    if (!formData.first_name || !formData.last_name) {
        showToast('First Name and Last Name are required!', 'error');
        return;
    }

    const customerId = document.getElementById('selectedCustomerId').value;
    const saveCustomer = document.getElementById('saveCustomerCheck').checked;
    const generatePdf = document.getElementById('generatePdfCheck').checked;

    const taxYear = document.getElementById('taxYearSelect').value;

    try {
        const result = await api('/api/forms', {
            method: 'POST',
            body: JSON.stringify({
                template_id: currentTemplate.id,
                customer_id: customerId ? parseInt(customerId) : null,
                form_data: formData,
                save_customer: saveCustomer,
                generate_pdf: generatePdf,
                tax_year: taxYear
            })
        });

        // Show success
        document.getElementById('formStep2').style.display = 'none';
        document.getElementById('formStep3').style.display = 'block';

        const msg = [`Form ${currentTemplate.form_type} (Tax Year ${taxYear}) saved for ${formData.first_name} ${formData.last_name}.`];
        if (result.customer_id && saveCustomer && !customerId) {
            msg.push('New customer added to database.');
        }
        if (result.pdf_path) {
            msg.push('PDF generated successfully.');
            const link = document.getElementById('downloadPdfLink');
            link.href = `/${result.pdf_path}`;
            link.style.display = 'inline-flex';
        } else {
            document.getElementById('downloadPdfLink').style.display = 'none';
        }

        document.getElementById('formSuccessMessage').textContent = msg.join(' ');
        showToast('Form saved successfully!', 'success');
    } catch (err) {
        showToast('Error saving form: ' + err.message, 'error');
    }
}

// ==================== CUSTOMERS PAGE ====================
async function loadCustomers(search = '') {
    try {
        const url = search ? `/api/customers?search=${encodeURIComponent(search)}` : '/api/customers';
        const customers = await api(url);
        allCustomers = customers;

        const tbody = document.getElementById('customersTableBody');
        if (customers.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">👥</div><p>No customers found</p></div></td></tr>`;
            return;
        }

        tbody.innerHTML = customers.map(c => `
            <tr>
                <td><strong>${c.last_name}, ${c.first_name}</strong></td>
                <td>${c.business_name || '—'}</td>
                <td>
                    ${c.ssn ? '<span title="' + c.ssn + '">SSN: ***-**-' + c.ssn.slice(-4) + '</span>' : ''}
                    ${c.ein ? '<span>EIN: ' + c.ein + '</span>' : ''}
                    ${!c.ssn && !c.ein ? '—' : ''}
                </td>
                <td>${c.email || '—'}</td>
                <td>${c.phone || '—'}</td>
                <td>${c.city && c.state ? c.city + ', ' + c.state : c.city || c.state || '—'}</td>
                <td>
                    <div class="actions">
                        <button class="btn btn-sm btn-outline" onclick="viewCustomer(${c.id})" title="View">👁️</button>
                        <button class="btn btn-sm btn-primary" onclick="editCustomer(${c.id})" title="Edit">✏️</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteCustomer(${c.id})" title="Delete">🗑️</button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        showToast('Error loading customers: ' + err.message, 'error');
    }
}

let searchTimeout;
function searchCustomers() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        const search = document.getElementById('customerSearch').value;
        loadCustomers(search);
    }, 300);
}

function showAddCustomerModal() {
    document.getElementById('customerModalTitle').textContent = 'Add Customer';
    document.getElementById('editCustomerId').value = '';
    // Clear all fields
    ['custFirstName', 'custLastName', 'custSSN', 'custEIN', 'custBusiness', 'custAddress', 'custCity', 'custState', 'custZip', 'custPhone', 'custEmail', 'custDOB', 'custFilingStatus', 'custNotes'].forEach(id => {
        document.getElementById(id).value = '';
    });
    openModal('customerModal');
}

async function editCustomer(id) {
    try {
        const c = await api(`/api/customers/${id}`);
        document.getElementById('customerModalTitle').textContent = 'Edit Customer';
        document.getElementById('editCustomerId').value = id;
        document.getElementById('custFirstName').value = c.first_name || '';
        document.getElementById('custLastName').value = c.last_name || '';
        document.getElementById('custSSN').value = c.ssn || '';
        document.getElementById('custEIN').value = c.ein || '';
        document.getElementById('custBusiness').value = c.business_name || '';
        document.getElementById('custAddress').value = c.address || '';
        document.getElementById('custCity').value = c.city || '';
        document.getElementById('custState').value = c.state || '';
        document.getElementById('custZip').value = c.zip || '';
        document.getElementById('custPhone').value = c.phone || '';
        document.getElementById('custEmail').value = c.email || '';
        document.getElementById('custDOB').value = c.date_of_birth || '';
        document.getElementById('custFilingStatus').value = c.filing_status || '';
        document.getElementById('custNotes').value = c.notes || '';
        openModal('customerModal');
    } catch (err) {
        showToast('Error loading customer: ' + err.message, 'error');
    }
}

async function saveCustomer() {
    const firstName = document.getElementById('custFirstName').value.trim();
    const lastName = document.getElementById('custLastName').value.trim();

    if (!firstName || !lastName) {
        showToast('First Name and Last Name are required!', 'error');
        return;
    }

    const data = {
        first_name: firstName,
        last_name: lastName,
        ssn: document.getElementById('custSSN').value.trim() || null,
        ein: document.getElementById('custEIN').value.trim() || null,
        business_name: document.getElementById('custBusiness').value.trim() || null,
        address: document.getElementById('custAddress').value.trim() || null,
        city: document.getElementById('custCity').value.trim() || null,
        state: document.getElementById('custState').value.trim() || null,
        zip: document.getElementById('custZip').value.trim() || null,
        phone: document.getElementById('custPhone').value.trim() || null,
        email: document.getElementById('custEmail').value.trim() || null,
        date_of_birth: document.getElementById('custDOB').value || null,
        filing_status: document.getElementById('custFilingStatus').value || null,
        notes: document.getElementById('custNotes').value.trim() || null
    };

    const editId = document.getElementById('editCustomerId').value;

    try {
        if (editId) {
            await api(`/api/customers/${editId}`, { method: 'PUT', body: JSON.stringify(data) });
            showToast('Customer updated successfully!');
        } else {
            await api('/api/customers', { method: 'POST', body: JSON.stringify(data) });
            showToast('Customer added successfully!');
        }
        closeModal('customerModal');
        loadCustomers();
    } catch (err) {
        showToast('Error saving customer: ' + err.message, 'error');
    }
}

async function deleteCustomer(id) {
    if (!confirm('Are you sure you want to delete this customer?')) return;
    try {
        await api(`/api/customers/${id}`, { method: 'DELETE' });
        showToast('Customer deleted.');
        loadCustomers();
    } catch (err) {
        showToast('Error deleting customer: ' + err.message, 'error');
    }
}

async function viewCustomer(id) {
    try {
        const c = await api(`/api/customers/${id}`);
        const forms = await api(`/api/customers/${id}/forms`);

        document.getElementById('customerDetailTitle').textContent = `${c.last_name}, ${c.first_name}`;
        
        let html = `
            <div class="form-row" style="margin-bottom: 20px;">
                <div><strong>SSN:</strong> ${c.ssn || 'N/A'}</div>
                <div><strong>EIN:</strong> ${c.ein || 'N/A'}</div>
            </div>
            <div style="margin-bottom: 10px;"><strong>Business:</strong> ${c.business_name || 'N/A'}</div>
            <div style="margin-bottom: 10px;"><strong>Address:</strong> ${c.address || ''} ${c.city || ''} ${c.state || ''} ${c.zip || ''}</div>
            <div class="form-row" style="margin-bottom: 10px;">
                <div><strong>Phone:</strong> ${c.phone || 'N/A'}</div>
                <div><strong>Email:</strong> ${c.email || 'N/A'}</div>
            </div>
            <div class="form-row" style="margin-bottom: 20px;">
                <div><strong>DOB:</strong> ${c.date_of_birth || 'N/A'}</div>
                <div><strong>Filing Status:</strong> ${c.filing_status || 'N/A'}</div>
            </div>
            ${c.notes ? `<div style="margin-bottom: 20px;"><strong>Notes:</strong> ${c.notes}</div>` : ''}
        `;

        if (forms.length > 0) {
            html += '<h4 style="margin-bottom: 10px;">📋 Form History</h4>';
            html += '<table><thead><tr><th>Form</th><th>Date</th><th>PDF</th></tr></thead><tbody>';
            forms.forEach(f => {
                html += `<tr>
                    <td><strong>${f.form_type}</strong> ${f.form_name || ''}</td>
                    <td>${new Date(f.created_at).toLocaleDateString()}</td>
                    <td>${f.pdf_path ? `<a href="/${f.pdf_path}" target="_blank" class="btn btn-sm btn-outline">📥</a>` : '—'}</td>
                </tr>`;
            });
            html += '</tbody></table>';
        }

        document.getElementById('customerDetailBody').innerHTML = html;
        openModal('customerDetailModal');
    } catch (err) {
        showToast('Error loading customer details: ' + err.message, 'error');
    }
}

// ==================== TEMPLATES PAGE ====================
async function loadTemplates() {
    try {
        const templates = await api('/api/templates');
        allTemplates = templates;
        const tbody = document.getElementById('templatesTableBody');

        if (templates.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">📄</div><p>No templates found</p></div></td></tr>`;
            return;
        }

        tbody.innerHTML = templates.map(t => `
            <tr style="${!t.active ? 'opacity: 0.5;' : ''}">
                <td><strong>${t.form_type}</strong></td>
                <td>${t.form_name}</td>
                <td>${t.version_year || 'N/A'}</td>
                <td>
                    ${t.file_path && t.file_path !== '' 
                        ? '<span class="badge badge-success">✅ Uploaded</span>' 
                        : '<span class="badge badge-warning">⚠️ No PDF</span>'}
                </td>
                <td>
                    ${t.active 
                        ? '<span class="badge badge-success">Active</span>' 
                        : '<span class="badge badge-danger">Archived</span>'}
                </td>
                <td>${t.upload_date ? new Date(t.upload_date).toLocaleDateString() : 'N/A'}</td>
                <td>
                    <div class="actions">
                        <button class="btn btn-sm btn-success" onclick="downloadIrsPdf(${t.id}, '${t.form_type}')" title="Download from IRS.gov" id="irsBtn_${t.id}">🌐</button>
                        <button class="btn btn-sm btn-primary" onclick="showUploadForTemplate(${t.id}, '${t.form_type}')" title="Upload/Update PDF">📤</button>
                        ${t.file_path && t.file_path !== '' ? `<button class="btn btn-sm btn-outline" onclick="showFieldMappings(${t.id})" title="Map PDF Fields to Data Fields" style="background:#e8f4fd;">🔗</button>` : ''}
                        ${t.file_path && t.file_path !== '' ? `<a href="/${t.file_path}" target="_blank" class="btn btn-sm btn-outline" title="View PDF">👁️</a>` : ''}
                        ${t.active ? `<button class="btn btn-sm btn-danger" onclick="archiveTemplate(${t.id})" title="Archive">📦</button>` : ''}
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        showToast('Error loading templates: ' + err.message, 'error');
    }
}

function showAddTemplateModal() {
    document.getElementById('templateModalTitle').textContent = 'Add New Template';
    document.getElementById('uploadTemplateId').value = '';
    document.getElementById('uploadFormType').value = '';
    document.getElementById('uploadFormName').value = '';
    document.getElementById('uploadVersionYear').value = new Date().getFullYear();
    document.getElementById('uploadFileName').textContent = '';
    document.getElementById('pdfFileInput').value = '';
    document.getElementById('newTemplateTypeGroup').style.display = 'block';
    openModal('templateModal');
}

function showUploadForTemplate(id, formType) {
    document.getElementById('templateModalTitle').textContent = `Update ${formType} Template`;
    document.getElementById('uploadTemplateId').value = id;
    document.getElementById('uploadFormType').value = formType;
    document.getElementById('uploadFormName').value = '';
    document.getElementById('uploadVersionYear').value = new Date().getFullYear();
    document.getElementById('uploadFileName').textContent = '';
    document.getElementById('pdfFileInput').value = '';
    document.getElementById('newTemplateTypeGroup').style.display = 'none';
    openModal('templateModal');
}

function handleFileSelect(input) {
    if (input.files.length > 0) {
        document.getElementById('uploadFileName').textContent = input.files[0].name;
    }
}

// Drag and drop
document.addEventListener('DOMContentLoaded', () => {
    const uploadArea = document.getElementById('uploadArea');
    if (uploadArea) {
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const fileInput = document.getElementById('pdfFileInput');
            fileInput.files = e.dataTransfer.files;
            handleFileSelect(fileInput);
        });
    }
});

async function uploadTemplate() {
    const fileInput = document.getElementById('pdfFileInput');
    if (!fileInput.files.length) {
        showToast('Please select a PDF file!', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('pdf', fileInput.files[0]);
    formData.append('form_type', document.getElementById('uploadFormType').value);
    formData.append('form_name', document.getElementById('uploadFormName').value);
    formData.append('version_year', document.getElementById('uploadVersionYear').value);

    const templateId = document.getElementById('uploadTemplateId').value;
    if (templateId) {
        formData.append('template_id', templateId);
    }

    try {
        const res = await fetch('/api/templates/upload', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');

        showToast('Template uploaded successfully!');
        closeModal('templateModal');
        loadTemplates();

        // Show detected fields info
        if (data.pdfFields && data.pdfFields.length > 0) {
            showToast(`Detected ${data.pdfFields.length} form fields in PDF`, 'info');
        }
    } catch (err) {
        showToast('Error uploading template: ' + err.message, 'error');
    }
}

async function archiveTemplate(id) {
    if (!confirm('Archive this template? It will no longer be available for new forms.')) return;
    try {
        await api(`/api/templates/${id}`, { method: 'DELETE' });
        showToast('Template archived.');
        loadTemplates();
    } catch (err) {
        showToast('Error archiving template: ' + err.message, 'error');
    }
}

// ==================== IRS PDF DOWNLOAD ====================
async function downloadIrsPdf(templateId, formType) {
    const btn = document.getElementById(`irsBtn_${templateId}`);
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳';
    }
    showToast(`Downloading ${formType} from IRS.gov...`, 'info');

    try {
        const result = await api(`/api/templates/${templateId}/download-irs`, { method: 'POST' });
        showToast(result.message || `${formType} PDF downloaded successfully!`, 'success');
        if (result.pdfFields && result.pdfFields.length > 0) {
            showToast(`Detected ${result.pdfFields.length} fillable fields in ${formType}`, 'info');
        }
        loadTemplates();
    } catch (err) {
        showToast(`Failed to download ${formType}: ${err.message}`, 'error');
        if (btn) {
            btn.disabled = false;
            btn.textContent = '🌐';
        }
    }
}

async function downloadAllIrsPdfs() {
    if (!confirm('Download all missing IRS PDFs? This may take a few minutes for many templates.')) return;

    const btn = document.getElementById('btnDownloadAll');
    btn.disabled = true;
    btn.textContent = '⏳ Downloading...';
    showToast('Batch downloading PDFs from IRS.gov — please wait...', 'info');

    try {
        const result = await api('/api/templates/irs/download-all', { method: 'POST' });
        showToast(result.message, 'success');

        if (result.results.failed.length > 0) {
            showToast(`Failed: ${result.results.failed.map(f => f.form_type).join(', ')}`, 'error');
        }
        if (result.results.skipped.length > 0) {
            showToast(`Skipped (no IRS URL): ${result.results.skipped.map(f => f.form_type).join(', ')}`, 'info');
        }

        loadTemplates();
    } catch (err) {
        showToast('Batch download error: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '🌐 Download All from IRS';
    }
}

// ==================== HISTORY PAGE ====================
async function loadHistory() {
    try {
        const filterType = document.getElementById('historyFilterType').value;
        const url = filterType ? `/api/forms?form_type=${encodeURIComponent(filterType)}` : '/api/forms';
        const forms = await api(url);

        // Populate filter dropdown
        const filterSelect = document.getElementById('historyFilterType');
        if (filterSelect.options.length <= 1) {
            const types = [...new Set(forms.map(f => f.form_type))];
            types.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t;
                opt.textContent = t;
                filterSelect.appendChild(opt);
            });
        }

        const tbody = document.getElementById('historyTableBody');
        if (forms.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">📋</div><p>No forms submitted yet</p></div></td></tr>`;
            return;
        }

        tbody.innerHTML = forms.map(f => `
            <tr>
                <td>#${f.id}</td>
                <td><strong>${f.form_type}</strong></td>
                <td>${f.tax_year || 'N/A'}</td>
                <td>${f.first_name ? `${f.last_name}, ${f.first_name}` : 'N/A'}</td>
                <td><span class="badge badge-success">${f.status}</span></td>
                <td>${new Date(f.created_at).toLocaleDateString()}</td>
                <td>
                    <div class="actions">
                        ${f.pdf_path ? `<a href="/${f.pdf_path}" target="_blank" class="btn btn-sm btn-success">📥 PDF</a>` : ''}
                        <button class="btn btn-sm btn-danger" onclick="deleteSubmission(${f.id})">🗑️</button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        showToast('Error loading history: ' + err.message, 'error');
    }
}

async function deleteSubmission(id) {
    if (!confirm('Delete this form submission?')) return;
    try {
        await api(`/api/forms/${id}`, { method: 'DELETE' });
        showToast('Submission deleted.');
        loadHistory();
    } catch (err) {
        showToast('Error deleting submission: ' + err.message, 'error');
    }
}

// ==================== FIELD MAPPING ====================
let fieldMapTemplateId = null;
let fieldMapPdfFields = [];

// Our data fields that can be mapped to PDF fields
const DATA_FIELDS = [
    { key: '', label: '— Not Mapped —' },
    { key: 'first_name', label: 'First Name' },
    { key: 'last_name', label: 'Last Name' },
    { key: 'full_name', label: 'Full Name (First + Last)' },
    { key: 'ssn', label: 'SSN' },
    { key: 'ein', label: 'EIN' },
    { key: 'business_name', label: 'Business Name' },
    { key: 'address', label: 'Address' },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'zip', label: 'ZIP' },
    { key: 'city_state_zip', label: 'City, State, ZIP (combined)' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'date_of_birth', label: 'Date of Birth' },
    { key: 'filing_status', label: 'Filing Status' },
    { key: 'federal_tax_classification', label: 'Federal Tax Classification' },
    { key: 'employer_name', label: 'Employer Name' },
    { key: 'employer_ein', label: 'Employer EIN' },
    { key: 'employer_address', label: 'Employer Address' },
    { key: 'payer_name', label: 'Payer Name' },
    { key: 'payer_tin', label: 'Payer TIN' },
    { key: 'payer_address', label: 'Payer Address' },
    { key: 'wages_tips', label: 'Wages/Tips' },
    { key: 'federal_tax_withheld', label: 'Federal Tax Withheld' },
    { key: 'nonemployee_compensation', label: 'Nonemployee Compensation' },
    { key: 'account_numbers', label: 'Account Numbers' },
    { key: 'requester_name', label: 'Requester Name' },
    { key: 'certification_date', label: 'Certification Date' },
    { key: 'taxpayer_name', label: 'Taxpayer Name' },
    { key: 'taxpayer_id', label: 'Taxpayer ID' },
    { key: 'representative_name', label: 'Representative Name' },
    { key: 'designee_name', label: 'Designee Name' },
    { key: 'tax_matters', label: 'Tax Matters' },
    { key: 'tax_form_number', label: 'Tax Form Number' },
    { key: 'tax_years', label: 'Tax Years/Periods' },
    { key: 'client_name', label: 'Client Name' },
    { key: 'services_description', label: 'Services Description' },
    { key: 'fee_arrangement', label: 'Fee Arrangement' },
    { key: 'engagement_date', label: 'Engagement Date' },
    { key: 'firm_name', label: 'Firm Name' },
];

async function showFieldMappings(templateId) {
    fieldMapTemplateId = templateId;
    document.getElementById('fieldMapContent').innerHTML = '<div class="loading"><div class="spinner"></div> Loading PDF fields...</div>';
    openModal('fieldMapModal');

    try {
        const data = await api(`/api/templates/${templateId}/fields`);
        const template = await api(`/api/templates/${templateId}`);
        fieldMapPdfFields = data.fields || [];
        const currentMappings = data.mappings || {};

        document.getElementById('fieldMapTitle').textContent = `Map Fields — ${template.form_type}`;

        if (fieldMapPdfFields.length === 0) {
            document.getElementById('fieldMapContent').innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📄</div>
                    <p>This PDF has no fillable form fields.</p>
                    <p style="color: var(--text-light);">The system will generate a data summary page instead.</p>
                </div>`;
            return;
        }

        // Build reverse map: find which data_key maps to which pdf_field
        // currentMappings format: { data_key: pdf_field_name_or_same_key }
        const pdfFieldToDataKey = {};
        for (const [dataKey, pdfField] of Object.entries(currentMappings)) {
            if (pdfField && pdfField !== dataKey) {
                pdfFieldToDataKey[pdfField] = dataKey;
            }
        }

        let html = `<p style="margin-bottom:10px; color: var(--text-light);">${fieldMapPdfFields.length} PDF fields found. Map each to your data field:</p>`;
        html += '<table style="width:100%;"><thead><tr><th style="width:50%;">PDF Field Name</th><th>Field Type</th><th style="width:35%;">Maps To →</th></tr></thead><tbody>';

        for (const field of fieldMapPdfFields) {
            const currentMap = pdfFieldToDataKey[field.name] || '';
            const shortName = field.name.replace(/^topmostSubform\[0\]\.Page\d+\[0\]\./, '').replace(/\[\d+\]$/g, '');

            html += `<tr>
                <td title="${field.name}" style="font-family: monospace; font-size: 11px; word-break: break-all;">${shortName}</td>
                <td><span class="badge badge-${field.type === 'PDFTextField' ? 'primary' : 'success'}" style="font-size:10px;">${field.type.replace('PDF','')}</span></td>
                <td>
                    <select class="form-control" data-pdf-field="${field.name}" style="font-size: 12px; padding: 4px;">
                        ${DATA_FIELDS.map(df => `<option value="${df.key}" ${df.key === currentMap ? 'selected' : ''}>${df.label}</option>`).join('')}
                    </select>
                </td>
            </tr>`;
        }

        html += '</tbody></table>';
        document.getElementById('fieldMapContent').innerHTML = html;
    } catch (err) {
        document.getElementById('fieldMapContent').innerHTML = `<div class="alert" style="color:red;">Error: ${err.message}</div>`;
        showToast('Error loading fields: ' + err.message, 'error');
    }
}

function autoDetectMappings() {
    // Heuristic: try to auto-match PDF field names to our data fields
    const selects = document.querySelectorAll('#fieldMapContent select[data-pdf-field]');
    let matched = 0;

    const patterns = [
        { regex: /first.?name|fname|given/i, key: 'first_name' },
        { regex: /last.?name|lname|surname|family/i, key: 'last_name' },
        { regex: /full.?name|your.?name|taxpayer.?name|^name$/i, key: 'full_name' },
        { regex: /business.?name|company|entity|dba/i, key: 'business_name' },
        { regex: /social.?sec|ssn/i, key: 'ssn' },
        { regex: /employer.*id|^ein$/i, key: 'ein' },
        { regex: /street|address.*1|mailing|address.*line/i, key: 'address' },
        { regex: /\bcity\b/i, key: 'city' },
        { regex: /\bstate\b/i, key: 'state' },
        { regex: /\bzip\b|postal/i, key: 'zip' },
        { regex: /city.*state.*zip/i, key: 'city_state_zip' },
        { regex: /phone|telephone/i, key: 'phone' },
        { regex: /email/i, key: 'email' },
        { regex: /date.*birth|dob/i, key: 'date_of_birth' },
        { regex: /filing.?status/i, key: 'filing_status' },
        { regex: /tax.?class|federal.?tax/i, key: 'federal_tax_classification' },
        { regex: /employer.*name/i, key: 'employer_name' },
        { regex: /payer.*name/i, key: 'payer_name' },
        { regex: /wages|compensation/i, key: 'wages_tips' },
        { regex: /fed.*withh/i, key: 'federal_tax_withheld' },
        { regex: /account/i, key: 'account_numbers' },
        { regex: /requester/i, key: 'requester_name' },
    ];

    selects.forEach(select => {
        if (select.value) return; // Already mapped, skip
        const pdfField = select.dataset.pdfField.toLowerCase();
        for (const p of patterns) {
            if (p.regex.test(pdfField)) {
                select.value = p.key;
                select.style.backgroundColor = '#e8f5e9';
                matched++;
                break;
            }
        }
    });

    showToast(`Auto-detected ${matched} field mappings. Review and save.`, matched > 0 ? 'success' : 'info');
}

async function saveFieldMappings() {
    if (!fieldMapTemplateId) return;

    // Build mappings: { data_key: pdf_field_name }
    const mappings = {};
    const selects = document.querySelectorAll('#fieldMapContent select[data-pdf-field]');

    selects.forEach(select => {
        const pdfFieldName = select.dataset.pdfField;
        const dataKey = select.value;
        if (dataKey) {
            mappings[dataKey] = pdfFieldName;
        }
    });

    try {
        await api(`/api/templates/${fieldMapTemplateId}/mappings`, {
            method: 'PUT',
            body: JSON.stringify({ field_mappings: mappings })
        });
        showToast('Field mappings saved! PDF generation will now use these mappings.', 'success');
        closeModal('fieldMapModal');
    } catch (err) {
        showToast('Error saving mappings: ' + err.message, 'error');
    }
}

// ==================== FIRM PROFILE ====================
// Map of HTML element IDs to database column names
const FIRM_PROFILE_FIELDS = {
    fpFirmName:        'firm_name',
    fpFirmAddress:     'firm_address',
    fpFirmCity:        'firm_city',
    fpFirmState:       'firm_state',
    fpFirmZip:         'firm_zip',
    fpFirmPhone:       'firm_phone',
    fpFirmFax:         'firm_fax',
    fpFirmEmail:       'firm_email',
    fpFirmEin:         'firm_ein',
    fpFirmPtin:        'firm_ptin',
    fpRepName:         'representative_name',
    fpRepAddress:      'representative_address',
    fpRepPhone:        'representative_phone',
    fpRepFax:          'representative_fax',
    fpRepPtin:         'representative_ptin',
    fpCafNumber:       'caf_number',
    fpRepDesignation:  'representative_designation',
    fpRepJurisdiction: 'representative_jurisdiction',
    fpRepBarNumber:    'representative_bar_number',
    fpPreparerName:    'preparer_name',
    fpPreparerTitle:   'preparer_title',
};

async function loadFirmProfile() {
    try {
        const profile = await api('/api/firm-profile');
        // Populate all form fields from profile data
        for (const [elementId, dbColumn] of Object.entries(FIRM_PROFILE_FIELDS)) {
            const el = document.getElementById(elementId);
            if (el) {
                el.value = profile[dbColumn] || '';
            }
        }
        showToast('Firm profile loaded', 'info');
    } catch (err) {
        showToast('Error loading firm profile: ' + err.message, 'error');
    }
}

async function saveFirmProfile() {
    const data = {};
    for (const [elementId, dbColumn] of Object.entries(FIRM_PROFILE_FIELDS)) {
        const el = document.getElementById(elementId);
        if (el) {
            data[dbColumn] = el.value.trim() || null;
        }
    }

    try {
        await api('/api/firm-profile', {
            method: 'PUT',
            body: JSON.stringify(data)
        });
        showToast('Firm profile saved successfully!', 'success');
    } catch (err) {
        showToast('Error saving firm profile: ' + err.message, 'error');
    }
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
    loadDashboard();
});
