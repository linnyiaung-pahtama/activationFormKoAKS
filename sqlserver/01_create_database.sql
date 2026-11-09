-- =============================================================================
-- Pahtama Group - Shaloot Noodle Activation & Sales System (PLS)
-- SQL Server version of supabase_schema.sql
--
-- Creates database [PLS] with the same 6 tables, the SKU-detail trigger and the
-- Excel export view. Table and column names are kept identical to Supabase so
-- the app code and CSV exports map 1:1.
--
-- Safe to run more than once (skips objects that already exist).
-- Needs SQL Server 2016+ (OPENJSON). Tested on SQL Server 2025 LocalDB.
--
-- Differences from the PostgreSQL version:
--   TEXT        -> NVARCHAR(n) / NVARCHAR(MAX)  (N = Unicode, needed for Myanmar text)
--   UUID        -> UNIQUEIDENTIFIER, gen_random_uuid() -> NEWID()
--   TIMESTAMPTZ -> DATETIMEOFFSET, NOW() -> SYSDATETIMEOFFSET()
--   BOOLEAN     -> BIT
--   JSONB       -> NVARCHAR(MAX) with ISJSON() check, read with OPENJSON()
--   RLS policies, GRANTs to anon/authenticated, Realtime publication -> removed
--     (only the app server will connect; access is controlled there)
-- =============================================================================

-- Collation matters for Myanmar text: the default SQL_Latin1_General_CP1_CI_AS
-- ignores Myanmar vowel signs, so e.g. N'ကိုသိန်းဝင်း' = N'ကိုသန်းဝင်း' and UNIQUE
-- keys clash. Latin1_General_100_CI_AS_SC compares them correctly (still
-- case-insensitive for English). Use the same collation on the company server.
IF DB_ID(N'PLS') IS NULL
    CREATE DATABASE [PLS] COLLATE Latin1_General_100_CI_AS_SC;
GO
IF CONVERT(NVARCHAR(128), DATABASEPROPERTYEX(N'PLS', 'Collation')) <> N'Latin1_General_100_CI_AS_SC'
    RAISERROR(N'WARNING: database PLS exists with a different collation; Myanmar text may compare incorrectly. Recreate it.', 10, 1);
GO

USE [PLS];
GO

-- =============================================================================
-- 1. app_users - logins, roles, routes, reporting chain
-- =============================================================================
IF OBJECT_ID(N'dbo.app_users', N'U') IS NULL
CREATE TABLE dbo.app_users (
    id                  UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_app_users PRIMARY KEY DEFAULT NEWID(),
    username            NVARCHAR(100)  NOT NULL CONSTRAINT UQ_app_users_username UNIQUE,
    password            NVARCHAR(255)  NOT NULL,   -- TODO: store a bcrypt hash, not plain text
    full_name           NVARCHAR(200)  NOT NULL DEFAULT N'',
    role                NVARCHAR(30)   NOT NULL DEFAULT N'seller'
                        CONSTRAINT CK_app_users_role CHECK (role IN (N'admin', N'nsm', N'brand_manager', N'manager', N'supervisor', N'seller')),
    route_code          NVARCHAR(50)   NOT NULL DEFAULT N'ALL-ROUTES',
    region_scope        NVARCHAR(200)  NOT NULL DEFAULT N'All Regions',
    supervisor_username NVARCHAR(100)  NULL,
    manager_username    NVARCHAR(100)  NULL,
    active              BIT            NOT NULL DEFAULT 1,
    created_at          DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    updated_at          DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_app_users_role')
    CREATE INDEX idx_app_users_role ON dbo.app_users (role);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_app_users_route_code')
    CREATE INDEX idx_app_users_route_code ON dbo.app_users (route_code);
GO

-- =============================================================================
-- 2. noodle_activations - one row per shop visit / invoice (main table)
-- =============================================================================
IF OBJECT_ID(N'dbo.noodle_activations', N'U') IS NULL
CREATE TABLE dbo.noodle_activations (
    id                    NVARCHAR(100)  NOT NULL CONSTRAINT PK_noodle_activations PRIMARY KEY,
    invoice_no            NVARCHAR(50)   NOT NULL,
    activation_date       DATE           NOT NULL DEFAULT CAST(GETDATE() AS DATE),
    created_at            DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    branch                NVARCHAR(50)   NULL DEFAULT N'Yangon',
    wholesale_store_name  NVARCHAR(300)  NOT NULL DEFAULT N'',
    pg_cover              NVARCHAR(10)   NOT NULL DEFAULT N'Yes',
    retailer_store_name   NVARCHAR(300)  NOT NULL DEFAULT N'',
    outlet_type           NVARCHAR(100)  NOT NULL DEFAULT N'Grocery',
    phone_number          NVARCHAR(50)   NOT NULL DEFAULT N'',
    address_no            NVARCHAR(100)  NOT NULL DEFAULT N'',
    address_street        NVARCHAR(200)  NOT NULL DEFAULT N'',
    address_ward          NVARCHAR(200)  NOT NULL DEFAULT N'',
    township              NVARCHAR(200)  NOT NULL DEFAULT N'',
    full_address          NVARCHAR(1000) NOT NULL DEFAULT N'',
    sales_status          BIT            NOT NULL DEFAULT 1,
    pricing_mode          NVARCHAR(30)   NOT NULL DEFAULT N'company_ldp',
    covered_status        BIT            NOT NULL DEFAULT 1,
    non_covered_reason    NVARCHAR(500)  NULL,
    seller_username       NVARCHAR(100)  NOT NULL,
    seller_name           NVARCHAR(200)  NOT NULL,
    route_code            NVARCHAR(50)   NOT NULL,
    supervisor_username   NVARCHAR(100)  NOT NULL DEFAULT N'',
    manager_username      NVARCHAR(100)  NOT NULL DEFAULT N'',
    region_scope          NVARCHAR(200)  NOT NULL DEFAULT N'',
    items                 NVARCHAR(MAX)  NOT NULL DEFAULT N'[]'
                          CONSTRAINT CK_noodle_activations_items_json CHECK (ISJSON(items) = 1),
    -- legacy fixed-SKU columns (kept so old CSV exports import cleanly)
    chicken_sichat_qty    INT            NOT NULL DEFAULT 0,
    chicken_sichat_price  DECIMAL(12, 2) NOT NULL DEFAULT 735,
    chicken_sichat_foc    INT            NOT NULL DEFAULT 0,
    coconut_qty           INT            NOT NULL DEFAULT 0,
    coconut_price         DECIMAL(12, 2) NOT NULL DEFAULT 870,
    coconut_foc           INT            NOT NULL DEFAULT 0,
    tom_yum_qty           INT            NOT NULL DEFAULT 0,
    tom_yum_price         DECIMAL(12, 2) NOT NULL DEFAULT 810,
    tom_yum_foc           INT            NOT NULL DEFAULT 0,
    total_paid_qty        INT            NOT NULL DEFAULT 0,
    total_foc_qty         INT            NOT NULL DEFAULT 0,
    grand_total_mmk       DECIMAL(14, 2) NOT NULL DEFAULT 0,
    remarks               NVARCHAR(MAX)  NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_noodle_activations_date')
    CREATE INDEX idx_noodle_activations_date ON dbo.noodle_activations (activation_date DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_noodle_activations_branch')
    CREATE INDEX idx_noodle_activations_branch ON dbo.noodle_activations (branch);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_noodle_activations_seller')
    CREATE INDEX idx_noodle_activations_seller ON dbo.noodle_activations (seller_username);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_noodle_activations_route')
    CREATE INDEX idx_noodle_activations_route ON dbo.noodle_activations (route_code);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_noodle_activations_invoice')
    CREATE INDEX idx_noodle_activations_invoice ON dbo.noodle_activations (invoice_no);
GO

-- =============================================================================
-- 3. noodle_activation_sku_details - one row per SKU per invoice
--    (filled automatically by the trigger in section 7; do not insert by hand)
-- =============================================================================
IF OBJECT_ID(N'dbo.noodle_activation_sku_details', N'U') IS NULL
CREATE TABLE dbo.noodle_activation_sku_details (
    id                   NVARCHAR(200)  NOT NULL CONSTRAINT PK_noodle_activation_sku_details PRIMARY KEY,
    activation_id        NVARCHAR(100)  NOT NULL
                         CONSTRAINT FK_sku_details_activation REFERENCES dbo.noodle_activations (id) ON DELETE CASCADE,
    invoice_no           NVARCHAR(50)   NOT NULL,
    activation_date      DATE           NOT NULL DEFAULT CAST(GETDATE() AS DATE),
    created_at           DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    branch               NVARCHAR(50)   NULL DEFAULT N'Yangon',
    seller_username      NVARCHAR(100)  NOT NULL,
    seller_name          NVARCHAR(200)  NOT NULL,
    route_code           NVARCHAR(50)   NOT NULL,
    supervisor_username  NVARCHAR(100)  NULL DEFAULT N'',
    manager_username     NVARCHAR(100)  NULL DEFAULT N'',
    region_scope         NVARCHAR(200)  NULL DEFAULT N'',
    wholesale_store_name NVARCHAR(300)  NOT NULL,
    pg_cover             NVARCHAR(10)   NOT NULL DEFAULT N'Yes',
    retailer_store_name  NVARCHAR(300)  NOT NULL,
    outlet_type          NVARCHAR(100)  NOT NULL DEFAULT N'Consumer',
    phone_number         NVARCHAR(50)   NULL DEFAULT N'',
    address_no           NVARCHAR(100)  NULL DEFAULT N'',
    address_street       NVARCHAR(200)  NULL DEFAULT N'',
    address_ward         NVARCHAR(200)  NULL DEFAULT N'',
    township             NVARCHAR(200)  NOT NULL,
    full_address         NVARCHAR(1000) NULL DEFAULT N'',
    sales_status         BIT            NOT NULL DEFAULT 1,
    non_covered_reason   NVARCHAR(500)  NULL,
    pricing_mode         NVARCHAR(30)   NOT NULL DEFAULT N'company_ldp',
    sku_id               NVARCHAR(100)  NOT NULL,
    sku_code             NVARCHAR(50)   NOT NULL,
    sku_name             NVARCHAR(300)  NOT NULL,
    myanmar_sub_name     NVARCHAR(300)  NULL DEFAULT N'',
    pack_spec            NVARCHAR(50)   NULL DEFAULT N'1x30pcs',
    unit_price           DECIMAL(12, 2) NOT NULL DEFAULT 0,
    paid_qty             INT            NOT NULL DEFAULT 0,
    foc_qty              INT            NOT NULL DEFAULT 0,
    total_qty            INT            NOT NULL DEFAULT 0,
    line_total_mmk       DECIMAL(14, 2) NOT NULL DEFAULT 0,
    remarks              NVARCHAR(MAX)  NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_sku_details_activation_id')
    CREATE INDEX idx_sku_details_activation_id ON dbo.noodle_activation_sku_details (activation_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_sku_details_invoice_no')
    CREATE INDEX idx_sku_details_invoice_no ON dbo.noodle_activation_sku_details (invoice_no);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_sku_details_date')
    CREATE INDEX idx_sku_details_date ON dbo.noodle_activation_sku_details (activation_date DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_sku_details_branch')
    CREATE INDEX idx_sku_details_branch ON dbo.noodle_activation_sku_details (branch);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_sku_details_seller')
    CREATE INDEX idx_sku_details_seller ON dbo.noodle_activation_sku_details (seller_username);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_sku_details_route')
    CREATE INDEX idx_sku_details_route ON dbo.noodle_activation_sku_details (route_code);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_sku_details_sku_code')
    CREATE INDEX idx_sku_details_sku_code ON dbo.noodle_activation_sku_details (sku_code);
GO

-- =============================================================================
-- 4. wholesale_stores - searchable wholesaler list
-- =============================================================================
IF OBJECT_ID(N'dbo.wholesale_stores', N'U') IS NULL
CREATE TABLE dbo.wholesale_stores (
    id         UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_wholesale_stores PRIMARY KEY DEFAULT NEWID(),
    name       NVARCHAR(300)  NOT NULL CONSTRAINT UQ_wholesale_stores_name UNIQUE,
    township   NVARCHAR(200)  NOT NULL DEFAULT N'',
    region     NVARCHAR(200)  NOT NULL DEFAULT N'',
    active     BIT            NOT NULL DEFAULT 1,
    sort_order INT            NOT NULL DEFAULT 0,
    created_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    updated_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_wholesale_stores_active')
    CREATE INDEX idx_wholesale_stores_active ON dbo.wholesale_stores (active);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_wholesale_stores_sort')
    CREATE INDEX idx_wholesale_stores_sort ON dbo.wholesale_stores (sort_order ASC, name ASC);
GO

-- =============================================================================
-- 5. product_master_skus - the noodle products, prices, images
-- =============================================================================
IF OBJECT_ID(N'dbo.product_master_skus', N'U') IS NULL
CREATE TABLE dbo.product_master_skus (
    id                NVARCHAR(100)  NOT NULL CONSTRAINT PK_product_master_skus PRIMARY KEY,
    code              NVARCHAR(50)   NOT NULL CONSTRAINT UQ_product_master_skus_code UNIQUE,
    name              NVARCHAR(300)  NOT NULL,
    short_name        NVARCHAR(200)  NOT NULL DEFAULT N'',
    myanmar_sub_name  NVARCHAR(300)  NOT NULL DEFAULT N'',
    pack_spec         NVARCHAR(50)   NOT NULL DEFAULT N'1x30pcs',
    default_ldp_price DECIMAL(12, 2) NOT NULL DEFAULT 0,
    accent_color      NVARCHAR(20)   NOT NULL DEFAULT N'#0F2C59',
    image_url         NVARCHAR(500)  NOT NULL DEFAULT N'',
    active            BIT            NOT NULL DEFAULT 1,
    sort_order        INT            NOT NULL DEFAULT 0,
    created_at        DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    updated_at        DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_product_master_skus_active')
    CREATE INDEX idx_product_master_skus_active ON dbo.product_master_skus (active, sort_order ASC);
GO

-- =============================================================================
-- 6. user_locations - per-user route profile + offline sync payload
-- =============================================================================
IF OBJECT_ID(N'dbo.user_locations', N'U') IS NULL
CREATE TABLE dbo.user_locations (
    id                   NVARCHAR(100)    NOT NULL CONSTRAINT PK_user_locations PRIMARY KEY,
    user_id              UNIQUEIDENTIFIER NULL,
    username             NVARCHAR(100)    NOT NULL,
    full_name            NVARCHAR(200)    NOT NULL DEFAULT N'',
    role                 NVARCHAR(30)     NOT NULL DEFAULT N'seller',
    route_code           NVARCHAR(50)     NOT NULL DEFAULT N'ALL-ROUTES',
    region_scope         NVARCHAR(200)    NOT NULL DEFAULT N'All Regions',
    supervisor_username  NVARCHAR(100)    NULL,
    manager_username     NVARCHAR(100)    NULL,
    wholesale_store_name NVARCHAR(300)    NULL DEFAULT N'',
    retailer_store_name  NVARCHAR(300)    NULL DEFAULT N'',
    outlet_type          NVARCHAR(100)    NULL DEFAULT N'Grocery',
    phone_number         NVARCHAR(50)     NULL DEFAULT N'',
    township             NVARCHAR(200)    NULL DEFAULT N'',
    full_address         NVARCHAR(1000)   NULL DEFAULT N'',
    invoice_no           NVARCHAR(50)     NULL DEFAULT N'',
    activation_date      DATE             NULL DEFAULT CAST(GETDATE() AS DATE),
    sales_status         BIT              NULL DEFAULT 1,
    total_paid_qty       INT              NULL DEFAULT 0,
    total_foc_qty        INT              NULL DEFAULT 0,
    grand_total_mmk      DECIMAL(14, 2)   NULL DEFAULT 0,
    payload              NVARCHAR(MAX)    NULL DEFAULT N'{}'
                         CONSTRAINT CK_user_locations_payload_json CHECK (payload IS NULL OR ISJSON(payload) = 1),
    updated_at           DATETIMEOFFSET   NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    created_at           DATETIMEOFFSET   NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_user_locations_user_id')
    CREATE INDEX idx_user_locations_user_id ON dbo.user_locations (user_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_user_locations_username')
    CREATE INDEX idx_user_locations_username ON dbo.user_locations (username);
GO

-- =============================================================================
-- 7. Trigger: rebuild SKU detail rows whenever an activation is inserted/updated
--    (T-SQL port of public.sync_noodle_activation_sku_details)
--    - one row per SKU in the items JSON that has paid or FOC qty > 0
--    - if none (or sales_status = 0), one "_no_sale" row
--    Works for multi-row INSERT/UPDATE (uses the "inserted" table).
-- =============================================================================
CREATE OR ALTER TRIGGER dbo.trg_sync_noodle_activation_sku_details
ON dbo.noodle_activations
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;

    DELETE d
    FROM dbo.noodle_activation_sku_details AS d
    JOIN inserted AS i ON d.activation_id = i.id;

    -- SKU rows (sales visits)
    ;WITH sku_rows AS (
        SELECT
            i.*,
            COALESCE(j.skuId, N'sku')                         AS j_sku_id,
            j.skuName                                         AS j_sku_name,
            COALESCE(TRY_CAST(j.unitPrice   AS DECIMAL(12,2)), 0) AS j_unit_price,
            COALESCE(TRY_CAST(j.quantity    AS INT), 0)       AS j_qty,
            COALESCE(TRY_CAST(j.focQuantity AS INT), 0)       AS j_foc,
            COALESCE(TRY_CAST(j.lineTotal   AS DECIMAL(14,2)), 0) AS j_line_total,
            ROW_NUMBER() OVER (PARTITION BY i.id, COALESCE(j.skuId, N'sku') ORDER BY (SELECT NULL)) AS rn
        FROM inserted AS i
        CROSS APPLY OPENJSON(i.items)
            WITH (
                skuId       NVARCHAR(100) '$.skuId',
                skuName     NVARCHAR(300) '$.skuName',
                unitPrice   NVARCHAR(50)  '$.unitPrice',
                quantity    NVARCHAR(50)  '$.quantity',
                focQuantity NVARCHAR(50)  '$.focQuantity',
                lineTotal   NVARCHAR(50)  '$.lineTotal'
            ) AS j
        WHERE i.sales_status = 1
    )
    INSERT INTO dbo.noodle_activation_sku_details (
        id, activation_id, invoice_no, activation_date, created_at, branch,
        seller_username, seller_name, route_code, supervisor_username, manager_username, region_scope,
        wholesale_store_name, pg_cover, retailer_store_name, outlet_type, phone_number,
        address_no, address_street, address_ward, township, full_address,
        sales_status, non_covered_reason, pricing_mode,
        sku_id, sku_code, sku_name, myanmar_sub_name, pack_spec,
        unit_price, paid_qty, foc_qty, total_qty, line_total_mmk, remarks
    )
    SELECT
        s.id + N'_' + s.j_sku_id,
        s.id, s.invoice_no, s.activation_date, s.created_at, COALESCE(s.branch, N'Yangon'),
        s.seller_username, s.seller_name, s.route_code,
        COALESCE(s.supervisor_username, N''), COALESCE(s.manager_username, N''), COALESCE(s.region_scope, N''),
        s.wholesale_store_name, s.pg_cover, s.retailer_store_name, s.outlet_type, COALESCE(s.phone_number, N''),
        COALESCE(s.address_no, N''), COALESCE(s.address_street, N''), COALESCE(s.address_ward, N''),
        s.township, COALESCE(s.full_address, N''),
        1, NULL, s.pricing_mode,
        s.j_sku_id,
        COALESCE(pm.code, s.j_sku_id, N'-'),
        COALESCE(s.j_sku_name, pm.name, s.j_sku_id),
        COALESCE(pm.myanmar_sub_name, N''),
        COALESCE(pm.pack_spec, N'1x30pcs'),
        s.j_unit_price, s.j_qty, s.j_foc, s.j_qty + s.j_foc, s.j_line_total,
        s.remarks
    FROM sku_rows AS s
    LEFT JOIN dbo.product_master_skus AS pm ON pm.id = s.j_sku_id
    WHERE s.rn = 1
      AND (s.j_qty > 0 OR s.j_foc > 0);

    -- "_no_sale" row for any activation that got no SKU rows
    INSERT INTO dbo.noodle_activation_sku_details (
        id, activation_id, invoice_no, activation_date, created_at, branch,
        seller_username, seller_name, route_code, supervisor_username, manager_username, region_scope,
        wholesale_store_name, pg_cover, retailer_store_name, outlet_type, phone_number,
        address_no, address_street, address_ward, township, full_address,
        sales_status, non_covered_reason, pricing_mode,
        sku_id, sku_code, sku_name, myanmar_sub_name, pack_spec,
        unit_price, paid_qty, foc_qty, total_qty, line_total_mmk, remarks
    )
    SELECT
        i.id + N'_no_sale',
        i.id, i.invoice_no, i.activation_date, i.created_at, COALESCE(i.branch, N'Yangon'),
        i.seller_username, i.seller_name, i.route_code,
        COALESCE(i.supervisor_username, N''), COALESCE(i.manager_username, N''), COALESCE(i.region_scope, N''),
        i.wholesale_store_name, i.pg_cover, i.retailer_store_name, i.outlet_type, COALESCE(i.phone_number, N''),
        COALESCE(i.address_no, N''), COALESCE(i.address_street, N''), COALESCE(i.address_ward, N''),
        i.township, COALESCE(i.full_address, N''),
        0, COALESCE(i.non_covered_reason, N'Recorded Visit'), i.pricing_mode,
        N'none', N'-', N'No SKU Sold (Non-Sales Visit)', N'-', N'-',
        0, 0, 0, 0, 0,
        COALESCE(i.remarks, i.non_covered_reason)
    FROM inserted AS i
    WHERE NOT EXISTS (
        SELECT 1 FROM dbo.noodle_activation_sku_details AS d WHERE d.activation_id = i.id
    );
END;
GO

-- =============================================================================
-- 8. View: flat itemized report used for the Excel download
--    (SQL Server views cannot contain ORDER BY - sort when you SELECT from it:
--     ORDER BY [Activation Date] DESC, [Invoice No] DESC, [SKU Code])
-- =============================================================================
CREATE OR ALTER VIEW dbo.v_itemized_sku_export AS
SELECT
    d.id                                                         AS [Row ID],
    d.activation_id                                              AS [Activation ID],
    d.invoice_no                                                 AS [Invoice No],
    d.activation_date                                            AS [Activation Date],
    COALESCE(d.branch, a.branch, N'Yangon')                      AS [Branch],
    COALESCE(d.region_scope, N'')                                AS [Region Scope],
    d.route_code                                                 AS [Route Code],
    d.seller_username                                            AS [Seller Username],
    d.seller_name                                                AS [Seller Name],
    COALESCE(d.supervisor_username, N'')                         AS [Supervisor],
    COALESCE(d.manager_username, N'')                            AS [Manager],
    d.wholesale_store_name                                       AS [Wholesale Store Name],
    d.pg_cover                                                   AS [PG Cover],
    d.retailer_store_name                                        AS [Retailer Store Name],
    d.outlet_type                                                AS [Outlet Type],
    COALESCE(d.phone_number, N'')                                AS [Phone Number],
    COALESCE(NULLIF(d.address_no, N''), a.address_no, N'')       AS [Address No],
    COALESCE(NULLIF(d.address_street, N''), a.address_street, N'') AS [Street],
    COALESCE(NULLIF(d.address_ward, N''), a.address_ward, N'')   AS [Ward],
    d.township                                                   AS [Township],
    COALESCE(d.full_address, N'')                                AS [Full Address],
    CASE WHEN d.sales_status = 1 THEN N'Yes' ELSE N'No' END      AS [Sales Status],
    CASE WHEN d.sales_status = 1 THEN N'-'
         ELSE COALESCE(d.non_covered_reason, a.non_covered_reason, N'Recorded Visit')
    END                                                          AS [Non-Covered Reason],
    CASE WHEN d.pricing_mode = N'manual_wholesale' THEN N'Manual Wholesale Store Price'
         ELSE N'Company LTP Price'
    END                                                          AS [Pricing Mode],
    d.sku_id                                                     AS [SKU ID],
    d.sku_code                                                   AS [SKU Code],
    d.sku_name                                                   AS [SKU Name],
    COALESCE(NULLIF(d.myanmar_sub_name, N''), pm.myanmar_sub_name, N'-') AS [Myanmar Name],
    COALESCE(d.pack_spec, pm.pack_spec, N'1x30pcs')              AS [Pack Spec],
    d.unit_price                                                 AS [Unit Price (MMK)],
    d.paid_qty                                                   AS [Paid Qty],
    d.foc_qty                                                    AS [FOC Qty (0 MMK)],
    d.total_qty                                                  AS [Total Qty],
    d.line_total_mmk                                             AS [Line Total (MMK)],
    COALESCE(d.remarks, N'')                                     AS [Remarks]
FROM dbo.noodle_activation_sku_details AS d
LEFT JOIN dbo.noodle_activations  AS a  ON a.id  = d.activation_id
LEFT JOIN dbo.product_master_skus AS pm ON pm.id = d.sku_id;
GO

PRINT N'PLS database and tables are ready.';
GO
