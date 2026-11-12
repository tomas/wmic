$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
# Spec payload is injected by Node as base64 JSON to avoid command-line quoting issues.
$spec = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String("__WMIC_SPEC_BASE64__")) | ConvertFrom-Json
# Query branch keeps behavior compatible with former where/filter execution.
$rows = @(
  if ($spec.condition) {
    Get-CimInstance -ClassName $spec.section -Filter $spec.condition
  } else {
    Get-CimInstance -ClassName $spec.section
  }
)

function Convert-Value([object]$value) {
  if ($null -eq $value) { return "" }
  # Legacy callers expect arrays serialized into a single field value.
  if ($value -is [System.Array]) { return (($value | ForEach-Object { if ($null -eq $_) { "" } else { [string]$_ } }) -join ",") }
  return [string]$value
}

function Get-FieldValue([object]$row, [string]$field) {
  $property = $row.PSObject.Properties[$field]
  if ($null -eq $property) { return "" }
  return Convert-Value $property.Value
}

if ($spec.type -eq "value") {
  # Emit key=value blocks for get_value compatibility.
  foreach ($row in $rows) {
    foreach ($field in $spec.fields) {
      Write-Output ($field + "=" + (Get-FieldValue $row $field))
    }
    Write-Output ""
  }
} elseif ($spec.type -eq "list") {
  # Emit key=value blocks separated by blank lines for get_list compatibility.
  foreach ($row in $rows) {
    foreach ($property in $row.CimInstanceProperties) {
      Write-Output ($property.Name + "=" + (Convert-Value $property.Value))
    }
    Write-Output ""
  }
} else {
  # Emit tab-delimited table format to match get_values parser contract.
  Write-Output ($spec.fields -join "`t")
  foreach ($row in $rows) {
    $line = @()
    foreach ($field in $spec.fields) {
      $line += (Get-FieldValue $row $field).Replace("`t", " ")
    }
    Write-Output ($line -join "`t")
  }
}
