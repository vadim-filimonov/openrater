# Select only unsigned Windows PE files for Artifact Signing. Vendor-signed
# runtimes and libraries are deliberately left untouched.
$ErrorActionPreference = "Stop"

$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Root = Join-Path $Repo "packaging\desktop\dist\mcpb-root"
if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
    throw "prepare-windows-signing: bundle root not found; run build-mcpb.sh first"
}

$PeExtensions = @(".exe", ".dll", ".pyd")
$Candidates = @(Get-ChildItem -LiteralPath $Root -Recurse -File | Where-Object {
    $PeExtensions -contains $_.Extension.ToLowerInvariant()
})
if ($Candidates.Count -eq 0) {
    throw "prepare-windows-signing: no Windows PE files found"
}

$Unsigned = @()
$Invalid = @()
foreach ($File in $Candidates) {
    $Signature = Get-AuthenticodeSignature -LiteralPath $File.FullName
    $Status = $Signature.Status.ToString()
    if ($Status -eq "NotSigned") {
        $Unsigned += $File
    } elseif ($Status -ne "Valid") {
        $Invalid += [PSCustomObject]@{
            Path = $File.FullName.Substring($Root.Length + 1)
            Status = $Status
        }
    }
}

if ($Invalid.Count -gt 0) {
    $Invalid | Format-Table -AutoSize | Out-String | Write-Host
    throw "prepare-windows-signing: found invalid pre-existing signatures"
}
if ([string]::IsNullOrWhiteSpace($env:GITHUB_OUTPUT)) {
    throw "prepare-windows-signing: GITHUB_OUTPUT is not available"
}

$Delimiter = "OPENRATER_$([Guid]::NewGuid().ToString('N'))"
$Output = @(
    "has_unsigned=$($Unsigned.Count -gt 0)".ToLowerInvariant()
    "count=$($Unsigned.Count)"
    "files<<$Delimiter"
) + @($Unsigned.FullName) + @($Delimiter)
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::AppendAllText(
    $env:GITHUB_OUTPUT,
    (($Output -join [Environment]::NewLine) + [Environment]::NewLine),
    $Utf8NoBom
)

Write-Host "windows-signing: selected $($Unsigned.Count) unsigned file(s); preserved $($Candidates.Count - $Unsigned.Count) valid signature(s)"
