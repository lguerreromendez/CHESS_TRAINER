<#
make_exe.ps1
Helper script to build a versioned .exe reproducibly (best-effort)
Usage: .\make_exe.ps1 -Version 1.2.3
#>
param(
    [Parameter(Mandatory=$false)]
    [string]$Version = $(if (Test-Path "VERSION") { Get-Content "VERSION" -Raw } else { "0.0.0" })
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $projectRoot

Write-Host "Making ChessTrainer .exe (version: $Version)"

# Create or update VERSION file
Set-Content -Path "$projectRoot\VERSION" -Value $Version -Force

# Create virtualenv if missing
$venvPython = "$projectRoot\venv\Scripts\python.exe"
if (!(Test-Path $venvPython)) {
    Write-Host "Creando entorno virtual..."
    python -m venv venv
}
$python = $venvPython

Write-Host "Instalando dependencias..."
& $python -m pip install --upgrade pip
if (Test-Path "requirements.txt") {
    & $python -m pip install -r requirements.txt
}
& $python -m pip install pyinstaller

Write-Host "Limpieza..."
if (Test-Path "build") { Remove-Item -Recurse -Force build }
if (Test-Path "dist") { Remove-Item -Recurse -Force dist }
if (Test-Path "ChessTrainer.spec") { Remove-Item -Force ChessTrainer.spec }
if (!(Test-Path "build")) { New-Item -ItemType Directory -Path "build" | Out-Null }

# Set reproducible timestamp (best-effort)
if (-not $env:SOURCE_DATE_EPOCH) { $env:SOURCE_DATE_EPOCH = [int][double]::Parse((Get-Date -UFormat %s)) }

$iconPath = Join-Path $projectRoot "icon.ico"
if (!(Test-Path $iconPath)) { throw "No se encontró icon.ico" }

Write-Host "Ejecutando PyInstaller..."
& $python -m PyInstaller --windowed --onefile --name "ChessTrainer" --add-data "static;static" --icon=$iconPath launcher.py

# Version the output
$exeName = "ChessTrainer.exe"
$versionedName = "ChessTrainer-v$Version.exe"
$distPath = Join-Path $projectRoot "dist\$exeName"
$outPath = Join-Path $projectRoot "build\$versionedName"
if (Test-Path $distPath) {
    Copy-Item -Path $distPath -Destination $outPath -Force
    Write-Host "Creado: build\$versionedName"
} else {
    throw "No se encontró el exe en dist\$exeName"
}

# Generate SHA256 for release
Write-Host "Generando SHA256..."
Get-FileHash -Algorithm SHA256 $outPath | Select-Object -ExpandProperty Hash | Set-Content "$outPath.sha256"

Write-Host "Hecho. Archivos en build/"
Write-Host " - $versionedName"
Write-Host " - $versionedName.sha256"
