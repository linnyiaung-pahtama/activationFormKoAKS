/**
 * Smoke test for the SQL Server data API.
 * Start the app first (npm run dev), then:  npx tsx sqlserver/api_smoke_test.ts
 * Uses the same client the browser uses. Creates a TEST record and removes it.
 */
import { createHttpExecutor, createSqlServerClient } from '../src/lib/sqlServerClient.ts';

const base = process.env.APP_URL || 'http://127.0.0.1:3000';
const db = createSqlServerClient(createHttpExecutor(`${base}/api/db`));
let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info !== undefined ? '  ' + JSON.stringify(info) : ''}`);
  if (!ok) failures++;
};

const TEST_ID = `act-TEST-${Date.now()}`;
const TEST_USER = `zz_test_${Date.now()}`;

async function main() {
  // --- reads -----------------------------------------------------------------
  const c = await db.from('app_users').select('id, username', { count: 'exact' });
  check('count app_users', !c.error && c.count === 29 && c.data.length === 29, { count: c.count, error: c.error });

  const before = await db.from('noodle_activations').select('id', { count: 'exact', head: true });
  const total = before.count ?? 0;
  const p = await db.from('noodle_activations').select('*').range(1000, 1999).order('created_at', { ascending: false });
  const expectedPage = Math.max(0, Math.min(1000, total - 1000));
  check(`paging rows 1000-1999 of ${total} activations`, !p.error && p.data.length === expectedPage, { rows: p.data?.length, error: p.error });
  const a0 = p.data?.[0];
  check('items returned as array', Array.isArray(a0?.items), typeof a0?.items);
  check('activation_date as YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(a0?.activation_date), a0?.activation_date);
  check('sales_status is boolean', typeof a0?.sales_status === 'boolean');

  const u = await db.from('app_users').select('*').ilike('username', 'SELLER4').maybeSingle();
  check('ilike + maybeSingle (case-insensitive)', !u.error && u.data?.username === 'seller4', u.data?.username);

  const none = await db.from('app_users').select('*').eq('username', 'nobody-here').maybeSingle();
  check('maybeSingle with no row -> null', !none.error && none.data === null);

  const w = await db.from('wholesale_stores').select('id, name').eq('active', true).order('sort_order', { ascending: true }).order('name', { ascending: true }).range(0, 999);
  check('wholesale stores (Myanmar names)', !w.error && w.data.length === 49 && w.data.some((s: any) => s.name.includes('ကိုသိန်းဝင်း')), w.data?.length);

  const cfg = await db.from('user_locations').select('payload').eq('id', 'config_product_master_skus').maybeSingle();
  check('config row lookup', !cfg.error, cfg.error);

  // --- writes on a temporary activation -------------------------------------
  const items = [
    { skuId: 'chicken_sichat_52g', skuName: 'Chicken Sichat', quantity: 3, focQuantity: 1, unitPrice: 735, focPrice: 0, lineTotal: 2205 },
    { skuId: 'tom_yum_55g', skuName: 'Tom Yum', quantity: 0, focQuantity: 0, unitPrice: 810, focPrice: 0, lineTotal: 0 },
  ];
  const up = await db.from('noodle_activations').upsert([{
    id: TEST_ID, invoice_no: 'INV-TEST', activation_date: '2026-11-05', created_at: new Date().toISOString(),
    branch: 'Yangon', wholesale_store_name: 'ကိုသိန်းဝင်း-C00111688', retailer_store_name: 'စမ်းသပ်ဆိုင်', township: 'Hlaing',
    sales_status: true, seller_username: 'seller4', seller_name: 'Test', route_code: 'RT-TEST', items,
    total_paid_qty: 3, total_foc_qty: 1, grand_total_mmk: 2205, unknown_column_should_be_ignored: 1,
  }], { onConflict: 'id' }).select();
  check('upsert activation + .select()', !up.error && up.data?.[0]?.id === TEST_ID && up.data?.[0]?.retailer_store_name === 'စမ်းသပ်ဆိုင်', up.error);

  const d1 = await db.from('noodle_activation_sku_details').select('id, paid_qty, foc_qty, line_total_mmk').eq('activation_id', TEST_ID);
  check('trigger created 1 SKU detail row', !d1.error && d1.data.length === 1 && d1.data[0].paid_qty === 3, d1.data);

  const up2 = await db.from('noodle_activations').upsert([{ id: TEST_ID, invoice_no: 'INV-TEST', seller_username: 'seller4', seller_name: 'Test', route_code: 'RT-TEST', sales_status: false, items: '[]', non_covered_reason: 'Out of Stock' }], { onConflict: 'id' });
  const d2 = await db.from('noodle_activation_sku_details').select('id, sales_status').eq('activation_id', TEST_ID);
  check('upsert existing -> no_sale detail row', !up2.error && d2.data?.length === 1 && d2.data[0].id === `${TEST_ID}_no_sale`, { err: up2.error, rows: d2.data });

  const kept = await db.from('noodle_activations').select('retailer_store_name, created_at').eq('id', TEST_ID).single();
  check('upsert keeps columns not sent', kept.data?.retailer_store_name === 'စမ်းသပ်ဆိုင်', kept.data);

  const upd = await db.from('noodle_activations').update({ remarks: 'updated by smoke test' }).eq('id', TEST_ID);
  const r3 = await db.from('noodle_activations').select('remarks').eq('id', TEST_ID).single();
  check('update', !upd.error && r3.data?.remarks === 'updated by smoke test', upd.error);

  const del = await db.from('noodle_activations').delete().eq('id', TEST_ID);
  const d4 = await db.from('noodle_activation_sku_details').select('id').eq('activation_id', TEST_ID);
  check('delete cascades to SKU details', !del.error && d4.data?.length === 0, del.error);

  // --- app_users: insert without id (DB generates UUID), upsert by username ---
  const ins = await db.from('app_users').insert([{ username: TEST_USER, password: 'x', full_name: 'Smoke Test', role: 'seller', active: true }]).select();
  check('insert user without id -> uuid', !ins.error && /^[0-9a-f-]{36}$/.test(ins.data?.[0]?.id), ins.error ?? ins.data?.[0]?.id);
  const ups = await db.from('app_users').upsert([{ username: TEST_USER, full_name: 'Smoke Test 2' }], { onConflict: 'username' }).select();
  check('upsert user by username', !ups.error && ups.data?.[0]?.full_name === 'Smoke Test 2', ups.error);
  const bad = await db.from('app_users').insert([{ username: TEST_USER, password: 'x', role: 'seller' }]);
  check('duplicate username -> 23505 error', bad.error?.code === '23505', bad.error?.code);
  await db.from('app_users').delete().eq('username', TEST_USER);

  // --- safety ---------------------------------------------------------------
  const noWhere = await db.from('noodle_activations').delete();
  check('delete without filter is refused', Boolean(noWhere.error), noWhere.error?.message);
  const badTable = await db.from('sys.objects').select('*');
  check('unknown table is refused', Boolean(badTable.error), badTable.error?.message);
  const badCol = await db.from('app_users').select('password; DROP TABLE x');
  check('unknown column is refused', Boolean(badCol.error), badCol.error?.message);

  const after = await db.from('noodle_activations').select('id', { count: 'exact', head: true });
  check(`activation count back to ${total}`, after.count === total, after.count);

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
