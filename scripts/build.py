#!/usr/bin/env python3
"""Turn every file in assets/ into page images and build the site in dist/.

Originals are never copied to dist/, so visitors can only read the pages.
A file that cannot be converted is reported and skipped; the rest still publish.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
WEB = ROOT / "web"
DIST = ROOT / "dist"
CACHE = ROOT / ".cache" / "books"
CONFIG = ROOT / "library.json"

BUILD_VERSION = "1"  # bump to force every book to be converted again
LONG_SIDE = 1600
COVER_WIDTH = 520
WEBP_QUALITY = 82
PAGES_SIZE_WARNING = 900 * 1024 * 1024

OFFICE = {".doc", ".docx", ".docm", ".dot", ".dotx", ".odt", ".rtf",
          ".ppt", ".pptx", ".pptm", ".pps", ".ppsx", ".odp",
          ".xls", ".xlsx", ".xlsm", ".ods", ".csv"}
PANDOC = {".md", ".markdown", ".epub", ".html", ".htm"}
IMAGES = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff"}
SUPPORTED = OFFICE | PANDOC | IMAGES | {".pdf", ".txt"}

RTL_LETTERS = re.compile("[֐-ࣿיִ-﷿ﹰ-ﻼ]")
LATIN_LETTERS = re.compile("[A-Za-zÀ-ɏ]")


def run(cmd, timeout=600):
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip().splitlines()
        raise RuntimeError(detail[-1] if detail else f"{cmd[0]} failed")
    return result.stdout


def soffice(source, outdir, *extra):
    profile = Path(tempfile.mkdtemp(prefix="lo-profile-"))
    try:
        run(["soffice", f"-env:UserInstallation={profile.as_uri()}", "--headless",
             *extra, "--convert-to", "pdf", "--outdir", str(outdir), str(source)])
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    pdf = outdir / (source.stem + ".pdf")
    if not pdf.exists():
        raise RuntimeError("the converter produced no output; the file may be damaged")
    return pdf


def to_pdf(source, workdir):
    ext = source.suffix.lower()
    # Short ASCII names keep the converters away from unusual characters.
    if ext == ".pdf":
        pdf = workdir / "book.pdf"
        shutil.copyfile(source, pdf)
        return pdf
    if ext in IMAGES:
        pdf = workdir / "book.pdf"
        with Image.open(source) as image:
            image.convert("RGB").save(pdf, "PDF", resolution=150)
        return pdf
    if ext == ".txt":
        raw = source.read_bytes()
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = raw.decode("cp1256", errors="replace")  # common for older Arabic files
        copy = workdir / "book.txt"
        copy.write_text(text, encoding="utf-8")
        return soffice(copy, workdir, '--infilter=Text (encoded):UTF8')
    if ext in PANDOC:
        docx = workdir / "book.docx"
        run(["pandoc", str(source), "-o", str(docx), f"--resource-path={source.parent}"])
        return soffice(docx, workdir)
    copy = workdir / ("book" + ext)
    shutil.copyfile(source, copy)
    return soffice(copy, workdir)


def detect_direction(pdf):
    try:
        text = run(["pdftotext", "-f", "1", "-l", "12", str(pdf), "-"])
    except RuntimeError:
        return "ltr"
    return "rtl" if len(RTL_LETTERS.findall(text)) > len(LATIN_LETTERS.findall(text)) else "ltr"


def render_pages(pdf, outdir):
    """Write 1.webp, 2.webp… all at one size, so facing pages always match."""
    raster = outdir / "raster"
    raster.mkdir()
    run(["pdftoppm", "-png", "-scale-to", str(LONG_SIDE), str(pdf), str(raster / "p")], timeout=3600)
    files = sorted(raster.glob("*.png"), key=lambda f: int(f.stem.rsplit("-", 1)[1]))
    if not files:
        raise RuntimeError("the document has no pages")

    sizes = []
    for file in files:
        with Image.open(file) as image:
            sizes.append(image.size)
    width, height = Counter(sizes).most_common(1)[0][0]

    def encode(item):
        number, file = item
        with Image.open(file) as image:
            page = image.convert("RGB")
        if page.size != (width, height):
            scale = min(width / page.width, height / page.height)
            fitted = page.resize((round(page.width * scale), round(page.height * scale)), Image.LANCZOS)
            page = Image.new("RGB", (width, height), "white")
            page.paste(fitted, ((width - fitted.width) // 2, (height - fitted.height) // 2))
        page.save(outdir / f"{number}.webp", "WEBP", quality=WEBP_QUALITY, method=4)
        if number == 1:
            cover_height = round(height * COVER_WIDTH / width)
            page.resize((COVER_WIDTH, cover_height), Image.LANCZOS).save(
                outdir / "cover.webp", "WEBP", quality=WEBP_QUALITY, method=4)

    with ThreadPoolExecutor(max_workers=os.cpu_count() or 2) as pool:
        list(pool.map(encode, enumerate(files, start=1)))
    shutil.rmtree(raster)
    return len(files), width, height


def fingerprint(source):
    digest = hashlib.sha256(BUILD_VERSION.encode())
    with source.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()[:32]


def convert(source):
    """Return the cached folder for this file, converting it if needed."""
    key = fingerprint(source)
    folder = CACHE / key
    if (folder / "meta.json").exists():
        return folder
    CACHE.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="book-") as temp:
        workdir = Path(temp)
        pages = workdir / "pages"
        pages.mkdir()
        pdf = to_pdf(source, workdir)
        count, width, height = render_pages(pdf, pages)
        meta = {"pages": count, "width": width, "height": height, "direction": detect_direction(pdf)}
        (pages / "meta.json").write_text(json.dumps(meta))
        shutil.move(str(pages), str(folder))
    return folder


def nice_title(path):
    return re.sub(r"\s+", " ", re.sub(r"[_]+|(?<=\w)-(?=\w)", " ", path.stem)).strip()


def book_id(relative, taken):
    ascii_name = unicodedata.normalize("NFKD", Path(relative).stem).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")[:60]
    short = hashlib.sha1(relative.encode()).hexdigest()[:8]
    candidate = slug or f"book-{short}"
    if candidate in taken:
        candidate = f"{candidate}-{short}"
    taken.add(candidate)
    return candidate


def warn(message):
    print(f"::warning::{message}" if os.environ.get("GITHUB_ACTIONS") else f"WARNING: {message}")


def asset_files():
    for path in sorted(ASSETS.rglob("*")):
        relative = path.relative_to(ASSETS)
        if not path.is_file() or any(part.startswith(".") for part in relative.parts):
            continue
        if str(relative).lower() == "readme.md":
            continue
        yield path, unicodedata.normalize("NFC", relative.as_posix())


def main():
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    overrides = {unicodedata.normalize("NFC", k): v for k, v in config.get("books", {}).items()}

    shutil.rmtree(DIST, ignore_errors=True)
    shutil.copytree(WEB, DIST)
    (DIST / "books").mkdir()

    books, used, taken, seen = [], set(), set(), set()
    for path, relative in asset_files():
        seen.add(relative)
        if path.suffix.lower() not in SUPPORTED:
            warn(f"Skipped {relative}: {path.suffix or 'this file type'} is not supported.")
            continue
        print(f"Converting {relative}", flush=True)
        try:
            folder = convert(path)
        except Exception as error:  # one bad file must not take the library down
            warn(f"Skipped {relative}: {error}")
            continue
        used.add(folder.name)
        meta = json.loads((folder / "meta.json").read_text())
        override = overrides.get(relative, {})
        identifier = book_id(relative, taken)
        shutil.copytree(folder, DIST / "books" / identifier, ignore=shutil.ignore_patterns("meta.json"))
        books.append({
            "id": identifier,
            "title": override.get("title") or nice_title(Path(relative)),
            "pages": meta["pages"],
            "width": meta["width"],
            "height": meta["height"],
            "direction": override.get("direction") or meta["direction"],
            "cover": override.get("cover", True),
        })

    for name in overrides.keys() - seen:
        warn(f'library.json mentions "{name}", but assets/ has no such file.')

    if CACHE.exists():
        for folder in CACHE.iterdir():
            if folder.name not in used:
                shutil.rmtree(folder, ignore_errors=True)

    books.sort(key=lambda book: book["title"].casefold())
    site = {"title": config.get("title", "My Library"), "tagline": config.get("tagline", "")}
    (DIST / "books.json").write_text(json.dumps({"site": site, "books": books}, ensure_ascii=False), encoding="utf-8")

    total = sum(f.stat().st_size for f in DIST.rglob("*") if f.is_file())
    print(f"Published {len(books)} book(s), {total / 1024 / 1024:.1f} MB.")
    if total > PAGES_SIZE_WARNING:
        warn("The site is close to GitHub Pages' 1 GB limit.")


if __name__ == "__main__":
    sys.exit(main())
