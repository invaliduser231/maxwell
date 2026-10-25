param(
  [Parameter(Mandatory)] [string]$Values,
  [string]$Namespace = 'maxwell',
  [string]$Release = 'maxwell',
  [string]$Kubeconfig = $env:KUBECONFIG,
  [string]$Registry = 'ghcr.io/invaliduser231',
  [string]$Tag,
  [switch]$SkipBuild,
  [switch]$SkipPush,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$chart = Join-Path $root 'deploy/helm/maxwell'

$helm = (Get-Command helm -ErrorAction SilentlyContinue).Source
if (-not $helm) {
  $helm = Join-Path (Split-Path $root -Parent) '.tools/helm/windows-amd64/helm.exe'
  if (-not (Test-Path $helm)) { throw 'helm not found' }
}

if (-not (Test-Path $Values)) { throw "values file not found: $Values" }
if (-not $DryRun -and -not $Kubeconfig) { throw 'pass -Kubeconfig or set KUBECONFIG' }

if (-not $Tag) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmm'
  $hash = git -C $root rev-parse --short HEAD 2>$null
  $Tag = if ($LASTEXITCODE -eq 0 -and $hash) { "$stamp-$hash" } else { $stamp }
}

$images = @(
  @{ Name = 'maxwell-bot'; Dockerfile = 'apps/bot/Dockerfile' },
  @{ Name = 'maxwell-dashboard'; Dockerfile = 'apps/dashboard/Dockerfile' }
)

foreach ($image in $images) {
  $ref = "$Registry/$($image.Name):$Tag"
  if (-not $SkipBuild) {
    Write-Host "build $ref"
    docker build --platform linux/amd64 -f (Join-Path $root $image.Dockerfile) -t $ref $root
    if ($LASTEXITCODE -ne 0) { throw "build failed: $ref" }
  }
  if (-not $SkipPush -and -not $DryRun) {
    Write-Host "push $ref"
    docker push $ref
    if ($LASTEXITCODE -ne 0) { throw "push failed: $ref" }
  }
}

$helmArgs = @(
  'upgrade', '--install', $Release, $chart,
  '--namespace', $Namespace,
  '--values', $Values,
  '--set-string', "bot.image.tag=$Tag",
  '--set-string', "dashboard.image.tag=$Tag",
  '--set-string', "bot.image.repository=$Registry/maxwell-bot",
  '--set-string', "dashboard.image.repository=$Registry/maxwell-dashboard",
  '--wait', '--timeout', '10m'
)
if ($Kubeconfig) { $helmArgs += @('--kubeconfig', $Kubeconfig) }

if ($DryRun) {
  & $helm template $Release $chart --namespace $Namespace --values $Values --set-string "bot.image.tag=$Tag" --set-string "dashboard.image.tag=$Tag" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'helm template failed' }
  Write-Host "dry run ok, tag $Tag"
  return
}

& $helm @helmArgs
if ($LASTEXITCODE -ne 0) { throw 'helm upgrade failed' }
Write-Host "deployed $Tag to $Namespace"
