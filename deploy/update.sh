#!/usr/bin/env bash
# Bring the Oracle server up to date with GitHub main and apply schema upgrades.
# On the server: sudo bash /var/www/anthropotomy/deploy/update.sh
set -euo pipefail
APP=/var/www/anthropotomy
git -C "$APP" pull --ff-only
set -a; . /etc/anthropotomy/db.env; set +a
php "$APP/database/migrate.php"
systemctl reload apache2
echo "Updated to $(git -C "$APP" log -1 --format='%h %s')"
