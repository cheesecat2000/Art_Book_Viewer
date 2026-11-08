(async function () {
  const STRIPS = 10;        // the turning page is built from strips so it can bend
  const BEND = 48;          // degrees of curl at the middle of a turn
  const TURN_MS = 820;
  const QUICK_MS = 420;

  const $ = (id) => document.getElementById(id);
  const stage = $("stage"), bookEl = $("book"), leafEl = $("leaf");
  const versoEl = $("verso"), rectoEl = $("recto");
  const slider = $("slider"), position = $("position");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

  function fail(text) {
    const message = $("message");
    message.textContent = text;
    message.hidden = false;
  }

  let book;
  try {
    const response = await fetch("books.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(response.status);
    const data = await response.json();
    const wanted = new URLSearchParams(location.search).get("book");
    book = data.books.find((entry) => entry.id === wanted);
    document.title = book ? book.title + " | " + data.site.title : data.site.title;
  } catch (error) {
    fail("This book could not be loaded. Check your connection and refresh the page.");
    return;
  }
  if (!book) {
    fail("This book is not in the library.");
    return;
  }

  $("book-title").textContent = book.title;
  const rtl = book.direction === "rtl";
  bookEl.dataset.dir = rtl ? "rtl" : "ltr";
  slider.dir = rtl ? "rtl" : "ltr";
  slider.max = book.pages;

  const N = book.pages;
  const pad = book.cover ? 0 : 1;     // without a cover, page 1 starts on the left
  const url = (page) => "books/" + book.id + "/" + (page + 1) + ".webp";

  /* A page value is a number (0-based), null (blank paper) or undefined (nothing there). */
  let single = false;
  let opened = 0;        // how many leaves have been turned
  let W = 0, H = 0, stripW = 0;

  const minOpened = () => (single ? 0 : pad);
  const maxOpened = () => (single ? N - 1 : Math.floor((N + pad) / 2));

  function front(leaf) {
    if (leaf < 0) return undefined;
    if (single) return leaf < N ? leaf : undefined;
    const index = 2 * leaf - pad;
    if (index < 0) return null;
    return index < N ? index : undefined;
  }

  function back(leaf) {
    if (leaf < 0) return undefined;
    if (single) return leaf < N ? null : undefined;
    const index = 2 * leaf + 1 - pad;
    if (index < 0) return undefined;
    if (index < N) return index;
    return front(leaf) === undefined ? undefined : null;
  }

  function openedForPage(page) {
    const value = single ? page : Math.ceil((page + pad) / 2);
    return Math.min(maxOpened(), Math.max(minOpened(), value));
  }

  function visiblePages(leaf) {
    const pages = [back(leaf - 1), front(leaf)].filter((page) => typeof page === "number");
    return pages.sort((a, b) => a - b);
  }

  /* ---- static pages ---- */

  function paint(el, page) {
    const img = el.firstElementChild;
    el.hidden = page === undefined;
    if (typeof page === "number") {
      const src = url(page);
      if (img.getAttribute("src") !== src) img.src = src;
      img.alt = "Page " + (page + 1);
      img.hidden = false;
    } else {
      img.removeAttribute("src");
      img.alt = "";
      img.hidden = true;
    }
  }

  function setEdges(leaf) {
    const total = Math.max(1, maxOpened());
    const thickness = Math.min(12, 3 + N / 40);
    const turned = single ? 0 : leaf / total;
    const left = single ? 0 : 1 - turned;
    $("edge-verso").style.width = (back(leaf - 1) === undefined ? 0 : thickness * turned) + "px";
    $("edge-recto").style.width = (front(leaf) === undefined ? 0 : thickness * left) + "px";
  }

  /* ---- the bending leaf ---- */

  let strips = [];

  function buildLeaf() {
    leafEl.textContent = "";
    strips = [];
    let parent = leafEl;
    for (let i = 0; i < STRIPS; i++) {
      const strip = document.createElement("div");
      strip.className = "strip";
      strip.style.width = stripW + "px";
      strip.style.transformOrigin = rtl ? "100% 50%" : "0 50%";
      strip.style[rtl ? "right" : "left"] = (i === 0 ? 0 : stripW) + "px";

      const overlap = i < STRIPS - 1 ? 1 : 0;
      const make = (cls) => {
        const face = document.createElement("div");
        face.className = "face " + cls;
        face.style.width = stripW + overlap + "px";
        face.style[rtl ? "right" : "left"] = "0";
        face.style.backgroundSize = W + "px " + H + "px";
        const shade = document.createElement("i");
        face.append(shade);
        return face;
      };
      const fromStart = -i * stripW;
      const fromEnd = -(W - (i + 1) * stripW - overlap);
      const frontFace = make("front"), backFace = make("back");
      frontFace.style.backgroundPosition = (rtl ? fromEnd : fromStart) + "px 0";
      backFace.style.backgroundPosition = (rtl ? fromStart : fromEnd) + "px 0";
      strip.append(frontFace, backFace);
      parent.append(strip);
      parent = strip;
      strips.push({ el: strip, front: frontFace, back: backFace });
    }
  }

  function dressLeaf(frontPage, backPage) {
    const image = (page) => (typeof page === "number" ? 'url("' + url(page) + '")' : "none");
    const frontImage = image(frontPage), backImage = image(backPage);
    for (const strip of strips) {
      strip.front.style.backgroundImage = frontImage;
      strip.back.style.backgroundImage = backImage;
    }
  }

  function shiftFor(leaf) {
    const away = rtl ? W / 2 : -W / 2;   // slide so a lone page sits in the middle
    if (single) return away;
    if (back(leaf - 1) === undefined) return away;
    if (front(leaf) === undefined) return -away;
    return 0;
  }

  let turn = null;   // { lo, hi } while a leaf is moving

  function setProgress(p) {
    const lift = Math.sin(Math.PI * p);
    const sign = rtl ? 1 : -1;
    const step = -(BEND * lift) / (STRIPS - 1);
    let angle = 180 * p + (BEND * lift) / 2;
    strips.forEach((strip, i) => {
      strip.el.style.transform = "rotateY(" + sign * (i === 0 ? angle : step) + "deg)";
      const absolute = angle + (i === 0 ? 0 : i * step);
      const shade = 0.34 * Math.abs(Math.sin((absolute * Math.PI) / 180));
      strip.front.firstChild.style.opacity = shade;
      strip.back.firstChild.style.opacity = shade * 0.7;
    });
    versoEl.lastElementChild.style.opacity = lift * Math.max(0, 1 - p * 0.2) * 0.55;
    rectoEl.lastElementChild.style.opacity = lift * 0.55;
    const x = shiftFor(turn.lo) + (shiftFor(turn.hi) - shiftFor(turn.lo)) * p;
    bookEl.style.transform = "translateX(" + x + "px)";
  }

  function beginTurn(lo, hi) {
    turn = { lo, hi };
    dressLeaf(front(lo), back(hi - 1));
    paint(versoEl, single ? undefined : back(lo - 1));
    paint(rectoEl, front(hi));
    leafEl.hidden = false;
  }

  function endTurn(atEnd) {
    opened = atEnd ? turn.hi : turn.lo;
    turn = null;
    showResting();
    leafEl.hidden = true;
  }

  function showResting() {
    paint(versoEl, single ? undefined : back(opened - 1));
    paint(rectoEl, front(opened));
    versoEl.lastElementChild.style.opacity = 0;
    rectoEl.lastElementChild.style.opacity = 0;
    bookEl.style.transform = "translateX(" + shiftFor(opened) + "px)";
    setEdges(opened);
    updateControls();
    preload();
  }

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  function animate(from, to, duration) {
    return new Promise((resolve) => {
      if (reduceMotion.matches || duration <= 0) {
        setProgress(to);
        resolve();
        return;
      }
      const start = performance.now();
      function frame(now) {
        const t = Math.min(1, (now - start) / duration);
        setProgress(from + (to - from) * ease(t));
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  /* ---- moving through the book ---- */

  let busy = false;
  let queued = null;
  let needsLayout = false;
  let drag = null;

  function imageReady(page) {
    if (typeof page !== "number") return Promise.resolve();
    const image = new Image();
    image.src = url(page);
    return Promise.race([image.decode().catch(() => {}), new Promise((r) => setTimeout(r, 900))]);
  }

  const cached = new Map();
  function preload() {
    const pages = new Set();
    for (let leaf = opened - 3; leaf <= opened + 3; leaf++) {
      [front(leaf), back(leaf)].forEach((page) => { if (typeof page === "number") pages.add(page); });
    }
    for (const page of pages) {
      if (!cached.has(page)) {
        const image = new Image();
        image.src = url(page);
        cached.set(page, image);
      }
    }
    for (const page of cached.keys()) if (!pages.has(page)) cached.delete(page);
  }

  const clampLeaf = (leaf) => Math.min(maxOpened(), Math.max(minOpened(), leaf));

  async function goTo(target, duration) {
    target = clampLeaf(target);
    if (busy || drag) { queued = target; return; }
    if (target === opened) return;
    busy = true;
    const forward = target > opened;
    const lo = Math.min(target, opened), hi = Math.max(target, opened);
    await Promise.all([front(lo), back(hi - 1), back(lo - 1), front(hi)].map(imageReady));
    beginTurn(lo, hi);
    setProgress(forward ? 0 : 1);
    await animate(forward ? 0 : 1, forward ? 1 : 0, duration);
    endTurn(forward);
    finishMove();
  }

  function finishMove() {
    busy = false;
    if (needsLayout) { needsLayout = false; layout(); }
    if (queued !== null) {
      const next = queued;
      queued = null;
      goTo(next, QUICK_MS);
    }
  }

  const heading = () => (queued !== null ? queued : turn ? (turn.hi === opened ? turn.lo : turn.hi) : opened);
  const next = () => goTo(heading() + 1, busy ? QUICK_MS : TURN_MS);
  const previous = () => goTo(heading() - 1, busy ? QUICK_MS : TURN_MS);

  function updateControls() {
    const pages = visiblePages(opened);
    const first = pages[0] + 1, last = pages[pages.length - 1] + 1;
    position.textContent = (first === last ? first : first + "–" + last) + " of " + N;
    slider.value = first;
    const atStart = opened <= minOpened(), atEnd = opened >= maxOpened();
    const left = $("turn-left"), right = $("turn-right");
    left.disabled = rtl ? atEnd : atStart;
    right.disabled = rtl ? atStart : atEnd;
    history.replaceState(null, "", "#p=" + first);
  }

  $("turn-left").setAttribute("aria-label", rtl ? "Next page" : "Previous page");
  $("turn-right").setAttribute("aria-label", rtl ? "Previous page" : "Next page");
  $("turn-left").addEventListener("click", () => (rtl ? next() : previous()));
  $("turn-right").addEventListener("click", () => (rtl ? previous() : next()));

  slider.addEventListener("input", () => { position.textContent = slider.value + " of " + N; });
  slider.addEventListener("change", () => goTo(openedForPage(slider.value - 1), TURN_MS));

  addEventListener("keydown", (event) => {
    if (event.target === slider || event.altKey || event.ctrlKey || event.metaKey) return;
    const forward = rtl ? "ArrowLeft" : "ArrowRight";
    const backward = rtl ? "ArrowRight" : "ArrowLeft";
    if (event.key === forward || event.key === "PageDown" || (event.key === " " && !event.shiftKey)) next();
    else if (event.key === backward || event.key === "PageUp" || event.key === " ") previous();
    else if (event.key === "Home") goTo(minOpened(), TURN_MS);
    else if (event.key === "End") goTo(maxOpened(), TURN_MS);
    else return;
    event.preventDefault();
  });

  /* ---- dragging and tapping ---- */

  bookEl.addEventListener("pointerdown", (event) => {
    if (busy || drag || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, moving: false, forward: true, p: 0, lastX: event.clientX, lastT: event.timeStamp, speed: 0 };
    bookEl.setPointerCapture(event.pointerId);
  });

  bookEl.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    if (!drag.moving) {
      if (Math.abs(dx) < 8) return;
      const forward = dx < 0 !== rtl;
      const target = opened + (forward ? 1 : -1);
      if (target < minOpened() || target > maxOpened()) return;
      drag.moving = true;
      drag.forward = forward;
      beginTurn(Math.min(opened, target), Math.max(opened, target));
    }
    const travel = Math.min(1, Math.abs(dx) / (W * 1.5));
    const toward = (dx < 0 !== rtl) === drag.forward ? travel : 0;
    drag.p = drag.forward ? toward : 1 - toward;
    setProgress(drag.p);
    const elapsed = event.timeStamp - drag.lastT;
    if (elapsed > 0) drag.speed = Math.abs(event.clientX - drag.lastX) / elapsed;
    drag.lastX = event.clientX;
    drag.lastT = event.timeStamp;
  });

  async function release(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const finished = drag;
    drag = null;
    if (!finished.moving) {
      if (event.type === "pointerup") tap(event.clientX);
      return;
    }
    busy = true;
    const committed = event.type === "pointerup" && (finished.speed > 0.5 || (finished.forward ? finished.p > 0.3 : finished.p < 0.7));
    const end = committed === finished.forward ? 1 : 0;
    await animate(finished.p, end, Math.max(180, Math.abs(end - finished.p) * TURN_MS));
    endTurn(end === 1);
    finishMove();
  }
  bookEl.addEventListener("pointerup", release);
  bookEl.addEventListener("pointercancel", release);

  function tap(x) {
    const box = rectoEl.getBoundingClientRect();
    let onForwardSide;
    if (single) {
      const fraction = (x - box.left) / box.width;
      onForwardSide = rtl ? fraction < 0.65 : fraction > 0.35;
    } else if (rectoEl.hidden) {
      onForwardSide = false;
    } else {
      onForwardSide = x >= box.left && x <= box.right;
    }
    if (onForwardSide) next(); else previous();
  }

  bookEl.addEventListener("contextmenu", (event) => event.preventDefault());

  /* ---- sizing ---- */

  function layout() {
    if (busy || drag) { needsLayout = true; return; }
    const pages = W ? visiblePages(opened) : [];
    const anchor = pages.length ? pages[0] : null;

    const wasSingle = single;
    single = innerWidth < 720 && innerHeight > innerWidth;

    const box = stage.getBoundingClientRect();
    const availableW = box.width - (single ? 24 : 48);
    const availableH = box.height - 24;
    const across = single ? 1 : 2;
    const ratio = book.width / book.height;
    let width = Math.min(availableW / across, availableH * ratio);
    width = Math.max(STRIPS * 8, Math.floor(width / STRIPS) * STRIPS);

    const changed = width !== W;
    W = width;
    H = Math.round(W / ratio);
    stripW = W / STRIPS;
    bookEl.style.width = W * 2 + "px";
    bookEl.style.height = H + "px";
    $("gutter").hidden = single;
    if (changed) buildLeaf();

    if (wasSingle !== single && anchor !== null) opened = openedForPage(anchor);
    opened = clampLeaf(opened);
    showResting();
  }

  let resizeTimer;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layout, 80);
  });

  const fullscreen = $("fullscreen");
  if (!document.documentElement.requestFullscreen) {
    fullscreen.hidden = true;
  } else {
    fullscreen.addEventListener("click", () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    });
    document.addEventListener("fullscreenchange", () => {
      fullscreen.textContent = document.fullscreenElement ? "Exit full screen" : "Full screen";
    });
  }

  /* ---- start ---- */

  function pageFromAddress() {
    const match = /[#&]p=(\d+)/.exec(location.hash);
    return match ? Math.min(N, Math.max(1, +match[1])) - 1 : 0;
  }
  addEventListener("hashchange", () => goTo(openedForPage(pageFromAddress()), TURN_MS));

  const startPage = pageFromAddress();
  single = innerWidth < 720 && innerHeight > innerWidth;
  opened = openedForPage(startPage);
  bookEl.hidden = false;
  $("controls").hidden = false;
  layout();
})();
