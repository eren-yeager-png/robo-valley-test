#!/usr/bin/env bash
# One-time LOCAL WordPress setup (Docker). Installs WordPress, the Astra theme and free Elementor from wordpress.org,
# activates the RoboValley Landing plugin and creates the "Find a Service" page from frontend/elementor/find-a-service-510.
# Idempotent. Never touches production. Needs the containers from docker-compose.wordpress.yml to be running.
set -euo pipefail
cd "$(dirname "$0")/.."
WP() { MSYS_NO_PATHCONV=1 docker compose -f docker-compose.wordpress.yml --env-file .env.local run --rm -T wpcli wp "$@"; }

for i in $(seq 1 30); do curl -fsS -o /dev/null http://localhost:8080/ 2>/dev/null && break; [ "$i" = 30 ] && echo "WordPress container not answering on :8080" && exit 1; sleep 2; done
WP config set WP_DEBUG false --raw >/dev/null 2>&1 || true

if ! WP core is-installed 2>/dev/null; then
  # --admin_password comes from the container environment (WP_ADMIN_PASSWORD), never from this file.
  MSYS_NO_PATHCONV=1 docker compose -f docker-compose.wordpress.yml --env-file .env.local run --rm -T wpcli sh -c \
    'wp core install --url=http://localhost:8080 --title="RoboValley (local)" --admin_user=wpadmin --admin_password="$WP_ADMIN_PASSWORD" --admin_email=wpadmin@example.test --skip-email'
fi
WP theme install astra --activate
WP plugin install elementor --activate
WP plugin activate robovalley-landing
# Where the browser finds the RoboValley API (Next.js). Empty on a site means the API features stay off.
WP option update robovalley_api_base "${ROBOVALLEY_API_BASE:-http://localhost:3000}" >/dev/null
WP rewrite structure '/%postname%/' --hard >/dev/null 2>&1 || WP rewrite structure '/%postname%/'

if [ -z "$(WP post list --post_type=page --name=find-a-service --field=ID)" ]; then
  ID=$(WP post create --post_type=page --post_status=publish --post_title="Find a Service" --post_name=find-a-service --porcelain)
else
  ID=$(WP post list --post_type=page --name=find-a-service --field=ID)
fi
# Elementor stores the widget tree as JSON in _elementor_data. The export's "content" field is exactly that.
WP eval-file /scripts/wp-import-page.php "$ID"
WP eval-file /scripts/wp-apply-header.php
WP elementor flush-css >/dev/null 2>&1 || true
echo "Done: http://localhost:8080/find-a-service/   (wp-admin user: wpadmin, password: WP_ADMIN_PASSWORD in .env.local)"
