-- =============================================================================
-- Repair: sales visits that exist only in user_locations (the app's backup copy)
-- but are missing from noodle_activations.
--
-- Found 2026-11-05 after importing the Supabase export: 7 records,
-- 237,950 MMK. The app's dashboard merges both tables, so it showed them, but
-- the itemized/Excel export (built from noodle_activations) did not.
--
-- What it does: rebuilds each missing activation from user_locations.payload
-- (the full record the phone saved) and inserts it. The trigger then creates
-- its SKU detail rows. Only inserts; never changes or deletes existing rows.
-- Safe to run again (inserts nothing the second time).
--
-- Undo: DELETE FROM dbo.noodle_activations WHERE id IN (<ids printed below>);
-- =============================================================================
USE [PLS];
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @restored TABLE (id NVARCHAR(100), invoice_no NVARCHAR(50), seller_username NVARCHAR(100), activation_date DATE, grand_total_mmk DECIMAL(14,2));

;WITH missing AS (
    SELECT l.id, JSON_QUERY(l.payload, '$.activation') AS a
    FROM dbo.user_locations AS l
    WHERE l.id LIKE N'act-%'
      AND ISJSON(l.payload) = 1
      AND JSON_VALUE(l.payload, '$.activation.id') = l.id
      AND NOT EXISTS (SELECT 1 FROM dbo.noodle_activations AS n WHERE n.id = l.id)
),
rec AS (
    SELECT m.id, m.a, j.*
    FROM missing AS m
    CROSS APPLY OPENJSON(m.a) WITH (
        invoiceNo           NVARCHAR(50)   '$.invoiceNo',
        activationDate      DATE           '$.activationDate',
        createdAt           DATETIMEOFFSET '$.createdAt',
        branch              NVARCHAR(50)   '$.branch',
        wholesaleStoreName  NVARCHAR(300)  '$.wholesaleStoreName',
        pgCover             NVARCHAR(10)   '$.pgCover',
        retailerStoreName   NVARCHAR(300)  '$.retailerStoreName',
        outletType          NVARCHAR(100)  '$.outletType',
        phoneNumber         NVARCHAR(50)   '$.phoneNumber',
        addressNo           NVARCHAR(100)  '$.addressNo',
        addressStreet       NVARCHAR(200)  '$.addressStreet',
        addressWard         NVARCHAR(200)  '$.addressWard',
        township            NVARCHAR(200)  '$.township',
        fullAddress         NVARCHAR(1000) '$.fullAddress',
        salesStatus         BIT            '$.salesStatus',
        pricingMode         NVARCHAR(30)   '$.pricingMode',
        coveredStatus       BIT            '$.coveredStatus',
        nonCoveredReason    NVARCHAR(500)  '$.nonCoveredReason',
        sellerUsername      NVARCHAR(100)  '$.sellerUsername',
        sellerName          NVARCHAR(200)  '$.sellerName',
        routeCode           NVARCHAR(50)   '$.routeCode',
        supervisorUsername  NVARCHAR(100)  '$.supervisorUsername',
        managerUsername     NVARCHAR(100)  '$.managerUsername',
        regionScope         NVARCHAR(200)  '$.regionScope',
        items               NVARCHAR(MAX)  '$.items' AS JSON,
        totalPaidQty        INT            '$.totalPaidQty',
        totalFocQty         INT            '$.totalFocQty',
        grandTotalMmk       DECIMAL(14,2)  '$.grandTotalMmk',
        remarks             NVARCHAR(MAX)  '$.remarks'
    ) AS j
)
INSERT INTO dbo.noodle_activations (
    id, invoice_no, activation_date, created_at, branch, wholesale_store_name, pg_cover,
    retailer_store_name, outlet_type, phone_number, address_no, address_street, address_ward,
    township, full_address, sales_status, pricing_mode, covered_status, non_covered_reason,
    seller_username, seller_name, route_code, supervisor_username, manager_username, region_scope,
    items,
    chicken_sichat_qty, chicken_sichat_price, chicken_sichat_foc,
    coconut_qty, coconut_price, coconut_foc,
    tom_yum_qty, tom_yum_price, tom_yum_foc,
    total_paid_qty, total_foc_qty, grand_total_mmk, remarks
)
OUTPUT INSERTED.id, INSERTED.invoice_no, INSERTED.seller_username, INSERTED.activation_date, INSERTED.grand_total_mmk
INTO @restored
SELECT
    r.id, r.invoiceNo, r.activationDate, COALESCE(r.createdAt, SYSDATETIMEOFFSET()), COALESCE(r.branch, N'Yangon'),
    COALESCE(r.wholesaleStoreName, N''), COALESCE(r.pgCover, CASE WHEN r.salesStatus = 1 THEN N'Yes' ELSE N'No' END),
    COALESCE(r.retailerStoreName, N''), COALESCE(r.outletType, N'Grocery'), COALESCE(r.phoneNumber, N''),
    COALESCE(r.addressNo, N''), COALESCE(r.addressStreet, N''), COALESCE(r.addressWard, N''),
    COALESCE(r.township, N''), COALESCE(r.fullAddress, N''), COALESCE(r.salesStatus, 0),
    CASE WHEN r.pricingMode = N'manual_wholesale' THEN N'manual_wholesale' ELSE N'company_ldp' END,
    COALESCE(r.coveredStatus, r.salesStatus, 0), NULLIF(r.nonCoveredReason, N''),
    r.sellerUsername, COALESCE(r.sellerName, r.sellerUsername), COALESCE(r.routeCode, N''),
    COALESCE(r.supervisorUsername, N''), COALESCE(r.managerUsername, N''), COALESCE(r.regionScope, N''),
    COALESCE(r.items, N'[]'),
    COALESCE(cs.qty, 0), COALESCE(cs.price, 735), COALESCE(cs.foc, 0),
    COALESCE(cc.qty, 0), COALESCE(cc.price, 870), COALESCE(cc.foc, 0),
    COALESCE(ty.qty, 0), COALESCE(ty.price, 810), COALESCE(ty.foc, 0),
    COALESCE(r.totalPaidQty, 0), COALESCE(r.totalFocQty, 0), COALESCE(r.grandTotalMmk, 0), NULLIF(r.remarks, N'')
FROM rec AS r
OUTER APPLY (SELECT TOP 1 TRY_CAST(JSON_VALUE(i.value, '$.quantity') AS INT) qty, TRY_CAST(JSON_VALUE(i.value, '$.unitPrice') AS DECIMAL(12,2)) price, TRY_CAST(JSON_VALUE(i.value, '$.focQuantity') AS INT) foc
             FROM OPENJSON(COALESCE(r.items, N'[]')) i WHERE JSON_VALUE(i.value, '$.skuId') = N'chicken_sichat_52g') AS cs
OUTER APPLY (SELECT TOP 1 TRY_CAST(JSON_VALUE(i.value, '$.quantity') AS INT) qty, TRY_CAST(JSON_VALUE(i.value, '$.unitPrice') AS DECIMAL(12,2)) price, TRY_CAST(JSON_VALUE(i.value, '$.focQuantity') AS INT) foc
             FROM OPENJSON(COALESCE(r.items, N'[]')) i WHERE JSON_VALUE(i.value, '$.skuId') = N'coconut_55g') AS cc
OUTER APPLY (SELECT TOP 1 TRY_CAST(JSON_VALUE(i.value, '$.quantity') AS INT) qty, TRY_CAST(JSON_VALUE(i.value, '$.unitPrice') AS DECIMAL(12,2)) price, TRY_CAST(JSON_VALUE(i.value, '$.focQuantity') AS INT) foc
             FROM OPENJSON(COALESCE(r.items, N'[]')) i WHERE JSON_VALUE(i.value, '$.skuId') = N'tom_yum_55g') AS ty
WHERE r.sellerUsername IS NOT NULL AND r.invoiceNo IS NOT NULL AND r.activationDate IS NOT NULL;

PRINT CONCAT(@@ROWCOUNT, N' missing activation(s) restored.');
SELECT * FROM @restored ORDER BY activation_date;
COMMIT;
GO
