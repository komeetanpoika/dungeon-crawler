#!/usr/bin/env bash
# Deploy the web release (static game + /pvp WebSocket) to Cloud Run.
# One instance holds every room; sockets may live an hour; many per instance.
set -euo pipefail
cd "$(dirname "$0")/.."
gcloud run deploy dungeon-crawler --source . --project delimaster --region europe-west4 \
  --allow-unauthenticated --max-instances=1 --timeout=3600 --concurrency=1000 --quiet
