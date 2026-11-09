-- =============================================================================
-- Review list: invoice numbers used by more than one visit.
-- READ ONLY - changes nothing. Give the result to the sales team to decide.
--
-- Cause (fixed 2026-11-09 in the app): the old invoice number was the date +
-- a random 4-digit number, created when the form opened, and a form left open
-- (another tab, a phone restoring an old page) could submit an old number again.
-- New numbers look like INV-261109-YGN04-143052 (date, route, time) and are
-- assigned at submit, so this should not happen for new visits.
--
-- kind:
--   DOUBLE SAVE?      same seller, same shop, same date and amounts
--                     -> probably the same visit saved twice; one may need deleting
--   SAME SELLER       same seller, different shops -> separate visits that got
--                     the same number; both are real, numbers just clash
--   DIFFERENT SELLERS random clash between sellers; both are real
-- =============================================================================
USE [PLS];
SET NOCOUNT ON;

;WITH dup AS (
    SELECT invoice_no
    FROM dbo.noodle_activations
    GROUP BY invoice_no
    HAVING COUNT(*) > 1
),
grp AS (
    SELECT a.invoice_no,
           COUNT(DISTINCT a.seller_username) AS sellers,
           COUNT(DISTINCT CONCAT(a.retailer_store_name, N'|', a.township, N'|', a.activation_date, N'|',
                                 a.sales_status, N'|', a.total_paid_qty, N'|', a.total_foc_qty, N'|', a.grand_total_mmk)) AS distinct_visits
    FROM dbo.noodle_activations a
    JOIN dup d ON d.invoice_no = a.invoice_no
    GROUP BY a.invoice_no
)
SELECT
    CASE WHEN g.sellers > 1 THEN N'DIFFERENT SELLERS'
         WHEN g.distinct_visits = 1 THEN N'DOUBLE SAVE?'
         ELSE N'SAME SELLER' END                                   AS kind,
    a.invoice_no                                                    AS [Invoice No],
    ROW_NUMBER() OVER (PARTITION BY a.invoice_no ORDER BY a.created_at) AS [Copy #],
    a.id                                                            AS [Activation ID],
    a.seller_username                                               AS [Seller],
    a.seller_name                                                   AS [Seller Name],
    a.activation_date                                               AS [Visit Date],
    CONVERT(varchar(16), SWITCHOFFSET(a.created_at, '+06:30'), 120) AS [Saved At (MMT)],
    a.retailer_store_name                                           AS [Retailer],
    a.township                                                      AS [Township],
    a.wholesale_store_name                                          AS [Wholesaler],
    CASE WHEN a.sales_status = 1 THEN N'Yes' ELSE N'No' END         AS [Sale],
    a.total_paid_qty                                                AS [Paid Qty],
    a.total_foc_qty                                                 AS [FOC Qty],
    a.grand_total_mmk                                               AS [Total MMK]
FROM dbo.noodle_activations a
JOIN grp g ON g.invoice_no = a.invoice_no
ORDER BY
    CASE WHEN g.sellers > 1 THEN 3 WHEN g.distinct_visits = 1 THEN 1 ELSE 2 END,
    a.invoice_no, a.created_at;
