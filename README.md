# Book library

A website that shows your documents as books, two pages at a time, with a page-turning animation. Visitors can only read. Books are added through this repository.

## Publish it

1. Create a repository on GitHub and upload everything in this folder, including the hidden `.github` folder. Pushing with Git is the safest way to keep that folder.
2. In the repository, open **Settings > Pages** and set **Source** to **GitHub Actions**.
3. Open the **Actions** tab. If the first run failed because Pages was not on yet, open it and choose **Re-run all jobs**.
4. When the run is green, your site is at `https://YOUR-NAME.github.io/REPOSITORY-NAME/`.

## Add, replace or remove a book

Change the files in `assets/` and push. The site updates in a few minutes.

Supported: `.docx .doc .odt .rtf .pptx .ppt .odp .xlsx .xls .ods .csv .pdf .epub .md .html .txt .jpg .png .webp .gif .bmp .tiff`

A file that can't be converted is skipped, and the rest of the library still publishes. Look for the warning on the run's page in the **Actions** tab.

Delete `Welcome to your library.docx` when you no longer need it.

## Settings

Edit `library.json`. Everything under `books` is optional, and each key is the file's path inside `assets/`.

```json
{
  "title": "My Library",
  "tagline": "Open a book and turn the pages.",
  "books": {
    "my_scanned_book.pdf": { "title": "A better title", "direction": "rtl" },
    "slides.pptx": { "cover": false }
  }
}
```

- `title`: shown instead of the file name.
- `direction`: `rtl` or `ltr`. Arabic and Hebrew text is detected automatically, but scanned books have no text to detect.
- `cover`: `false` starts with two facing pages instead of a single cover.

## Who can see what

- Only people with write access to the repository can publish. The website has no upload feature.
- The site publishes page images only, never your original files.
- **In a public repository, anyone can download the originals from `assets/` on GitHub.** To keep them private, use a private repository, which GitHub Pages supports on paid plans. The website itself stays public either way.
- Anyone who can read a page can screenshot it or save its image. No website can fully prevent that.

## Limits

GitHub Pages sites can be up to 1 GB, with a soft limit of 100 GB of traffic a month. GitHub rejects single files over 100 MB unless you use Git LFS.

## Preview on your own computer

Needs Python with Pillow, LibreOffice, Poppler and Pandoc.

```
python3 scripts/build.py
python3 -m http.server -d dist
```
