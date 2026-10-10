$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$nativeRoot = Join-Path $projectRoot 'MyScript'
$output = Join-Path $nativeRoot 'bin'
$sdk = Join-Path $nativeRoot 'vendor/sdk'
New-Item -ItemType Directory -Force $output | Out-Null
Copy-Item -LiteralPath (Join-Path $sdk 'lib/net481/x64/MyScript.IInk.dll') -Destination $output
Get-ChildItem -LiteralPath (Join-Path $sdk 'build/x64') -Filter '*.dll' | Copy-Item -Destination $output
& "$env:WINDIR/Microsoft.NET/Framework64/v4.0.30319/csc.exe" /nologo /target:exe /platform:x64 "/out:$output/RecognizeMath.exe" /reference:System.Web.Extensions.dll "/reference:$output/MyScript.IInk.dll" (Join-Path $nativeRoot 'RecognizeMath.cs') (Join-Path $nativeRoot 'MyCertificate.cs')
if ($LASTEXITCODE -ne 0) { throw 'MyScript helper compilation failed.' }
