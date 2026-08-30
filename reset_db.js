'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { db, supabase, DATA_DIR } = require('./backend/db');
const { seed } = require('./backend/seed');

const TABLES = ['users','tokens','customers','customer_contacts','equipment','tickets','ticket_status_history','ticket_timeline','work_orders','checklist_templates','checklist_template_items','checklist_responses','diagnoses','work_performed','parts','part_usages','attachments','service_reports','invoices','payments','notifications','audit_logs','settings'];

(async () => {
  console.log('[1/4] Truncating tables...');
  await db.query('TRUNCATE TABLE ' + TABLES.join(', ') + ' CASCADE');
  console.log('      done');

  console.log('[2/4] Deleting Supabase auth users...');
  let page = 1, deleted = 0;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error('listUsers: ' + error.message);
    const users = data.users || [];
    if (!users.length) break;
    for (const u of users) {
      const { error: e2 } = await supabase.auth.admin.deleteUser(u.id);
      if (e2) console.log('      warn delete', u.email, e2.message); else deleted++;
    }
    if (users.length < 100) break;
    page++;
  }
  console.log('      deleted', deleted, 'auth users');

  console.log('[3/4] Cleaning uploads dir...');
  const up = path.join(DATA_DIR, 'uploads');
  try { for (const f of fs.readdirSync(up)) fs.unlinkSync(path.join(up, f)); } catch {}
  console.log('      done');

  console.log('[4/4] Reseeding...');
  const seeded = await seed();
  console.log('      seeded =', seeded);
  console.log('RESET COMPLETE');
  process.exit(0);
})().catch((e) => { console.error('RESET FAILED:', e.message); process.exit(1); });
