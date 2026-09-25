import fs from 'fs';
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'conveyhub_isolated',
  user: process.env.DB_USER || 'legitify',
  password: process.env.DB_PASSWORD || 'legitify_dev',
});

function parseCSV(text) {
  const lines = text.split('\n');
  const rows = [];
  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;
    const row = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < rawLine.length; i++) {
      const c = rawLine[i];
      if (c === '"' && (i === 0 || rawLine[i - 1] !== '\\')) {
        inQuotes = !inQuotes;
      } else if (c === ',' && !inQuotes) {
        row.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    row.push(cur.trim());
    rows.push(row);
  }
  return rows;
}

// Map column index to canonical classification code from migration 015
const CLASSIFICATION_MAP = {
  2: 'transfer.private_treaty.not_applicable',          // Private Treaty - freehold
  3: 'transfer.private_treaty.sectional_title_register',// Private Treaty - Sectional Title Register
  4: 'transfer.private_treaty.township_register',       // Private Treaty - Township Register
  5: 'transfer.private_treaty.extension_of_scheme',     // Private Treaty - Extension of Scheme
  6: 'transfer.private_treaty.subdivision',             // Private Treaty - Subdivision
  7: 'transfer.private_treaty.bulk_transfer',           // Private Treaty - Bulk Transfer
  8: 'transfer.auction',                                // Auction
  9: 'transfer.sale_in_execution',                      // Sale in Execution
  10: 'transfer.property_in_possession',                // Property in Possession
  11: 'transfer.deceased_estate_inheritance',           // Deceased Estate - Inheritance
  12: 'transfer.deceased_estate_sale',                  // Deceased Estate - Sale
  13: 'transfer.endorsement_section_45',                 // Endorsement - Section 45
  14: 'transfer.endorsement_section_45bis',              // Endorsement - Section 45bis
  15: 'transfer.donation',                              // Donation
  16: 'development.new_sectional_title_register',       // New Sectional Title Register
  17: 'development.new_township_register_establishment',// New Township Register / Establishment
  18: 'development.scheme_extension_sections',          // Scheme Extension (Sections)
  19: 'development.subdivision',                        // Subdivision
};

const GENERATED_DOC_IDS = new Set([
  'DOC-030', 'DOC-031', 'DOC-032', 'DOC-033', 'DOC-034',
  'DOC-035', 'DOC-036', 'DOC-037', 'DOC-038', 'DOC-039',
  'DOC-040', 'DOC-041', 'DOC-042', 'DOC-043', 'DOC-044',
  'DOC-071', 'DOC-076', 'DOC-077', 'DOC-078'
]);

function getCategory(docId, name) {
  const num = parseInt(docId.replace(/\D/g, ''), 10) || 0;
  if (num >= 1 && num <= 16) return 'fica_kyc';
  if (num >= 17 && num <= 22) return 'commercial_contracts';
  if ((num >= 23 && num <= 27) || num === 61 || num === 62 || num === 73 || num === 74) return 'estate_succession';
  if (num === 28 || num === 29 || num === 84) return 'auction_execution';
  if (num >= 30 && num <= 43) return 'conveyancing_deeds';
  if (num === 44 || num === 45) return 'municipal_rates';
  if (num === 46 || name.toLowerCase().includes('body corporate')) return 'sectional_title';
  if (num === 47) return 'property_clearances';
  if (num === 48 || num === 72) return 'statutory_tax';
  if ((num >= 49 && num <= 53) || num === 63 || num === 79) return 'mortgage_finance';
  if (num === 54) return 'deeds_office';
  if (num >= 55 && num <= 59) return 'compliance_certificates';
  if (num === 60) return 'property_valuation';
  if (num >= 64 && num <= 71) return 'development_sectional';
  if (num >= 75 && num <= 80) return 'development_sectional';
  if (num === 81) return 'suspensive_conditions';
  if (num === 82) return 'registration';
  if (num === 83) return 'statutory_tax';
  if (num === 85) return 'bulk_transfers';
  if (num === 86) return 'court_orders';
  return 'general';
}

function cleanDocName(name) {
  return name
    .replace(/ - leave out\s*$/i, '')
    .replace(/ - Required\s*$/i, '')
    .replace(/ - \s*$/i, '')
    .replace(/[^\x00-\x7F]/g, '—')
    .trim();
}

async function run() {
  const client = await pool.connect();
  try {
    const csvContent = fs.readFileSync('docs/DEEDLY_Required_Documents_Register 1(Requirements).csv', 'utf8');
    const parsed = parseCSV(csvContent);

    console.log('Connecting to database...');
    await client.query('SET search_path TO transfers, public');

    let docCount = 0;
    let ruleCount = 0;

    await client.query('BEGIN');

    for (let i = 7; i < parsed.length; i++) {
      const row = parsed[i];
      let docId = row[0];
      let docName = row[1];
      if (!docName) continue;

      if (!docId && docName.includes('Body corporate levy clearance Certificate')) {
        docId = 'DOC-046b';
      }
      if (!docId) continue;

      const code = docId.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const cleanName = cleanDocName(docName);
      const isLeaveOut = docName.toLowerCase().includes('leave out');
      const category = getCategory(docId, cleanName);
      const fulfillmentType = GENERATED_DOC_IDS.has(docId) ? 'GENERATED' : 'COLLECTED';
      const outputFormats = fulfillmentType === 'GENERATED' ? ['pdf', 'docx'] : ['pdf'];

      // 1. Upsert document definition
      await client.query(
        `
        INSERT INTO transfers.document_definitions (
          code, name, category, fulfillment_type, default_output_formats, description, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (code) DO UPDATE SET
          name = EXCLUDED.name,
          category = EXCLUDED.category,
          fulfillment_type = EXCLUDED.fulfillment_type,
          default_output_formats = EXCLUDED.default_output_formats,
          is_active = EXCLUDED.is_active
        `,
        [code, cleanName, category, fulfillmentType, outputFormats, `${docId}: ${cleanName}`, !isLeaveOut]
      );
      docCount++;

      // 2. Process classification requirements (columns 2 to 19)
      for (const [colIdx, classCode] of Object.entries(CLASSIFICATION_MAP)) {
        const statusVal = (row[colIdx] || '').trim();
        if (!statusVal || statusVal.toLowerCase() === 'not applicable') {
          continue;
        }

        const ruleCode = `rule.${code}.${classCode.replace(/\./g, '_')}`;
        let nature = 'CONDITIONAL';
        if (statusVal.toLowerCase() === 'required') {
          nature = 'MANDATORY';
        } else if (statusVal.toLowerCase() === 'optional') {
          nature = 'OPTIONAL';
        }

        const condition = {
          classification_code: classCode
        };

        const ruleTitle = `${cleanName} (${nature}) for ${classCode}`;

        await client.query(
          `
          INSERT INTO transfers.document_requirement_rules (
            rule_code, document_code, title, condition_expression, requirement_nature, priority, is_active
          ) VALUES ($1, $2, $3, $4, $5, 100, $6)
          ON CONFLICT (rule_code) DO UPDATE SET
            document_code = EXCLUDED.document_code,
            title = EXCLUDED.title,
            condition_expression = EXCLUDED.condition_expression,
            requirement_nature = EXCLUDED.requirement_nature,
            is_active = EXCLUDED.is_active
          `,
          [ruleCode, code, ruleTitle, JSON.stringify(condition), nature, !isLeaveOut]
        );
        ruleCount++;
      }
    }

    await client.query('COMMIT');
    console.log(`✅ Successfully seeded ${docCount} document definitions and ${ruleCount} classification requirement rules into PostgreSQL!`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed seeding documents from register:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
