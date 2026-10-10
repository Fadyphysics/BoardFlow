$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

try {
    $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $assemblyPath = 'C:\Program Files\Common Files\Microsoft Shared\Ink\Microsoft.Ink.dll'
    if (-not (Test-Path -LiteralPath $assemblyPath)) { throw 'Windows Ink recognition is not installed.' }
    Add-Type -Path $assemblyPath

    $ink = New-Object Microsoft.Ink.Ink
    foreach ($sourceStroke in $payload.strokes) {
        $points = [System.Collections.Generic.List[System.Drawing.Point]]::new()
        foreach ($point in $sourceStroke) {
            $points.Add([System.Drawing.Point]::new(
                [int][Math]::Round([double]$point.x * 10),
                [int][Math]::Round([double]$point.y * 10)))
        }
        if ($points.Count -ge 2) { $null = $ink.CreateStroke([System.Drawing.Point[]]$points.ToArray()) }
    }
    if ($ink.Strokes.Count -eq 0) { throw 'No handwriting strokes were supplied.' }

    $recognizers = New-Object Microsoft.Ink.Recognizers
    $recognizer = $null
    for ($index = 0; $index -lt $recognizers.Count; $index++) {
        $candidate = $recognizers[$index]
        if ($candidate.Name -notmatch 'Gesture') { $recognizer = $candidate; break }
    }
    if ($null -eq $recognizer) { throw 'No Windows handwriting language is installed.' }

    $context = $recognizer.CreateRecognizerContext()
    $context.Strokes = $ink.Strokes
    $status = [Microsoft.Ink.RecognitionStatus]::NoError
    $result = $context.Recognize([ref]$status)
    if ($null -eq $result) { throw 'Windows Ink could not recognize these strokes.' }
    $alternatives = @($result.GetAlternatesFromSelection() | ForEach-Object { $_.ToString() })
    @{
        text = $result.TopString
        alternatives = @($result.TopString) + $alternatives | Select-Object -Unique -First 5
        engine = $recognizer.Name
        kind = 'text'
        confidenceLevel = $result.TopConfidence.ToString()
        status = $status.ToString()
    } | ConvertTo-Json -Compress
} catch {
    @{ text = ''; alternatives = @(); engine = 'Windows Ink'; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
