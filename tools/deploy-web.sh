#!/usr/bin/env bash
# Deploy the web release (static game + /pvp WebSocket) to Google Cloud Run.
# One instance holds every room; sockets may live an hour; many per instance.
#
#   GCP_PROJECT=<your-project-id> tools/deploy-web.sh
#
# Optional: REGION (default europe-west4), SERVICE (default dungeon-crawler).
# The upload is limited to what the Dockerfile needs by .gcloudignore.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${GCP_PROJECT:?set GCP_PROJECT to your Google Cloud project id}"
gcloud run deploy "${SERVICE:-dungeon-crawler}" --source . --project "$GCP_PROJECT" \
  --region "${REGION:-europe-west4}" \
  --allow-unauthenticated --max-instances=1 --timeout=3600 --concurrency=1000 --quiet
