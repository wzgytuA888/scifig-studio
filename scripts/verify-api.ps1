# SciFigure Studio - /scifig API acceptance (v5: single-figure focus)
# ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 as ANSI unless BOM.
param(
  [string]$Origin = 'http://127.0.0.1:3080',
  [string]$SessionId = '',
  [switch]$AllowDestructive
)

$ErrorActionPreference = 'Stop'
$script:pass = 0
$script:fail = 0
$script:skip = 0
$script:notes = New-Object System.Collections.Generic.List[string]

function Check($name, $cond, $detail) {
  if ($cond) { $script:pass++; Write-Host ("  [PASS] " + $name) -ForegroundColor Green }
  else { $script:fail++; Write-Host ("  [FAIL] " + $name + " :: " + $detail) -ForegroundColor Red; $script:notes.Add("$name :: $detail") }
}
function Skip($name, $why) {
  $script:skip++
  Write-Host ("  [SKIP] " + $name + " :: " + $why) -ForegroundColor Yellow
}

function Get-Json($path) {
  $r = Invoke-WebRequest -Uri ($Origin + $path) -UseBasicParsing -TimeoutSec 180
  return [pscustomobject]@{ status = [int]$r.StatusCode; body = ($r.Content | ConvertFrom-Json); raw = $r.Content }
}
function Try-GetJson($path) {
  try { return Get-Json $path } catch { return [pscustomobject]@{ status = 404; body = $null; raw = $_.Exception.Message } }
}
function Post-Json($path, $obj) {
  $json = $obj | ConvertTo-Json -Depth 12 -Compress
  $r = Invoke-WebRequest -Uri ($Origin + $path) -Method POST -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json)) -UseBasicParsing -TimeoutSec 300
  return [pscustomobject]@{ status = [int]$r.StatusCode; body = ($r.Content | ConvertFrom-Json); raw = $r.Content }
}

Write-Host "== SciFigure Studio API acceptance (v5) @ $Origin ==" -ForegroundColor Cyan

# 1 health
$h = Get-Json '/scifig/api/health'
Check 'health.ok' ($h.body.ok -eq $true) ('ok=' + $h.body.ok)
Check 'health.renderer' ($h.body.renderer -eq $true) ('renderer=' + $h.body.renderer)
Check 'health.controlsReady' ($h.body.controlsReady -eq $true) ('controlsReady=' + $h.body.controlsReady)

# 2 controls（工具区分组 + 新配色控件）
# note: PS 5.1 ConvertFrom-Json rejects empty-string object keys (optionLabels ""), so parse by regex here.
$craw = (Invoke-WebRequest -Uri ($Origin + '/scifig/api/controls') -UseBasicParsing -TimeoutSec 180).Content
$pathCount = ([regex]::Matches($craw, '"path"\s*:')).Count
$appliesCount = ([regex]::Matches($craw, '"appliesTo"\s*:')).Count
Check 'controls.items' ($pathCount -ge 60) ('paths=' + $pathCount)
Check 'controls.groups' ($appliesCount -ge 6) ('groups=' + $appliesCount)
Check 'controls.presets' (([regex]::Matches($craw, '"presets"\s*:')).Count -ge 1) 'presets missing'
Check 'controls.palette' ($craw -match '"style\.palette"') 'style.palette missing'
Check 'controls.paletteSeq' ($craw -match '"style\.paletteSequential"') 'style.paletteSequential missing'
Check 'controls.projection' ($craw -match '"map\.projection"') 'map.projection missing'
Check 'controls.centralLon' ($craw -match '"map\.centralLongitude"') 'map.centralLongitude missing'
$presetId = 'sci'

# 3 palettes（v4 §9.3）
$p = Try-GetJson '/scifig/api/palettes'
if ($p.status -eq 200 -and $p.body -and $p.body.ok -eq $true) {
  $plist = @($p.body.palettes)
  Check 'palettes.count' ($plist.Count -ge 20) ('count=' + $plist.Count)
  $kinds = @($plist | ForEach-Object { $_.kind } | Sort-Object -Unique)
  Check 'palettes.kinds' (($kinds -contains 'categorical') -and ($kinds -contains 'sequential') -and ($kinds -contains 'diverging')) ($kinds -join ',')
  $bad = @($plist | Where-Object { @($_.colors | Where-Object { $_ -notmatch '^#[0-9A-Fa-f]{6}$' }).Count -gt 0 }).Count
  Check 'palettes.hexValid' ($bad -eq 0) ('bad=' + $bad)
  $noName = @($plist | Where-Object { -not $_.name }).Count
  Check 'palettes.named' ($noName -eq 0) ('unnamed=' + $noName)
  $byKind = $p.body.byKind
  Check 'palettes.byKind' (([bool]$byKind.categorical) -and ([bool]$byKind.sequential) -and ([bool]$byKind.diverging)) 'byKind missing'
} else {
  Check 'palettes.ok' $false ('status=' + $p.status + ' ' + $p.raw)
}

# 4 state
$q = if ($SessionId) { '?sessionId=' + $SessionId } else { '' }
$s = Get-Json ('/scifig/api/state' + $q)
Check 'state.ok' ($s.body.ok -eq $true) ('ok=' + $s.body.ok)
$figs = @($s.body.figures)
Check 'state.hasFigure' ($figs.Count -ge 1) ('figures=' + $figs.Count)
$figureId = $null
if ($figs.Count -ge 1) { $figureId = $figs[0].id }
# prefer a map figure so projection assertions always run
$mapFig = @($figs | Where-Object { $_.kind -eq 'map' })
if ($mapFig.Count -ge 1) { $figureId = $mapFig[0].id }
$fig = $s.body.figure
# always resolve the exact figure we are about to patch (state.figure is the "active" one)
if ($figureId) { $fig = (Get-Json ('/scifig/api/state?figureId=' + $figureId)).body.figure }
Check 'state.figure' ([bool]$fig) 'no figure'

if ($fig) {
  $rev0 = [int]$fig.rev
  Check 'figure.spec' ([bool]$fig.spec) 'no spec'
  Check 'figure.imageUrl' ([bool]$fig.imageUrl) 'no imageUrl'
  Check 'figure.pngPath' ([bool]$fig.pngPath) 'no pngPath'

  $img = Invoke-WebRequest -Uri ($Origin + $fig.imageUrl) -UseBasicParsing -TimeoutSec 60
  $bytes = $img.RawContentStream.ToArray()
  $isPng = ($bytes.Length -gt 8 -and $bytes[0] -eq 0x89 -and $bytes[1] -eq 0x50)
  Check 'image.png' $isPng ('bytes=' + $bytes.Length)

  # patch：换配色 + 换投影（单图核心能力）
  $p1 = Post-Json '/scifig/api/patch' @{ figureId = $figureId; set = @{ 'style.palette' = 'ppt-03'; 'legend.position' = 'lower right' } }
  Check 'patch.palette' ($p1.body.ok -eq $true) $p1.raw
  $rev1 = if ($p1.body.figure) { [int]$p1.body.figure.rev } else { -1 }
  Check 'patch.revBumped' ($rev1 -gt $rev0) ('rev ' + $rev0 + ' -> ' + $rev1)
  if ($fig.kind -eq 'map') {
    $p2 = Post-Json '/scifig/api/patch' @{ figureId = $figureId; set = @{ 'map.projection' = 'mercator' } }
    Check 'patch.projection' ($p2.body.ok -eq $true) $p2.raw
    $p3 = Post-Json '/scifig/api/patch' @{ figureId = $figureId; set = @{ 'map.projection' = 'lambert' } }
    Check 'patch.projection.back' ($p3.body.ok -eq $true) $p3.raw
  } else {
    Skip 'patch.projection' 'not a map figure'
  }

  # nl：中文改图 + 换投影
  $nl = Post-Json '/scifig/api/nl' @{ figureId = $figureId; text = '图例放右下角，字号调到8' }
  Check 'nl.ok' ($nl.body.ok -eq $true) ('ok=' + $nl.body.ok)
  Check 'nl.applied' (@($nl.body.applied).Count -gt 0) ('applied=' + @($nl.body.applied).Count)
  if ($fig.kind -eq 'map') {
    $nl2 = Post-Json '/scifig/api/nl' @{ figureId = $figureId; text = '换成墨卡托投影' }
    Check 'nl.projection' (@($nl2.body.applied).Count -gt 0) ('applied=' + @($nl2.body.applied).Count)
  } else {
    Skip 'nl.projection' 'not a map figure'
  }

  $hasAuto = $fig.PSObject.Properties.Name -contains 'autoAdjust'
  Check 'figure.autoAdjust' $hasAuto 'figure.autoAdjust missing'
  $warnAuto = @($fig.warnings | Where-Object { $_ -match '中央经线|自动对齐' }).Count
  Check 'warnings.noAutoNoise' ($warnAuto -eq 0) ('auto-like warnings=' + $warnAuto)

  if ($presetId) {
    $pr = Post-Json '/scifig/api/preset' @{ figureId = $figureId; preset = $presetId }
    Check 'preset.ok' ($pr.body.ok -eq $true) ('ok=' + $pr.body.ok)
  }

  $ex = Post-Json '/scifig/api/export' @{ figureId = $figureId }
  Check 'export.ok' ($ex.body.ok -eq $true) ('ok=' + $ex.body.ok)
  if ($ex.body.path) { Check 'export.fileExists' (Test-Path $ex.body.path) $ex.body.path }

  $code = Get-Json ('/scifig/api/code?id=' + $figureId)
  Check 'code.ok' ($code.body.ok -eq $true) ('ok=' + $code.body.ok)
  $codeLen = 0
  if ($code.body.code) { $codeLen = $code.body.code.Length }
  Check 'code.hasContent' ($codeLen -gt 200) ('len=' + $codeLen)
}

# 5 v5：拼接/拆分必须被拒（§10.2）
$cp = Post-Json '/scifig/api/compose' @{ componentIds = @(); optimize = $true }
Check 'compose.removed' ($cp.body.ok -eq $false) ('ok=' + $cp.body.ok + ' error=' + $cp.body.error)
$dc = Post-Json '/scifig/api/decompose' @{ figureId = 'fig-none' }
Check 'decompose.removed' ($dc.body.ok -eq $false) ('ok=' + $dc.body.ok + ' error=' + $dc.body.error)

# 6 sessions（跨会话调图）
$rawSes = $null
for ($i = 0; $i -lt 3 -and -not $rawSes; $i++) {
  try {
    $resp = Invoke-WebRequest -Uri ($Origin + '/scifig/api/sessions') -UseBasicParsing -TimeoutSec 180
    if ($resp.Content) { $rawSes = $resp.Content }
  } catch { Write-Host ('  [WARN] sessions attempt ' + ($i + 1) + ': ' + $_.Exception.Message) -ForegroundColor Yellow }
  if (-not $rawSes) { Start-Sleep -Milliseconds 700 }
}
if (-not $rawSes) {
  Check 'sessions.ok' $false 'empty response'
} else {
  $sesBody = $rawSes | ConvertFrom-Json
  Check 'sessions.ok' ($sesBody.ok -eq $true) ('ok=' + $sesBody.ok)
  $groups = @($sesBody.sessions)
  Check 'sessions.groups' ($groups.Count -ge 1) ('groups=' + $groups.Count)
  $sesTotal = 0
  foreach ($g in $groups) { $sesTotal += @($g.figures).Count }
  Check 'sessions.total>=figures' ($sesTotal -ge $figs.Count) ('total=' + $sesTotal + ' figures=' + $figs.Count)
}

# 7 delete（幂等 + all 防护），不创建任何数据
$del = Post-Json '/scifig/api/workspace/delete' @{ mode = 'figure'; figureId = 'fig-00000000-000000-0000' }
Check 'delete.nonexistentOk' ($del.body.ok -eq $true) ('ok=' + $del.body.ok)
Check 'delete.nonexistentZero' ([int]$del.body.deleted.figures -eq 0) ('deleted=' + $del.body.deleted.figures)
$delS = Post-Json '/scifig/api/workspace/delete' @{ mode = 'session'; sessionId = 'session-does-not-exist' }
Check 'delete.sessionNonexistentOk' ($delS.body.ok -eq $true) ('ok=' + $delS.body.ok)
if ($AllowDestructive) {
  $allDeny = Post-Json '/scifig/api/workspace/delete' @{ mode = 'all' }
  Check 'delete.allRequiresConfirm' ($allDeny.body.ok -eq $false) ('ok=' + $allDeny.body.ok + ' error=' + $allDeny.body.error)
} else {
  Skip 'delete.allRequiresConfirm' 'pass -AllowDestructive'
}

Write-Host ''
Write-Host ('== RESULT: PASS=' + $pass + '  FAIL=' + $fail + '  SKIP=' + $skip + ' ==') -ForegroundColor Cyan
if ($fail -gt 0) {
  Write-Host 'failures:' -ForegroundColor Red
  $notes | ForEach-Object { Write-Host ('  - ' + $_) -ForegroundColor Red }
  exit 1
}
exit 0
