/* PocketTrail UI enhancements. Progressive: every form works without JS.

   PDF extraction: pinned pdf.js 4.10.38 ESM build loaded via dynamic import,
   always with isEvalSupported:false (CVE-2024-4367 mitigation). Lines are
   reconstructed from text-item coordinates (see static/extraction.js) so
   statement parsers can rely on column whitespace. Only the extracted text
   and the chosen original file are submitted to PocketTrail itself. */
(function () {
  "use strict";
  // HTMX navigation can evaluate page scripts again. Delegated listeners
  // belong to the document and should only be registered once.
  if (window.PocketTrailUIReady) return;
  window.PocketTrailUIReady = true;

  // Keep native disclosure toggling and Tab order; Escape is only a dismissal.
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (document.querySelector("dialog[open]")) return;
    var drawer = document.querySelector(".navdrawer[open]");
    if (!drawer) return;
    drawer.open = false;
    drawer.querySelector("summary").focus();
    event.preventDefault();
  });

  // One overflow rule for every table, including HTMX-loaded and resized content.
  var tableCueId = 0;
  var observedTables = new WeakSet();
  function initializeTableCues() {
    document.querySelectorAll(".table-scroll").forEach(function (wrapper) {
      if (observedTables.has(wrapper)) return;
      observedTables.add(wrapper);
      var cue = document.createElement("p");
      cue.id = "table-scroll-cue-" + (++tableCueId);
      cue.className = "table-scroll-cue";
      cue.textContent = "Scroll horizontally to see all columns and actions.";
      cue.hidden = true;
      wrapper.before(cue);
      var description = wrapper.getAttribute("aria-describedby");
      var tabindex = wrapper.getAttribute("tabindex");
      function update() {
        var overflowing = wrapper.scrollWidth > wrapper.clientWidth + 1;
        cue.hidden = !overflowing;
        if (overflowing) {
          wrapper.setAttribute("tabindex", "0");
          wrapper.setAttribute("aria-describedby", [description, cue.id].filter(Boolean).join(" "));
        } else {
          if (tabindex === null) wrapper.removeAttribute("tabindex");
          else wrapper.setAttribute("tabindex", tabindex);
          if (description === null) wrapper.removeAttribute("aria-describedby");
          else wrapper.setAttribute("aria-describedby", description);
        }
      }
      var observer = new ResizeObserver(function () {
        if (!wrapper.isConnected) {
          observer.disconnect();
          return;
        }
        update();
      });
      observer.observe(wrapper);
      var table = wrapper.querySelector("table");
      if (table) observer.observe(table);
      update();
    });
  }
  document.addEventListener("DOMContentLoaded", initializeTableCues);
  document.addEventListener("htmx:load", initializeTableCues);
  if (document.readyState !== "loading") initializeTableCues();

  /* Keep the server's sections/anchors usable until native dialog enhancement
     succeeds. Moving, not copying, preserves form values, IDs and HTMX context. */
  var dialogStates = new WeakMap();
  function formState(dialog) {
    return JSON.stringify(Array.from(dialog.querySelectorAll("input[name],select[name],textarea[name]")).map(function (field) {
      if (/^(submit|button|reset|image)$/.test(field.type)) return null;
      return [field.name, field.type, field.value, field.checked,
        field.options ? Array.from(field.options).map(function (option) { return option.selected; }) : null,
        field.files ? Array.from(field.files).map(function (file) { return [file.name, file.size, file.lastModified]; }) : null];
    }));
  }
  function requestDialogClose(dialog) {
    var state = dialogStates.get(dialog);
    if (state.baseline !== formState(dialog) &&
        !window.confirm("Close without saving? Your unsaved entries will remain here until you leave this page.")) return false;
    dialog.close();
    return true;
  }
  function openDialog(dialog, trigger) {
    if (dialog.open) return;
    // Only one editor at a time; never silently dismiss another dirty form.
    var current = document.querySelector(".pt-dialog[open]");
    if (current && !requestDialogClose(current)) return;
    var state = dialogStates.get(dialog);
    state.trigger = trigger || document.activeElement;
    if (state.baseline === null) state.baseline = formState(dialog);
    dialog.showModal();
    document.documentElement.classList.add("pt-dialog-open");
    dialog.querySelector(".pt-dialog__title").focus();
  }
  function initializeDialogs() {
    if (!window.HTMLDialogElement || !HTMLDialogElement.prototype.showModal) return;
    document.querySelectorAll("section[data-dialog-panel][id]").forEach(function (section) {
      if (section.closest("dialog")) return;
      var heading = document.getElementById(section.getAttribute("aria-labelledby"));
      if (!heading || !section.contains(heading)) return;
      var dialog = document.createElement("dialog");
      dialog.className = "pt-dialog";
      dialog.id = section.id + "-dialog";
      var header = document.createElement("header");
      header.className = "pt-dialog__header";
      var title = document.createElement("h2");
      title.className = "pt-dialog__title";
      title.id = dialog.id + "-title";
      title.tabIndex = -1;
      title.textContent = heading.textContent;
      dialog.setAttribute("aria-labelledby", title.id);
      var close = document.createElement("button");
      close.type = "button";
      close.className = "btn pt-dialog__close";
      close.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg><span>Close</span>';
      header.append(title, close);
      var body = document.createElement("div");
      body.className = "pt-dialog__body";
      section.before(dialog);
      dialog.append(header, body);
      body.append(section);
      heading.classList.add("pt-dialog__source-title");
      dialogStates.set(dialog, { baseline: null, trigger: null });
      close.addEventListener("click", function () { requestDialogClose(dialog); });
      dialog.addEventListener("keydown", function (event) {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        // Claim child Escape before component handlers hide it or native close
        // watchers dismiss a shared popover/dialog group. The next Escape is
        // still the parent's native cancel, including its dirty-close guard.
        var popup = Array.from(dialog.querySelectorAll("[popover]")).reverse().find(function (element) {
          return typeof element.hidePopover === "function" && element.matches(":popover-open");
        });
        if (!popup) return;
        event.preventDefault();
        event.stopPropagation();
        popup.hidePopover();
        var control = popup.closest(".pt-control");
        var trigger = control && control.querySelector(".pt-trigger");
        if (trigger) trigger.focus();
      }, true);
      dialog.addEventListener("cancel", function (event) {
        event.preventDefault();
        requestDialogClose(dialog);
      });
      // A drag out of the content must not count as a backdrop click.
      var backdropDown = false;
      function outside(event) {
        var rect = dialog.getBoundingClientRect();
        return event.target === dialog &&
          (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
      }
      dialog.addEventListener("pointerdown", function (event) { backdropDown = outside(event); });
      dialog.addEventListener("click", function (event) {
        if (backdropDown && outside(event)) requestDialogClose(dialog);
        backdropDown = false;
      });
      dialog.addEventListener("close", function () {
        if (!document.querySelector(".pt-dialog[open]")) document.documentElement.classList.remove("pt-dialog-open");
        var trigger = dialogStates.get(dialog).trigger;
        if (trigger && trigger.isConnected && !document.querySelector(".pt-dialog[open]")) trigger.focus();
      });
    });
    document.querySelectorAll("[data-dialog-open]").forEach(function (trigger) {
      var section = document.getElementById(trigger.dataset.dialogOpen);
      var dialog = section && section.closest(".pt-dialog");
      if (!dialog) return;
      trigger.setAttribute("aria-haspopup", "dialog");
      trigger.setAttribute("aria-controls", dialog.id);
    });
  }
  document.addEventListener("click", function (event) {
    var trigger = event.target.closest("[data-dialog-open]");
    if (!trigger || event.defaultPrevented || event.button !== 0 ||
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var section = document.getElementById(trigger.dataset.dialogOpen);
    var dialog = section && section.closest(".pt-dialog");
    if (!dialog) return;
    event.preventDefault();
    openDialog(dialog, trigger);
  });
  function openHashDialog() {
    var id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (_) { return; }
    var section = document.getElementById(id);
    var dialog = section && section.closest(".pt-dialog");
    if (dialog) openDialog(dialog);
  }
  document.addEventListener("DOMContentLoaded", function () { initializeDialogs(); openHashDialog(); });
  document.addEventListener("htmx:load", initializeDialogs);
  document.addEventListener("htmx:afterSettle", openHashDialog);
  window.addEventListener("hashchange", openHashDialog);
  if (document.readyState !== "loading") { initializeDialogs(); openHashDialog(); }

  document.addEventListener("htmx:beforeSwap", function (event) {
    var detail = event.detail;
    // Never replace an editor with an error document, even if HTMX's response
    // handling is configured to swap 4xx responses.
    if (detail.xhr && detail.xhr.status >= 400) {
      detail.shouldSwap = false;
      detail.isError = true;
      return;
    }
    if (!detail.shouldSwap || !detail.target) return;
    document.querySelectorAll(".pt-dialog[open]").forEach(function (dialog) {
      if (detail.target === dialog || detail.target.contains(dialog)) {
        // A successful server navigation replaces the editor, not a close request.
        dialogStates.get(dialog).trigger = null;
        dialog.close();
        document.documentElement.classList.remove("pt-dialog-open");
      }
    });
  });

  document.addEventListener("htmx:responseError", function (event) {
    var source = event.detail.elt || event.target;
    var dialog = source.closest && source.closest(".pt-dialog[open]");
    var main = dialog ? dialog.querySelector(".pt-dialog__body") : document.getElementById("main");
    if (!main) return;
    var alert = main.querySelector("[data-request-error]");
    if (!alert) {
      alert = document.createElement("p");
      alert.id = dialog ? dialog.id + "-request-error" : "request-error";
      alert.dataset.requestError = "";
      alert.className = "flash flash--error";
      alert.setAttribute("role", "alert");
      alert.tabIndex = -1;
      main.prepend(alert);
    }
    var response = new DOMParser().parseFromString(event.detail.xhr.responseText, "text/html");
    var message = response.querySelector("p");
    alert.textContent = (message ? message.textContent : "Request failed.") + " Your entries are unchanged. Correct the problem and try again.";
    alert.focus();
  });

  document.addEventListener("htmx:beforeRequest", function (event) {
    var form = event.detail.elt.closest("form");
    if (!form) return;
    form.setAttribute("aria-busy", "true");
    form.querySelectorAll('button[type="submit"]').forEach(function (button) {
      button.dataset.pendingLabel = button.textContent;
      button.dataset.pendingDisabled = String(button.disabled);
      button.disabled = true;
      button.textContent = "Working…";
    });
  });
  document.addEventListener("htmx:afterRequest", function (event) {
    var form = event.detail.elt.closest("form");
    if (!form) return;
    form.removeAttribute("aria-busy");
    form.querySelectorAll("button[data-pending-label]").forEach(function (button) {
      button.textContent = button.dataset.pendingLabel;
      button.disabled = button.dataset.pendingDisabled === "true";
      delete button.dataset.pendingLabel;
      delete button.dataset.pendingDisabled;
    });
  });

  var pdfjsPromise = null;
  function loadPdfjs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import("/static/vendor/pdf.min.mjs").then(function (lib) {
        lib.GlobalWorkerOptions.workerSrc = "/static/vendor/pdf.worker.min.mjs";
        return lib;
      });
    }
    return pdfjsPromise;
  }

  function loadDocument(lib, buf) {
    function attempt(password) {
      return lib.getDocument({ data: buf, password: password, isEvalSupported: false }).promise;
    }
    return attempt(undefined).catch(function (err) {
      if (err && err.name === "PasswordException") {
        var pw = window.prompt("This statement PDF is password-protected. Enter its password:");
        if (pw === null) throw err;
        return attempt(pw);
      }
      throw err;
    });
  }

  function extractPdf(lib, file) {
    return file.arrayBuffer().then(function (buf) {
      return loadDocument(lib, buf).then(function (pdf) {
        var pages = [];
        var i = 1;
        function step() {
          if (i > pdf.numPages) return;
          return pdf.getPage(i).then(function (page) {
            return page.getTextContent().then(function (tc) {
              pages.push(window.PocketTrailExtraction.itemsToText(tc.items));
              i += 1;
              return step();
            });
          });
        }
        return step().then(function () {
          return { text: pages.join("\n"), numPages: pdf.numPages };
        });
      });
    });
  }

  document.addEventListener("change", function (e) {
    var input = e.target.closest("[data-pdf-input]");
    if (!input) return;
    var target = document.querySelector(input.getAttribute("data-pdf-target"));
    var status = document.querySelector(input.getAttribute("data-pdf-status"));
    if (!target || !status) return;
    var files = Array.prototype.slice.call(input.files || []);
    if (!files.length) return;
    var version = (input.pockettrailVersion || 0) + 1;
    input.pockettrailVersion = version;
    target.value = "";
    var submit = input.form && input.form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    loadPdfjs().then(function (lib) {
      // Replace previous extraction; the text and retained original must match.
      var parts = [];
      var next = files.reduce(function (p, file) { return p.then(function () {
        status.textContent = "Extracting " + file.name + "\u2026";
        return extractPdf(lib, file).then(function (res) {
          parts.push(res.text);
          if (input.pockettrailVersion === version) {
            status.textContent = "Extracted " + file.name +
              " (" + res.numPages + " page" + (res.numPages === 1 ? "" : "s") + ") with preserved rows.";
          }
        });
      }); }, Promise.resolve());
      return next.then(function () {
        if (input.pockettrailVersion === version) target.value = parts.join("\n");
      });
    }).catch(function (err) {
      if (input.pockettrailVersion !== version) return;
      status.textContent = "Could not read file" +
        (err && err.message ? ": " + err.message : "") +
        " \u2014 try pasting the statement text manually.";
    }).finally(function () {
      if (input.pockettrailVersion === version && submit) submit.disabled = false;
    });
  });

  /* Purpose allocation rows: clone a <template>, keep at least one row. */
  document.addEventListener("click", function (e) {
    var add = e.target.closest("[data-add-row]");
    if (add) {
      var tpl = document.querySelector(add.getAttribute("data-add-row"));
      var list = document.querySelector(add.getAttribute("data-row-list"));
      if (tpl && list) list.appendChild(tpl.content.cloneNode(true));
      return;
    }
    var remove = e.target.closest("[data-remove-row]");
    if (remove) {
      var row = remove.closest("[data-row]");
      var container = row && row.parentElement;
      if (row && container && container.querySelectorAll("[data-row]").length > 1) {
        row.remove();
        updateAllocTotal(container);
      }
    }
  });

  /* Currency inputs are IDR; integer minor units remain an internal detail. */
  document.addEventListener("input", function (e) {
    var list = e.target.closest("[data-row-list]");
    if (list && e.target.matches("[data-amount-input]")) updateAllocTotal(list);
  });

  function formatMinor(minor) {
    var rupiah = minor / 100;
    var opts = Number.isInteger(rupiah) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    return "Rp " + rupiah.toLocaleString("id-ID", opts);
  }

  function updateAllocTotal(list) {
    var out = document.querySelector(list.getAttribute("data-alloc-total"));
    if (!out) return;
    var sum = 0;
    list.querySelectorAll("[data-amount-input]").forEach(function (el) {
      var match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(el.value.trim());
      if (match) {
        sum += Number(match[1]) * 100 + Number(((match[2] || "") + "00").slice(0, 2));
      }
    });
    var cap = parseInt(list.getAttribute("data-total-minor"), 10);
    var text = "Allocated " + formatMinor(sum) + " of " + formatMinor(cap);
    var over = !isNaN(cap) && sum > cap;
    var balanced = !isNaN(cap) && sum === cap;
    out.textContent = over ? "Over-allocated \u2014 " + text : text;
    out.classList.toggle("alloc-total__over", over);
    out.classList.toggle("alloc-total__balanced", balanced);
  }

  function initializeTotals() {
    document.querySelectorAll("[data-total-minor]").forEach(updateAllocTotal);
  }
  document.addEventListener("DOMContentLoaded", initializeTotals);
  document.addEventListener("htmx:load", initializeTotals);
  if (document.readyState !== "loading") initializeTotals();

  /* Mention chips insert @Name at the cursor of the linked textarea. */
  document.addEventListener("click", function (e) {
    var chip = e.target.closest("[data-mention]");
    if (!chip) return;
    var target = document.querySelector(chip.getAttribute("data-mention-target"));
    if (!target) return;
    var text = chip.getAttribute("data-mention") + " ";
    var at = target.selectionStart || target.value.length;
    target.value = target.value.slice(0, at) + text + target.value.slice(target.selectionEnd || at);
    target.focus();
    var caret = at + text.length;
    target.setSelectionRange(caret, caret);
  });
})();
