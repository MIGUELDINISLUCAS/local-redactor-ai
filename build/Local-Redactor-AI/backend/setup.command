#!/usr/bin/env bash
# Double-clickable launcher for macOS (Finder). Runs setup.sh in this folder.
cd "$(dirname "$0")"
exec bash ./setup.sh
