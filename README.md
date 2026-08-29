"# CHESS_TRAINER" 
"# CHESS_TRAINER" 

## Build (Windows)

Quick build for a versioned `.exe` (PowerShell):

```powershell
.\make_exe.ps1 -Version 0.1.0
```

A GitHub Actions workflow is included at `.github/workflows/build-release.yml` to build on Windows and publish to Releases when pushing tags or triggering manually.
