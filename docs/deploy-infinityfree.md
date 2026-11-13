# Putting Anthropotomy online with InfinityFree (free, no card)

InfinityFree is free PHP and MySQL hosting, the same kind of setup as XAMPP. This guide moves Anthropotomy and its data from this PC to an address such as `https://anthropotomy.infinityfreeapp.com`. Allow about 45 minutes the first time.

## Limits to know first

- **Uploads:** each file can be at most 10 MB, so long lesson videos will not upload. Slide decks, PDFs and photos are fine.
- **Email** (announcement emails through Gmail) may be blocked on free hosting. Everything else works without it.
- **Busy times:** the account allows a fixed number of requests a day. A class of about 40 using the site for a couple of hours a day fits; if the limit is reached the site pauses until the next day.
- **Backups and database upgrades are manual:** there is no command line. Export the database from phpMyAdmin now and then (step 9).
- **First visit:** each browser sees a short "checking your browser" page once. That is InfinityFree's protection and is normal.
<<<<<<< HEAD
=======
- **Slide and document previews:** students read PowerPoint and Word files inside the site from a PDF copy made with LibreOffice, and the free host cannot run it. Copies made on this PC arrive with the site (step 4 packs `uploads\` and `storage\`), so before step 4 run `C:\xampp\php\php.exe database\convert_previews.php` here once to give every deck and document its copy. A PowerPoint or Word file uploaded directly on the online site has no copy, so students download it instead.
>>>>>>> 6288eaf (50%% revision)

## 1. Create the InfinityFree account

1. Go to https://www.infinityfree.com and choose **Register**. Sign up with your email and verify it.
2. In the client area choose **Create Account**.
3. **Domain:** choose **Subdomain**, type the name you want (for example `anthropotomy`) and pick one of the free endings, such as `infinityfreeapp.com`. This is your site's address. Choose **Create Account**.
4. Wait until the account shows **Active** (a few minutes).

## 2. Create the database

1. Open the account, then **Control Panel** (accept its terms the first time).
2. Open **MySQL Databases**, type `anthropotomy` as the new database name and choose **Create Database**.
3. Write down the four values InfinityFree shows on that page or in the client area under **MySQL Details**:
   - **MySQL Host Name**, like `sql123.infinityfree.com`
   - **MySQL Database Name**, like `if0_12345678_anthropotomy`
   - **MySQL User Name**, like `if0_12345678`
   - **MySQL Password**: your hosting account password, shown under **Account Details → Show** in the client area

## 3. Get the FTP login

In the client area, under **FTP Details**, note the **FTP Hostname** (like `ftpupload.net`), **FTP Username** (the same `if0_…` name) and **FTP Password** (the same account password). You will upload with FileZilla, a free FTP program: install **FileZilla Client** from https://filezilla-project.org.

## 4. Build the upload on this PC

Start MySQL in XAMPP, open PowerShell and run:

```powershell
powershell -ExecutionPolicy Bypass -File C:\xampp\htdocs\Anthropotomy\deploy\package-infinityfree.ps1
```

It asks for the four MySQL values from step 2, then creates `C:\xampp\anthropotomy-infinityfree\` with:

- `htdocs\`: only what the site needs, your uploaded files, and the database login.
- `anthropotomy.sql`: your database (accounts, lessons, quizzes, results).

## 5. Import the database

1. In the InfinityFree control panel, open **MySQL Databases** and choose **Admin** (phpMyAdmin) next to your database.
2. Choose the **Import** tab, then **Choose File** and pick `C:\xampp\anthropotomy-infinityfree\anthropotomy.sql`.
3. Choose **Import** (or **Go**) at the bottom. It should finish with a green success message.

## 6. Upload the site

1. Open FileZilla. Fill in **Host** (the FTP Hostname), **Username**, **Password** and **Port** `21`, then choose **Quickconnect**.
2. On the right (the server), open the `htdocs` folder. Delete the files InfinityFree put there (such as `index2.html`).
3. On the left (this PC), open `C:\xampp\anthropotomy-infinityfree\htdocs`, select everything inside it (including `.htaccess`) and drag it into `htdocs` on the right.
4. Wait for **Queued files** to reach zero. It can take 10 to 20 minutes for the first upload. If any transfers show under **Failed transfers**, right-click them and choose **Reset and requeue all**.

FileZilla hides files that start with a dot on some setups; if `.htaccess` is missing on the left, choose **Server → Force showing hidden files**.

## 7. Turn on HTTPS

Open `https://` followed by your address. If the browser says the connection is not secure, go to the client area, open **SSL Certificates**, choose your address and follow the steps to issue a free certificate; it can take up to an hour to appear.

## 8. Check it works

1. Open your address and sign in with your usual teacher account.
2. Open a lesson, the 3D explorer and a quiz.
3. Upload a profile photo in Settings.
<<<<<<< HEAD
=======
4. Sign in as a student and open a PowerPoint lesson: it should open in the viewer with no Download button (unless you turned downloads on for it).
5. Type the direct address of one of its files, `https://` followed by your address and `/uploads/lessons/` and the file's name (the `lesson_...pptx` name in the `uploads\lessons` folder you uploaded). The browser must show **Forbidden** (403), not download the file. If it downloads, the host is ignoring `.htaccess`: tell whoever maintains the site before students use it.
>>>>>>> 6288eaf (50%% revision)

Then delete `C:\xampp\anthropotomy-infinityfree\` from this PC: it holds the database password and student records.

## 9. Keeping it up to date and backed up

- **Backups:** every week or so, open phpMyAdmin (step 5), choose your database, the **Export** tab and **Go**. Keep the downloaded `.sql` file somewhere safe.
- **New code:** after changes are pushed to GitHub, pull them on this PC, run step 4 again and upload only the changed folders with FileZilla. Do **not** re-import `anthropotomy.sql` once students use the online site: it would replace their data with this PC's copy. When a change also needs a database upgrade, ask for the SQL to paste into phpMyAdmin's **SQL** tab.

## If something goes wrong

- **"Database unavailable"**: a value in step 4 was mistyped. Run step 4 again and upload only `storage\db.ini`.
- **Error 500 on every page**: re-upload `.htaccess` and the `api` folder; a file may have been cut off during upload.
- **A page loads but nothing saves**: open the site with `https://` and the exact address InfinityFree shows, not a different spelling.
