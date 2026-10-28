(function () {
  'use strict';

  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isTouch = window.matchMedia('(hover: none), (pointer: coarse)').matches;

  function init() {
    initCustomCursor();
    initSpotlightCards();
    initCountUpStats();
    initTiltPetCards();
    initMagneticButtons();
    initTimelineProgress();
    initStaggerReveal();
    initParallaxDecor();
    initHeroTilt();
    initNewsletterParallax();
  }

  /* ----------------------------------------------------------
     1. Custom cursor follower (desktop only)
     ---------------------------------------------------------- */
  function initCustomCursor() {
    if (prefersReducedMotion || isTouch) return;

    var cursor = document.createElement('div');
    cursor.className = 'cult-cursor';
    document.body.appendChild(cursor);

    var mx = 0, my = 0, cx = 0, cy = 0;
    var visible = false;

    document.addEventListener('mousemove', function (e) {
      mx = e.clientX;
      my = e.clientY;
      if (!visible) {
        cursor.classList.add('cult-cursor--visible');
        visible = true;
      }
    });

    document.addEventListener('mouseleave', function () {
      cursor.classList.remove('cult-cursor--visible');
      visible = false;
    });

    document.addEventListener('mouseenter', function () {
      cursor.classList.add('cult-cursor--visible');
      visible = true;
    });

    function animate() {
      cx += (mx - cx) * 0.18;
      cy += (my - cy) * 0.18;
      cursor.style.transform = 'translate(' + cx + 'px, ' + cy + 'px) translate(-50%, -50%)';
      requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);

    // hover targets
    var hoverSelectors = 'a, button, .pet-card, .testimonial-card, .stat-card, .step-card, .card, .gallery-item, .faq-item, .filter-chip, .contact-info-card, input, textarea, select';
    document.addEventListener('mouseover', function (e) {
      if (e.target.closest(hoverSelectors)) {
        cursor.classList.add('cult-cursor--hover');
      }
    });
    document.addEventListener('mouseout', function (e) {
      if (e.target.closest(hoverSelectors)) {
        cursor.classList.remove('cult-cursor--hover');
      }
    });
  }

  /* ----------------------------------------------------------
     2. Spotlight: track mouse over cards
     ---------------------------------------------------------- */
  function initSpotlightCards() {
    if (prefersReducedMotion || isTouch) return;

    var selectors = [
      '.stat-card',
      '.testimonial-card',
      '.pet-card',
      '.contact-info-card',
      '.faq-item',
      '.step-card',
      '.card',
      '.gallery-item'
    ];
    var cards = document.querySelectorAll(selectors.join(','));

    cards.forEach(function (card) {
      card.addEventListener('mousemove', function (e) {
        var rect = card.getBoundingClientRect();
        var x = ((e.clientX - rect.left) / rect.width) * 100;
        var y = ((e.clientY - rect.top) / rect.height) * 100;
        card.style.setProperty('--mx', x + '%');
        card.style.setProperty('--my', y + '%');
      });
      card.addEventListener('mouseleave', function () {
        card.style.setProperty('--mx', '50%');
        card.style.setProperty('--my', '50%');
      });
    });
  }

  /* ----------------------------------------------------------
     3. Count-up stats
     ---------------------------------------------------------- */
  function initCountUpStats() {
    var stats = document.querySelectorAll('.stat-number[data-count]');
    if (!stats.length) return;

    var animated = new WeakSet();

    function animate(el) {
      if (prefersReducedMotion) return;
      var target = parseFloat(el.getAttribute('data-count'));
      var suffix = el.getAttribute('data-suffix') || '';
      var duration = 1700;
      var start = null;

      function step(ts) {
        if (!start) start = ts;
        var progress = Math.min((ts - start) / duration, 1);
        var eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
        var current = Math.floor(target * eased);
        el.textContent = current + suffix;
        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          el.textContent = target + suffix;
        }
      }
      requestAnimationFrame(step);
    }

    if (!('IntersectionObserver' in window)) {
      stats.forEach(function (el) { animate(el); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && !animated.has(entry.target)) {
          animated.add(entry.target);
          animate(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });

    stats.forEach(function (el) { observer.observe(el); });

    // Re-run when navigating between views
    window.addEventListener('miauguau:navigate', function () {
      stats.forEach(function (el) {
        if (!animated.has(el)) {
          var rect = el.getBoundingClientRect();
          if (rect.top < window.innerHeight && rect.bottom > 0) {
            animated.add(el);
            animate(el);
          }
        }
      });
    });
  }

  /* ----------------------------------------------------------
     4. 3D tilt on pet cards
     ---------------------------------------------------------- */
  function initTiltPetCards() {
    if (prefersReducedMotion || isTouch) return;
    var cards = document.querySelectorAll('.pet-card');
    cards.forEach(function (card) {
      var MAX = 5;
      card.addEventListener('mousemove', function (e) {
        var rect = card.getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        var dx = (e.clientX - cx) / (rect.width / 2);
        var dy = (e.clientY - cy) / (rect.height / 2);
        var rotateY = dx * MAX;
        var rotateX = -dy * MAX;
        card.style.transform =
          'perspective(900px) rotateX(' + rotateX + 'deg) rotateY(' + rotateY + 'deg) translateY(-6px)';
      });
      card.addEventListener('mouseleave', function () {
        card.style.transform = '';
      });
    });
  }

  /* ----------------------------------------------------------
     5. Magnetic buttons
     ---------------------------------------------------------- */
  function initMagneticButtons() {
    if (prefersReducedMotion || isTouch) return;
    var selectors = [
      '.btn-primary',
      '.btn-outline',
      '.btn-ghost',
      '.cta-banner__btn',
      '.btn-adopt-nav',
      '.btn-submit',
      '.modal-card__adopt-btn',
      '.newsletter-submit',
      '.back-to-top',
      '.chat-fab'
    ];
    var btns = document.querySelectorAll(selectors.join(','));
    var STRENGTH = 0.22;

    btns.forEach(function (btn) {
      btn.addEventListener('mousemove', function (e) {
        var rect = btn.getBoundingClientRect();
        var x = e.clientX - rect.left - rect.width / 2;
        var y = e.clientY - rect.top - rect.height / 2;
        btn.style.transform = 'translate(' + (x * STRENGTH) + 'px, ' + (y * STRENGTH) + 'px)';
      });
      btn.addEventListener('mouseleave', function () {
        btn.style.transform = '';
      });
    });
  }

  /* ----------------------------------------------------------
     6. Timeline progress fill
     ---------------------------------------------------------- */
  function initTimelineProgress() {
    if (prefersReducedMotion) return;
    var timeline = document.querySelector('.timeline');
    if (!timeline) return;

    var ticking = false;
    function update() {
      var rect = timeline.getBoundingClientRect();
      var viewportH = window.innerHeight;
      var start = viewportH * 0.7;
      var end = viewportH * 0.5;
      var progress;
      if (rect.top > start) {
        progress = 0;
      } else if (rect.bottom < end) {
        progress = 1;
      } else {
        progress = Math.min(1, Math.max(0, (start - rect.top) / (start - end)));
      }
      timeline.style.setProperty('--cult-progress', (progress * 100) + '%');
      ticking = false;
    }

    window.addEventListener('scroll', function () {
      if (!ticking) { window.requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    window.addEventListener('resize', function () {
      if (!ticking) { window.requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    update();
  }

  /* ----------------------------------------------------------
     7. Stagger reveal
     ---------------------------------------------------------- */
  function initStaggerReveal() {
    if (prefersReducedMotion) return;
    if (!('IntersectionObserver' in window)) return;

    var containers = document.querySelectorAll(
      '.stats-grid, .steps-grid, .testimonials-grid, .info-grid, .faq-list, .contact-info-side, .gallery-grid'
    );

    containers.forEach(function (container) {
      var children = Array.prototype.slice.call(container.children);
      children.forEach(function (child, i) {
        if (!child.classList.contains('reveal')) {
          child.classList.add('reveal');
        }
        var delay = Math.min(i, 6) * 0.08;
        child.style.transitionDelay = (parseFloat(child.style.transitionDelay || '0') + delay) + 's';
      });
    });

    // re-observe
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('reveal--visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

    document.querySelectorAll('.reveal:not(.reveal--visible)').forEach(function (el) {
      observer.observe(el);
    });
  }

  /* ----------------------------------------------------------
     8. Parallax decorative circles
     ---------------------------------------------------------- */
  function initParallaxDecor() {
    if (prefersReducedMotion || isTouch) return;
    var heros = document.querySelectorAll('.hero-section, .conciencia-hero');
    if (!heros.length) return;

    heros.forEach(function (hero) {
      var circles = hero.querySelectorAll('.decor-circle');
      if (!circles.length) return;

      var ticking = false;
      hero.addEventListener('mousemove', function (e) {
        if (!ticking) {
          window.requestAnimationFrame(function () {
            var rect = hero.getBoundingClientRect();
            var x = (e.clientX - rect.left) / rect.width - 0.5;
            var y = (e.clientY - rect.top) / rect.height - 0.5;
            circles.forEach(function (c, i) {
              var depth = (i + 1) * 20;
              c.style.transform = 'translate(' + (x * depth) + 'px, ' + (y * depth) + 'px)';
            });
            ticking = false;
          });
          ticking = true;
        }
      });
      hero.addEventListener('mouseleave', function () {
        circles.forEach(function (c) { c.style.transform = ''; });
      });
    });
  }

  /* ----------------------------------------------------------
     9. Hero image subtle tilt
     ---------------------------------------------------------- */
  function initHeroTilt() {
    if (prefersReducedMotion || isTouch) return;
    var col = document.querySelector('.hero-image-col');
    if (!col) return;
    var container = col.querySelector('.image-container');
    if (!container) return;

    var ticking = false;
    var MAX = 4;
    col.addEventListener('mousemove', function (e) {
      if (!ticking) {
        window.requestAnimationFrame(function () {
          var rect = col.getBoundingClientRect();
          var x = (e.clientX - rect.left) / rect.width - 0.5;
          var y = (e.clientY - rect.top) / rect.height - 0.5;
          container.style.transform =
            'perspective(1000px) rotateY(' + (x * MAX) + 'deg) rotateX(' + (-y * MAX) + 'deg)';
          ticking = false;
        });
        ticking = true;
      }
    });
    col.addEventListener('mouseleave', function () {
      container.style.transform = '';
    });
  }

  /* ----------------------------------------------------------
     10. Newsletter form parallax tilt (subtle)
     ---------------------------------------------------------- */
  function initNewsletterParallax() {
    if (prefersReducedMotion || isTouch) return;
    var form = document.querySelector('.newsletter-form');
    if (!form) return;

    var ticking = false;
    form.addEventListener('mousemove', function (e) {
      if (!ticking) {
        window.requestAnimationFrame(function () {
          var rect = form.getBoundingClientRect();
          var x = (e.clientX - rect.left) / rect.width - 0.5;
          var y = (e.clientY - rect.top) / rect.height - 0.5;
          form.style.transform = 'perspective(800px) rotateY(' + (x * 2) + 'deg) rotateX(' + (-y * 2) + 'deg)';
          ticking = false;
        });
        ticking = true;
      }
    });
    form.addEventListener('mouseleave', function () {
      form.style.transform = '';
    });
  }

  /* ----------------------------------------------------------
     Boot
     ---------------------------------------------------------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  setTimeout(init, 400);

})();
