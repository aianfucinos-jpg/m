(function () {
  'use strict';

  /* ============================================================
     1. KNOWLEDGE BASE  (cargada dinámicamente desde el backend)
     --------------------------------------------------------------
     Toda la base de conocimientos del chatbot vive en la base de
     datos (tabla CONOCIMIENTO_CHATBOT) y se sirve desde el endpoint
     /api/chatbot.  Nada de esto está hardcodeado en el frontend.

     Cada entrada: { id, label, icon, keywords[], weight,
                     response, actions[], followups[], emergency }
     ============================================================ */
  var knowledge = [];          /* se llena desde /api/chatbot */
  var knowledgeById = {};      /* map id -> entry              */
  var defaultResponse = {      /* fallback mínimo hasta que cargue */
    id: 'default',
    response: 'Cargando…',
    actions: [],
    followups: []
  };
  var welcomeCategories = [];  /* se llena desde /api/chatbot */
  var knowledgeReady = false;  /* flag: la base de conocimientos ya cargó */

  /**
   * Descarga la base de conocimientos desde el backend y construye
   * el mapa knowledgeById.  Devuelve una Promise.
   */
  function cargarConocimiento() {
    return fetch('/api/chatbot', { headers: { 'Accept': 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (data && data.knowledge) knowledge = data.knowledge;
        if (data && data.defaultResponse) defaultResponse = data.defaultResponse;
        if (data && data.welcomeCategories) welcomeCategories = data.welcomeCategories;

        /* Reconstruir el mapa id -> entry */
        knowledgeById = {};
        knowledge.forEach(function (e) { knowledgeById[e.id] = e; });

        knowledgeReady = true;
      })
      .catch(function (err) {
        console.error('[Miauguau Chatbot] No se pudo cargar la base de conocimientos:', err);
        /* Dejar knowledgeReady en false; el widget mostrará un aviso
           si el usuario intenta usarlo sin datos. */
      });
  }

  /* ============================================================
     2. CONVERSATION STATE
     ============================================================ */
  var state = {
    context: null,        // last matched entry id
    lastTopic: null,      // for follow-up context
    userName: null,       // persisted name
    askedName: false,     // already asked for name
    history: [],          // [{role, text, ts}]
    isOpen: false,
    hasWelcomed: false,
    idleTimer: null
  };

  function loadState() {
    try {
      var saved = JSON.parse(localStorage.getItem('miauguau-chat-state') || '{}');
      if (saved.userName) state.userName = saved.userName;
      if (saved.askedName) state.askedName = saved.askedName;
    } catch (e) { }
  }
  function saveState() {
    try {
      localStorage.setItem('miauguau-chat-state', JSON.stringify({
        userName: state.userName,
        askedName: state.askedName
      }));
    } catch (e) { }
  }

  /* ============================================================
     3. NLU ENGINE — weighted keyword matching + fuzzy + context
     ============================================================ */
  function normalize(text) {
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    var prev = new Array(b.length + 1);
    var curr = new Array(b.length + 1);
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      curr[0] = i;
      for (var j = 1; j <= b.length; j++) {
        var cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      for (var j = 0; j <= b.length; j++) prev[j] = curr[j];
    }
    return prev[b.length];
  }

  function similarity(a, b) {
    if (a === b) return 1;
    if (!a.length || !b.length) return 0;
    var dist = levenshtein(a, b);
    return 1 - dist / Math.max(a.length, b.length);
  }

  function getBotResponse(userMessage) {
    var lowerMsg = normalize(userMessage);
    var words = lowerMsg.split(/\s+/).filter(function (w) { return w.length >= 2; });
    var scores = {};
    var bestMatch = null;
    var bestScore = 0;

    for (var i = 0; i < knowledge.length; i++) {
      var entry = knowledge[i];
      var score = 0;
      var matchedKws = 0;

      for (var j = 0; j < entry.keywords.length; j++) {
        var kw = normalize(entry.keywords[j]);
        // Exact phrase match (strongest)
        if (lowerMsg.indexOf(kw) !== -1) {
          var phraseBoost = kw.split(/\s+/).length * 2.5;
          score += phraseBoost * entry.weight;
          matchedKws++;
        }
      }

      // Word-level fuzzy matching
      for (var w = 0; w < words.length; w++) {
        if (words[w].length < 3) continue;
        for (var k = 0; k < entry.keywords.length; k++) {
          var kwNorm = normalize(entry.keywords[k]);
          var kwWords = kwNorm.split(/\s+/);
          for (var kwW = 0; kwW < kwWords.length; kwW++) {
            if (kwWords[kwW].length < 3) continue;
            var sim = similarity(words[w], kwWords[kwW]);
            if (sim > 0.82) {
              score += sim * entry.weight * 0.8;
            }
          }
        }
      }

      // Context boost: if this entry is a followup of the last topic
      if (state.context && knowledgeById[state.context] && knowledgeById[state.context].followups.indexOf(entry.id) !== -1) {
        score *= 1.15;
      }

      // Emergency priority boost
      if (entry.emergency) score *= 1.3;

      scores[entry.id] = score;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = entry;
      }
    }

    // If nothing matched well, try context-based followup interpretation
    if (bestScore < 0.8 && state.context) {
      var ctxEntry = knowledgeById[state.context];
      if (ctxEntry && ctxEntry.followups.length) {
        // Check if any followup keyword matches loosely
        for (var f = 0; f < ctxEntry.followups.length; f++) {
          var fEntry = knowledgeById[ctxEntry.followups[f]];
          if (!fEntry) continue;
          for (var fk = 0; fk < fEntry.keywords.length; fk++) {
            var fkw = normalize(fEntry.keywords[fk]);
            if (lowerMsg.indexOf(fkw) !== -1 || words.some(function (w) { return similarity(w, fkw) > 0.85; })) {
              return fEntry;
            }
          }
        }
      }
    }

    if (bestMatch && bestScore > 0.5) {
      return bestMatch;
    }
    return defaultResponse;
  }

  /* ============================================================
     4. SPA-AWARE PAGE CONTEXT
     ============================================================ */
  function getPageContext() {
    var active = document.querySelector('[data-page-view].is-active');
    if (!active) return 'inicio';
    var view = active.getAttribute('data-page-view');
    if (view === 'adoptar') return 'adopcion';
    if (view === 'concientizar') return 'concientizar';
    if (view === 'contacto') return 'contacto';
    return 'inicio';
  }

  function getWelcomeMessage() {
    var ctx = getPageContext();
    var name = state.userName ? ', ' + state.userName : '';
    var base = {
      adopcion: {
        response: '¡Hola' + name + '! 😻 Veo que estás mirando nuestras mascotas en adopción. ¿Te gustaría saber más sobre alguna de ellas o tenés preguntas sobre el proceso?',
        followups: ['adopcion', 'requisitos', 'costo', 'perros', 'gatos']
      },
      concientizar: {
        response: '¡Hola' + name + '! 🌱 Estás en nuestra sección de concientización. ¿Querés saber más sobre cómo ayudar a los animales o tenés alguna consulta?',
        followups: ['voluntariado', 'esterilizacion', 'cuidados', 'historias']
      },
      contacto: {
        response: '¡Hola' + name + '! 💌 ¿Necesitas contactarnos? Puedo ayudarte con información sobre horarios o resolver tus dudas directamente.',
        followups: ['horarios', 'contacto', 'voluntariado']
      },
      inicio: {
        response: '¡Hola' + name + '! 🐾 Soy **Miau**, el asistente virtual de Miauguau. ¿En qué puedo ayudarte hoy? Tocá una categoría o escribinos tu consulta.',
        followups: ['adopcion', 'horarios', 'voluntariado']
      }
    };
    return base[ctx] || base.inicio;
  }

  /* ============================================================
     5. NOTIFICATION SOUND (Web Audio)
     ============================================================ */
  var notificationSound = null;
  function initNotificationSound() {
    try {
      var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      notificationSound = {
        ctx: audioCtx,
        play: function () {
          try {
            var osc = this.ctx.createOscillator();
            var gain = this.ctx.createGain();
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, this.ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(587, this.ctx.currentTime + 0.15);
            gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.25);
            osc.start(this.ctx.currentTime);
            osc.stop(this.ctx.currentTime + 0.25);
          } catch (e) { }
        }
      };
    } catch (e) { }
  }
  function playNotificationSound() {
    if (notificationSound) notificationSound.play();
  }

  /* ============================================================
     6. WIDGET CREATION
     ============================================================ */
  function createChatWidget() {
    initNotificationSound();

    /* --- FAB --- */
    var fab = document.createElement('button');
    fab.className = 'chat-fab';
    fab.setAttribute('aria-label', 'Abrir chat de ayuda');
    fab.innerHTML = '<span class="material-symbols-outlined" style="font-variation-settings: \'FILL\' 1;">pets</span>' +
                    '<span class="chat-fab__label">¿Necesitas ayuda?</span>';
    document.body.appendChild(fab);

    var badge = document.createElement('span');
    badge.className = 'chat-fab__badge';
    badge.textContent = '1';
    fab.appendChild(badge);

    /* --- Panel --- */
    var panel = document.createElement('div');
    panel.className = 'chat-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Chat de ayuda Miauguau');
    panel.innerHTML =
      '<div class="chat-panel__header">' +
        '<div class="chat-panel__header-bg"></div>' +
        '<div class="chat-panel__header-content">' +
          '<div class="chat-panel__header-info">' +
            '<div class="chat-panel__avatar">' +
              '<span class="material-symbols-outlined" style="font-variation-settings: \'FILL\' 1; font-size:22px;">pets</span>' +
              '<span class="chat-panel__avatar-status"></span>' +
            '</div>' +
            '<div class="chat-panel__header-text">' +
              '<p class="chat-panel__title">Miau <span class="chat-panel__badge-verified" title="Asistente verificado"><span class="material-symbols-outlined" style="font-size:11px;">check</span></span></p>' +
              '<p class="chat-panel__status"><span class="chat-panel__status-dot"></span><span class="chat-panel__status-text">En línea • Responde en seguida</span></p>' +
            '</div>' +
          '</div>' +
          '<div class="chat-panel__header-actions">' +
            '<button class="chat-panel__btn chat-panel__btn--search" aria-label="Buscar en la conversación">' +
              '<span class="material-symbols-outlined">search</span>' +
              '<span class="chat-panel__btn-tooltip">Buscar</span>' +
            '</button>' +
            '<button class="chat-panel__btn chat-panel__btn--clear" aria-label="Limpiar conversación">' +
              '<span class="material-symbols-outlined">delete_sweep</span>' +
              '<span class="chat-panel__btn-tooltip">Limpiar</span>' +
            '</button>' +
            '<span class="chat-panel__btn-divider" aria-hidden="true"></span>' +
            '<button class="chat-panel__btn chat-panel__btn--close" aria-label="Cerrar chat">' +
              '<span class="material-symbols-outlined">close</span>' +
              '<span class="chat-panel__btn-tooltip">Cerrar</span>' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="chat-panel__search" aria-hidden="true">' +
        '<span class="material-symbols-outlined">search</span>' +
        '<input type="text" class="chat-panel__search-input" placeholder="Buscar en la conversación..." />' +
        '<button class="chat-panel__search-close" aria-label="Cerrar búsqueda"><span class="material-symbols-outlined">close</span></button>' +
      '</div>' +
      '<div class="chat-panel__messages"></div>' +
      '<button class="chat-panel__scroll-btn" aria-label="Ir al final"><span class="material-symbols-outlined">arrow_downward</span></button>' +
      '<div class="chat-panel__quick-replies"></div>' +
      '<div class="chat-panel__input-area">' +
        '<div class="chat-panel__command-palette" aria-hidden="true"></div>' +
        '<form class="chat-panel__form">' +
          '<button type="button" class="chat-panel__mic" aria-label="Entrada de voz" title="Hablar"><span class="material-symbols-outlined">mic</span></button>' +
          '<input type="text" class="chat-panel__input" placeholder="Escribí tu mensaje o / para comandos..." autocomplete="off">' +
          '<button type="submit" class="chat-panel__send" aria-label="Enviar mensaje">' +
            '<span class="material-symbols-outlined">send</span>' +
          '</button>' +
        '</form>' +
      '</div>' +
      '<div class="chat-panel__footer">' +
        '<span class="material-symbols-outlined" style="font-size:11px;">bolt</span>' +
        'Respuestas automáticas • Powered by Miauguau' +
      '</div>';
    document.body.appendChild(panel);

    var messagesContainer = panel.querySelector('.chat-panel__messages');
    var quickRepliesContainer = panel.querySelector('.chat-panel__quick-replies');
    var inputForm = panel.querySelector('.chat-panel__form');
    var inputEl = panel.querySelector('.chat-panel__input');
    var micBtn = panel.querySelector('.chat-panel__mic');
    var sendBtn = panel.querySelector('.chat-panel__send');
    var closeBtn = panel.querySelector('.chat-panel__btn--close');
    var clearBtn = panel.querySelector('.chat-panel__btn--clear');
    var searchBtn = panel.querySelector('.chat-panel__btn--search');
    var searchBox = panel.querySelector('.chat-panel__search');
    var searchInput = panel.querySelector('.chat-panel__search-input');
    var searchClose = panel.querySelector('.chat-panel__search-close');
    var scrollBtn = panel.querySelector('.chat-panel__scroll-btn');
    var headerEl = panel.querySelector('.chat-panel__header');
    var statusTextEl = panel.querySelector('.chat-panel__status-text');

    /* --- Header "typing" state --- */
    var headerTypingTimer = null;
    function setHeaderTyping(isTyping) {
      if (isTyping) {
        headerEl.classList.add('chat-panel__header--typing');
        if (statusTextEl) statusTextEl.textContent = 'Escribiendo…';
      } else {
        headerEl.classList.remove('chat-panel__header--typing');
        if (statusTextEl) statusTextEl.textContent = 'En línea • Responde en seguida';
      }
    }
    var commandPalette = panel.querySelector('.chat-panel__command-palette');

    /* --- Open / close --- */
    function toggleChat() {
      state.isOpen = !state.isOpen;
      if (state.isOpen) {
        panel.classList.add('chat-panel--open');
        fab.classList.add('chat-fab--hidden');
        badge.style.display = 'none';
        setTimeout(function () { inputEl.focus(); }, 300);
        if (!state.hasWelcomed) {
          state.hasWelcomed = true;
          restoreChat();
          if (messagesContainer.children.length === 0) {
            var welcome = getWelcomeMessage();
            setTimeout(function () {
              addBotMessage(welcome.response, welcome.followups);
            }, 400);
          }
        }
        resetIdleTimer();
      } else {
        panel.classList.remove('chat-panel--open');
        fab.classList.remove('chat-fab--hidden');
        clearIdleTimer();
      }
    }
    function closePanel() {
      state.isOpen = false;
      panel.classList.remove('chat-panel--open');
      fab.classList.remove('chat-fab--hidden');
      clearIdleTimer();
    }

    fab.addEventListener('click', toggleChat);
    closeBtn.addEventListener('click', closePanel);

    /* --- Clear chat --- */
    clearBtn.addEventListener('click', function () {
      messagesContainer.innerHTML = '';
      quickRepliesContainer.innerHTML = '';
      try {
        localStorage.removeItem('miauguau-chat-history');
      } catch (e) { }
      state.history = [];
      state.context = null;
      state.hasWelcomed = true;
      var welcome = getWelcomeMessage();
      setTimeout(function () {
        addBotMessage(welcome.response, welcome.followups);
      }, 300);
    });

    /* --- Search within chat --- */
    var searchOpen = false;
    searchBtn.addEventListener('click', function () {
      searchOpen = !searchOpen;
      if (searchOpen) {
        searchBox.setAttribute('aria-hidden', 'false');
        searchBox.classList.add('chat-panel__search--open');
        setTimeout(function () { searchInput.focus(); }, 200);
      } else {
        closeSearch();
      }
    });
    searchClose.addEventListener('click', closeSearch);
    function closeSearch() {
      searchOpen = false;
      searchBox.setAttribute('aria-hidden', 'true');
      searchBox.classList.remove('chat-panel__search--open');
      searchInput.value = '';
      highlightSearch('');
    }
    searchInput.addEventListener('input', function () {
      highlightSearch(searchInput.value.trim().toLowerCase());
    });
    function highlightSearch(query) {
      var bubbles = messagesContainer.querySelectorAll('.chat-message__bubble');
      bubbles.forEach(function (b) {
        b.classList.remove('chat-message__bubble--match');
        b.classList.remove('chat-message__bubble--dim');
        if (!query) return;
        var txt = b.textContent.toLowerCase();
        if (txt.indexOf(query) !== -1) {
          b.classList.add('chat-message__bubble--match');
        } else {
          b.classList.add('chat-message__bubble--dim');
        }
      });
    }

    /* --- Scroll button --- */
    messagesContainer.addEventListener('scroll', function () {
      var atBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < 60;
      scrollBtn.classList.toggle('chat-panel__scroll-btn--visible', !atBottom);
    });
    scrollBtn.addEventListener('click', function () {
      scrollToBottom(true);
    });

    /* --- Command palette (type "/") --- */
    inputEl.addEventListener('input', function () {
      var val = inputEl.value;
      if (val.trim() === '/') {
        showCommandPalette();
      } else if (val.charAt(0) === '/') {
        filterCommandPalette(val.slice(1).toLowerCase());
      } else {
        hideCommandPalette();
      }
    });
    function showCommandPalette() {
      commandPalette.innerHTML = '';
      knowledge.forEach(function (entry) {
        if (entry.id === 'saludo' || entry.id === 'gracias' || entry.id === 'despedida') return;
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'chat-command-item';
        item.setAttribute('data-search', entry.label.toLowerCase());
        item.innerHTML =
          '<span class="chat-command-item__icon"><span class="material-symbols-outlined">' + entry.icon + '</span></span>' +
          '<span class="chat-command-item__text">' + entry.label + '</span>';
        item.addEventListener('click', function () {
          inputEl.value = '';
          hideCommandPalette();
          handleUserInput(entry.label);
        });
        commandPalette.appendChild(item);
      });
      commandPalette.setAttribute('aria-hidden', 'false');
      commandPalette.classList.add('chat-panel__command-palette--open');
    }
    function filterCommandPalette(q) {
      var items = commandPalette.querySelectorAll('.chat-command-item');
      items.forEach(function (it) {
        var s = it.getAttribute('data-search');
        it.style.display = s.indexOf(q) !== -1 ? '' : 'none';
      });
    }
    function hideCommandPalette() {
      commandPalette.setAttribute('aria-hidden', 'true');
      commandPalette.classList.remove('chat-panel__command-palette--open');
    }

    /* --- Voice input (Web Speech API) --- */
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    var recognition = null;
    var isRecording = false;
    if (SpeechRecognition) {
      try {
        recognition = new SpeechRecognition();
        recognition.lang = 'es-AR';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        recognition.continuous = false;
        recognition.onresult = function (e) {
          var transcript = e.results[0][0].transcript;
          inputEl.value = transcript;
          stopRecording();
          setTimeout(function () { inputForm.requestSubmit(); }, 200);
        };
        recognition.onerror = function () { stopRecording(); };
        recognition.onend = function () { stopRecording(); };
      } catch (e) { recognition = null; }
    }
    if (!recognition) {
      micBtn.style.display = 'none';
    }
    function startRecording() {
      if (!recognition || isRecording) return;
      try {
        recognition.start();
        isRecording = true;
        micBtn.classList.add('chat-panel__mic--recording');
        micBtn.setAttribute('aria-label', 'Detener grabación');
      } catch (e) { }
    }
    function stopRecording() {
      isRecording = false;
      micBtn.classList.remove('chat-panel__mic--recording');
      micBtn.setAttribute('aria-label', 'Entrada de voz');
    }
    micBtn.addEventListener('click', function () {
      if (isRecording) {
        recognition.stop();
        stopRecording();
      } else {
        startRecording();
      }
    });

    /* --- Rendering helpers --- */
    function formatRichText(text) {
      // Escape first
      var esc = escapeHtml(text);
      // Bold **text**
      esc = esc.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      // Newlines to <br>
      esc = esc.replace(/\n/g, '<br>');
      return esc;
    }

    function timeStamp() {
      var d = new Date();
      var h = d.getHours();
      var m = d.getMinutes();
      return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    }

    function escapeHtml(text) {
      var div = document.createElement('div');
      div.appendChild(document.createTextNode(text));
      return div.innerHTML;
    }

    function scrollToBottom(animate) {
      if (animate) {
        messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' });
      } else {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    }

    /* --- Add bot message with typing + character animation --- */
    function addBotMessage(text, followups, options) {
      options = options || {};
      // Header typing state
      setHeaderTyping(true);
      // Typing indicator first
      var typing = document.createElement('div');
      typing.className = 'chat-message chat-message--bot chat-message--typing';
      typing.innerHTML =
        '<div class="chat-message__avatar"><span class="material-symbols-outlined" style="font-variation-settings: \'FILL\' 1; font-size:16px;">pets</span></div>' +
        '<div class="chat-message__bubble"><div class="chat-typing-indicator"><span></span><span></span><span></span></div></div>';
      messagesContainer.appendChild(typing);
      scrollToBottom();

      var delay = Math.min(700 + text.length * 6, 1800);
      setTimeout(function () {
        typing.remove();
        setHeaderTyping(false);
        var msg = document.createElement('div');
        msg.className = 'chat-message chat-message--bot';
        if (options.emergency) msg.classList.add('chat-message--emergency');

        var bubbleHtml = formatRichText(text);

        // Action chips inside bubble
        var actionsHtml = '';
        if (options.actions && options.actions.length) {
          actionsHtml = '<div class="chat-message__actions">';
          options.actions.forEach(function (a) {
            var icon = a.icon ? '<span class="material-symbols-outlined">' + a.icon + '</span>' : '';
            actionsHtml += '<button class="chat-action-chip" data-nav="' + (a.nav || '') + '" data-intent="' + (a.intent || '') + '" data-href="' + (a.href || '') + '">' + icon + '<span>' + escapeHtml(a.label) + '</span></button>';
          });
          actionsHtml += '</div>';
        }

        msg.innerHTML =
          '<div class="chat-message__avatar"><span class="material-symbols-outlined" style="font-variation-settings: \'FILL\' 1; font-size:16px;">pets</span></div>' +
          '<div class="chat-message__content">' +
            '<div class="chat-message__bubble">' + bubbleHtml + actionsHtml + '</div>' +
            '<div class="chat-message__meta">' +
              '<span class="chat-message__time">' + timeStamp() + '</span>' +
              '<span class="chat-message__reactions">' +
                '<button class="chat-reaction" data-reaction="up" aria-label="Útil"><span class="material-symbols-outlined">thumb_up</span></button>' +
                '<button class="chat-reaction" data-reaction="down" aria-label="No útil"><span class="material-symbols-outlined">thumb_down</span></button>' +
              '</span>' +
            '</div>' +
          '</div>';
        messagesContainer.appendChild(msg);
        scrollToBottom();
        playNotificationSound();

        // Bind action chips
        msg.querySelectorAll('.chat-action-chip').forEach(function (chip) {
          chip.addEventListener('click', function () {
            var nav = chip.getAttribute('data-nav');
            var intent = chip.getAttribute('data-intent');
            var href = chip.getAttribute('data-href');
            if (href) {
              window.open(href, '_blank');
              return;
            }
            if (nav) {
              // Trigger SPA navigation
              var navLink = document.querySelector('[data-nav="' + nav + '"]');
              if (navLink) {
                navLink.click();
                // Visual feedback
                if (window.miauguauToast) {
                  window.miauguauToast('Te llevo a la sección…', 'info');
                }
              }
              closePanel();
              return;
            }
            if (intent && knowledgeById[intent]) {
              var entry = knowledgeById[intent];
              addUserMessage(entry.label);
              state.context = intent;
              setTimeout(function () {
                addBotMessage(entry.response, entry.followups, { actions: entry.actions, emergency: entry.emergency });
              }, 200);
            }
          });
        });

        // Bind reactions
        msg.querySelectorAll('.chat-reaction').forEach(function (r) {
          r.addEventListener('click', function () {
            var reaction = r.getAttribute('data-reaction');
            msg.querySelectorAll('.chat-reaction').forEach(function (x) { x.classList.remove('chat-reaction--active'); });
            r.classList.add('chat-reaction--active');
            if (window.miauguauToast) {
              if (reaction === 'up') {
                window.miauguauToast('¡Gracias por tu feedback! 💚', 'success');
              } else {
                window.miauguauToast('Vamos a mejorar esa respuesta 🙏', 'info');
              }
            }
          });
        });

        // Show follow-up quick replies
        if (followups && followups.length) {
          showQuickReplies(followups);
        } else {
          quickRepliesContainer.innerHTML = '';
        }

        saveChat();
      }, delay);
    }

    function addUserMessage(text) {
      var msg = document.createElement('div');
      msg.className = 'chat-message chat-message--user';
      msg.innerHTML =
        '<div class="chat-message__content">' +
          '<div class="chat-message__bubble">' + escapeHtml(text) + '</div>' +
          '<div class="chat-message__meta"><span class="chat-message__time">' + timeStamp() + '</span><span class="chat-message__read">✓✓</span></div>' +
        '</div>';
      messagesContainer.appendChild(msg);
      scrollToBottom();
      quickRepliesContainer.innerHTML = '';
      state.history.push({ role: 'user', text: text, ts: Date.now() });
    }

    /* --- Quick replies with icons --- */
    function showQuickReplies(followupIds) {
      quickRepliesContainer.innerHTML = '';
      var wrapper = document.createElement('div');
      wrapper.className = 'chat-quick-replies__wrapper';
      followupIds.forEach(function (id) {
        var entry = knowledgeById[id];
        if (!entry) return;
        var chip = document.createElement('button');
        chip.className = 'chat-quick-reply';
        chip.innerHTML = '<span class="material-symbols-outlined">' + entry.icon + '</span><span>' + escapeHtml(entry.label) + '</span>';
        chip.addEventListener('click', function () {
          handleUserInput(entry.label);
        });
        wrapper.appendChild(chip);
      });
      quickRepliesContainer.appendChild(wrapper);
    }

    /* --- Main input handler --- */
    function handleUserInput(text) {
      text = text.trim();
      if (!text) return;
      hideCommandPalette();
      resetIdleTimer();

      // Emergency override: if message contains urgent keywords, prioritize
      var lower = normalize(text);
      var emergencyWords = ['urgente', 'emergencia', 'herido', 'herida', 'sangrando', 'atropellado', 'maltrato', 'abandono', 'ayuda urgente'];
      var isEmergency = emergencyWords.some(function (w) { return lower.indexOf(w) !== -1; });

      addUserMessage(text);

      // Ask for name if not known (once)
      if (!state.userName && !state.askedName && state.history.filter(function (h) { return h.role === 'user'; }).length === 1 && !isEmergency) {
        // Don't ask if it's a greeting or command
        if (!/^(hola|buenas|hey|hi|\/)/.test(lower)) {
          state.askedName = true;
          saveState();
          setTimeout(function () {
            addBotMessage('¡Qué bueno tenerte por acá! 🐾 Antes de seguir, ¿cómo te llamás? (escribí tu nombre o "salir" para omitir)', [], { actions: [] });
            var nameHandler = function (e) {
              var val = e.detail || inputEl.value.trim();
              if (!val) return;
              if (lower === 'salir' || normalize(val) === 'salir' || normalize(val) === 'omitir') {
                state.userName = '';
                state.askedName = true;
              } else if (val.length <= 30) {
                state.userName = val;
              }
              saveState();
              inputForm.removeEventListener('submit-name', nameHandler);
            };
            // We'll handle name capture in the normal flow
          }, 200);
        }
      }

      var response = getBotResponse(text);
      state.context = response.id;
      state.lastTopic = response.id;

      // Special: if user provided a name (after we asked), capture it
      if (state.askedName && !state.userName && state.history.filter(function (h) { return h.role === 'user'; }).length === 2) {
        var potentialName = text.trim();
        if (potentialName.length <= 30 && potentialName.length >= 2 && !/^(salir|omitir|no|gracias)$/i.test(potentialName)) {
          state.userName = potentialName;
          saveState();
          setTimeout(function () {
            addBotMessage('¡Encantada, **' + escapeHtml(state.userName) + '**! 💚 Ahora contame, ¿en qué te puedo ayudar?', response.followups, { actions: response.actions, emergency: response.emergency });
          }, 200);
          return;
        }
      }

      setTimeout(function () {
        addBotMessage(response.response, response.followups, {
          actions: response.actions,
          emergency: response.emergency || isEmergency
        });
      }, 200);
    }

    inputForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = inputEl.value.trim();
      if (!text) return;
      inputEl.value = '';
      hideCommandPalette();
      handleUserInput(text);
    });

    /* --- Idle suggestions --- */
    function resetIdleTimer() {
      clearIdleTimer();
      state.idleTimer = setTimeout(function () {
        if (state.isOpen && state.history.length > 0) {
          var idleMsgs = [
            '¿Todo bien? Si tenés más preguntas, estoy acá 🐾',
            '¿Te puedo ayudar con algo más? Escribí / para ver todos los temas.',
            '¿Necesitas info sobre alguna mascota en particular? 🐶🐱'
          ];
          var pick = idleMsgs[Math.floor(Math.random() * idleMsgs.length)];
          addBotMessage(pick, ['adopcion', 'horarios', 'voluntariado'], { actions: [] });
        }
      }, 45000);
    }
    function clearIdleTimer() {
      if (state.idleTimer) {
        clearTimeout(state.idleTimer);
        state.idleTimer = null;
      }
    }

    /* --- Persistence --- */
    function saveChat() {
      try {
        var msgs = [];
        var msgEls = messagesContainer.querySelectorAll('.chat-message:not(.chat-message--typing)');
        for (var i = 0; i < msgEls.length; i++) {
          var isBot = msgEls[i].classList.contains('chat-message--bot');
          var bubble = msgEls[i].querySelector('.chat-message__bubble');
          if (bubble) {
            // Strip action chips from saved content (we lose re-binding on restore)
            var clone = bubble.cloneNode(true);
            var acts = clone.querySelectorAll('.chat-message__actions');
            acts.forEach(function (a) { a.remove(); });
            msgs.push({ type: isBot ? 'bot' : 'user', text: clone.innerHTML, ts: Date.now() });
          }
        }
        localStorage.setItem('miauguau-chat-history', JSON.stringify(msgs.slice(-30)));
      } catch (e) { }
    }

    function restoreChat() {
      if (messagesContainer.children.length > 0) return;
      try {
        var saved = localStorage.getItem('miauguau-chat-history');
        if (saved) {
          var msgs = JSON.parse(saved);
          var start = Math.max(0, msgs.length - 20);
          for (var i = start; i < msgs.length; i++) {
            var msg = document.createElement('div');
            msg.className = 'chat-message chat-message--' + msgs[i].type;
            if (msgs[i].type === 'bot') {
              msg.innerHTML =
                '<div class="chat-message__avatar"><span class="material-symbols-outlined" style="font-variation-settings: \'FILL\' 1; font-size:16px;">pets</span></div>' +
                '<div class="chat-message__content">' +
                  '<div class="chat-message__bubble">' + msgs[i].text + '</div>' +
                '</div>';
            } else {
              msg.innerHTML = '<div class="chat-message__content"><div class="chat-message__bubble">' + msgs[i].text + '</div></div>';
            }
            messagesContainer.appendChild(msg);
          }
          scrollToBottom();
        }
      } catch (e) { }
    }

    /* --- Keyboard --- */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (searchOpen) { closeSearch(); return; }
        if (state.isOpen) closePanel();
      }
    });
  }

  /* ============================================================
     7. BOOT
     ============================================================ */
  function boot() {
    loadState();
    /* Cargar la base de conocimientos desde el backend ANTES de
       crear el widget, para que todas las respuestas estén listas. */
    cargarConocimiento().finally(function () {
      createChatWidget();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
