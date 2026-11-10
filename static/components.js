/* Progressive form controls. Native fields remain the submission/validation source. */
(() => {
  'use strict';
  if (window.PocketTrailComponents || !HTMLElement.prototype.showPopover) return;
  window.PocketTrailComponents = true;
  const controls = new WeakMap();
  let serial = 0;
  const make = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const button = (text, label) => {
    const el = make('button', 'pt-button', text);
    el.type = 'button';
    if (label) el.setAttribute('aria-label', label);
    return el;
  };
  function icon(kind) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', kind === 'calendar' ? 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z' : 'm7 10 5 5 5-5');
    svg.append(path);
    return svg;
  }
  function enhance(source) {
    if (getComputedStyle(document.documentElement).getPropertyValue('--pt-components').trim() !== 'ready') return;
    if (controls.has(source) || source.multiple || (source.tagName === 'SELECT' && source.size > 1) || source.readOnly) return;
    // Cloned enhanced markup has no listeners/WeakMap entry. Rebuild, don't nest.
    const cloned = source.closest('.pt-control');
    if (cloned) { cloned.before(source); cloned.remove(); }
    const date = source.type === 'date';
    const wrap = make('span', 'pt-control');
    const trigger = button('', date ? 'Choose date' : undefined);
    trigger.classList.add('pt-trigger');
    const value = make('span', 'pt-value');
    trigger.append(value, icon(date ? 'calendar' : 'chevron'));
    const popup = make('div', `pt-popover ${date ? 'pt-calendar' : 'pt-options'}`);
    popup.id = `pt-popup-${++serial}`;
    popup.popover = 'auto';
    popup.setAttribute('role', date ? 'dialog' : 'listbox');
    trigger.setAttribute('aria-haspopup', date ? 'dialog' : 'listbox');
    trigger.setAttribute('aria-controls', popup.id);
    trigger.setAttribute('aria-expanded', 'false');
    if (!source.id) source.id = `pt-field-${serial}`;
    const labelIds = Array.from(source.labels || [], label => {
      if (!label.id) label.id = `pt-label-${++serial}`;
      return label.id;
    });
    const name = source.getAttribute('aria-label');
    if (labelIds.length) {
      trigger.setAttribute('aria-labelledby', labelIds.join(' ') + (date ? '' : ` ${popup.id}-value`));
      popup.setAttribute('aria-labelledby', labelIds.join(' '));
    } else {
      trigger.setAttribute('aria-label', name || (date ? 'Date' : 'Choose option'));
      popup.setAttribute('aria-label', name || (date ? 'Choose date' : 'Options'));
    }
    value.id = `${popup.id}-value`;
    if (source.hasAttribute('aria-describedby')) trigger.setAttribute('aria-describedby', source.getAttribute('aria-describedby'));
    source.before(wrap);
    wrap.append(source, trigger, popup);
    source.classList.add('pt-native');
    source.tabIndex = -1;
    source.setAttribute('aria-hidden', 'true');
    const state = { source, wrap, trigger, popup, value, sync: null };
    controls.set(source, state);
    const position = () => {
      const rect = trigger.getBoundingClientRect();
      popup.style.width = `${date ? Math.min(336, innerWidth - 24) : Math.min(Math.max(rect.width, 180), innerWidth - 24)}px`;
      popup.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - popup.offsetWidth - 12))}px`;
      // Measure unconstrained content each opening; use larger side if neither fits.
      popup.style.maxHeight = `${innerHeight - 24}px`;
      const below = Math.max(0, innerHeight - 12 - rect.bottom - 6);
      const above = Math.max(0, rect.top - 18);
      const down = popup.offsetHeight <= below || below >= above;
      popup.style.maxHeight = `${Math.max(1, down ? below : above)}px`;
      popup.style.top = `${down ? rect.bottom + 6 : rect.top - popup.offsetHeight - 6}px`;
    };
    const close = (focus = true) => {
      if (popup.matches(':popover-open')) popup.hidePopover();
      trigger.setAttribute('aria-expanded', 'false');
      if (focus) trigger.focus();
    };
    state.close = close;
    state.open = () => {
      if (source.matches(':disabled')) return;
      state.sync();
      popup.dataset.settling = 'true';
      popup.showPopover();
      trigger.setAttribute('aria-expanded', 'true');
      position();
      state.focus();
      requestAnimationFrame(() => requestAnimationFrame(() => { delete popup.dataset.settling; }));
    };
    trigger.addEventListener('click', () => popup.matches(':popover-open') ? close() : state.open());
    popup.addEventListener('toggle', () => {
      trigger.setAttribute('aria-expanded', String(popup.matches(':popover-open')));
    });
    popup.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Enter' && event.target.matches('.pt-month-number,.pt-year-number')) event.preventDefault();
    });
    wrap.addEventListener('focusout', () => setTimeout(() => {
      if (!wrap.contains(document.activeElement)) close(false);
    }));
    // Hidden sources cannot receive label focus; keep original label association.
    Array.from(source.labels || []).forEach(label => label.addEventListener('click', event => {
      if (event.target.closest('button,a,input,select,textarea')) return;
      event.preventDefault();
      if (!trigger.disabled) trigger.focus();
    }));
    const validation = make('span', 'pt-validation');
    validation.id = `${popup.id}-validation`;
    validation.setAttribute('role', 'alert');
    wrap.append(validation);
    trigger.setAttribute('aria-describedby', [trigger.getAttribute('aria-describedby'), validation.id].filter(Boolean).join(' '));
    source.addEventListener('invalid', event => {
      event.preventDefault();
      validation.textContent = source.validationMessage;
      trigger.setAttribute('aria-invalid', 'true');
    });
    // app.js decides which invalid control gets focus (first in DOM order,
    // native or enhanced); it asks us to surface this one.
    source.addEventListener('pt:surface-invalid', () => {
      trigger.scrollIntoView({ block: 'center' });
      trigger.focus({ preventScroll: true });
    });
    state.commit = newValue => {
      source.value = newValue;
      source.dispatchEvent(new Event('input', { bubbles: true }));
      source.dispatchEvent(new Event('change', { bubbles: true }));
      trigger.removeAttribute('aria-invalid');
      validation.textContent = '';
      state.sync();
    };
    if (date) calendar(state); else select(state);
    const sync = state.sync;
    state.sync = () => {
      trigger.disabled = source.matches(':disabled') || source.readOnly;
      trigger.setAttribute('aria-required', String(source.required));
      sync();
    };
    source.addEventListener('change', state.sync);
    source.form?.addEventListener('reset', () => setTimeout(state.sync));
    new MutationObserver(state.sync).observe(source, { attributes: true, childList: true, subtree: true, characterData: true });
    state.sync();
  }
  function select(state) {
    const { source, trigger, popup, value } = state;
    let active = 0, typed = '', timer;
    const options = () => Array.from(popup.children).filter(el => el.getAttribute('role') === 'option');
    const focus = index => {
      const items = options();
      if (!items.length) return;
      active = Math.max(0, Math.min(items.length - 1, index));
      items.forEach((el, i) => { el.tabIndex = i === active ? 0 : -1; });
      // Fixed-position popup: focusing must never scroll the document, or the
      // scroll listener below would close the menu it just opened.
      items[active].focus({ preventScroll: true });
      items[active].scrollIntoView?.({ block: 'nearest' });
    };
    state.sync = () => {
      value.textContent = source.selectedOptions[0]?.textContent || 'Choose option';
      popup.replaceChildren();
      let group = null;
      Array.from(source.options).forEach((option, index) => {
        if (option.hidden) return;
        if (option.parentElement.tagName === 'OPTGROUP' && group !== option.parentElement) {
          group = option.parentElement;
          popup.append(make('div', 'pt-option-group', group.label));
        }
        const item = make('div', 'pt-option', option.textContent);
        const disabled = option.disabled || option.parentElement.disabled;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(option.selected));
        item.setAttribute('aria-disabled', String(Boolean(disabled)));
        item.tabIndex = -1;
        item.dataset.index = index;
        item.addEventListener('click', () => {
          if (disabled) return;
          source.selectedIndex = index;
          state.commit(option.value);
          state.close();
        });
        popup.append(item);
      });
    };
    const enabled = () => options().filter(el => el.getAttribute('aria-disabled') !== 'true');
    const move = key => {
      const all = options(), valid = enabled();
      const current = valid.indexOf(document.activeElement);
      const target = key === 'Home' ? valid[0] : key === 'End' ? valid.at(-1) : valid[Math.max(0, Math.min(valid.length - 1, current + (key === 'ArrowUp' ? -1 : 1)))];
      if (target) focus(all.indexOf(target));
    };
    state.focus = () => {
      const items = options();
      focus(Math.max(0, items.indexOf(items.find(el => el.getAttribute('aria-selected') === 'true' && el.getAttribute('aria-disabled') !== 'true') || enabled()[0])));
    };
    trigger.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || (event.key.length === 1 && event.key !== ' ')) {
        event.preventDefault(); state.open();
        if (event.key === 'Home' || event.key === 'End') move(event.key);
        else if (event.key.length === 1) type(event.key);
      }
    });
    function type(key) {
      clearTimeout(timer); typed += key.toLocaleLowerCase();
      timer = setTimeout(() => { typed = ''; }, 650);
      const items = enabled();
      const query = Array.from(typed).every(c => c === typed[0]) ? typed[0] : typed;
      const from = items.indexOf(document.activeElement);
      const ordered = items.slice(from + 1).concat(items.slice(0, from + 1));
      const match = ordered.find(el => el.textContent.trim().toLocaleLowerCase().startsWith(query));
      if (match) focus(options().indexOf(match));
    }
    popup.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); move(event.key); }
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); document.activeElement.click(); }
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); type(event.key); }
    });
  }
  const iso = date => `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  const parse = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00Z`);
    return !isNaN(date) && iso(date) === value ? date : null;
  };
  const day = 86400000;
  function calendar(state) {
    const { source, popup, value } = state;
    let cursor;
    const today = () => { const now = new Date(); return parse(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`); };
    const allowed = date => {
      const text = iso(date);
      const step = source.step === 'any' ? 1 : Number(source.step || 1);
      const base = parse(source.min) || parse(source.getAttribute('value') || '') || parse('1970-01-01');
      return date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999 && (!source.min || text >= source.min) && (!source.max || text <= source.max) && (!step || Math.abs(((date - base) / day) / step - Math.round(((date - base) / day) / step)) < 1e-8);
    };
    const header = make('div', 'pt-calendar-nav');
    const prev = button('Previous', 'Previous month'), next = button('Next', 'Next month');
    prev.classList.add('pt-month-step'); next.classList.add('pt-month-step');
    const month = make('input', 'pt-month-number'); month.type = 'number'; month.min = '1'; month.max = '12'; month.setAttribute('aria-label', 'Month');
    const year = make('input', 'pt-year-number'); year.type = 'number'; year.min = '1'; year.max = '9999'; year.setAttribute('aria-label', 'Year');
    header.append(prev, month, year, next);
    const heading = make('div', 'pt-calendar-heading'); heading.setAttribute('aria-live', 'polite');
    const grid = make('div', 'pt-date-grid'); grid.setAttribute('role', 'grid');
    const hint = make('p', 'pt-date-hint', 'Type YYYY-MM-DD, or choose a day. Month: 1–12.');
    const manualLabel = make('label', 'pt-date-label', 'Date (YYYY-MM-DD)');
    const manual = make('input', 'pt-date-manual'); manual.type = 'text'; manual.placeholder = 'YYYY-MM-DD'; manual.autocomplete = 'off'; manual.id = `${popup.id}-iso`; manualLabel.htmlFor = manual.id;
    const error = make('p', 'pt-date-error'); error.id = `${popup.id}-error`; error.setAttribute('aria-live', 'polite'); manual.setAttribute('aria-describedby', error.id);
    const actions = make('div', 'pt-date-actions');
    const use = button('Use date'), clear = button('Clear'), current = button('Today');
    actions.append(current, clear, use);
    popup.append(header, heading, grid, hint, manualLabel, manual, error, actions);
    const render = () => {
      month.value = cursor.getUTCMonth() + 1; year.value = cursor.getUTCFullYear();
      heading.textContent = cursor.toLocaleDateString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      grid.setAttribute('aria-label', heading.textContent);
      grid.replaceChildren();
      const names = make('div', 'pt-date-week'); names.setAttribute('role', 'row');
      ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].forEach(text => { const cell = make('span', '', text); cell.setAttribute('role', 'columnheader'); names.append(cell); });
      grid.append(names);
      const first = new Date(cursor); first.setUTCDate(1);
      const start = new Date(first.getTime() - first.getUTCDay() * day);
      for (let week = 0; week < 6; week++) {
        const row = make('div', 'pt-date-week'); row.setAttribute('role', 'row');
        for (let weekday = 0; weekday < 7; weekday++) {
          const date = new Date(start.getTime() + (week * 7 + weekday) * day), text = iso(date);
          const cell = button(date.getUTCDate()); cell.className = 'pt-day'; cell.setAttribute('role', 'gridcell');
          cell.setAttribute('aria-label', date.toLocaleDateString('en', { dateStyle: 'full', timeZone: 'UTC' }));
          cell.setAttribute('aria-selected', String(text === source.value));
          if (text === iso(today())) cell.setAttribute('aria-current', 'date');
          cell.classList.toggle('pt-day-outside', date.getUTCMonth() !== cursor.getUTCMonth());
          cell.setAttribute('aria-disabled', String(!allowed(date)));
          cell.tabIndex = text === iso(cursor) ? 0 : -1;
          cell.dataset.date = text;
          cell.addEventListener('click', () => { if (allowed(date)) { state.commit(text); state.close(); } });
          row.append(cell);
        }
        grid.append(row);
      }
    };
    const focusDay = () => { const day = grid.querySelector('[tabindex="0"]'); if (!day) return; day.focus({ preventScroll: true }); day.scrollIntoView?.({ block: 'nearest' }); };
    const navigate = amount => {
      const date = new Date(cursor); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + amount);
      if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return;
      cursor = date; render();
    };
    prev.addEventListener('click', () => navigate(-1)); next.addEventListener('click', () => navigate(1));
    [month, year].forEach(input => input.addEventListener('change', () => {
      if (!month.checkValidity() || !year.checkValidity() || !month.value || !year.value) return;
      cursor = parse(`${year.value.padStart(4, '0')}-${month.value.padStart(2, '0')}-01`); render();
    }));
    grid.addEventListener('keydown', event => {
      if (!event.target.dataset.date) return;
      const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -cursor.getUTCDay(), End: 6 - cursor.getUTCDay() };
      if (Object.hasOwn(offsets, event.key)) { event.preventDefault(); const nextDate = new Date(cursor.getTime() + offsets[event.key] * day); if (nextDate.getUTCFullYear() < 1 || nextDate.getUTCFullYear() > 9999) return; cursor = nextDate; render(); focusDay(); }
      if (event.key === 'PageUp' || event.key === 'PageDown') { event.preventDefault(); navigate((event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1)); focusDay(); }
    });
    const apply = () => {
      const date = parse(manual.value.trim());
      if ((!manual.value.trim() && !source.required) || (date && allowed(date))) { state.commit(date ? iso(date) : ''); state.close(); }
      else { error.textContent = 'Enter a valid YYYY-MM-DD date within the allowed range and step.'; manual.setAttribute('aria-invalid', 'true'); manual.focus(); }
    };
    use.addEventListener('click', apply);
    manual.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); apply(); } });
    clear.addEventListener('click', () => { state.commit(''); state.close(); });
    current.addEventListener('click', () => { cursor = today(); render(); focusDay(); });
    state.sync = () => {
      value.textContent = source.value ? parse(source.value).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'Pick a date';
      cursor = parse(source.value) || parse(source.min) || today();
      manual.value = source.value; error.textContent = ''; manual.removeAttribute('aria-invalid'); render();
    };
    state.focus = focusDay;
  }
  function initialize(root = document) {
    if (root.matches?.('select,input[type="date"]')) enhance(root);
    root.querySelectorAll?.('select,input[type="date"]').forEach(enhance);
  }
  document.addEventListener('load', event => {
    if (event.target.matches?.('link[rel="stylesheet"]')) initialize();
  }, true);
  document.addEventListener('DOMContentLoaded', () => initialize());
  document.addEventListener('htmx:load', event => initialize(event.detail?.elt || event.target));
  new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
    if (node.nodeType === 1 && !node.closest('.pt-popover')) initialize(node);
  }))).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener('resize', () => document.querySelectorAll('.pt-popover:popover-open').forEach(el => el.hidePopover()));
  document.addEventListener('scroll', event => {
    if (event.target.closest?.('.pt-popover')) return;
    // A scroll the popup itself caused while opening (e.g. an invalid trigger
    // brought into view) must not dismiss it.
    document.querySelectorAll('.pt-popover:popover-open').forEach(el => {
      if (el.dataset.settling) return;
      el.hidePopover();
    });
  }, true);
  if (document.readyState !== 'loading') initialize();
})();
