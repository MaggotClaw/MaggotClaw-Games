$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$compilerCandidates = @(
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compiler) {
    throw 'The built-in Windows C# compiler was not found.'
}

$source = Join-Path $projectRoot 'src-tauri\sidecars\WindowsDictation.cs'
$outputDirectory = Join-Path $projectRoot 'src-tauri\resources'
$output = Join-Path $outputDirectory 'WindowsDictation.exe'
$speechAssembly = Get-ChildItem -Path "$env:WINDIR\Microsoft.NET\assembly" -Recurse -Filter 'System.Speech.dll' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
if (-not $speechAssembly) {
    throw 'The built-in Windows offline speech library was not found.'
}
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

& $compiler /nologo /target:exe /optimize+ "/reference:$speechAssembly" "/out:$output" $source
if ($LASTEXITCODE -ne 0) {
    throw 'The offline Windows dictation helper did not compile.'
}
