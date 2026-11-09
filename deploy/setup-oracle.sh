#!/usr/bin/env bash
# Anthropotomy on an Oracle Cloud Always Free Ubuntu 24.04 server: Apache, PHP, MariaDB,
# a free DuckDNS address and HTTPS from Let's Encrypt. Step-by-step guide: docs/deploy-oracle.md.
#
# Run once on the server, from the home folder holding the files copied from the PC
# (both optional; without them the server starts with an empty database):
#   anthropotomy.sql             the database, from deploy/export-local.ps1
#   anthropotomy-files.tar.gz    uploads and teacher files, from the same export
#
#   DUCKDNS_NAME=anthropotomy DUCKDNS_TOKEN=... LETSENCRYPT_EMAIL=you@example.com sudo -E bash setup-oracle.sh
#
# Safe to run again: it keeps the database, its password and anything already set up.
set -euo pipefail

: "${DUCKDNS_NAME:?Set DUCKDNS_NAME, the part before .duckdns.org}"
: "${DUCKDNS_TOKEN:?Set DUCKDNS_TOKEN, shown at the top of duckdns.org once signed in}"
: "${LETSENCRYPT_EMAIL:?Set LETSENCRYPT_EMAIL, where certificate expiry notices go}"
TIMEZONE="${TIMEZONE:-Asia/Manila}"
[ "$(id -u)" -eq 0 ] || { echo "Run it with sudo -E." >&2; exit 1; }

DOMAIN="$DUCKDNS_NAME.duckdns.org"
APP=/var/www/anthropotomy
REPO=https://github.com/Ezkiel2004/Anthropotomy.git
CONF=/etc/anthropotomy  # database password and DuckDNS token, readable by root only
HOME_DIR=$(getent passwd "${SUDO_USER:-ubuntu}" | cut -d: -f6)
export DEBIAN_FRONTEND=noninteractive

echo "== Packages"
apt-get update -q
apt-get install -yq apache2 libapache2-mod-php php-mysql php-mbstring mariadb-server \
  certbot python3-certbot-apache git curl iptables-persistent netfilter-persistent

echo "== Time zone $TIMEZONE (study days and quiz deadlines follow the server's calendar day)"
timedatectl set-timezone "$TIMEZONE"
for dir in /etc/php/*/apache2/conf.d /etc/php/*/cli/conf.d; do
  echo "date.timezone = $TIMEZONE" > "$dir/99-anthropotomy.ini"
done
systemctl restart mariadb

echo "== Swap (the 1 GB micro server needs it next to MariaDB)"
if [ "$(free -m | awk '/^Mem:/{print $2}')" -lt 2000 ] && ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== Firewall: Oracle's Ubuntu image rejects web traffic unless ports 80 and 443 are opened"
for port in 80 443; do
  if ! iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null; then
    reject=$(iptables -L INPUT --line-numbers | awk '/REJECT/{print $1; exit}')
    if [ -n "$reject" ]; then iptables -I INPUT "$reject" -p tcp --dport "$port" -m state --state NEW -j ACCEPT
    else iptables -A INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT; fi
  fi
done
netfilter-persistent save

echo "== DuckDNS: $DOMAIN points at this server, refreshed every 5 minutes"
install -d -m 700 "$CONF"
printf 'DUCKDNS_NAME=%s\nDUCKDNS_TOKEN=%s\n' "$DUCKDNS_NAME" "$DUCKDNS_TOKEN" > "$CONF/duckdns.env"
chmod 600 "$CONF/duckdns.env"
cat > /usr/local/bin/anthropotomy-duckdns <<'SH'
#!/bin/sh
. /etc/anthropotomy/duckdns.env
curl -fsS "https://www.duckdns.org/update?domains=$DUCKDNS_NAME&token=$DUCKDNS_TOKEN&ip=" | grep -q OK
SH
chmod 700 /usr/local/bin/anthropotomy-duckdns
/usr/local/bin/anthropotomy-duckdns || { echo "DuckDNS refused the update: check DUCKDNS_NAME and DUCKDNS_TOKEN." >&2; exit 1; }
echo "*/5 * * * * root /usr/local/bin/anthropotomy-duckdns" > /etc/cron.d/anthropotomy-duckdns

echo "== App code from GitHub"
if [ -d "$APP/.git" ]; then git -C "$APP" pull --ff-only; else git clone --depth 1 "$REPO" "$APP"; fi
if [ -f "$HOME_DIR/anthropotomy-files.tar.gz" ]; then
  tar -xzf "$HOME_DIR/anthropotomy-files.tar.gz" -C "$APP"
fi
mkdir -p "$APP/storage/files" "$APP/uploads/avatars" "$APP/uploads/lessons"
chown -R www-data:www-data "$APP/uploads" "$APP/storage"

echo "== Database"
if [ ! -f "$CONF/db.env" ]; then
  printf 'ANTHROPOTOMY_DB_HOST=127.0.0.1\nANTHROPOTOMY_DB_NAME=anthropotomy_db\nANTHROPOTOMY_DB_USER=anthropotomy\nANTHROPOTOMY_DB_PASS=%s\n' \
    "$(openssl rand -hex 24)" > "$CONF/db.env"
  chmod 600 "$CONF/db.env"
fi
set -a; . "$CONF/db.env"; set +a
mysql <<SQL
CREATE DATABASE IF NOT EXISTS anthropotomy_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'anthropotomy'@'localhost' IDENTIFIED BY '$ANTHROPOTOMY_DB_PASS';
ALTER USER 'anthropotomy'@'localhost' IDENTIFIED BY '$ANTHROPOTOMY_DB_PASS';
GRANT ALL PRIVILEGES ON anthropotomy_db.* TO 'anthropotomy'@'localhost';
SQL
fresh=0
if [ "$(mysql -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'anthropotomy_db'")" -eq 0 ]; then
  if [ -f "$HOME_DIR/anthropotomy.sql" ]; then mysql anthropotomy_db < "$HOME_DIR/anthropotomy.sql"
  else php "$APP/database/schema.php"; fresh=1; fi
fi
php "$APP/database/migrate.php"
# PHP reads the database login from these, kept out of the web folder and the repository.
sed 's/^\([A-Z_]*\)=\(.*\)$/SetEnv \1 "\2"/' "$CONF/db.env" > "$CONF/apache-env.conf"
chmod 600 "$CONF/apache-env.conf"

echo "== Apache site"
cat > /etc/apache2/sites-available/anthropotomy.conf <<'CONF'
<VirtualHost *:80>
    ServerName __DOMAIN__
    DocumentRoot /var/www/anthropotomy
    <Directory /var/www/anthropotomy>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>
    # Only the app itself is served; docs, sources, scripts and tests stay off the web.
    RewriteEngine On
    RewriteRule "!^/(index\.html|login\.html|favicon\.ico|manifest\.json|(api|assets|student|teacher|system_model|uploads)/.*)?$" - [R=404,L]
    Include /etc/anthropotomy/apache-env.conf
    ErrorLog ${APACHE_LOG_DIR}/anthropotomy-error.log
    CustomLog ${APACHE_LOG_DIR}/anthropotomy-access.log combined
</VirtualHost>
CONF
sed -i "s/__DOMAIN__/$DOMAIN/" /etc/apache2/sites-available/anthropotomy.conf
a2enmod -q rewrite
a2dissite -q 000-default || true
a2ensite -q anthropotomy
apache2ctl configtest
systemctl reload apache2

echo "== HTTPS certificate for $DOMAIN (renews itself)"
certbot --apache -d "$DOMAIN" -m "$LETSENCRYPT_EMAIL" --agree-tos --non-interactive --redirect

echo "== Nightly database backup at 02:30, kept for 14 days in /var/backups/anthropotomy"
cat > /usr/local/bin/anthropotomy-backup <<'SH'
#!/bin/sh
set -e
mkdir -p /var/backups/anthropotomy
mysqldump --single-transaction anthropotomy_db | gzip > "/var/backups/anthropotomy/anthropotomy-$(date +%F).sql.gz"
find /var/backups/anthropotomy -name '*.sql.gz' -mtime +14 -delete
SH
chmod 700 /usr/local/bin/anthropotomy-backup
echo "30 2 * * * root /usr/local/bin/anthropotomy-backup" > /etc/cron.d/anthropotomy-backup

echo
echo "Done. Anthropotomy is at https://$DOMAIN"
[ -f "$HOME_DIR/anthropotomy.sql" ] && echo "Delete the copied export now that it is imported: rm ~/anthropotomy.sql ~/anthropotomy-files.tar.gz"
if [ "$fresh" -eq 1 ]; then
  echo "The database is new and empty. Create the first teacher account (docs/deploy-oracle.md, step 8)."
fi
