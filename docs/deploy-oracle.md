# Putting Anthropotomy online with Oracle Cloud (free)

Oracle Cloud's Always Free tier gives a small Linux server at no cost, with no time limit. This guide puts Anthropotomy on it with a free address from DuckDNS (for example `https://anthropotomy.duckdns.org`) and HTTPS. Your data from this PC moves with it.

You do the steps that need your accounts and card; the scripts in `deploy/` do the rest. Allow about an hour the first time.

## What it costs

Nothing, as long as you stay inside the Always Free limits. Oracle asks for a card only to verify you; it says the Always Free resources are never charged. Two things to know:

- **Free accounts can lose idle servers.** Oracle may reclaim an Always Free server that sits almost unused for a week. A class using the site keeps it busy; over a long break it may not be. Upgrading the account to **Pay As You Go** stops that, and Always Free resources stay free there too. If you upgrade, set a budget alert (Billing → Budgets, for example ₱100) so anything outside the free tier is caught at once.
- Sign-up is sometimes refused, and the free servers can be "out of capacity" in a region for a while. Try again later, or use the smaller shape in step 2.

## 1. Create the Oracle Cloud account

1. Go to https://www.oracle.com/cloud/free/ and choose **Start for free**.
2. Pick the **home region** closest to your students, for example **Singapore**. It cannot be changed later, and Always Free servers only run in the home region.
3. Verify your email, phone and card as asked. A small temporary hold may appear on the card; Oracle releases it.

## 2. Create the server

In the Oracle Cloud console, open **Compute → Instances → Create instance**.

1. **Name:** `anthropotomy`.
2. **Image:** **Change image → Ubuntu → Canonical Ubuntu 24.04**.
3. **Shape:** **Change shape → Ampere → VM.Standard.A1.Flex**, with **2 OCPUs and 12 GB memory** (the free tier allows up to 4 and 24). If it says it is out of capacity, choose **Specialty and previous generation → VM.Standard.E2.1.Micro** instead; it is smaller but enough for a class, and the setup adds swap for it.
4. **Networking:** keep the new virtual cloud network and **Assign a public IPv4 address**.
5. **Add SSH keys:** choose **Generate a key pair for me** and **Save private key**. Keep the `.key` file safe: it is the only way into the server. Move it to `C:\Users\<you>\.ssh\anthropotomy.key`.
6. Choose **Create**. When the instance is **Running**, copy its **Public IP address**.

## 3. Open the web ports

The server only accepts SSH until you allow web traffic.

1. On the instance page, open the **Subnet** link, then the **Default Security List**.
2. **Add Ingress Rules**, twice: **Source CIDR** `0.0.0.0/0`, **IP Protocol** TCP, **Destination Port Range** `80`, then the same with `443`.

## 4. Get a free address from DuckDNS

1. Go to https://www.duckdns.org and sign in (with Google or GitHub).
2. Under **domains**, type the name you want, for example `anthropotomy`, and choose **add domain**. If it is taken, try another, such as `anthropotomy-ph`.
3. Copy the **token** shown at the top of the page. Keep it private; it controls the address.

## 5. Export your data from this PC

With MySQL running in XAMPP, open PowerShell and run:

```powershell
powershell -ExecutionPolicy Bypass -File C:\xampp\htdocs\Anthropotomy\deploy\export-local.ps1
```

It writes `anthropotomy.sql` (the database) and `anthropotomy-files.tar.gz` (photos, lesson media, teacher files and mail settings) to `C:\xampp\anthropotomy-export\`. Skip this step to start the server with an empty database instead.

## 6. Copy the export to the server

Windows needs the key file to be readable by you alone, once:

```powershell
icacls "$env:USERPROFILE\.ssh\anthropotomy.key" /inheritance:r /grant:r "$($env:USERNAME):R"
```

Then copy the export, replacing `PUBLIC_IP` with the address from step 2:

```powershell
scp -i "$env:USERPROFILE\.ssh\anthropotomy.key" C:\xampp\anthropotomy-export\anthropotomy.sql C:\xampp\anthropotomy-export\anthropotomy-files.tar.gz ubuntu@PUBLIC_IP:~
```

Answer `yes` the first time it asks about the server's fingerprint.

## 7. Set up the server

Sign in to the server:

```powershell
ssh -i "$env:USERPROFILE\.ssh\anthropotomy.key" ubuntu@PUBLIC_IP
```

Then download and run the setup script, putting in your DuckDNS name, token and email:

```bash
curl -fsSLO https://raw.githubusercontent.com/Ezkiel2004/Anthropotomy/main/deploy/setup-oracle.sh
DUCKDNS_NAME=anthropotomy DUCKDNS_TOKEN=your-token LETSENCRYPT_EMAIL=you@example.com sudo -E bash setup-oracle.sh
```

It takes about five minutes. It installs Apache, PHP and MariaDB, opens the firewall, points your DuckDNS address at the server, downloads the app from GitHub, imports your database and files, gets the HTTPS certificate and sets up a nightly database backup. When it prints **Done**, open `https://anthropotomy.duckdns.org` (your name) and sign in with your usual account. Then delete the export copies, as it says, and the ones on this PC in `C:\xampp\anthropotomy-export\`.

If it stops with an error, read the line above the error; running it again is safe.

## 8. First teacher account (empty database only)

Skip this if you imported your data in step 5. On a new, empty database, create the first teacher on the server:

```bash
sudo ANTHROPOTOMY_BOOTSTRAP_USERNAME=teacher ANTHROPOTOMY_BOOTSTRAP_NAME="Your Name" ANTHROPOTOMY_BOOTSTRAP_TEACHER_ID=T-001 ANTHROPOTOMY_BOOTSTRAP_PASSWORD='a-long-password' bash -c 'set -a; . /etc/anthropotomy/db.env; php /var/www/anthropotomy/database/create_teacher.php'
```

## Keeping it up to date

After new changes are pushed to GitHub, sign in to the server (step 7) and run:

```bash
sudo bash /var/www/anthropotomy/deploy/update.sh
```

It downloads the latest code, applies database upgrades and reloads Apache. Uploaded files and the database are kept.

## Where things are on the server

- App: `/var/www/anthropotomy` (uploads in `uploads/`, teacher files and mail settings in `storage/`).
- Database login and DuckDNS token: `/etc/anthropotomy/` (root only).
- Nightly backups: `/var/backups/anthropotomy/`, kept for 14 days. To keep one on this PC, run `sudo install -o ubuntu -m 600 /var/backups/anthropotomy/anthropotomy-$(date +%F).sql.gz ~` on the server, then from this PC `scp -i "$env:USERPROFILE\.ssh\anthropotomy.key" "ubuntu@PUBLIC_IP:~/anthropotomy-*.sql.gz" .`
- Logs: `/var/log/apache2/anthropotomy-error.log`.

Only the app's own pages are served (the landing and sign-in pages, `api/`, `assets/`, `student/`, `teacher/`, `system_model/` and `uploads/`); everything else in the repository returns 404.
