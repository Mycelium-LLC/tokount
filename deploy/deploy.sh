#!/usr/bin/env bash
# Deploy the tokount service from a clean checkout of the release tag (or its merge commit), as hello@.
#   deploy/deploy.sh
# The mycx.dev route (/tokount, /api/tokount), robots.txt and sitemap.xml belong to Mycelium-LLC/mycx-hosting;
# this repo never deploys Hosting. The npm package publishes from CI (.github/workflows/publish.yml) on the tag.
set -euo pipefail
cd "$(dirname "$0")/.."

P=mycelium-hq
REGION=us-central1
SA=tokount-web@$P.iam.gserviceaccount.com
OPS_URL=https://mycelium-ops-zmvkiuplba-uc.a.run.app
VERSION=$(node -p "require('./service/package.json').version")
COMMIT=$(git rev-parse HEAD)
BUILT_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [ -n "$(git status --porcelain)" ]; then echo "refusing: the checkout has uncommitted changes" >&2; exit 1; fi
test "$(node -p "require('./package/package.json').version")" = "$VERSION" || { echo "refusing: package and service versions differ" >&2; exit 1; }

echo "== service tokount $VERSION ($COMMIT)"
# Public by design: Hosting calls it. min-instances 0 (an idle service costs nothing); max 3 bounds a runaway.
gcloud run deploy tokount --project $P --region $REGION --source service \
  --service-account "$SA" --allow-unauthenticated \
  --set-env-vars "COMMIT_SHA=$COMMIT,BUILT_AT=$BUILT_AT,OPS_URL=$OPS_URL,TOKOUNT_COLLECTION=tokount_profiles" \
  --cpu 1 --memory 512Mi --min-instances 0 --max-instances 3 --concurrency 40

echo "== live"
RUN_URL=$(gcloud run services describe tokount --project $P --region $REGION --format 'value(status.url)')
# The CDN can hold version.json for minutes: a cache-buster reads the origin, and an empty or failed read fails loudly.
for url in "https://mycx.dev/tokount/version.json?v=$COMMIT" "$RUN_URL/api/health"; do
  body=$(curl -sf "$url") || { echo "live check failed: $url did not answer" >&2; exit 1; }
  [ -n "$body" ] || { echo "live check failed: $url answered empty" >&2; exit 1; }
  echo "$body"
  echo "$body" | grep -q "\"version\":\"$VERSION\"" && echo "$body" | grep -q "$COMMIT" || { echo "live check failed: $url" >&2; exit 1; }
done
curl -sf -o /dev/null -w "landing %{http_code}\n" https://mycx.dev/tokount/
curl -sf -o /dev/null -w "og.png %{http_code} %{content_type}\n" https://mycx.dev/tokount/og.png
for icon in favicon.svg favicon.ico apple-touch-icon.png manifest.webmanifest; do
  curl -sf -o /dev/null -w "$icon %{http_code} %{content_type}\n" "https://mycx.dev/tokount/$icon" || { echo "live check failed: $icon" >&2; exit 1; }
done
