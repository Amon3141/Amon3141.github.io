/**
 * Loads page HTML fragments, then initializes peel interaction and home origami embed.
 * Add entries to PAGE_URLS (and matching files under pages/) when you add screens.
 */

import { initBookPeel } from './book-peel.js';
import { initHomeOrigami } from './home-origami.js';
import { initProjectGallery } from './project-gallery.js';

const PAGE_URLS = ['./pages/home.html', './pages/projects.html'];

function parsePageFragment(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.firstElementChild;
}

async function injectPages() {
  const book = document.getElementById('book');
  const fold = document.getElementById('fold-overlay');
  if (!book || !fold) {
    throw new Error('main: #book or #fold-overlay missing');
  }

  for (const url of PAGE_URLS) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to load ${url}: ${res.status}`);
    }
    const node = parsePageFragment(await res.text());
    if (node) {
      book.insertBefore(node, fold);
    }
  }
}

await injectPages();

initProjectGallery();

initBookPeel();

const homeOrigami = document.getElementById('home-origami');
if (homeOrigami) {
  await initHomeOrigami(homeOrigami);
}
