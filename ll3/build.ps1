# 產生要上傳到 ll3 主機的 Big5 檔案：ll3\dist\kaki_order、ll3\dist\order
#  - line_config.asp / line_api.asp / line_token.asp：由 ll3\src（UTF-8）套入各系統設定
#  - vieworder_suda.asp：由 chou-suda-print 的線上版本加上 include 與「LINE 通知客人寄出」區塊
#  金鑰讀 .env.local 的 LL3_LINE_KEY（不寫進原始碼）
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $PSScriptRoot 'src'
$dist = Join-Path $PSScriptRoot 'dist'
$suda = Join-Path (Split-Path -Parent $root) 'chou-suda-print'

$envFile = Join-Path $root '.env.local'
$key = $null
foreach ($line in [IO.File]::ReadAllLines($envFile)) {
  $l = $line.TrimStart([char]0xFEFF)
  if ($l -match '^\s*LL3_LINE_KEY\s*=\s*(.+?)\s*$') { $key = $Matches[1].Trim('"') }
}
if (-not $key) { throw '.env.local 沒有 LL3_LINE_KEY' }

$big5 = [Text.Encoding]::GetEncoding(950, [Text.EncoderExceptionFallback]::new(), [Text.DecoderExceptionFallback]::new())

$systems = @(
  @{ dir = 'kaki_order'; code = 'asp_change_code'; sys = 'kaki'; label = '甜柿'; ship = 'KakaShipPrice'; cod = 'KakaCodFee' },
  @{ dir = 'order'; code = 'peach_asp_change_code'; sys = 'peach'; label = '水蜜桃'; ship = 'PeachShipPrice'; cod = 'PeachCodFee' }
)

function Save-Big5($path, $text) {
  $text = ($text -replace "`r`n", "`n") -replace "`n", "`r`n"
  [IO.File]::WriteAllBytes($path, $big5.GetBytes($text))
}

foreach ($s in $systems) {
  $out = Join-Path $dist $s.dir
  New-Item -ItemType Directory -Force $out | Out-Null
  foreach ($f in 'line_config.asp', 'line_api.asp', 'line_token.asp') {
    $t = [IO.File]::ReadAllText((Join-Path $src $f), [Text.Encoding]::UTF8)
    $t = $t.Replace('{{SYS}}', $s.sys).Replace('{{LABEL}}', $s.label).Replace('{{SHIP}}', $s.ship).Replace('{{COD}}', $s.cod).Replace('{{KEY}}', $key)
    if ($t -match '\{\{') { throw "$f 還有沒取代的 {{…}}" }
    Save-Big5 (Join-Path $out $f) $t
  }
  # vieworder_suda.asp
  $vf = Join-Path (Join-Path $suda $s.code) 'vieworder_suda.asp'
  $v = $big5.GetString([IO.File]::ReadAllBytes($vf))
  $inc = '<!-- #include file="buyer_config.asp" -->'
  $anchor = '<div style="margin-top:14px; padding-top:10px; border-top:1px solid #F0DDA8">'
  foreach ($a in $inc, $anchor) {
    $n = ([regex]::Matches($v, [regex]::Escape($a))).Count
    if ($n -ne 1) { throw "$($s.dir) vieworder_suda.asp 找到 $n 個「$a」（應為 1 個）" }
  }
  if ($v.Contains('line_config.asp')) { throw "$($s.dir) vieworder_suda.asp 已經有 line_config.asp" }
  $v = $v.Replace($inc, $inc + "`r`n" + '<!-- #include file="line_config.asp" -->')
  $v = $v.Replace($anchor, '<%LineNotifyBox sudaNo%>' + "`r`n`t  " + $anchor)
  [IO.File]::WriteAllBytes((Join-Path $out 'vieworder_suda.asp'), $big5.GetBytes($v))
  Write-Output "$($s.dir)：完成 → $out"
}
