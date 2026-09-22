import { Fluid } from './fluid.mjs?v=liquid-seed-8';
import { FluidRenderer } from './fluid-renderer.mjs?v=deep-dither-13';

(() => {
  'use strict';
  const canvas = document.querySelector('#metaballs');
  const field = document.querySelector('.liquid-field');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const mix = (a, b, t) => a + (b - a) * t;
  let renderer, fluid, width = 0, height = 0, textField;
  let raf = 0, clock = 0, accumulator = 0, lastDraw = -Infinity, lost = false;
  let entered = false;
  function fail(error) {
    canvas.classList.remove('is-ready');
    cancelAnimationFrame(raf); raf = 0;
    console.warn('Retaining the quiet background:', error.message);
  }
  function layout() {
    width = field.clientWidth; height = field.clientHeight;
    const headline = document.querySelector('h1').getBoundingClientRect();
    let groups;
    if (width > 700) {
      const size = Math.min(height * .24, width * .165, Math.max(70, (width - headline.right) * .43));
      groups = [
        { x: Math.max(width * .82, headline.right + size * 1.5), y: height * .28, size },
        { x: width * .91, y: height * .80, size: size * .61 },
      ];
    } else {
      const header = document.querySelector('.masthead').getBoundingClientRect();
      const footer = document.querySelector('.colophon').getBoundingClientRect();
      const topGap = Math.max(0, headline.top - header.bottom);
      const bottomGap = Math.max(0, Math.min(footer.top, height) - headline.bottom);
      groups = [
        { x: width * .85, y: (header.bottom + headline.top) / 2, size: Math.min(width * .32, topGap * .33) },
        { x: width * .89, y: (headline.bottom + Math.min(footer.top, height)) / 2, size: Math.min(width * .29, bottomGap * .30) },
      ].filter(group => group.size > 22);
    }
    measureLettering();
    fluid = new Fluid({ width, height, groups, distance: letterDistance,
      headline: { left: headline.left, right: headline.right, top: headline.top, bottom: headline.bottom } });
    fluid.prime();
    renderer.resize(width, height); accumulator = 0; clock = 0;
    draw();
  }
  function measureLettering() {
    // Rasterize native glyphs only when layout changes. The visible type remains
    // ordinary DOM text; this small signed-distance grid is just its collider.
    const cell = 2, cols = Math.ceil(width / cell), rows = Math.ceil(height / cell);
    const mask = document.createElement('canvas');
    mask.width = cols; mask.height = rows;
    const ink = mask.getContext('2d', { willReadFrequently: true });
    ink.scale(1 / cell, 1 / cell);
    for (const element of document.querySelectorAll('.wordmark, h1, .colophon p')) {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const style = getComputedStyle(node.parentElement);
        ink.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const metrics = ink.measureText('Hg'), size = parseFloat(style.fontSize);
        const ascent = metrics.fontBoundingBoxAscent ?? size * .8;
        const descent = metrics.fontBoundingBoxDescent ?? size * .2;
        for (let i = 0; i < node.length; i++) {
          if (/\s/.test(node.data[i])) continue;
          const range = document.createRange();
          range.setStart(node, i); range.setEnd(node, i + 1);
          const rect = range.getBoundingClientRect();
          ink.fillText(node.data[i], rect.left, rect.top + (rect.height - ascent - descent) / 2 + ascent);
        }
      }
    }
    const pixels = ink.getImageData(0, 0, cols, rows).data;
    const outside = new Float32Array(cols * rows), inside = new Float32Array(cols * rows);
    for (let i = 0; i < outside.length; i++) {
      const solid = pixels[i * 4 + 3] > 64;
      outside[i] = solid ? 0 : 10000; inside[i] = solid ? 10000 : 0;
    }
    function sweep(grid) {
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        if (x) grid[i] = Math.min(grid[i], grid[i - 1] + 1);
        if (y) {
          grid[i] = Math.min(grid[i], grid[i - cols] + 1);
          if (x) grid[i] = Math.min(grid[i], grid[i - cols - 1] + Math.SQRT2);
          if (x + 1 < cols) grid[i] = Math.min(grid[i], grid[i - cols + 1] + Math.SQRT2);
        }
      }
      for (let y = rows - 1; y >= 0; y--) for (let x = cols - 1; x >= 0; x--) {
        const i = y * cols + x;
        if (x + 1 < cols) grid[i] = Math.min(grid[i], grid[i + 1] + 1);
        if (y + 1 < rows) {
          grid[i] = Math.min(grid[i], grid[i + cols] + 1);
          if (x) grid[i] = Math.min(grid[i], grid[i + cols - 1] + Math.SQRT2);
          if (x + 1 < cols) grid[i] = Math.min(grid[i], grid[i + cols + 1] + Math.SQRT2);
        }
      }
    }
    sweep(outside); sweep(inside);
    for (let i = 0; i < outside.length; i++) outside[i] = (outside[i] - inside[i]) * cell;
    textField = { cols, rows, cell, distance: outside };
  }
  function letterDistance(x, y) {
    if (!textField) return 10000;
    const { cols, rows, cell, distance } = textField;
    const gx = Math.max(0, Math.min(cols - 1.001, x / cell - .5));
    const gy = Math.max(0, Math.min(rows - 1.001, y / cell - .5));
    const ix = Math.floor(gx), iy = Math.floor(gy), i = iy * cols + ix;
    return mix(mix(distance[i], distance[i + 1], gx - ix),
      mix(distance[i + cols], distance[i + cols + 1], gx - ix), gy - iy);
  }
  function draw() {
    if (!renderer || !fluid || lost) return;
    renderer.draw(fluid);
    if (!entered) {
      entered = true;
      if (!reduced.matches) {
        // Start with the entire seeded surface beyond the right edge. The
        // entrance starts only after a real frame exists, regardless of download time.
        let left = width;
        for (let i = 0; i < fluid.count; i++) left = Math.min(left, fluid.positions[i * 3] * fluid.unit);
        const distance = Math.ceil((width - left + fluid.unit * 2 + 8) / 4) * 4;
        canvas.style.setProperty('--arrival-distance', `${distance}px`);
        canvas.classList.add('is-entering');
      }
    }
    canvas.classList.add('is-ready');
  }
  const finishEntrance = () => canvas.classList.remove('is-entering');
  canvas.addEventListener('animationend', finishEntrance);
  canvas.addEventListener('animationcancel', finishEntrance);
  function frame(now) {
    raf = 0;
    if (lost || document.hidden || reduced.matches) return;
    try {
      accumulator += clock ? Math.min(.1, (now - clock) / 1000) : 0; clock = now;
      if (now - lastDraw >= 1000 / 30 - .5) {
        while (accumulator >= 1 / 60) { fluid.step(1 / 60); accumulator -= 1 / 60; }
        draw(); lastDraw = now;
      }
      raf = requestAnimationFrame(frame);
    } catch (error) { fail(error); }
  }
  function sync() {
    cancelAnimationFrame(raf); raf = 0; clock = 0; accumulator = 0;
    if (lost || !renderer || document.hidden) return;
    try { draw(); if (!reduced.matches) raf = requestAnimationFrame(frame); }
    catch (error) { fail(error); }
  }
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); lost = true; canvas.classList.remove('is-ready'); sync();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    try { renderer = new FluidRenderer(canvas); renderer.resize(width, height); lost = false; sync(); }
    catch (error) { fail(error); }
  });
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener('change', () => { if (reduced.matches) finishEntrance(); sync(); });
  window.addEventListener('pagehide', () => { cancelAnimationFrame(raf); raf = 0; clock = 0; });
  window.addEventListener('pageshow', sync);
  let resizeTimer;
  window.addEventListener('resize', () => {
    finishEntrance();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { try { layout(); } catch (error) { fail(error); } }, 120);
  }, { passive: true });
  window.addEventListener('scroll', () => { measureLettering(); }, { passive: true });
  new MutationObserver(() => {
    if (!renderer || !fluid || lost) return;
    try { measureLettering(); } catch (error) { fail(error); }
  }).observe(document.querySelector('.colophon'), {
    childList: true, subtree: true, characterData: true,
  });
  try { renderer = new FluidRenderer(canvas); layout(); sync(); }
  catch (error) { fail(error); }
})();
