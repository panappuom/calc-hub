param(
  [Parameter(Mandatory=$true)][string]$Name,
  [string]$Desc = "auto site",
  [switch]$Private
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$template = $root
$dir = Join-Path (Split-Path $root -Parent) $Name

if (Test-Path $dir) { throw "ディレクトリ既に存在: $dir" }
Copy-Item -Recurse -Force $template $dir
Set-Location $dir

# クリーンアップ: テンプレの .git は持たない
if (Test-Path ".git") { Remove-Item -Recurse -Force ".git" }

# package 名を装置名に
(Get-Content package.json) -replace '"name": "auto-factory-template"', ('"name": "' + $Name + '"') | Set-Content package.json -Encoding UTF8

git init
git add .
git commit -m "chore: bootstrap $Name"

$visibility = $Private.IsPresent ? "--private" : "--public"
gh repo create $env:GITHUB_USER/$Name $visibility --source "." --push --description $Desc --disable-wiki --disable-issues

git branch -M main
git push -u origin main

Write-Host "`nDone. GitHub Pages が自動で公開されます。URLは Actions の 'deploy-pages' 出力に表示されます。" -ForegroundColor Green
