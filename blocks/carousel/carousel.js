/*
 * Carousel Block
 * Shows a series of slides (image, heading, description, optional CTA) one at a time.
 * Based on https://www.aem.live/developer/block-collection/carousel
 */

import { createOptimizedPicture } from '../../scripts/aem.js';
import { moveInstrumentation } from '../../scripts/scripts.js';

const LABELS = {
  carousel: 'Carousel',
  slide: 'Slide',
  of: 'of',
  previous: 'Previous slide',
  next: 'Next slide',
  controls: 'Choose slide to display',
  showSlide: 'Show slide',
};

let carouselCount = 0;

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const getSlides = (block) => [...block.querySelectorAll('.carousel-slide')];

/**
 * Marks a slide as active: updates ARIA state, focusability and indicators.
 * @param {Element} block The carousel block
 * @param {number} index Index of the slide to activate
 * @param {boolean} announce Whether to announce the change to screen readers
 */
function setActiveSlide(block, index, announce = false) {
  const slides = getSlides(block);
  if (Number(block.dataset.activeSlide) === index && !announce) return;
  block.dataset.activeSlide = index;

  slides.forEach((slide, idx) => {
    const isActive = idx === index;
    slide.classList.toggle('active', isActive);
    slide.setAttribute('aria-hidden', !isActive);
    // keep links in hidden slides out of the tab order
    slide.querySelectorAll('a, button, input, select, textarea, [tabindex]').forEach((el) => {
      if (isActive) {
        if (el.dataset.carouselTabindex !== undefined) {
          if (el.dataset.carouselTabindex) el.setAttribute('tabindex', el.dataset.carouselTabindex);
          else el.removeAttribute('tabindex');
          delete el.dataset.carouselTabindex;
        }
      } else if (el.dataset.carouselTabindex === undefined) {
        el.dataset.carouselTabindex = el.getAttribute('tabindex') || '';
        el.setAttribute('tabindex', '-1');
      }
    });
  });

  block.querySelectorAll('.carousel-slide-indicator button').forEach((button, idx) => {
    if (idx === index) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  });

  if (announce) {
    const status = block.querySelector('.carousel-status');
    if (status) status.textContent = `${LABELS.slide} ${index + 1} ${LABELS.of} ${slides.length}`;
  }
}

/**
 * Scrolls to a slide. Indexes outside the range wrap around.
 * @param {Element} block The carousel block
 * @param {number} index Index of the slide to show
 */
function showSlide(block, index) {
  const slides = getSlides(block);
  if (!slides.length) return;
  const target = (index + slides.length) % slides.length;
  const track = block.querySelector('.carousel-slides');

  track.scrollTo({
    top: 0,
    left: slides[target].offsetLeft,
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  });
  setActiveSlide(block, target, true);
}

function bindEvents(block) {
  const track = block.querySelector('.carousel-slides');
  const current = () => Number(block.dataset.activeSlide) || 0;

  block.querySelector('.slide-prev').addEventListener('click', () => showSlide(block, current() - 1));
  block.querySelector('.slide-next').addEventListener('click', () => showSlide(block, current() + 1));

  block.querySelectorAll('.carousel-slide-indicator button').forEach((button, idx) => {
    button.addEventListener('click', () => showSlide(block, idx));
  });

  // keyboard: arrows / Home / End while focus is inside the carousel
  block.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    const last = getSlides(block).length - 1;
    const keys = {
      ArrowLeft: current() - 1,
      ArrowRight: current() + 1,
      Home: 0,
      End: last,
    };
    if (!(e.key in keys)) return;
    e.preventDefault();
    showSlide(block, keys[e.key]);
    // keep focus on the indicators when navigating from there
    if (e.target.closest('.carousel-slide-indicator')) {
      block.querySelectorAll('.carousel-slide-indicator button')[current()]?.focus();
    }
  });

  // swipe / native scrolling: track whichever slide is mostly visible
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        setActiveSlide(block, Number(entry.target.dataset.slideIndex));
      }
    });
  }, { root: track, threshold: 0.6 });
  getSlides(block).forEach((slide) => observer.observe(slide));
}

/**
 * Universal Editor: when an author selects a slide in the content tree, scroll to it.
 * Registered once per page; harmless outside the editor.
 */
function bindEditorSelection() {
  if (window.carouselEditorSelectBound) return;
  window.carouselEditorSelectBound = true;
  document.addEventListener('aue:ui-select', (e) => {
    const resource = e.detail?.resource;
    if (!resource || !e.detail?.selected) return;
    const el = document.querySelector(`.carousel [data-aue-resource="${resource}"]`);
    const slide = el?.closest('.carousel-slide');
    if (slide) showSlide(slide.closest('.carousel'), Number(slide.dataset.slideIndex));
  }, true);
}

/**
 * Reads an external image from a cell authored as a URL (plain text or link),
 * optionally followed by alt text. Only http(s) URLs are accepted.
 * @param {Element} cell The cell to inspect
 * @returns {{src: string, alt: string}|null}
 */
function getExternalImage(cell) {
  if (cell.querySelector('picture, h1, h2, h3, h4, h5, h6')) return null;
  const links = [...cell.querySelectorAll('a')];
  // a link with its own label (e.g. "Learn more") is a CTA, not an image URL
  if (links.some((a) => a.textContent.trim() && a.textContent.trim() !== a.getAttribute('href'))) return null;
  const parts = [...cell.querySelectorAll('a, p')]
    .filter((el) => !(el.matches('p') && el.querySelector('a')))
    .map((el) => (el.matches('a') ? el.getAttribute('href') : el.textContent.trim()));
  if (!parts.length && cell.textContent.trim()) parts.push(...cell.textContent.trim().split(/\s*\n\s*/));
  const [first, ...rest] = parts.filter(Boolean);
  if (!first) return null;
  try {
    const url = new URL(first, window.location.href);
    if (!/^https?:$/.test(url.protocol) || !/^(https?:)?\/\//.test(first)) return null;
    return { src: url.href, alt: rest.join(' ').trim() };
  } catch {
    return null;
  }
}

/**
 * Builds a picture element for an external image (no EDS optimization possible).
 */
function createExternalPicture(src, alt, eager) {
  const picture = document.createElement('picture');
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt;
  img.loading = eager ? 'eager' : 'lazy';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  if (eager) img.fetchPriority = 'high';
  picture.append(img);
  return picture;
}

/**
 * Turns an authored row into a slide.
 * @param {Element} row The authored row (image cell + content cell)
 * @param {number} index Slide index
 * @param {number} total Number of slides
 * @param {string} id Carousel id
 * @param {boolean} eager Whether the slide image should load eagerly (LCP)
 */
function createSlide(row, index, total, id, eager) {
  const slide = document.createElement('li');
  moveInstrumentation(row, slide);
  slide.className = 'carousel-slide';
  slide.id = `${id}-slide-${index}`;
  slide.dataset.slideIndex = index;
  slide.setAttribute('role', 'group');
  slide.setAttribute('aria-roledescription', LABELS.slide.toLowerCase());
  slide.setAttribute('aria-label', `${index + 1} ${LABELS.of} ${total}`);

  [...row.children].forEach((cell, cellIndex) => {
    const pic = cell.querySelector('picture');
    // external image URLs are only read from the media (first) cell
    const external = pic || cellIndex > 0 ? null : getExternalImage(cell);
    if (external) {
      cell.className = 'carousel-slide-image';
      const picture = createExternalPicture(external.src, external.alt, eager);
      const source = cell.querySelector('a, p');
      if (source) moveInstrumentation(source, picture.querySelector('img'));
      cell.replaceChildren(picture);
    } else if (pic && (cellIndex === 0 || cell.textContent.trim() === '')) {
      // a selected AEM image wins over an external URL in the same cell
      cell.className = 'carousel-slide-image';
      const img = pic.querySelector('img');
      if (img) {
        const sameOrigin = new URL(img.src, window.location.href).origin === window.location.origin;
        // EDS image optimization only works for images served by this site
        const picture = sameOrigin
          ? createOptimizedPicture(img.src, img.alt, eager, [
            { media: '(min-width: 900px)', width: '2000' },
            { media: '(min-width: 600px)', width: '1200' },
            { width: '750' },
          ])
          : createExternalPicture(img.src, img.alt, eager);
        moveInstrumentation(img, picture.querySelector('img'));
        cell.replaceChildren(picture);
      }
    } else if (cell.children.length || cell.textContent.trim()) {
      cell.className = 'carousel-slide-content';
      // single-link paragraphs become CTA buttons
      cell.querySelectorAll('p').forEach((p) => {
        const a = p.querySelector(':scope > a, :scope > strong > a, :scope > em > a');
        if (!a || p.textContent.trim() !== a.textContent.trim()) return;
        p.classList.add('button-wrapper');
        a.classList.add('button');
        if (!a.matches('.primary, .secondary, .accent')) a.classList.add('primary');
      });
    } else {
      cell.remove();
      return;
    }
    slide.append(cell);
  });

  return slide;
}

/**
 * loads and decorates the block
 * @param {Element} block The block element
 */
export default function decorate(block) {
  carouselCount += 1;
  const id = `carousel-${carouselCount}`;
  block.id = id;
  block.setAttribute('role', 'region');
  block.setAttribute('aria-roledescription', LABELS.carousel.toLowerCase());

  const rows = [...block.children];
  const isSingleSlide = rows.length < 2;
  const firstSection = document.querySelector('main .section');
  const isFirstOnPage = !!firstSection && firstSection.contains(block);

  block.setAttribute('aria-label', LABELS.carousel);

  const container = document.createElement('div');
  container.className = 'carousel-slides-container';

  const track = document.createElement('ul');
  track.className = 'carousel-slides';
  track.id = `${id}-slides`;
  rows.forEach((row, idx) => {
    track.append(createSlide(row, idx, rows.length, id, isFirstOnPage && idx === 0));
    row.remove();
  });
  container.append(track);
  block.replaceChildren(container);

  if (isSingleSlide) {
    block.classList.add('carousel-single');
    return;
  }

  const buttons = document.createElement('div');
  buttons.className = 'carousel-navigation-buttons';
  buttons.innerHTML = `
    <button type="button" class="slide-prev" aria-controls="${track.id}" aria-label="${LABELS.previous}"></button>
    <button type="button" class="slide-next" aria-controls="${track.id}" aria-label="${LABELS.next}"></button>
  `;
  container.append(buttons);

  const indicatorsNav = document.createElement('nav');
  indicatorsNav.setAttribute('aria-label', LABELS.controls);
  const indicators = document.createElement('ol');
  indicators.className = 'carousel-slide-indicators';
  rows.forEach((_, idx) => {
    const li = document.createElement('li');
    li.className = 'carousel-slide-indicator';
    li.innerHTML = `<button type="button" aria-controls="${id}-slide-${idx}" aria-label="${LABELS.showSlide} ${idx + 1} ${LABELS.of} ${rows.length}"></button>`;
    indicators.append(li);
  });
  indicatorsNav.append(indicators);

  const status = document.createElement('div');
  status.className = 'carousel-status';
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');

  block.append(indicatorsNav, status);

  setActiveSlide(block, 0);
  bindEvents(block);
  bindEditorSelection();
}
