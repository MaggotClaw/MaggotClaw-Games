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
$vendor = Join-Path $projectRoot 'src-tauri\vendor'
$naudioAssembly = Join-Path $vendor 'NAudio.dll'
$voskAssembly = Join-Path $vendor 'Vosk.dll'
$speechAssembly = Get-ChildItem -Path "$env:WINDIR\Microsoft.NET\assembly" -Recurse -Filter 'System.Speech.dll' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
if (-not $speechAssembly) {
    throw 'The built-in Windows offline speech library was not found.'
}
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

# The managed Vosk wrapper P/Invokes libvosk.dll, which needs its MinGW runtime
# siblings; every native dll must sit next to the compiled helper exe to load.
$nativeDlls = @('NAudio.dll', 'Vosk.dll', 'libvosk.dll', 'libgcc_s_seh-1.dll', 'libstdc++-6.dll', 'libwinpthread-1.dll')
foreach ($dll in $nativeDlls) {
    Copy-Item -LiteralPath (Join-Path $vendor $dll) -Destination (Join-Path $outputDirectory $dll) -Force
}

# /target:winexe (not exe) so Windows never allocates a console window for the
# helper; stdout/stdin still work because the parent redirects them to pipes.
& $compiler /nologo /target:winexe /optimize+ "/reference:$speechAssembly" "/reference:$naudioAssembly" "/reference:$voskAssembly" "/out:$output" $source
if ($LASTEXITCODE -ne 0) {
    throw 'The offline Windows dictation helper did not compile.'
}
