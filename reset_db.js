'use strict';
require('dotenv').config();
const { db, supabaseAdmin } = require('./backend/db');
const { seed } = require('./backend/seed');
const { BUCKET } = require('./backend/storage');

// SAFETY GUARD: reset_db wipes the ENTIRE database pointed to by .env (which is the
// live production Supabase). It may only run against a disposable test database and
// only when explicitly requested with the --demo flag.
if (!process.argv.includes('--demo')) {
  console.error('REFUSED: reset_db menghapus seluruh database yang ditunjuk .env (production).');
  console.error('Hanya jalankan terhadap database testing terpisah dengan flag eksplisit: node reset_db.js --demo');
  process.exit(1);
}

const TABLES = ['users','tokens','customers','customer_contacts','equipment','tickets','ticket_status_history','ticket_timeline','work_orders','checklist_templates','checklist_template_items','checklist_responses','diagnoses','work_performed','parts','part_usages','expenses','attachments','service_reports','invoice_items','invoices','payments','wallet_transactions','wallet_accounts','payment_orders','finance_income','notifications','audit_logs','settings'];

(async () => {
  console.log('[1/4] Truncating tables...');
  await db.query('TRUNCATE TABLE ' + TABLES.join(', ') + ' CASCADE');
  console.log('      done');

  console.log('[2/4] Deleting Supabase auth users...');
  let page = 1, deleted = 0;
  for (;;) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error('listUsers: ' + error.message);
    const users = data.users || [];
    if (!users.length) break;
    for (const u of users) {
      const { error: e2 } = await supabaseAdmin.auth.admin.deleteUser(u.id);
      if (e2) console.log('      warn delete', u.email, e2.message); else deleted++;
    }
    if (users.length < 100) break;
    page++;
  }
  console.log('      deleted', deleted, 'auth users');

  console.log('[3/4] Cleaning Supabase Storage bucket...');
  try {
    const { data: files } = await supabaseAdmin.storage.from(BUCKET).list();
    if (files && files.length) {
      await supabaseAdmin.storage.from(BUCKET).remove(files.map((f) => f.name));
      console.log('      removed', files.length, 'files');
    } else {
      console.log('      bucket empty');
    }
  } catch (e) {
    console.log('      warn:', e.message);
  }

  console.log('[4/4] Reseeding...');
  const seeded = await seed();
  console.log('      seeded =', seeded);
  console.log('RESET COMPLETE');
  process.exit(0);
})().catch((e) => { console.error('RESET FAILED:', e.message); process.exit(1); });
