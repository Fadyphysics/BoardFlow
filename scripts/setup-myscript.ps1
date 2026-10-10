$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$nativeRoot = Join-Path $projectRoot 'MyScript'
$vendor = Join-Path $nativeRoot 'vendor'
if (-not (Test-Path -LiteralPath (Join-Path $nativeRoot 'MyCertificate.cs'))) {
    throw 'Place your Windows MyScript certificate in MyScript/MyCertificate.cs first.'
}
New-Item -ItemType Directory -Force $vendor | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $vendor 'sdk/lib/net481/x64/MyScript.IInk.dll'))) {
    $archive = Join-Path $vendor 'sdk.zip'
    Invoke-WebRequest 'https://api.nuget.org/v3-flatcontainer/myscript.interactiveink.wpf/4.5.0/myscript.interactiveink.wpf.4.5.0.nupkg' -OutFile $archive -UseBasicParsing
    Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $vendor 'sdk') -Force
}
if (-not (Test-Path -LiteralPath (Join-Path $vendor 'recognition-assets/conf/math2.conf'))) {
    $archive = Join-Path $vendor 'math2.zip'
    Invoke-WebRequest 'https://download.myscript.com/iink/recognitionAssets_iink_4.5/myscript-iink-recognition-math2.zip' -OutFile $archive -UseBasicParsing
    Expand-Archive -LiteralPath $archive -DestinationPath $vendor -Force
}
if (-not (Test-Path -LiteralPath (Join-Path $vendor 'recognition-assets/conf/en_US.conf'))) {
    $archive = Join-Path $vendor 'text.zip'
    Invoke-WebRequest 'https://download.myscript.com/iink/recognitionAssets_iink_4.5/myscript-iink-recognition-text-en_US.zip' -OutFile $archive -UseBasicParsing
    Expand-Archive -LiteralPath $archive -DestinationPath $vendor -Force
}
if (-not (Test-Path -LiteralPath (Join-Path $vendor 'recognition-assets/conf/raw-content2.conf'))) {
    $archive = Join-Path $vendor 'raw-content2.zip'
    Invoke-WebRequest 'https://download.myscript.com/iink/recognitionAssets_iink_4.5/myscript-iink-recognition-raw-content2.zip' -OutFile $archive -UseBasicParsing
    Expand-Archive -LiteralPath $archive -DestinationPath $vendor -Force
}
& (Join-Path $PSScriptRoot 'build-myscript.ps1')
