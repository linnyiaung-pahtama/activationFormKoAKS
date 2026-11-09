-- =============================================================================
-- Check that the app saved data correctly.
-- Run in SSMS (database PLS) right after pressing "Submit Survey" in the app.
-- Every "CHECK" row should say OK.
-- =============================================================================
USE [PLS];
SET NOCOUNT ON;

-- 1. The 5 most recent visits (your new one should be on top)
SELECT TOP 5
    id, invoice_no, activation_date, created_at, seller_username,
    retailer_store_name, wholesale_store_name, township,
    CASE WHEN sales_status = 1 THEN 'Sale' ELSE 'No sale' END AS sale,
    total_paid_qty, total_foc_qty, grand_total_mmk
FROM dbo.noodle_activations
ORDER BY created_at DESC;

-- 2. Product lines of the newest visit (made automatically by the trigger)
DECLARE @latest NVARCHAR(100) = (SELECT TOP 1 id FROM dbo.noodle_activations ORDER BY created_at DESC);

SELECT sku_code, sku_name, unit_price, paid_qty, foc_qty, total_qty, line_total_mmk
FROM dbo.noodle_activation_sku_details
WHERE activation_id = @latest
ORDER BY sku_code;

-- 3. Automatic checks on the newest visit
SELECT check_name, result FROM (
    SELECT 1 AS n, 'Has SKU detail rows' AS check_name,
           CASE WHEN EXISTS (SELECT 1 FROM dbo.noodle_activation_sku_details WHERE activation_id = @latest)
                THEN 'OK' ELSE 'PROBLEM: no detail rows' END AS result
    UNION ALL
    SELECT 2, 'Grand total = sum of product lines',
           CASE WHEN a.sales_status = 0 OR a.grand_total_mmk =
                     (SELECT COALESCE(SUM(line_total_mmk), 0) FROM dbo.noodle_activation_sku_details WHERE activation_id = a.id)
                THEN 'OK' ELSE 'PROBLEM: totals differ' END
    FROM dbo.noodle_activations a WHERE a.id = @latest
    UNION ALL
    SELECT 3, 'Paid qty = sum of product lines',
           CASE WHEN a.total_paid_qty =
                     (SELECT COALESCE(SUM(paid_qty), 0) FROM dbo.noodle_activation_sku_details WHERE activation_id = a.id)
                THEN 'OK' ELSE 'PROBLEM: paid qty differs' END
    FROM dbo.noodle_activations a WHERE a.id = @latest
    UNION ALL
    SELECT 4, 'FOC qty = sum of product lines',
           CASE WHEN a.total_foc_qty =
                     (SELECT COALESCE(SUM(foc_qty), 0) FROM dbo.noodle_activation_sku_details WHERE activation_id = a.id)
                THEN 'OK' ELSE 'PROBLEM: FOC qty differs' END
    FROM dbo.noodle_activations a WHERE a.id = @latest
    UNION ALL
    SELECT 5, 'Backup copy saved in user_locations',
           CASE WHEN EXISTS (SELECT 1 FROM dbo.user_locations WHERE id = @latest)
                THEN 'OK' ELSE 'PROBLEM: no backup copy' END
    UNION ALL
    SELECT 6, 'Myanmar text not broken (no ? marks)',
           CASE WHEN a.retailer_store_name + a.wholesale_store_name + a.full_address NOT LIKE N'%??%'
                THEN 'OK' ELSE 'PROBLEM: text shows ??' END
    FROM dbo.noodle_activations a WHERE a.id = @latest
) x ORDER BY n;

-- 4. Whole-database health checks (should all be 0)
SELECT
    (SELECT COUNT(*) FROM dbo.noodle_activations a
      WHERE NOT EXISTS (SELECT 1 FROM dbo.noodle_activation_sku_details d WHERE d.activation_id = a.id))
        AS visits_without_detail_rows,
    (SELECT COUNT(*) FROM dbo.noodle_activations a
      WHERE a.sales_status = 1 AND a.grand_total_mmk <>
            (SELECT COALESCE(SUM(line_total_mmk), 0) FROM dbo.noodle_activation_sku_details d WHERE d.activation_id = a.id))
        AS sales_with_wrong_total,
    (SELECT COUNT(*) FROM dbo.user_locations l
      WHERE l.id LIKE N'act-%' AND NOT EXISTS (SELECT 1 FROM dbo.noodle_activations a WHERE a.id = l.id))
        AS visits_only_in_backup,
    (SELECT COUNT(*) FROM (SELECT invoice_no FROM dbo.noodle_activations GROUP BY invoice_no HAVING COUNT(*) > 1) d)
        AS duplicate_invoice_numbers;

-- 5. Totals (compare with the admin dashboard: Total Activations / Total Net Revenue)
SELECT COUNT(*) AS total_activations,
       SUM(grand_total_mmk) AS total_mmk,
       SUM(total_paid_qty) AS total_paid_packs,
       SUM(total_foc_qty) AS total_foc_packs
FROM dbo.noodle_activations;
