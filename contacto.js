(function () {
  'use strict';

  /* ============================================================
     contacto.js — Formulario de contacto
     --------------------------------------------------------------
     Ahora el formulario envía al BACKEND PROPIO (/api/contacto),
     que guarda el mensaje en la tabla MENSAJES_CONTACTO de la
     base de datos.  Ya NO se usa FormSubmit.

     Si el usuario viene del modal de adopción (hay un
     'miauguau-adopcion-pet' en sessionStorage), se precarga el
     asunto en "adopcion" y se guarda el mascota_id en un campo
     oculto; al enviar, el backend también crea una
     SOLICITUDES_ADOPCION.
     ============================================================ */

  var commonDomains = [
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
    'live.com', 'aol.com', 'icloud.com', 'mail.com',
    'protonmail.com', 'zoho.com', 'yandex.com', 'qq.com',
    'terra.com', 'uol.com.br', 'bol.com.br', 'yahoo.com.ar',
    'hotmail.es'
  ];

  function levenshtein(a, b) {
    var tmp, i, j, prev, val;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    if (a.length > b.length) { tmp = a; a = b; b = tmp; }
    var row = new Array(a.length + 1);
    for (i = 0; i <= a.length; i++) row[i] = i;
    for (i = 1; i <= b.length; i++) {
      prev = i;
      for (j = 1; j <= a.length; j++) {
        if (b[i - 1] === a[j - 1]) val = row[j - 1];
        else val = Math.min(row[j - 1] + 1, Math.min(prev + 1, row[j] + 1));
        row[j - 1] = prev;
        prev = val;
      }
      row[a.length] = prev;
    }
    return row[a.length];
  }

  function findClosestDomain(domain) {
    if (!domain || domain.length < 2) return null;
    var lower = domain.toLowerCase().trim();
    var best = null;
    var bestDist = Infinity;
    var maxDist = Math.max(3, Math.floor(lower.length * 0.4));
    for (var i = 0; i < commonDomains.length; i++) {
      if (lower === commonDomains[i]) return null;
      var dist = levenshtein(lower, commonDomains[i]);
      if (dist < bestDist && dist <= maxDist) {
        bestDist = dist;
        best = commonDomains[i];
      }
    }
    return best;
  }

  function checkEmailDomain(emailValue) {
    if (!emailValue) return null;
    var value = emailValue.trim();
    var atPos = value.indexOf('@');
    if (atPos < 1 || atPos >= value.length - 1) return null;
    var domain = value.substring(atPos + 1);
    if (domain.length < 2) return null;
    return findClosestDomain(domain);
  }

  function init() {
    var form = document.getElementById('contactForm');
    if (!form || form._contactoInit) return;
    form._contactoInit = true;

    var emailInput = document.getElementById('email');
    var submitBtn = form.querySelector('.btn-submit');
    if (!emailInput || !submitBtn) return;

    var currentSuggestedEmail = null;

    /* ----------------------------------------------------------
       Prefill desde el modal de adopción (sessionStorage)
       ---------------------------------------------------------- */
    (function prefillAdopcion() {
      var petData = null;
      try {
        var raw = sessionStorage.getItem('miauguau-adopcion-pet');
        if (raw) petData = JSON.parse(raw);
      } catch (e) { }
      if (!petData) return;

      // mostrar banner informativo sobre la mascota
      var banner = document.createElement('div');
      banner.className = 'email-confirm-warning';
      banner.setAttribute('role', 'status');
      banner.innerHTML =
        '<div class="email-confirm-warning__icon"><span class="material-symbols-outlined">pets</span></div>' +
        '<div class="email-confirm-warning__content">' +
          '<p class="email-confirm-warning__title">Estás iniciando la adopción de <strong>' +
            (petData.nombre || 'una mascota') + '</strong></p>' +
          '<p class="email-confirm-warning__text">Completá tus datos y te contactaremos para continuar el proceso.</p>' +
        '</div>' +
        '<button type="button" class="email-confirm-warning__close" title="Cerrar"><span class="material-symbols-outlined">close</span></button>';
      var formCard = document.querySelector('.form-card');
      if (formCard) formCard.parentNode.insertBefore(banner, formCard);
      else form.parentNode.insertBefore(banner, form);

      banner.querySelector('.email-confirm-warning__close').addEventListener('click', function () {
        banner.remove();
        try { sessionStorage.removeItem('miauguau-adopcion-pet'); } catch (e) { }
        var hidden = form.querySelector('#mascotaId');
        if (hidden) hidden.value = '';
        var subjectSelect = form.querySelector('#subject');
        if (subjectSelect) subjectSelect.value = '';
      });

      // precargar mascota_id y asunto
      var hidden = form.querySelector('#mascotaId');
      if (hidden) hidden.value = petData.id || '';
      var subjectSelect = form.querySelector('#subject');
      if (subjectSelect) subjectSelect.value = 'adopcion';

      // precargar el mensaje
      var messageField = form.querySelector('#message');
      if (messageField && !messageField.value) {
        messageField.value = 'Hola, quiero iniciar el proceso de adopción de ' +
          (petData.nombre || 'esta mascota') + '. ';
      }

      try { sessionStorage.removeItem('miauguau-adopcion-pet'); } catch (e) { }
    })();

    /* ----------------------------------------------------------
       Sugerencia de dominio de email (UX, sin cambios)
       ---------------------------------------------------------- */
    function showSuggestion(suggestedDomain) {
      removeSuggestion();
      if (!suggestedDomain) return;
      var localPart = emailInput.value.split('@')[0] || '';
      var fullSuggestion = localPart + '@' + suggestedDomain;
      currentSuggestedEmail = fullSuggestion;

      var el = document.createElement('div');
      el.className = 'email-suggestion';
      el.setAttribute('role', 'alert');
      el.innerHTML =
        '<span class="material-symbols-outlined email-suggestion__icon">spellcheck</span>' +
        '<span class="email-suggestion__text">¿Quisiste decir ' +
          '<button type="button" class="email-suggestion__domain">' + fullSuggestion + '</button>?</span>' +
        '<button type="button" class="email-suggestion__btn">' +
          '<span class="material-symbols-outlined" style="font-size:14px;">arrow_forward</span>Cambiar</button>';

      var group = emailInput.closest('.form-group');
      group.appendChild(el);

      function applySuggestion(evt) {
        if (evt) { evt.preventDefault(); evt.stopPropagation(); }
        emailInput.value = fullSuggestion;
        currentSuggestedEmail = null;
        removeSuggestion();
        emailInput.classList.remove('form-input--error');
        emailInput.classList.add('form-input--success');
        var err = group.querySelector('.form-error');
        if (err) err.remove();
      }
      el.querySelector('.email-suggestion__domain').addEventListener('click', applySuggestion);
      el.querySelector('.email-suggestion__btn').addEventListener('click', applySuggestion);
    }

    function removeSuggestion() {
      var group = emailInput.closest('.form-group');
      if (!group) return;
      var existing = group.querySelector('.email-suggestion');
      if (existing) existing.remove();
    }

    function checkAndShowSuggestion() {
      var s = checkEmailDomain(emailInput.value);
      if (s) showSuggestion(s);
      else { currentSuggestedEmail = null; removeSuggestion(); }
    }

    var debounce = null;
    emailInput.addEventListener('keyup', function () {
      clearTimeout(debounce);
      debounce = setTimeout(checkAndShowSuggestion, 300);
    });
    emailInput.addEventListener('input', function () {
      clearTimeout(debounce);
      debounce = setTimeout(checkAndShowSuggestion, 300);
    });
    emailInput.addEventListener('blur', function () {
      clearTimeout(debounce);
      debounce = setTimeout(checkAndShowSuggestion, 150);
    });

    /* ----------------------------------------------------------
       Validación de campos
       ---------------------------------------------------------- */
    var validators = {
      name: function (v) {
        if (!v.trim()) return 'Por favor ingresá tu nombre';
        if (v.trim().length < 2) return 'El nombre debe tener al menos 2 caracteres';
        return '';
      },
      email: function (v) {
        if (!v.trim()) return 'Por favor ingresá tu email';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) return 'Por favor ingresá un email válido';
        return '';
      },
      subject: function (v) {
        if (!v) return 'Por favor seleccioná un asunto';
        return '';
      },
      message: function (v) {
        if (!v.trim()) return 'Por favor escribí tu mensaje';
        if (v.trim().length < 10) return 'El mensaje debe tener al menos 10 caracteres';
        return '';
      }
    };

    function showError(input, message) {
      input.classList.add('form-input--error');
      input.classList.remove('form-input--success');
      var group = input.closest('.form-group');
      var existing = group.querySelector('.form-error');
      if (existing) existing.remove();
      if (message) {
        var el = document.createElement('p');
        el.className = 'form-error';
        el.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px;">error</span>' + message;
        group.appendChild(el);
      }
    }
    function showSuccess(input) {
      input.classList.remove('form-input--error');
      input.classList.add('form-input--success');
      var group = input.closest('.form-group');
      var existing = group.querySelector('.form-error');
      if (existing) existing.remove();
    }

    var fields = form.querySelectorAll('.form-input, .form-select, .form-textarea');
    fields.forEach(function (field) {
      field.addEventListener('blur', function () {
        var name = field.getAttribute('name');
        if (validators[name] && field.value.trim()) {
          var err = validators[name](field.value);
          if (err) showError(field, err);
          else showSuccess(field);
        }
      });
      field.addEventListener('focus', function () {
        field.classList.remove('form-input--error');
      });
    });

    /* ----------------------------------------------------------
       Envío al backend (/api/contacto) -> MENSAJES_CONTACTO
       ---------------------------------------------------------- */
    var isSubmitting = false;
    function handleSubmit(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      if (isSubmitting) return;
      isSubmitting = true;

      var isValid = true;
      fields.forEach(function (field) {
        var name = field.getAttribute('name');
        if (validators[name]) {
          var err = validators[name](field.value);
          if (err) { showError(field, err); isValid = false; }
          else showSuccess(field);
        }
      });

      if (!isValid) {
        isSubmitting = false;
        var firstError = form.querySelector('.form-input--error, .form-select--error, .form-textarea--error');
        if (firstError) {
          firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
          firstError.focus();
        }
        return;
      }

      var submittedEmail = emailInput.value.trim();
      var ajaxUrl = form.getAttribute('data-ajax-url') || '/api/contacto';

      var payload = {
        nombre: form.querySelector('#name').value.trim(),
        correo: submittedEmail,
        asunto: form.querySelector('#subject').value,
        mensaje: form.querySelector('#message').value.trim()
      };
      var mascotaIdField = form.querySelector('#mascotaId');
      if (mascotaIdField && mascotaIdField.value) {
        payload.mascota_id = mascotaIdField.value;
      }

      var originalHTML = submitBtn.innerHTML;
      submitBtn.innerHTML = '<span class="material-symbols-outlined">sync</span> Enviando...';
      submitBtn.disabled = true;

      function restoreButton() {
        submitBtn.innerHTML = originalHTML;
        submitBtn.classList.remove('btn-submit--success');
        submitBtn.disabled = false;
      }

      function resetFormState() {
        form.reset();
        currentSuggestedEmail = null;
        removeSuggestion();
        fields.forEach(function (f) {
          f.classList.remove('form-input--success');
          f.classList.remove('form-input--error');
        });
      }

      var sesionHeader = (window.miauguauSesion && window.miauguauSesion.header()) || {};
      fetch(ajaxUrl, {
        method: 'POST',
        headers: Object.assign(
          { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          sesionHeader
        ),
        body: JSON.stringify(payload)
      })
        .then(function (res) {
          if (!res.ok) console.warn('[Miauguau] /api/contacto respondió HTTP ' + res.status);
          return res.json().catch(function () { return {}; });
        })
        .then(function (data) {
          if (!data || data.ok !== true) {
            var serverMsg = (data && data.error) ? String(data.error) : 'Error al enviar';
            throw new Error(serverMsg);
          }
          submitBtn.innerHTML = '<span class="material-symbols-outlined">check_circle</span> ¡Mensaje enviado!';
          submitBtn.classList.add('btn-submit--success');
          showSuccessNotice(submittedEmail, !!payload.mascota_id);

          setTimeout(function () {
            restoreButton();
            isSubmitting = false;
            resetFormState();
          }, 4500);
        })
        .catch(function (err) {
          restoreButton();
          isSubmitting = false;
          console.error('[Miauguau] No se pudo enviar el formulario:', err);
          if (window.miauguauToast) {
            window.miauguauToast('No se pudo enviar el mensaje: ' +
              ((err && err.message) ? err.message : 'revisá tu conexión'), 'error');
          }
        });
    }

    submitBtn.addEventListener('click', handleSubmit);
    form.addEventListener('submit', handleSubmit);

    /* ----------------------------------------------------------
       Aviso de éxito (reemplaza al antiguo aviso de FormSubmit)
       ---------------------------------------------------------- */
    function showSuccessNotice(submittedEmail, esAdopcion) {
      var existing = document.querySelector('.email-confirm-warning');
      if (existing) existing.remove();

      var warning = document.createElement('div');
      warning.className = 'email-confirm-warning';
      warning.setAttribute('role', 'status');

      var title = esAdopcion
        ? '¡Solicitud de adopción enviada!'
        : '¡Mensaje enviado!';
      var note = esAdopcion
        ? '<p class="email-confirm-warning__text">Recibimos tu solicitud de adopción. '
          + 'Te contactaremos a <strong>' + submittedEmail + '</strong> a la brevedad '
          + 'para continuar el proceso.</p>'
        : '<p class="email-confirm-warning__text">Gracias por escribirnos. Te '
          + 'responderemos a <strong>' + submittedEmail + '</strong> dentro de las '
          + 'próximas 48 horas.</p>';

      warning.innerHTML =
        '<div class="email-confirm-warning__icon"><span class="material-symbols-outlined">mark_email_unread</span></div>' +
        '<div class="email-confirm-warning__content">' +
          '<p class="email-confirm-warning__title">' + title + '</p>' +
          note +
        '</div>' +
        '<button type="button" class="email-confirm-warning__close" title="Cerrar"><span class="material-symbols-outlined">close</span></button>';

      var formCard = document.querySelector('.form-card');
      if (formCard) formCard.parentNode.insertBefore(warning, formCard.nextSibling);
      else form.parentNode.insertBefore(warning, form.nextSibling);

      warning.querySelector('.email-confirm-warning__close').addEventListener('click', function () {
        warning.style.opacity = '0';
        warning.style.transform = 'translateY(-10px)';
        setTimeout(function () { warning.remove(); }, 300);
      });

      setTimeout(function () {
        if (warning.parentNode) {
          warning.style.opacity = '0';
          warning.style.transform = 'translateY(-10px)';
          setTimeout(function () { warning.remove(); }, 300);
        }
      }, 15000);

      warning.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  setTimeout(function () {
    var form = document.getElementById('contactForm');
    if (form && !form._contactoInit) init();
  }, 200);

})();
