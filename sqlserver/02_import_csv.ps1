<#
.SYNOPSIS
  Load the Supabase CSV exports into the SQL Server [PLS] database.

.DESCRIPTION
  Reads the "<table>_rows.csv" files exported from the Supabase Table Editor,
  converts Supabase/PostgreSQL formats to SQL Server types, and bulk-loads them.

  - Columns are matched BY NAME, so column order in the CSV doesn't matter.
  - Every target table is EMPTIED first, then reloaded, in one transaction.
    If anything fails, nothing is changed.
  - noodle_activation_sku_details is NOT loaded from CSV: the trigger on
    noodle_activations rebuilds it, exactly like Supabase does.

  Conversions:
    "true"/"false"/"TRUE"/"FALSE"      -> BIT
    "2026-10-24 03:56:51.396+00"       -> DATETIMEOFFSET (adds the missing ":00")
    "2026-10-24" or "24/10/2026"       -> DATE
    empty cell                         -> NULL if the column allows NULL,
                                          otherwise '' for text; an empty required
                                          number/date/yes-no cell stops the import

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\02_import_csv.ps1
  powershell -ExecutionPolicy Bypass -File .\02_import_csv.ps1 -Server "MYSERVER\SQL2022" -Database PLS
#>
param(
    [string]$Server   = '(localdb)\MSSQLLocalDB',
    [string]$Database = 'PLS',
    [string]$CsvDir   = (Join-Path $PSScriptRoot '..\doc'),
    [string]$SqlUser,          # leave empty for Windows Authentication
    [string]$SqlPassword
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Data

# Load order matters: product_master_skus before noodle_activations (the trigger
# looks up SKU codes / Myanmar names from it).
$tables = @(
    'product_master_skus',
    'app_users',
    'wholesale_stores',
    'noodle_activations',
    'user_locations'
)

if ($SqlUser) {
    $connStr = "Server=$Server;Database=$Database;User ID=$SqlUser;Password=$SqlPassword;"
} else {
    $connStr = "Server=$Server;Database=$Database;Integrated Security=True;"
}

$inv = [Globalization.CultureInfo]::InvariantCulture

function Convert-Value {
    param([string]$raw, $col)
    $t = $col.Type
    if ([string]::IsNullOrEmpty($raw)) {
        if ($col.Nullable) { return [DBNull]::Value }
        if ($t -in 'nvarchar', 'varchar', 'nchar', 'char') { return '' }
        return [DBNull]::Value   # NOT NULL number/date/bit left empty -> reported below
    }
    switch ($t) {
        'bit' {
            switch ($raw.Trim().ToLowerInvariant()) {
                { $_ -in 'true', 't', '1', 'yes' }  { return $true }
                { $_ -in 'false', 'f', '0', 'no' } { return $false }
                default { throw "Bad boolean '$raw' for column $($col.Name)" }
            }
        }
        'int'              { return [int]::Parse($raw, $inv) }
        'decimal'          { return [decimal]::Parse($raw, [Globalization.NumberStyles]::Float, $inv) }
        'uniqueidentifier' { return [guid]::Parse($raw) }
        'date' {
            $d = [datetime]::MinValue
            [string[]]$fmts = 'yyyy-MM-dd', 'dd/MM/yyyy', 'd/M/yyyy'
            if ([datetime]::TryParseExact($raw.Trim(), $fmts, $inv, [Globalization.DateTimeStyles]::None, [ref]$d)) { return $d.Date }
            throw "Bad date '$raw' for column $($col.Name)"
        }
        'datetimeoffset' {
            # Postgres writes "+00" / "+06:30"; .NET wants "+00:00"
            $s = $raw.Trim() -replace '([+-]\d{2})$', '$1:00'
            return [DateTimeOffset]::Parse($s, $inv)
        }
        default { return $raw }
    }
}

$conn = New-Object System.Data.SqlClient.SqlConnection $connStr
$conn.Open()
Write-Host "Connected to $Server / $Database"

# Read column metadata for every target table
function Get-Columns([string]$table) {
    $cmd = $conn.CreateCommand()
    $cmd.Transaction = $script:tx
    $cmd.CommandText = @"
SELECT c.name, t.name AS type_name, c.is_nullable,
       CASE WHEN dc.object_id IS NULL THEN 0 ELSE 1 END AS has_default
FROM sys.columns c
JOIN sys.types t ON t.user_type_id = c.user_type_id
LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
WHERE c.object_id = OBJECT_ID(@t)
ORDER BY c.column_id
"@
    [void]$cmd.Parameters.AddWithValue('@t', "dbo.$table")
    $r = $cmd.ExecuteReader()
    $cols = @()
    while ($r.Read()) {
        $cols += [pscustomobject]@{
            Name = $r.GetString(0); Type = $r.GetString(1)
            Nullable = $r.GetBoolean(2); HasDefault = [bool]$r.GetInt32(3)
        }
    }
    $r.Close()
    return $cols
}

$script:tx = $conn.BeginTransaction()
try {
    # Empty tables (reverse order; sku_details is emptied by ON DELETE CASCADE)
    foreach ($t in ($tables[($tables.Count - 1)..0])) {
        $cmd = $conn.CreateCommand(); $cmd.Transaction = $script:tx
        $cmd.CommandText = "DELETE FROM dbo.$t"
        [void]$cmd.ExecuteNonQuery()
    }

    foreach ($t in $tables) {
        $file = Join-Path $CsvDir "$($t)_rows.csv"
        if (-not (Test-Path $file)) { throw "Missing file: $file" }

        $rows    = @(Import-Csv -Path $file -Encoding UTF8)
        $cols    = Get-Columns $t
        $csvCols = $rows[0].PSObject.Properties.Name

        $unknown = $csvCols | Where-Object { $_ -notin $cols.Name }
        if ($unknown) { Write-Warning "$t : CSV columns not in table (ignored): $($unknown -join ', ')" }
        $useCols = $cols | Where-Object { $_.Name -in $csvCols }

        # Build an in-memory table with only the columns present in the CSV
        $dt = New-Object System.Data.DataTable
        foreach ($c in $useCols) { [void]$dt.Columns.Add($c.Name, [object]) }

        $line = 1
        foreach ($row in $rows) {
            $line++
            $dr = $dt.NewRow()
            foreach ($c in $useCols) {
                try { $v = Convert-Value $row.($c.Name) $c }
                catch { throw "$t line $line : $($_.Exception.Message)" }
                $dr[$c.Name] = $v
            }
            [void]$dt.Rows.Add($dr)
        }

        # Stop with a clear message if a required (NOT NULL) column has empty cells
        foreach ($c in ($useCols | Where-Object { -not $_.Nullable })) {
            $bad = @($dt.Select("[$($c.Name)] IS NULL")).Count
            if ($bad -gt 0) { throw "$t : $bad rows have an empty value in NOT NULL column $($c.Name)" }
        }

        $opts = [System.Data.SqlClient.SqlBulkCopyOptions]::CheckConstraints -bor
                [System.Data.SqlClient.SqlBulkCopyOptions]::FireTriggers
        $bulk = New-Object System.Data.SqlClient.SqlBulkCopy($conn, $opts, $script:tx)
        $bulk.DestinationTableName = "dbo.$t"
        $bulk.BatchSize = 500
        $bulk.BulkCopyTimeout = 600
        foreach ($c in $useCols) { [void]$bulk.ColumnMappings.Add($c.Name, $c.Name) }
        $bulk.WriteToServer($dt)
        Write-Host ("{0,-28} {1,6} rows loaded" -f $t, $dt.Rows.Count)
    }

    $script:tx.Commit()
    Write-Host "Done. All tables committed."
}
catch {
    $script:tx.Rollback()
    Write-Host "FAILED - nothing was changed." -ForegroundColor Red
    throw
}
finally {
    $conn.Close()
}
