(function () {
  'use strict';

  /* ================== SESIÓN DE USUARIO ==================
     El usuario logueado se guarda en localStorage (miauguau-usuario).
     Todas las llamadas fetch al backend incluyen el header
     X-Usuario-Id si hay sesión activa.
  */
  var SESION_KEY = 'miauguau-usuario';

  window.miauguauSesion = {
    get: function () {
      try { return JSON.parse(localStorage.getItem(SESION_KEY) || 'null'); }
      catch (e) { return null; }
    },
    set: function (usuario) {
      try { localStorage.setItem(SESION_KEY, JSON.stringify(usuario)); } catch (e) { }
    },
    clear: function () {
      try { localStorage.removeItem(SESION_KEY); } catch (e) { }
    },
    isLogged: function () {
      return !!this.get();
    },
    header: function () {
      var u = this.get();
      return u ? { 'X-Usuario-Id': u.id } : {};
    }
  };

  /* Helper: fetch con header de sesión automático */
  window.miauguauFetch = function (url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({}, opts.headers || {}, window.miauguauSesion.header());
    return fetch(url, opts);
  };

  /* ================== MULTI-PAGE NAVIGATION ================== */
  var ROUTES = ['home', 'concientizar', 'adoptar', 'contacto'];
  // Rutas de Flask (fallback). La URL real siempre sale del href que
  // genera url_for() en los templates, asi no hay que hardcodear nada.
  var FLASK_ROUTES = {
    home: '/',
    concientizar: '/concientizacion',
    adoptar: '/adopciones',
    contacto: '/contacto'
  };

  // Resuelve la URL de una ruta usando los href reales presentes en la página
  function routeUrl(route) {
    var link = document.querySelector('a[data-nav="' + route + '"][href]');
    if (link) {
      var href = link.getAttribute('href');
      if (href && href !== '#') return href;
    }
    return FLASK_ROUTES[route] || '/';
  }
  var CURRENT_PAGE = (function () {
    var view = document.querySelector('[data-page-view]');
    return view ? view.getAttribute('data-page-view') : 'home';
  })();

  // Visibilidad inmediata de la vista de esta pagina (sin esperar a DOMContentLoaded)
  (function () {
    var v = document.querySelector('[data-page-view="' + CURRENT_PAGE + '"]');
    if (v) v.classList.add('is-active');
  })();

  function navigate(el) {
    var route = (el && el.getAttribute) ? el.getAttribute('data-nav') : el;
    if (ROUTES.indexOf(route) === -1) route = 'home';
    if (route === CURRENT_PAGE) {
      // ya estamos en esta página: cerrar menú y volver arriba
      closeMobileMenu();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    // priorizar el href propio del elemento (generado por url_for de Flask);
    // si no tiene (botones), resolverlo con los enlaces de la página
    var href = (el && el.getAttribute) ? el.getAttribute('href') : null;
    if (!href || href === '#') href = routeUrl(route);
    window.location.href = href;
  }

  // handle nav clicks
  document.addEventListener('click', function (e) {
    var target = e.target.closest('[data-nav]');
    if (!target) return;
    e.preventDefault();
    navigate(target);
  });

  // handle placeholder social links (href="#") gracefully
  document.addEventListener('click', function (e) {
    var link = e.target.closest('a.contact-social-link[href="#"], a.footer-social[href="#"]');
    if (!link) return;
    e.preventDefault();
    var label = link.getAttribute('aria-label') || 'Red social';
    if (window.miauguauToast) {
      window.miauguauToast(label + ': próximamente estaremos en redes 🐾', 'info');
    }
  });

  /* ================== INIT ON DOM READY ================== */
  function init() {
    initToastContainer();
    initMobileMenu();
    initDarkMode();
    initScrollEffects();
    initRevealObserver();
    initBackToTop();
    initSearch();
    initFAQ();
    initPetModal();
    initNewsletter();
    initRegistro();
    initSesion();
    initScrollProgress();
    initSmoothAnchorScroll();
    initFavorites();
    updateResultsCounter('all');

    // marcar como activa la vista de esta página
    var currentView = document.querySelector('[data-page-view="' + CURRENT_PAGE + '"]');
    if (currentView) currentView.classList.add('is-active');

    // búsqueda pendiente proveniente de otra página
    var pendingQuery = null;
    try {
      pendingQuery = sessionStorage.getItem('miauguau-search-query');
      sessionStorage.removeItem('miauguau-search-query');
    } catch (e) { }
    if (pendingQuery && CURRENT_PAGE === 'adoptar') {
      setTimeout(function () { highlightAndScroll(pendingQuery); }, 400);
    }
  }

  /* ================== TOAST SYSTEM ================== */
  var toastContainer = null;
  function initToastContainer() {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    toastContainer.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastContainer);
  }
  window.miauguauToast = function (message, type) {
    type = type || 'info';
    if (!toastContainer) return;
    var toast = document.createElement('div');
    toast.className = 'toast toast--' + type;
    var iconMap = { success: 'check', error: 'close', info: 'info' };
    toast.innerHTML =
      '<span class="toast__icon"><span class="material-symbols-outlined">' + (iconMap[type] || 'info') + '</span></span>' +
      '<span>' + message + '</span>';
    toastContainer.appendChild(toast);
    requestAnimationFrame(function () {
      toast.classList.add('toast--visible');
    });
    setTimeout(function () {
      toast.classList.remove('toast--visible');
      setTimeout(function () { toast.remove(); }, 400);
    }, 3500);
  };

  /* ================== FAVORITES SYSTEM ==================
     La fuente de verdad es la BASE DE DATOS (tabla FAVORITOS).
     localStorage es solo un CACHÉ para no tener que pedir al backend
     en cada render.  Se sincroniza:
       - al cargar la página (si hay sesión)
       - al iniciar sesión (reemplaza con los de la BD del usuario)
       - al cerrar sesión (se vacía)
  */
  var FAVS_KEY = 'miauguau-favorites';
  function getFavorites() {
    try { return JSON.parse(localStorage.getItem(FAVS_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveFavorites(favs) {
    try { localStorage.setItem(FAVS_KEY, JSON.stringify(favs)); } catch (e) { }
  }

  /* Re-marca los corazones según el caché actual de localStorage */
  function renderFavoritosUI() {
    var favs = getFavorites();
    document.querySelectorAll('.pet-card__fav').forEach(function (btn) {
      var petId = btn.getAttribute('data-pet-id');
      if (petId && favs.indexOf(petId) !== -1) {
        btn.classList.add('pet-card__fav--active');
      } else {
        btn.classList.remove('pet-card__fav--active');
      }
    });
    updateFavCount();
    // Si estoy en el filtro de favoritos, re-aplicar
    var activeChip = document.querySelector('.filter-chip--active[data-filter="favorites"]');
    if (activeChip) applyPetFilter('favorites');
  }

  /* Sincroniza el caché local con la BD del usuario actual.
     - Si hay sesión: trae los favoritos REALES del usuario y reemplaza el caché.
     - Si no hay sesión: trae los del anónimo (USR-ANON) y reemplaza el caché.
     Después re-renderiza los corazones. */
  function syncFavoritosDesdeBD() {
    return window.miauguauFetch('/api/favoritos', {
      headers: { 'Accept': 'application/json' }
    })
      .then(function (res) { return res.json().catch(function () { return {}; }); })
      .then(function (data) {
        if (data && data.ok === true && Array.isArray(data.mascota_ids)) {
          saveFavorites(data.mascota_ids);
        }
        renderFavoritosUI();
      })
      .catch(function (err) {
        console.warn('[Miauguau] No se pudo sincronizar favoritos desde la BD:', err);
        renderFavoritosUI();
      });
  }

  /* Vacía el caché local (al cerrar sesión) y re-renderiza */
  function vaciarFavoritosLocal() {
    saveFavorites([]);
    renderFavoritosUI();
  }

  function initFavorites() {
    // Atar los clicks de los corazones
    document.querySelectorAll('.pet-card__fav').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleFavorite(btn);
      });
    });
    // Sincronizar con la BD al cargar (trae los del usuario logueado o anónimo)
    syncFavoritosDesdeBD();
  }
  function toggleFavorite(btn) {
    var petId = btn.getAttribute('data-pet-id');
    var name = btn.getAttribute('data-pet-name') || petId;
    if (!petId) return;
    var favs = getFavorites();
    var idx = favs.indexOf(petId);
    var isAdding = (idx === -1);
    if (isAdding) {
      favs.push(petId);
      btn.classList.add('pet-card__fav--active');
      window.miauguauToast(name + ' agregado a favoritos', 'success');
    } else {
      favs.splice(idx, 1);
      btn.classList.remove('pet-card__fav--active');
      window.miauguauToast(name + ' removido de favoritos', 'info');
    }
    saveFavorites(favs);
    updateFavCount();

    // ---- Guardar en la base de datos (tabla FAVORITOS) ----
    // Se usa el usuario logueado si hay sesión (header X-Usuario-Id);
    // si no, el backend usa el usuario anónimo (USR-ANON).
    window.miauguauFetch('/api/favoritos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        mascota_id: petId,
        accion: isAdding ? 'agregar' : 'quitar'
      })
    }).catch(function (err) {
      console.warn('[Miauguau] No se pudo guardar el favorito en la BD:', err);
    });

    // If currently on favorites filter, re-apply
    var activeChip = document.querySelector('.filter-chip--active[data-filter="favorites"]');
    if (activeChip) applyPetFilter('favorites');
  }
  function updateFavCount() {
    var favs = getFavorites();
    document.querySelectorAll('.filter-chip__fav-count').forEach(function (el) {
      el.textContent = favs.length;
    });
  }

  /* ================== PET FILTERS + COUNTER ================== */
  function applyPetFilter(filter) {
    var cards = document.querySelectorAll('.pet-card');
    var visible = 0;
    var favs = getFavorites();
    cards.forEach(function (card) {
      var show = false;
      if (filter === 'all') {
        show = true;
      } else if (filter === 'favorites') {
        var petId = card.getAttribute('data-pet-id');
        show = petId && favs.indexOf(petId) !== -1;
      } else if (filter === 'urgentes') {
        show = card.getAttribute('data-pet-urgent') === 'true';
      } else if (filter === 'perros' || filter === 'gatos') {
        show = card.getAttribute('data-pet-type') === filter;
      } else if (filter === 'cachorros') {
        show = card.getAttribute('data-pet-age') === 'joven';
      } else if (filter === 'adultos') {
        show = card.getAttribute('data-pet-age') === 'adulto';
      }
      card.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    updateResultsCounter(filter, visible);
    // Show empty state if no results
    showEmptyState(visible, filter);
  }
  function updateResultsCounter(filter, count) {
    var counter = document.getElementById('resultsCounter');
    if (!counter) return;
    if (count === undefined) {
      // Calculate based on filter
      var favs = getFavorites();
      var cards = document.querySelectorAll('.pet-card');
      count = 0;
      cards.forEach(function (card) {
        var show = false;
        if (filter === 'all') show = true;
        else if (filter === 'favorites') {
          var petId = card.getAttribute('data-pet-id');
          show = petId && favs.indexOf(petId) !== -1;
        } else if (filter === 'urgentes') show = card.getAttribute('data-pet-urgent') === 'true';
        else if (filter === 'perros' || filter === 'gatos') show = card.getAttribute('data-pet-type') === filter;
        else if (filter === 'cachorros') show = card.getAttribute('data-pet-age') === 'joven';
        else if (filter === 'adultos') show = card.getAttribute('data-pet-age') === 'adulto';
        if (show) count++;
      });
    }
    var labels = {
      all: 'mascotas', perros: 'perros', gatos: 'gatos', cachorros: 'cachorros',
      adultos: 'adultos', urgentes: 'urgentes', favorites: 'favoritos'
    };
    var label = labels[filter] || 'mascotas';
    counter.innerHTML = 'Mostrando <strong>' + count + '</strong> ' + label;
  }
  function showEmptyState(visible, filter) {
    var grid = document.querySelector('[data-page-view="adoptar"] .info-grid');
    if (!grid) return;
    var empty = grid.querySelector('.empty-state');
    if (visible === 0) {
      if (!empty) {
        empty = document.createElement('div');
        empty.className = 'empty-state';
        var messages = {
          favorites: { title: 'No tenés favoritos todavía', text: 'Tocá el corazón en cualquier mascota para guardarla acá.' },
          perros: { title: 'No hay perros disponibles', text: 'Volvé pronto, estamos rescatando más amigos.' },
          gatos: { title: 'No hay gatos disponibles', text: 'Volvé pronto, estamos rescatando más amigos.' },
          urgentes: { title: 'No hay adopciones urgentes', text: 'Por ahora todas las mascotas están en buen estado.' },
          cachorros: { title: 'No hay cachorros disponibles', text: 'Volvé pronto, llegan nuevos cachorros cada semana.' },
          adultos: { title: 'No hay adultos disponibles', text: 'Volvé pronto, estamos rescatando más amigos.' }
        };
        var msg = messages[filter] || { title: 'Sin resultados', text: 'Probá con otro filtro.' };
        empty.innerHTML =
          '<div class="empty-state__icon"><span class="material-symbols-outlined">pets</span></div>' +
          '<p class="empty-state__title">' + msg.title + '</p>' +
          '<p class="empty-state__text">' + msg.text + '</p>';
        grid.appendChild(empty);
      }
    } else {
      if (empty) empty.remove();
    }
  }

  /* ================== MOBILE MENU ================== */
  var mobileOverlay = null;
  var mobileDrawer = null;

  function initMobileMenu() {
    var btn = document.querySelector('.mobile-menu-btn');
    if (!btn) return;

    mobileOverlay = document.createElement('div');
    mobileOverlay.className = 'mobile-overlay';
    mobileOverlay.addEventListener('click', closeMobileMenu);

    mobileDrawer = document.createElement('div');
    mobileDrawer.className = 'mobile-drawer';
    mobileDrawer.innerHTML = buildMobileNav();

    document.body.appendChild(mobileOverlay);
    document.body.appendChild(mobileDrawer);

    btn.addEventListener('click', function () {
      if (mobileDrawer.classList.contains('mobile-drawer--open')) {
        closeMobileMenu();
      } else {
        openMobileMenu();
      }
    });
  }

  function buildMobileNav() {
    var searchHTML = '';
    var searchBar = document.querySelector('.search-bar');
    if (searchBar) {
      searchHTML = '<div class="mobile-drawer__search">' + searchBar.outerHTML + '</div>';
    }
    var linksHTML = '<nav class="mobile-drawer__nav">';
    ROUTES.forEach(function (route) {
      var labels = { home: 'Inicio', concientizar: 'Concientización', adoptar: 'Adopciones', contacto: 'Contacto' };
      linksHTML += '<a class="mobile-drawer__link" data-nav="' + route + '" href="' + routeUrl(route) + '">' + labels[route] + '</a>';
    });
    linksHTML += '</nav>';
    var ctaHTML = '<div class="mobile-drawer__cta"><button class="mobile-drawer__btn-adopt" data-nav="adoptar">Adoptar ahora</button></div>';
    return searchHTML + linksHTML + ctaHTML;
  }

  function openMobileMenu() {
    if (!mobileDrawer) return;
    mobileDrawer.classList.add('mobile-drawer--open');
    mobileOverlay.classList.add('mobile-overlay--visible');
    document.body.style.overflow = 'hidden';
  }

  function closeMobileMenu() {
    if (!mobileDrawer) return;
    mobileDrawer.classList.remove('mobile-drawer--open');
    mobileOverlay.classList.remove('mobile-overlay--visible');
    document.body.style.overflow = '';
  }

  /* ================== DARK MODE ================== */
  function initDarkMode() {
    var toggle = document.querySelector('.dark-mode-toggle');
    if (!toggle) return;

    var saved = localStorage.getItem('miauguau-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (saved === 'dark' || (!saved && prefersDark)) {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
      toggle.innerHTML = '<span class="material-symbols-outlined">light_mode</span>';
    }

    toggle.addEventListener('click', function () {
      var isDark = document.documentElement.classList.contains('dark');
      if (isDark) {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
        toggle.innerHTML = '<span class="material-symbols-outlined">dark_mode</span>';
        localStorage.setItem('miauguau-theme', 'light');
      } else {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
        toggle.innerHTML = '<span class="material-symbols-outlined">light_mode</span>';
        localStorage.setItem('miauguau-theme', 'dark');
      }
    });
  }

  /* ================== SCROLL EFFECTS ================== */
  function initScrollEffects() {
    var navbar = document.querySelector('.top-navbar');
    var ticking = false;

    function update() {
      if (navbar) {
        if (window.scrollY > 40) navbar.classList.add('top-navbar--scrolled');
        else navbar.classList.remove('top-navbar--scrolled');
      }
      ticking = false;
    }

    window.addEventListener('scroll', function () {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    }, { passive: true });
    update();
  }

  /* ================== REVEAL OBSERVER ================== */
  function initRevealObserver() {
    if (!('IntersectionObserver' in window)) {
      document.querySelectorAll('.reveal').forEach(function (el) {
        el.classList.add('reveal--visible');
      });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('reveal--visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

    window.__miauguauRevealObserver = observer;

    document.querySelectorAll('.reveal').forEach(function (el) {
      observer.observe(el);
    });
  }

  /* ================== BACK TO TOP ================== */
  function initBackToTop() {
    var btn = document.createElement('button');
    btn.className = 'back-to-top';
    btn.setAttribute('aria-label', 'Volver arriba');
    btn.innerHTML = '<span class="material-symbols-outlined">keyboard_arrow_up</span>';
    document.body.appendChild(btn);

    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    var ticking = false;
    window.addEventListener('scroll', function () {
      if (!ticking) {
        window.requestAnimationFrame(function () {
          btn.classList.toggle('back-to-top--visible', window.scrollY > 500);
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  }

  /* ================== SEARCH ================== */
  function initSearch() {
    var inputs = document.querySelectorAll('.search-input');
    inputs.forEach(function (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          var query = input.value.trim().toLowerCase();
          if (query) {
            if (CURRENT_PAGE === 'adoptar') {
              // resaltar coincidencias en esta misma página
              highlightAndScroll(query);
            } else {
              // ir a la página de adopciones y resaltar coincidencias al llegar
              try { sessionStorage.setItem('miauguau-search-query', query); } catch (err) { }
              window.location.href = routeUrl('adoptar');
            }
          }
        }
      });
    });
  }

  function highlightAndScroll(query) {
    document.querySelectorAll('.search-highlight').forEach(function (el) {
      el.classList.remove('search-highlight');
    });

    var activeView = document.querySelector('[data-page-view].is-active') || document;
    var petCards = activeView.querySelectorAll('.pet-card');
    var found = false;

    petCards.forEach(function (card) {
      var name = card.querySelector('.pet-card__name');
      if (name && name.textContent.toLowerCase().includes(query)) {
        card.classList.add('search-highlight');
        if (!found) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          found = true;
        }
      }
    });

    if (!found) {
      var mainContent = document.querySelector('.main-content');
      if (!mainContent) return;
      var walker = document.createTreeWalker(mainContent, NodeFilter.SHOW_TEXT, null, false);
      while (walker.nextNode()) {
        if (walker.currentNode.textContent.toLowerCase().includes(query)) {
          var parent = walker.currentNode.parentElement;
          if (parent) {
            parent.classList.add('search-highlight');
            if (!found) {
              parent.scrollIntoView({ behavior: 'smooth', block: 'center' });
              found = true;
            }
          }
        }
      }
    }

    setTimeout(function () {
      document.querySelectorAll('.search-highlight').forEach(function (el) {
        el.classList.remove('search-highlight');
      });
    }, 3000);
  }

  /* ================== FAQ ACCORDION ================== */
  function initFAQ() {
    var questions = document.querySelectorAll('.faq-item__question');
    questions.forEach(function (q) {
      q.addEventListener('click', function () {
        var item = q.closest('.faq-item');
        var isOpen = item.classList.contains('faq-item--open');
        document.querySelectorAll('.faq-item--open').forEach(function (open) {
          open.classList.remove('faq-item--open');
        });
        if (!isOpen) item.classList.add('faq-item--open');
      });
    });
  }

  /* ================== PET MODAL ==================
     Las descripciones de las mascotas ya NO están hardcodeadas acá.
     Cada tarjeta (.pet-card) trae su descripción desde el backend
     en el atributo data-pet-description (renderizado por Jinja2
     desde la base de datos). Acá solo la leemos.
  */
  function initPetModal() {
    var petCards = document.querySelectorAll('.pet-card');
    if (!petCards.length) return;

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
      '<div class="modal-card">' +
        '<button class="modal-card__close" aria-label="Cerrar"><span class="material-symbols-outlined">close</span></button>' +
        '<img class="modal-card__image" src="" alt="">' +
        '<div class="modal-card__body">' +
          '<h3 class="modal-card__name"></h3>' +
          '<p class="modal-card__info"></p>' +
          '<p class="modal-card__description"></p>' +
          '<div class="modal-card__tags"></div>' +
          '<button class="modal-card__adopt-btn" data-nav="contacto" type="button">' +
            '<span class="material-symbols-outlined">favorite</span>' +
            'Iniciar proceso de adopción' +
          '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.closest('.modal-card__close')) {
        closeModal();
      }
    });

    // Al clickear "Iniciar proceso de adopción" guardamos la mascota en
    // sessionStorage para que la página de contacto la precargue (asunto =
    // adopcion + mascota_id oculto).  El handler global [data-nav] navega
    // a contacto; acá solo dejamos el dato listo antes de cerrar el modal.
    var modalAdoptBtn = overlay.querySelector('.modal-card__adopt-btn');
    if (modalAdoptBtn) {
      modalAdoptBtn.addEventListener('click', function () {
        var currentCard = overlay.getAttribute('data-current-pet-id');
        var currentName = overlay.querySelector('.modal-card__name') &&
                          overlay.querySelector('.modal-card__name').textContent.trim();
        if (currentCard) {
          try {
            sessionStorage.setItem('miauguau-adopcion-pet',
              JSON.stringify({ id: currentCard, nombre: currentName || '' }));
          } catch (e) { }
        }
        closeModal();
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('modal-overlay--visible')) {
        closeModal();
      }
    });

    function closeModal() {
      overlay.classList.remove('modal-overlay--visible');
      document.body.style.overflow = '';
    }

    petCards.forEach(function (card) {
      var btn = card.querySelector('.pet-card__adopt-btn');
      if (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          var name = card.querySelector('.pet-card__name').textContent.trim();
          var info = card.querySelector('.pet-card__info').textContent.trim();
          var image = card.querySelector('.pet-card__image');
          var tags = card.querySelectorAll('.pet-card__tag');
          // La descripción viene desde el backend (atributo data-pet-description
          // renderizado por Jinja2 desde la base de datos).
          var desc = card.getAttribute('data-pet-description')
                     || 'Esta mascota está buscando un hogar amoroso. Contactanos para más información.';
          var petId = card.getAttribute('data-pet-id') || '';

          // Guardar el id de la mascota actual en el overlay para que el
          // botón "Iniciar proceso de adopción" lo envíe al formulario.
          overlay.setAttribute('data-current-pet-id', petId);

          overlay.querySelector('.modal-card__image').src = image ? image.src : '';
          overlay.querySelector('.modal-card__image').alt = name;
          overlay.querySelector('.modal-card__name').textContent = name;
          overlay.querySelector('.modal-card__info').textContent = info;
          overlay.querySelector('.modal-card__description').textContent = desc;

          var tagsContainer = overlay.querySelector('.modal-card__tags');
          tagsContainer.innerHTML = '';
          tags.forEach(function (tag) {
            tagsContainer.appendChild(tag.cloneNode(true));
          });

          overlay.classList.add('modal-overlay--visible');
          document.body.style.overflow = 'hidden';
        });
      }
    });
  }

  /* ================== PET FILTERS (click delegation) ================== */
  document.addEventListener('click', function (e) {
    var chip = e.target.closest('.filter-chip');
    if (!chip) return;

    document.querySelectorAll('.filter-chip').forEach(function (c) {
      c.classList.remove('filter-chip--active');
    });
    chip.classList.add('filter-chip--active');

    var filter = chip.getAttribute('data-filter');
    applyPetFilter(filter);
  });

  /* ================== NEWSLETTER ================== */
  function initNewsletter() {
    var form = document.getElementById('newsletterForm');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = document.getElementById('newsletterEmail').value.trim();
      var successDiv = document.getElementById('newsletterSuccess');
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        // Show inline error for invalid email
        successDiv.hidden = false;
        successDiv.className = 'newsletter-error';
        successDiv.innerHTML = '<span class="material-symbols-outlined">error</span> Por favor ingresá un email válido.';
        form.reset();
        if (window.miauguauToast) window.miauguauToast('Email inválido. Revisá el formato.', 'error');
        setTimeout(function () {
          successDiv.hidden = true;
        }, 4000);
        return;
      }

      /* --- Envío real al backend (/api/newsletter) -> SUSCRIPTORES_DIARIO --- */
      successDiv.hidden = false;
      successDiv.className = 'newsletter-success';
      successDiv.innerHTML = '<span class="material-symbols-outlined">sync</span> Suscribiendo...';
      var submitBtn = form.querySelector('.newsletter-submit');
      if (submitBtn) submitBtn.disabled = true;

      fetch('/api/newsletter', {
        method: 'POST',
        headers: Object.assign(
          { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          window.miauguauSesion.header()
        ),
        body: JSON.stringify({ correo: email })
      })
        .then(function (res) { return res.json().catch(function () { return {}; }); })
        .then(function (data) {
          if (!data || data.ok !== true) {
            throw new Error((data && data.error) ? data.error : 'Error al suscribir');
          }
          successDiv.innerHTML = '<span class="material-symbols-outlined">check_circle</span> ¡Listo! Te sumaste a la comunidad Miauguau.';
          form.reset();
          if (window.miauguauToast) window.miauguauToast('¡Suscripción confirmada! 🐾', 'success');
          setTimeout(function () { successDiv.hidden = true; }, 5000);
        })
        .catch(function (err) {
          successDiv.className = 'newsletter-error';
          successDiv.innerHTML = '<span class="material-symbols-outlined">error</span> No se pudo suscribir: ' +
            ((err && err.message) ? err.message : 'revisá tu conexión');
          if (window.miauguauToast) window.miauguauToast('No se pudo completar la suscripción.', 'error');
          setTimeout(function () { successDiv.hidden = true; }, 5000);
        })
        .finally(function () {
          if (submitBtn) submitBtn.disabled = false;
        });
    });
  }

  /* ================== REGISTRO DE USUARIO ==================
     Formulario del home que guarda nombre + correo en la tabla
     USUARIOS vía POST /api/usuarios.  El backend hace UPSERT por
     correo (UNIQUE) así que si el usuario ya existe, no se duplica.
  */
  function initRegistro() {
    var form = document.getElementById('registroForm');
    if (!form) return;

    var nombreInput = document.getElementById('reg-nombre');
    var correoInput = document.getElementById('reg-correo');
    var submitBtn = document.getElementById('reg-submit');
    var feedback = document.getElementById('registroFeedback');
    if (!nombreInput || !correoInput || !submitBtn) return;

    function mostrarFeedback(tipo, mensaje) {
      if (!feedback) return;
      feedback.hidden = false;
      feedback.className = tipo === 'error' ? 'newsletter-error' : 'newsletter-success';
      var icon = tipo === 'error' ? 'error' : 'check_circle';
      feedback.innerHTML = '<span class="material-symbols-outlined">' + icon + '</span> ' + mensaje;
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var nombre = nombreInput.value.trim();
      var correo = correoInput.value.trim().toLowerCase();

      // Validación del lado del cliente
      if (!nombre || nombre.length < 2) {
        mostrarFeedback('error', 'El nombre debe tener al menos 2 caracteres.');
        if (window.miauguauToast) window.miauguauToast('Nombre inválido', 'error');
        return;
      }
      if (!correo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
        mostrarFeedback('error', 'Por favor ingresá un correo válido.');
        if (window.miauguauToast) window.miauguauToast('Correo inválido', 'error');
        return;
      }

      var originalHTML = submitBtn.innerHTML;
      submitBtn.innerHTML = '<span class="material-symbols-outlined">sync</span> Guardando...';
      submitBtn.disabled = true;

      fetch('/api/usuarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ nombre: nombre, correo: correo })
      })
        .then(function (res) {
          return res.json().catch(function () { return {}; });
        })
        .then(function (data) {
          if (!data || data.ok !== true) {
            throw new Error((data && data.error) ? data.error : 'Error al registrar');
          }
          // ---- Guardar la sesión ----
          if (data.usuario) {
            window.miauguauSesion.set(data.usuario);
            renderPanelUsuario();
            // Sincronizar favoritos: traer los REALES del usuario desde la BD
            // (reemplaza cualquier favorito anónimo que tuviera en el caché)
            syncFavoritosDesdeBD();
          }
          if (data.creado) {
            mostrarFeedback('success', '¡Cuenta creada y sesión iniciada! Bienvenido/a, ' + (data.usuario.nombre || nombre) + ' 🐾');
            if (window.miauguauToast) window.miauguauToast('¡Registro exitoso! 🎉', 'success');
          } else {
            mostrarFeedback('success', '¡Sesión iniciada! Bienvenido de nuevo, ' + (data.usuario.nombre || nombre) + '! 🐾');
            if (window.miauguauToast) window.miauguauToast('Sesión iniciada', 'success');
          }
          form.reset();
        })
        .catch(function (err) {
          mostrarFeedback('error', 'No se pudo registrar: ' + ((err && err.message) ? err.message : 'revisá tu conexión'));
          if (window.miauguauToast) window.miauguauToast('Error al registrar', 'error');
        })
        .finally(function () {
          submitBtn.innerHTML = originalHTML;
          submitBtn.disabled = false;
        });
    });
  }

  /* ================== PANEL DE USUARIO (navbar) ==================
     Muestra el nombre del usuario logueado + botón de logout.
     Si no hay sesión, muestra un botón "Ingresar" que abre un modal
     rápido de login (solo correo).
  */
  function renderPanelUsuario() {
    // Evitar duplicar el panel si ya existe
    var existente = document.getElementById('userPanel');
    if (existente) existente.remove();

    var navbar = document.querySelector('.navbar-inner');
    if (!navbar) return;

    var usuario = window.miauguauSesion.get();
    var panel = document.createElement('div');
    panel.id = 'userPanel';
    panel.style.cssText = 'display:flex; align-items:center; gap:8px; padding:6px 12px; ' +
                          'border-radius:999px; background:rgba(0,0,0,0.04); font-size:14px;';

    if (usuario) {
      panel.innerHTML =
        '<span class="material-symbols-outlined" style="font-size:18px; color: var(--rust);">person</span>' +
        '<span style="font-weight:600; color: var(--ink); max-width:120px; overflow:hidden; ' +
        'text-overflow:ellipsis; white-space:nowrap;">' + escapeHtmlUser(usuario.nombre) + '</span>' +
        '<button id="btnLogout" type="button" aria-label="Cerrar sesión" ' +
        'style="border:none; background:transparent; cursor:pointer; padding:4px; ' +
        'display:flex; align-items:center; color: var(--ink-mute);" ' +
        'title="Cerrar sesión">' +
        '<span class="material-symbols-outlined" style="font-size:18px;">logout</span>' +
        '</button>';

      navbar.appendChild(panel);

      var btnLogout = panel.querySelector('#btnLogout');
      btnLogout.addEventListener('click', function () {
        window.miauguauSesion.clear();
        renderPanelUsuario();
        // Al cerrar sesión, vaciar el caché local de favoritos y traer
        // los del anónimo (para que no queden los del usuario que cerró)
        vaciarFavoritosLocal();
        syncFavoritosDesdeBD();
        if (window.miauguauToast) window.miauguauToast('Sesión cerrada. Hasta pronto 👋', 'info');
      });
    } else {
      panel.innerHTML =
        '<button id="btnLogin" type="button" ' +
        'style="border:none; background:transparent; cursor:pointer; padding:4px 10px; ' +
        'display:flex; align-items:center; gap:4px; color: var(--ink); font-weight:600;">' +
        '<span class="material-symbols-outlined" style="font-size:18px;">login</span>' +
        'Ingresar</button>';
      navbar.appendChild(panel);

      panel.querySelector('#btnLogin').addEventListener('click', abrirModalLogin);
    }
  }

  function escapeHtmlUser(text) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(String(text || '')));
    return div.innerHTML;
  }

  /* Modal de login rápido (solo correo) */
  function abrirModalLogin() {
    var existente = document.getElementById('loginModal');
    if (existente) existente.remove();

    var overlay = document.createElement('div');
    overlay.id = 'loginModal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
      '<div class="modal-card" style="max-width:400px;">' +
        '<button class="modal-card__close" aria-label="Cerrar"><span class="material-symbols-outlined">close</span></button>' +
        '<div class="modal-card__body" style="padding:32px;">' +
          '<div style="text-align:center; margin-bottom:20px;">' +
            '<div class="card-icon card-icon--primary" style="margin:0 auto 12px;">' +
              '<span class="material-symbols-outlined" style="font-variation-settings: \'FILL\' 1;">login</span>' +
            '</div>' +
            '<h3 style="margin:0 0 8px;">Iniciar sesión</h3>' +
            '<p style="color: var(--ink-mute); font-size:14px; margin:0;">Ingresá tu correo para continuar</p>' +
          '</div>' +
          '<form id="loginForm">' +
            '<div class="form-group" style="margin-bottom:16px;">' +
              '<label class="form-label" for="login-correo">Correo</label>' +
              '<input class="form-input" id="login-correo" name="correo" type="email" ' +
              'placeholder="tu@email.com" autocomplete="email" required>' +
            '</div>' +
            '<div id="loginFeedback" style="margin-bottom:12px;"></div>' +
            '<button class="btn-submit" type="submit" id="login-submit" style="width:100%;">' +
              '<span class="material-symbols-outlined">login</span> Ingresar' +
            '</button>' +
            '<p style="text-align:center; color: var(--ink-mute); font-size:12px; margin-top:12px;">' +
              '¿No tenés cuenta? <a href="/" data-nav="home" style="color: var(--rust); font-weight:600;">Registrate acá</a>' +
            '</p>' +
          '</form>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    setTimeout(function () {
      overlay.classList.add('modal-overlay--visible');
      var inp = overlay.querySelector('#login-correo');
      if (inp) inp.focus();
    }, 50);

    function cerrar() {
      overlay.classList.remove('modal-overlay--visible');
      document.body.style.overflow = '';
      setTimeout(function () { overlay.remove(); }, 300);
    }

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.closest('.modal-card__close')) cerrar();
    });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { cerrar(); document.removeEventListener('keydown', esc); }
    });

    var form = overlay.querySelector('#loginForm');
    var feedback = overlay.querySelector('#loginFeedback');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var correo = overlay.querySelector('#login-correo').value.trim().toLowerCase();
      if (!correo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
        feedback.innerHTML = '<p class="form-error"><span class="material-symbols-outlined" style="font-size:14px;">error</span>Correo inválido</p>';
        return;
      }

      var submitBtn = overlay.querySelector('#login-submit');
      var orig = submitBtn.innerHTML;
      submitBtn.innerHTML = '<span class="material-symbols-outlined">sync</span> Ingresando...';
      submitBtn.disabled = true;

      fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ correo: correo })
      })
        .then(function (res) { return res.json().catch(function () { return {}; }); })
        .then(function (data) {
          if (!data || data.ok !== true) {
            throw new Error((data && data.error) ? data.error : 'Error al ingresar');
          }
          window.miauguauSesion.set(data.usuario);
          renderPanelUsuario();
          // Sincronizar favoritos: traer los REALES del usuario desde la BD
          syncFavoritosDesdeBD();
          if (window.miauguauToast) window.miauguauToast('¡Bienvenido/a, ' + data.usuario.nombre + '! 🐾', 'success');
          cerrar();
        })
        .catch(function (err) {
          feedback.innerHTML = '<p class="form-error"><span class="material-symbols-outlined" style="font-size:14px;">error</span>' +
            ((err && err.message) ? err.message : 'Error') + '</p>';
        })
        .finally(function () {
          submitBtn.innerHTML = orig;
          submitBtn.disabled = false;
        });
    });
  }

  function initSesion() {
    // Restaurar sesión al cargar la página
    renderPanelUsuario();
  }

  /* ================== SCROLL PROGRESS BAR ================== */
  function initScrollProgress() {
    var bar = document.createElement('div');
    bar.className = 'cult-scroll-progress';
    document.body.appendChild(bar);

    var ticking = false;
    function update() {
      var scrollTop = window.scrollY;
      var docHeight = document.documentElement.scrollHeight - window.innerHeight;
      var progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
      bar.style.width = progress + '%';
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    }, { passive: true });
    update();
  }

  /* ================== SMOOTH ANCHOR SCROLL ================== */
  function initSmoothAnchorScroll() {
    document.querySelectorAll('a[href^="#"]:not([data-nav])').forEach(function (anchor) {
      anchor.addEventListener('click', function (e) {
        var href = this.getAttribute('href');
        if (href === '#' || href.length < 2) return;
        var el = document.querySelector(href);
        if (el) {
          e.preventDefault();
          el.scrollIntoView({ behavior: 'smooth' });
        }
      });
    });
  }

  /* ================== BOOT ================== */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
