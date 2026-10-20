# Magic-Website
Magic Website for Mentalism and Magic for Farhad Baloch

## Checking the site before you merge

The files in this folder are the whole website. GitHub Pages publishes them at https://farhadbaloch.com/. A browser check confirms the public site still has the pieces visitors and search engines rely on:

- The phone number 832-302-1130 and the email farhadkbaloch@gmail.com
- The contact form, which sends to FormSubmit (the check never submits the form)
- The red Contact button on a phone-sized screen, and that tapping it scrolls to the form
- The YouTube and Facebook videos, which load when a visitor clicks them
- The 404 page, including a link back home
- The logo and the favicon
- Search tags, the sitemap, and robots.txt
- No leftover placeholder text, and no em dashes in the words people can read

GitHub runs this on every pull request, and again whenever someone pushes to the `main` branch. If a check fails, the pull request is marked failed. Screenshots from that run are saved as a download named `verify-evidence`.

### Run the same check on your computer

You need Node.js 20 or newer and Python 3. From the project folder:

```bash
cd scripts/verify
npm install
./verify.sh
```

That looks at the live site, https://farhadbaloch.com/.

To check the files on your computer instead, which is what a pull request does:

```bash
cd scripts/verify
npm install
./verify.sh --local
```

The script serves this folder at http://127.0.0.1:4173/ and points the checks there. Pictures and a `results.json` file are written to `scripts/verify/evidence/`.

The first run downloads a browser (Playwright's Chromium) if Google Chrome is not already installed. You can choose a browser with `CHROME=/path/to/chrome ./verify.sh`.

The share-image tags in the page must stay full `https://farhadbaloch.com/...` addresses, because that is what Facebook and others read. The check then downloads the image file from the copy of the site it was pointed at, so a pull request is judged by its own files.
