/* LiveForge — main.js. Vanilla JS, no dependencies.
   Content renders fully with JS disabled; everything here is enhancement:
   count-up stats, scroll reveal, activity ticker, constellation canvas,
   next-post countdown. Total budget: < 20 KB. */
(function () {
  "use strict";
  document.documentElement.classList.add("js");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var EASE = "cubic-bezier(0.2, 0.6, 0.2, 1)";

  /* ---------- Count-up stats (600ms, once) ---------- */
  function countUp(el) {
    var target = parseInt(el.getAttribute("data-count"), 10);
    if (isNaN(target)) return;
    if (reduceMotion) { el.textContent = String(target); return; }
    var start = null;
    function frame(ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / 600, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(target * eased));
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  var statNumbers = document.querySelectorAll("[data-count]");
  if ("IntersectionObserver" in window && !reduceMotion) {
    var statObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          countUp(entry.target);
          statObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });
    statNumbers.forEach(function (el) { statObserver.observe(el); });
  } else {
    statNumbers.forEach(function (el) { el.textContent = el.getAttribute("data-count"); });
  }

  /* ---------- Scroll reveal (600ms, 16px, max 3 staggered) ---------- */
  var revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reduceMotion && revealEls.length) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var group = entry.target.parentElement
          ? entry.target.parentElement.querySelectorAll(".reveal")
          : [entry.target];
        var idx = Array.prototype.indexOf.call(group, entry.target);
        var delay = Math.min(idx, 2) * 80;
        entry.target.style.transitionDelay = delay + "ms";
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.15 });
    revealEls.forEach(function (el) { revealObserver.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
  }

  /* ---------- Activity ticker (6s advance, pause on hover/focus) ---------- */
  var ticker = document.getElementById("ticker");
  var toggle = document.getElementById("ticker-toggle");
  if (ticker && toggle) {
    var items = ticker.querySelectorAll("li");
    var pausedLabel = toggle.textContent;
    var resumedLabel = toggle.getAttribute("data-resume-label") || "Resume updates";
    var current = 0;
    var paused = false;
    var timer = null;
    function show(i) {
      items.forEach(function (li, j) {
        li.style.display = j === i ? "" : "none";
      });
    }
    function advance() {
      if (paused || items.length < 2) return;
      current = (current + 1) % items.length;
      show(current);
    }
    function start() {
      if (timer || reduceMotion || items.length < 2) return;
      timer = window.setInterval(advance, 6000);
    }
    function stop() {
      if (timer) { window.clearInterval(timer); timer = null; }
    }
    function setPaused(value) {
      paused = value;
      toggle.setAttribute("aria-pressed", String(value));
      toggle.textContent = value ? resumedLabel : pausedLabel;
      if (value) stop(); else start();
    }
    if (reduceMotion || items.length < 2) {
      /* Static vertical list: all items visible, no timer. */
      items.forEach(function (li) { li.style.display = ""; });
      toggle.style.display = "none";
    } else {
      show(0);
      start();
      toggle.addEventListener("click", function () { setPaused(!paused); });
      ticker.addEventListener("mouseenter", stop);
      ticker.addEventListener("mouseleave", function () { if (!paused) start(); });
      ticker.addEventListener("focusin", stop);
      ticker.addEventListener("focusout", function () { if (!paused) start(); });
      document.addEventListener("visibilitychange", function () {
        if (document.hidden) stop();
        else if (!paused) start();
      });
    }
  }

  /* ---------- Next-post countdown (visitor clock, no API call) ---------- */
  var nextPost = document.getElementById("next-post");
  if (nextPost) {
    var schedule = [7 * 60 + 15, 17 * 60 + 15]; /* 07:15 and 17:15 UTC */
    function updateNextPost() {
      var now = new Date();
      var mins = now.getUTCHours() * 60 + now.getUTCMinutes();
      var next = schedule.find(function (m) { return m > mins; });
      var dayOffset = 0;
      if (next === undefined) { next = schedule[0]; dayOffset = 1; }
      var target = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset,
        Math.floor(next / 60), next % 60, 0
      ));
      var diff = Math.max(0, target - now);
      var h = Math.floor(diff / 3600000);
      var m = Math.floor((diff % 3600000) / 60000);
      var label = (dayOffset ? "Tomorrow" : "Today") + " " +
        String(Math.floor(next / 60)).padStart(2, "0") + ":" +
        String(next % 60).padStart(2, "0") + " UTC";
      nextPost.textContent = label + " (in " + h + "h " + m + "m)";
    }
    updateNextPost();
    window.setInterval(updateNextPost, 30000);
  }

  /* ---------- Constellation canvas (PLAN section 7, decision C1) ----------
     2D canvas, real push points from data-points. Initialises after LCP,
     pauses off-screen, steps quality down below 55fps, one static frame
     under prefers-reduced-motion. */
  var canvas = document.getElementById("constellation");
  if (!canvas) return;
  var ctx = null;
  try { ctx = canvas.getContext("2d"); } catch (e) { ctx = null; }
  if (!ctx) { canvas.style.display = "none"; return; }
  var points = [];
  try { points = JSON.parse(canvas.getAttribute("data-points") || "[]"); } catch (e) { points = []; }
  if (!points.length) { canvas.style.display = "none"; return; }

  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var quality = 0; /* 0 full, 1 dpr=1, 2 half points, 3 static */
  var rafId = null;
  var running = false;
  var frameCount = 0;
  var frameTime = 0;
  var startTime = 0;

  function resize() {
    /* B1-2: the canvas is confined to the right half of the hero by CSS,
       so size the backing store from the canvas's own box, not the hero's. */
    var rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  }
  function draw(now) {
    var w = canvas.width;
    var h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    var t = (now - startTime) / 1000;
    /* Faint grid. */
    ctx.strokeStyle = "#21262d";
    ctx.lineWidth = 1;
    var step = Math.floor(64 * dpr);
    var gx;
    for (gx = 0; gx < w; gx += step) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
    }
    var gy;
    for (gy = 0; gy < h; gy += step) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
    }
    var visible = quality >= 2 ? points.filter(function (_, i) { return i % 2 === 0; }) : points;
    var drift = quality >= 3 || reduceMotion ? 0 : Math.sin(t * 0.2) * 4 * dpr;
    /* Connect consecutive pushes. */
    ctx.strokeStyle = "rgba(63, 185, 80, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    visible.forEach(function (p, i) {
      var x = p[0] * w + drift;
      var y = p[1] * h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    /* Points. */
    visible.forEach(function (p, i) {
      var x = p[0] * w + drift;
      var y = p[1] * h;
      ctx.beginPath();
      ctx.arc(x, y, (i === visible.length - 1 ? 3 : 2) * dpr, 0, Math.PI * 2);
      ctx.fillStyle = i === visible.length - 1 ? "#5fed83" : "#3fb950";
      ctx.fill();
    });
  }
  function loop(now) {
    if (!running) return;
    draw(now);
    frameCount++;
    if (frameCount >= 50) {
      var fps = 50000 / (now - frameTime);
      if (fps < 55 && quality < 3) {
        quality++;
        if (quality === 1) { dpr = 1; resize(); }
        if (quality === 3) { running = false; draw(performance.now()); return; }
      }
      frameCount = 0;
      frameTime = now;
    }
    rafId = requestAnimationFrame(loop);
  }
  function start() {
    if (running || quality >= 3) return;
    running = true;
    startTime = performance.now();
    frameTime = startTime;
    frameCount = 0;
    rafId = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }
  resize();
  window.addEventListener("resize", resize);
  if (reduceMotion || quality >= 3) {
    draw(performance.now());
  } else if ("IntersectionObserver" in window) {
    var heroObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) start(); else stop();
      });
    });
    heroObserver.observe(canvas.parentElement);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop();
    });
    /* Initialise after LCP: wait for load, then one frame. */
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start);
  } else {
    draw(performance.now());
  }
})();
