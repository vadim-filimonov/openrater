# Require every Windows PE file to have a valid Authenticode signature, then
# replace the unsigned .mcpb with a package containing the signed binaries.
$ErrorActionPreference = "Stop"

$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Out = Join-Path $Repo "packaging\desktop\dist"
$Root = Join-Path $Out "mcpb-root"
$PeExtensions = @(".exe", ".dll", ".pyd")
$Candidates = @(Get-ChildItem -LiteralPath $Root -Recurse -File | Where-Object {
    $PeExtensions -contains $_.Extension.ToLowerInvariant()
})
if ($Candidates.Count -eq 0) {
    throw "finish-windows-signing: no Windows PE files found"
}

$Invalid = @()
foreach ($File in $Candidates) {
    $Signature = Get-AuthenticodeSignature -LiteralPath $File.FullName
    if ($Signature.Status.ToString() -ne "Valid") {
        $Invalid += [PSCustomObject]@{
            Path = $File.FullName.Substring($Root.Length + 1)
            Status = $Signature.Status.ToString()
        }
    }
}
if ($Invalid.Count -gt 0) {
    $Invalid | Format-Table -AutoSize | Out-String | Write-Host
    throw "finish-windows-signing: not every Windows binary has a valid signature"
}
Write-Host "windows-signing: verified $($Candidates.Count)/$($Candidates.Count) PE files"

Push-Location $Repo
try {
    Get-ChildItem -LiteralPath $Out -Filter "*.mcpb" -File | Remove-Item -Force
    $Version = (& node -p "require('./services/mcp/package.json').version").Trim()
    if ($LASTEXITCODE -ne 0) { throw "finish-windows-signing: could not read version" }
    $Artifact = Join-Path $Out "openrater-$Version-win32-x64.mcpb"
    & npx.cmd --yes "@anthropic-ai/mcpb" pack $Root $Artifact
    if ($LASTEXITCODE -ne 0) { throw "finish-windows-signing: repack failed" }
    Get-Item -LiteralPath $Artifact | Format-List FullName, Length
} finally {
    Pop-Location
}
