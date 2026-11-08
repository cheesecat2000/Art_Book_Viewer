(async function () {
  const shelf = document.getElementById("shelf");
  const notice = document.getElementById("notice");
  const say = (text) => { notice.textContent = text; notice.hidden = false; };

  let data;
  try {
    const response = await fetch("books.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(response.status);
    data = await response.json();
  } catch (error) {
    say("The library could not be loaded. Check your connection and refresh the page.");
    return;
  }

  document.title = data.site.title;
  document.getElementById("site-title").textContent = data.site.title;
  document.getElementById("site-tagline").textContent = data.site.tagline;

  if (!data.books.length) {
    say("No books on the shelf yet.");
    return;
  }

  for (const book of data.books) {
    const item = document.createElement("li");
    item.style.setProperty("--ratio", book.width / book.height);

    const link = document.createElement("a");
    link.href = "read.html?book=" + encodeURIComponent(book.id);

    const cover = document.createElement("img");
    cover.src = "books/" + book.id + "/cover.webp";
    cover.alt = "";
    cover.loading = "lazy";

    const title = document.createElement("span");
    title.className = "book-title";
    title.dir = "auto";
    title.textContent = book.title;

    link.append(cover, title);
    item.append(link);
    shelf.append(item);
  }
})();
