# build_installer.ps1 (VERSION PRO)
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $projectRoot

# Accept optional version parameter or read from VERSION file
param(
    [string]$Version = $(if (Test-Path "$projectRoot\VERSION") { Get-Content "$projectRoot\VERSION" -Raw } else { "0.0.0" })
)

# Allow reproducible-ish builds by setting SOURCE_DATE_EPOCH
if (-not $env:SOURCE_DATE_EPOCH) {
    $env:SOURCE_DATE_EPOCH = [int][double]::Parse((Get-Date -UFormat %s))
}

Write-Host "===================================="
Write-Host "Chess Trainer - BUILD SYSTEM"
Write-Host "===================================="

# ==============================
# 1. PYTHON VENV
# ==============================
$venvPython = "$projectRoot\venv\Scripts\python.exe"

if (!(Test-Path $venvPython)) {
    Write-Host "Creando entorno virtual..."
    python -m venv venv
}

$python = $venvPython

# ==============================
# 2. PIP UPGRADE
# ==============================
Write-Host "Actualizando pip..."
& $python -m pip install --upgrade pip

# ==============================
# 3. PYINSTALLER
# ==============================
Write-Host "Instalando PyInstaller..."
& $python -m pip install pyinstaller

# ==============================
# 4. LIMPIEZA (IMPORTANTE)
# ==============================
Write-Host "Limpiando builds anteriores..."
if (Test-Path "build") { Remove-Item -Recurse -Force build }
if (Test-Path "dist") { Remove-Item -Recurse -Force dist }
if (Test-Path "ChessTrainer.spec") { Remove-Item -Force ChessTrainer.spec }

# Ensure output folder
if (!(Test-Path "$projectRoot\build")) { New-Item -ItemType Directory -Path "$projectRoot\build" | Out-Null }

# ==============================
# 5. ICONO (DINÁMICO)
# ==============================
$iconPath = Join-Path $projectRoot "icon.ico"

if (!(Test-Path $iconPath)) {
    throw "No se encontró icon.ico en el proyecto"
}

# ==============================
# 6. BUILD EXE
# ==============================
Write-Host "Construyendo ChessTrainer.exe..."

& $python -m PyInstaller `
    --windowed `
    --onefile `
    --name "ChessTrainer" `
    --add-data "static;static" `
    --icon=$iconPath `
    launcher.py

# Rename and move exe to include version
$exeName = "ChessTrainer.exe"
$versionedName = "ChessTrainer-v$Version.exe"
$distPath = Join-Path $projectRoot "dist\$exeName"
$outPath = Join-Path $projectRoot "build\$versionedName"
if (Test-Path $distPath) {
    Copy-Item -Path $distPath -Destination $outPath -Force
    Write-Host "EXE creado: build\$versionedName"
} else {
    throw "No se encontró el ejecutable en dist\$exeName"
}

# ==============================
# 7. FINAL
# ==============================
Write-Host ""
Write-Host "===================================="
Write-Host "BUILD COMPLETADO"
Write-Host "EXE en: build\$versionedName"
Write-Host "===================================="