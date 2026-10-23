#!/bin/bash
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
docker compose stop
echo 'Matala has stopped. Your saved jobs and leads remain in the local database.'
read -r -p 'Press Return to close...'
