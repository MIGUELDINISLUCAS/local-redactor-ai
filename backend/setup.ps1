# Local Redactor AI — one-shot setup + launch (Windows).
# Installs deps, builds the local model (auto-downloads ~4GB the first time),
# and starts the backend on http://localhost:3001.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "Local Redactor AI - setup"
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "X Node.js is not installed."
  Write-Host "  Install the LTS version from https://nodejs.org , then run this again."
  Read-Host "Press Enter to exit"; exit 1
}

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
  Write-Host "X Ollama is not installed (this runs the local AI model)."
  Write-Host "  Install it from https://ollama.com/download , then run this again."
  Read-Host "Press Enter to exit"; exit 1
}

# Make sure the Ollama server is up.
try { ollama list *> $null } catch {
  Write-Host "- Starting Ollama..."
  Start-Process ollama -ArgumentList "serve" -WindowStyle Hidden
  Start-Sleep -Seconds 3
}

# Build the model once. 'ollama create' downloads the GGUF (~4GB) the first time.
if (-not (ollama list | Select-String "anonymizer-4b-fast")) {
  Write-Host "- Downloading & building the local model (~4GB, one time - go get a coffee)..."
  ollama create anonymizer-4b-fast -f ollama/anonymizer-4b-fast.hf.Modelfile
} else {
  Write-Host "- Local model already installed."
}

Write-Host "- Installing backend dependencies..."
npm install --silent

Write-Host ""
Write-Host "Ready. Starting the backend on http://localhost:3001"
Write-Host "Leave this window open while you use the extension. Press Ctrl+C to stop."
Write-Host ""
npm run dev
