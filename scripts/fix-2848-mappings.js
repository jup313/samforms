#!/usr/bin/env node
/**
 * Fix 2848 field_mappings in the database
 * Run this after deployment to update the server DB
 */
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'database', 'irs_forms.db');
const db = new Database(dbPath);

const correctMappings = {
    'full_name': 'topmostSubform[0].Page1[0].TaxpayerName[0]',
    'full_address': 'topmostSubform[0].Page1[0].TaxpayerAddress[0]',
    'ssn': 'topmostSubform[0].Page1[0].TaxpayerIDSSN[0]',
    'ein': 'topmostSubform[0].Page1[0].TaxpayerIDEIN[0]',
    'phone': 'topmostSubform[0].Page1[0].TaxpayerTelephone[0]',
    'plan_number': 'topmostSubform[0].Page1[0].TaxpayerPlanNumber[0]',
    'representative_name': 'topmostSubform[0].Page1[0].RepresentativesName1[0]',
    'representative_address': 'topmostSubform[0].Page1[0].RepresentativesAddress1[0]',
    'caf_number': 'topmostSubform[0].Page1[0].CAFNumber1[0]',
    'representative_ptin': 'topmostSubform[0].Page1[0].PTIN1[0]',
    'representative_phone': 'topmostSubform[0].Page1[0].TelephoneNo1[0]',
    'representative_fax': 'topmostSubform[0].Page1[0].FaxNo1[0]',
    'tax_matters': 'topmostSubform[0].Page1[0].Table_Line3[0].BodyRow1[0].Description1[0]',
    'tax_form_number': 'topmostSubform[0].Page1[0].Table_Line3[0].BodyRow1[0].TaxForm1[0]',
    'tax_years': 'topmostSubform[0].Page1[0].Table_Line3[0].BodyRow1[0].Years1[0]',
    'specific_acts': 'topmostSubform[0].Page1[0].AdditionalActs1[0]',
    'specific_deletions': 'topmostSubform[0].Page2[0].SpecificDeletions1[0]',
    'full_name_p2': 'topmostSubform[0].Page2[0].PrintName[0]',
    'full_name_taxpayer_p2': 'topmostSubform[0].Page2[0].PrintNameTaxpayer[0]',
    'representative_designation': 'topmostSubform[0].Page2[0].Table_PartII[0].BodyRow1[0].Designation1[0]',
    'representative_jurisdiction': 'topmostSubform[0].Page2[0].Table_PartII[0].BodyRow1[0].Jurisdiction1[0]',
    'representative_bar_number': 'topmostSubform[0].Page2[0].Table_PartII[0].BodyRow1[0].Bar1[0]'
};

const result = db.prepare('UPDATE templates SET field_mappings = ? WHERE form_type = ?')
    .run(JSON.stringify(correctMappings), '2848');

console.log(`Updated 2848 field_mappings: ${result.changes} row(s) affected`);

// Verify
const t = db.prepare("SELECT field_mappings FROM templates WHERE form_type = '2848'").get();
if (t) {
    const fm = JSON.parse(t.field_mappings);
    console.log(`Verified: ${Object.keys(fm).length} mappings set`);
} else {
    console.log('WARNING: No 2848 template found in database');
}

db.close();
