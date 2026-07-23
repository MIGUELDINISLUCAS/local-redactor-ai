#!/usr/bin/env bash
# Double-clickable launcher for macOS (Finder). Runs the installer in this folder.
cd "$(dirname "$0")"
exec bash ./install-thorough-model.sh
