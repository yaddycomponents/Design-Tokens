/* ═══════════════════════════════════════════════════════════════
   Design System — Team Comments
   Self-contained, no dependencies, no frameworks.
   Reads window.DS_COMMENTS_API (Google Apps Script URL).
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Config ─────────────────────────────────────────────────── */
  const SB_URL = () => (window.DS_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const SB_KEY = () => (window.DS_SUPABASE_KEY || '').trim();
  const hasBackend = () => SB_URL() && SB_KEY();
  const POLL_MS = 10000;
  const LS_AUTHOR_KEY = 'ds_comments_author';

  /* ── State ───────────────────────────────────────────────────── */
  let currentPage = 'Home';
  let comments = [];          // all comments for current page
  let panelOpen = false;
  let addMode = false;
  let pollTimer = null;
  let pendingPin = null;      // { x, y, x2, y2 } while form is open
  let formEl = null;
  let selectedPinId = null;
  let dragStart = null;       // { clientX, clientY } for area selection
  let selectionEl = null;     // temp selection rect DOM element

  /* ══════════════════════════════════════════════════════════════
     CSS
     ══════════════════════════════════════════════════════════════ */
  const CSS = `
/* ── FAB ── */
#cs-fab {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #7F56D9;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  box-shadow: 0 4px 16px rgba(127,86,217,.4), 0 1px 3px rgba(16,24,40,.1);
  transition: background .15s, transform .15s, box-shadow .15s;
  outline: none;
}
#cs-fab:hover { background: #6941C6; transform: scale(1.06); box-shadow: 0 8px 24px rgba(127,86,217,.5); }
#cs-fab.active { background: #53389E; }
#cs-fab svg { width: 20px; height: 20px; fill: #fff; pointer-events: none; }

/* FAB badge */
#cs-fab-badge {
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 16px;
  height: 16px;
  border-radius: 8px;
  background: #D92D20;
  color: #fff;
  font-family: 'Inter', sans-serif;
  font-size: 9px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
  border: 2px solid #fff;
  pointer-events: none;
  display: none;
}

/* ── Panel ── */
#cs-panel {
  position: fixed;
  right: 0;
  top: 0;
  height: 100%;
  width: 320px;
  background: #FFFFFF;
  border-left: 1px solid #EAECF0;
  z-index: 999;
  transform: translateX(100%);
  transition: transform .2s ease;
  display: flex;
  flex-direction: column;
  font-family: 'Inter', sans-serif;
  box-shadow: -4px 0 24px rgba(16,24,40,.08);
}
#cs-panel.open { transform: translateX(0); }

/* Panel header */
#cs-panel-head {
  padding: 16px 16px 12px;
  border-bottom: 1px solid #EAECF0;
  flex-shrink: 0;
}
.cs-panel-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cs-panel-title {
  font-size: 13px;
  font-weight: 600;
  color: #101828;
  flex: 1;
}
.cs-panel-pagename {
  font-size: 11px;
  color: #667085;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
  margin-bottom: 10px;
  font-family: 'IBM Plex Mono', monospace;
}
.cs-head-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
#cs-add-btn {
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 500;
  color: #6941C6;
  background: #F9F5FF;
  border: 1px solid #E9D7FE;
  border-radius: 6px;
  padding: 5px 12px;
  cursor: pointer;
  transition: all .12s;
}
#cs-add-btn:hover { background: #F4EBFF; border-color: #D6BBFB; }
#cs-add-btn.active { background: #7F56D9; border-color: #7F56D9; color: #fff; }
#cs-close-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  color: #98A2B3;
  font-size: 16px;
  line-height: 1;
  padding: 4px 6px;
  border-radius: 6px;
  transition: all .12s;
}
#cs-close-btn:hover { color: #344054; background: #F9FAFB; }

/* Panel body (scrollable list) */
#cs-panel-body {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #EAECF0 transparent;
}
#cs-panel-body::-webkit-scrollbar { width: 4px; }
#cs-panel-body::-webkit-scrollbar-thumb { background: #D0D5DD; border-radius: 4px; }

/* Empty state */
.cs-empty {
  padding: 40px 20px;
  text-align: center;
  font-size: 13px;
  color: #98A2B3;
  line-height: 1.7;
}

/* Comment item */
.cs-item {
  display: flex;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid #F2F4F7;
  transition: background .12s;
  cursor: pointer;
}
.cs-item:hover { background: #F9FAFB; }
.cs-item.cs-resolved { opacity: .55; }
.cs-item.cs-selected { background: #F9F5FF; }

/* Pin circle in list */
.cs-item-pin {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #7F56D9;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
}

/* Item content */
.cs-item-body { flex: 1; min-width: 0; }
.cs-item-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
}
.cs-item-author {
  font-size: 12px;
  font-weight: 600;
  color: #344054;
}
.cs-item-time {
  font-size: 11px;
  color: #98A2B3;
  margin-left: auto;
}
.cs-item-text {
  font-size: 13px;
  color: #667085;
  margin-top: 2px;
  line-height: 1.5;
  word-break: break-word;
}
.cs-item-text.cs-resolved-text { text-decoration: line-through; }

/* Resolve / Delete buttons */
.cs-item-actions { display: flex; gap: 6px; margin-top: 6px; }
.cs-resolve-btn {
  background: transparent;
  border: 1px solid #ABEFC6;
  color: #067647;
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  font-weight: 500;
  border-radius: 6px;
  padding: 3px 10px;
  cursor: pointer;
  transition: all .12s;
}
.cs-resolve-btn:hover { background: #ECFDF3; border-color: #75E0A7; }
.cs-delete-btn {
  background: transparent;
  border: 1px solid #FECDCA;
  color: #B42318;
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  font-weight: 500;
  border-radius: 6px;
  padding: 3px 10px;
  cursor: pointer;
  transition: all .12s;
}
.cs-delete-btn:hover { background: #FEF3F2; border-color: #FDA29B; }

/* Resolved section header */
.cs-resolved-header {
  font-size: 11px;
  font-weight: 500;
  color: #98A2B3;
  text-transform: uppercase;
  letter-spacing: .06em;
  padding: 8px 16px;
  background: #F9FAFB;
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 6px;
  border-bottom: 1px solid #EAECF0;
}
.cs-resolved-header:hover { color: #667085; }

/* Panel footer */
#cs-panel-foot {
  flex-shrink: 0;
  padding: 10px 16px;
  border-top: 1px solid #EAECF0;
}
.cs-no-api-warn {
  font-size: 12px;
  color: #B54708;
  line-height: 1.6;
}

/* ── Overlay ── */
#cs-overlay {
  position: fixed;
  pointer-events: none;
  z-index: 998;
  background: transparent;
}
#cs-overlay.cs-add-mode {
  pointer-events: all;
  cursor: crosshair;
}

/* ── Add mode banner ── */
#cs-banner {
  position: fixed;
  left: 240px;
  right: 0;
  top: 64px;
  height: 36px;
  background: rgba(127,86,217,.9);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 500;
  color: #fff;
  letter-spacing: .01em;
  z-index: 1002;
  display: none;
  backdrop-filter: blur(8px);
  border-bottom: 1px solid rgba(127,86,217,.5);
  box-shadow: 0 1px 4px rgba(127,86,217,.3);
}

/* ── Pins ── */
.cs-pin {
  position: absolute;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #7F56D9;
  color: #fff;
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: 2px solid #F9FAFB;
  transform: translate(-50%, -50%);
  transition: transform .12s;
  pointer-events: all;
  z-index: 1;
}
.cs-pin:hover { transform: translate(-50%, -50%) scale(1.1); }
.cs-pin:focus { outline: none; }
.cs-pin.cs-pin-sel { border-color: #E9D7FE; transform: translate(-50%, -50%) scale(1.08); }
.cs-pin.cs-pin-sel:hover { transform: translate(-50%, -50%) scale(1.15); }
.cs-pin.cs-resolved-pin { opacity: .4; background: #98A2B3; }

/* ── Area selection (while dragging) ── */
.cs-sel-rect {
  position: absolute;
  border: 2px dashed #7F56D9;
  background: rgba(127,86,217,.06);
  border-radius: 4px;
  pointer-events: none;
  z-index: 2;
}

/* ── Area highlight (saved comment) ── */
.cs-highlight {
  position: absolute;
  border: 1.5px solid rgba(127,86,217,.45);
  background: transparent;
  border-radius: 4px;
  pointer-events: all;
  cursor: pointer;
  z-index: 0;
  transition: border-color .15s, background .15s;
}
.cs-highlight:hover {
  border-color: #7F56D9;
  background: rgba(127,86,217,.04);
}
.cs-highlight.cs-hl-sel {
  border-color: #7F56D9;
  background: rgba(127,86,217,.07);
}

/* ── Floating form ── */
#cs-form {
  position: fixed;
  z-index: 1001;
  background: #FFFFFF;
  border: 1px solid #EAECF0;
  border-radius: 12px;
  padding: 16px;
  width: 288px;
  box-shadow: 0 12px 40px rgba(16,24,40,.14), 0 4px 8px rgba(16,24,40,.06);
  display: none;
}
.cs-form-head {
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: #101828;
  margin-bottom: 12px;
}
.cs-form-field {
  width: 100%;
  background: #FFFFFF;
  border: 1px solid #D0D5DD;
  border-radius: 8px;
  color: #101828;
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  padding: 9px 12px;
  outline: none;
  box-sizing: border-box;
  transition: border-color .12s, box-shadow .12s;
  display: block;
}
.cs-form-field::placeholder { color: #98A2B3; }
.cs-form-field:focus { border-color: #7F56D9; box-shadow: 0 0 0 3px rgba(127,86,217,.12); }
.cs-form-field + .cs-form-field { margin-top: 8px; }
textarea.cs-form-field {
  min-height: 80px;
  resize: vertical;
  font-family: 'Inter', sans-serif;
}
.cs-form-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  justify-content: flex-end;
}
#cs-form-cancel {
  background: #FFFFFF;
  color: #344054;
  border: 1px solid #D0D5DD;
  border-radius: 8px;
  padding: 8px 14px;
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all .12s;
}
#cs-form-cancel:hover { border-color: #98A2B3; background: #F9FAFB; }
#cs-form-submit {
  background: #7F56D9;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 8px 16px;
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background .12s, box-shadow .12s;
  box-shadow: 0 1px 2px rgba(16,24,40,.05);
}
#cs-form-submit:hover { background: #6941C6; box-shadow: 0 4px 8px rgba(127,86,217,.3); }
`;

  /* ══════════════════════════════════════════════════════════════
     DOM bootstrap
     ══════════════════════════════════════════════════════════════ */
  function init() {
    // Inject styles
    const style = document.createElement('style');
    style.id = 'cs-styles';
    style.textContent = CSS;
    document.head.appendChild(style);

    // FAB
    const fab = document.createElement('button');
    fab.id = 'cs-fab';
    fab.title = 'Team Comments';
    fab.innerHTML = `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 2H4C2.9 2 2 2.9 2 4v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
      </svg>
      <span id="cs-fab-badge"></span>
    `;
    document.body.appendChild(fab);

    // Panel
    const panel = document.createElement('div');
    panel.id = 'cs-panel';
    panel.innerHTML = `
      <div id="cs-panel-head">
        <div class="cs-panel-pagename" id="cs-pagename"></div>
        <div class="cs-panel-title-row">
          <span class="cs-panel-title">Team Comments</span>
          <div class="cs-head-actions">
            <button id="cs-add-btn">+ Add</button>
            <button id="cs-close-btn" title="Close">✕</button>
          </div>
        </div>
      </div>
      <div id="cs-panel-body"></div>
      <div id="cs-panel-foot"></div>
    `;
    document.body.appendChild(panel);

    // Overlay
    const overlay = document.createElement('div');
    overlay.id = 'cs-overlay';
    document.body.appendChild(overlay);

    // Banner
    const banner = document.createElement('div');
    banner.id = 'cs-banner';
    banner.textContent = 'Drag to select an area, or click to drop a pin — Esc to cancel';
    document.body.appendChild(banner);

    // Floating form
    const form = document.createElement('div');
    form.id = 'cs-form';
    form.innerHTML = `
      <div class="cs-form-head">New Comment</div>
      <input id="cs-form-name" class="cs-form-field" type="text" placeholder="Your name" autocomplete="off">
      <textarea id="cs-form-text" class="cs-form-field" placeholder="Write a comment…"></textarea>
      <div class="cs-form-actions">
        <button id="cs-form-cancel">Cancel</button>
        <button id="cs-form-submit">Submit</button>
      </div>
    `;
    document.body.appendChild(form);
    formEl = form;

    // Wire events
    fab.addEventListener('click', togglePanel);
    document.getElementById('cs-close-btn').addEventListener('click', closePanel);
    document.getElementById('cs-add-btn').addEventListener('click', toggleAddMode);
    overlay.addEventListener('mousedown', onOverlayMousedown);
    overlay.addEventListener('mousemove', onOverlayMousemove);
    // Listen on document so a release outside the overlay is always caught
    document.addEventListener('mouseup',  onOverlayMouseup);
    document.getElementById('cs-form-cancel').addEventListener('click', cancelForm);
    document.getElementById('cs-form-submit').addEventListener('click', submitForm);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', positionOverlay);

    // Pre-fill name from localStorage
    const savedName = localStorage.getItem(LS_AUTHOR_KEY) || '';
    if (savedName) document.getElementById('cs-form-name').value = savedName;

    // Position overlay initially
    positionOverlay();

    // Re-render pins on iframe scroll so they track content position
    const frame = document.getElementById('contentFrame');
    if (frame) {
      frame.addEventListener('load', () => {
        try { frame.contentWindow.addEventListener('scroll', renderPins); } catch(e) {}
      });
    }

    // Wrap navigation functions
    wrapNavFunctions();

    // Initial page
    setPage('Home');
  }

  /* ══════════════════════════════════════════════════════════════
     Overlay positioning — matches .frame-area exactly
     ══════════════════════════════════════════════════════════════ */
  function positionOverlay() {
    const frameArea = document.getElementById('frameArea');
    const overlay = document.getElementById('cs-overlay');
    if (!frameArea || !overlay) return;
    const r = frameArea.getBoundingClientRect();
    overlay.style.left   = r.left + 'px';
    overlay.style.top    = r.top  + 'px';
    overlay.style.width  = r.width + 'px';
    overlay.style.height = r.height + 'px';
  }

  /* ══════════════════════════════════════════════════════════════
     Wrap loadPage / showHome
     ══════════════════════════════════════════════════════════════ */
  function wrapNavFunctions() {
    const origLoad = window.loadPage;
    window.loadPage = function (e, href, section, page) {
      if (origLoad) origLoad.apply(this, arguments);
      setPage(page || section || href || 'Page');
    };

    const origHome = window.showHome;
    window.showHome = function (e) {
      if (origHome) origHome.apply(this, arguments);
      setPage('Home');
    };
  }

  /* ══════════════════════════════════════════════════════════════
     Page change
     ══════════════════════════════════════════════════════════════ */
  function setPage(name) {
    currentPage = name || 'Home';
    comments = [];
    clearPins();
    cancelAddMode();
    cancelForm();
    renderList();
    updatePageName();
    fetchComments();
    startPolling();
  }

  function updatePageName() {
    const el = document.getElementById('cs-pagename');
    if (el) el.textContent = currentPage;
  }

  /* ══════════════════════════════════════════════════════════════
     Panel open / close
     ══════════════════════════════════════════════════════════════ */
  function togglePanel() {
    panelOpen ? closePanel() : openPanel();
  }

  function openPanel() {
    panelOpen = true;
    document.getElementById('cs-panel').classList.add('open');
    document.getElementById('cs-fab').classList.add('active');
    updatePageName();
    fetchComments();
    startPolling();
  }

  function closePanel() {
    panelOpen = false;
    document.getElementById('cs-panel').classList.remove('open');
    document.getElementById('cs-fab').classList.remove('active');
    cancelAddMode();
    cancelForm();
    stopPolling();
  }

  /* ══════════════════════════════════════════════════════════════
     Add mode
     ══════════════════════════════════════════════════════════════ */
  function toggleAddMode() {
    addMode ? cancelAddMode() : enterAddMode();
  }

  function enterAddMode() {
    addMode = true;
    document.getElementById('cs-overlay').classList.add('cs-add-mode');
    document.getElementById('cs-banner').style.display = 'flex';
    document.getElementById('cs-add-btn').classList.add('active');
    positionOverlay();
  }

  function cancelAddMode() {
    addMode = false;
    const overlay = document.getElementById('cs-overlay');
    if (overlay) overlay.classList.remove('cs-add-mode');
    const banner = document.getElementById('cs-banner');
    if (banner) banner.style.display = 'none';
    const addBtn = document.getElementById('cs-add-btn');
    if (addBtn) addBtn.classList.remove('active');
  }

  /* ══════════════════════════════════════════════════════════════
     Overlay drag → area select or point pin
     ══════════════════════════════════════════════════════════════ */
  function onOverlayMousedown(e) {
    if (!addMode) return;
    dragStart = { clientX: e.clientX, clientY: e.clientY };

    // Create a temporary selection-rect element
    const overlay = document.getElementById('cs-overlay');
    const rect = overlay.getBoundingClientRect();
    selectionEl = document.createElement('div');
    selectionEl.className = 'cs-sel-rect';
    selectionEl.style.left   = (dragStart.clientX - rect.left) + 'px';
    selectionEl.style.top    = (dragStart.clientY - rect.top)  + 'px';
    selectionEl.style.width  = '0px';
    selectionEl.style.height = '0px';
    overlay.appendChild(selectionEl);
  }

  function onOverlayMousemove(e) {
    if (!addMode || !dragStart || !selectionEl) return;
    // If the mouse button was released outside the overlay, cancel the drag
    if (!(e.buttons & 1)) {
      selectionEl.remove(); selectionEl = null;
      dragStart = null;
      return;
    }
    const overlay = document.getElementById('cs-overlay');
    const rect = overlay.getBoundingClientRect();
    const sx = dragStart.clientX - rect.left;
    const sy = dragStart.clientY - rect.top;
    const ex = e.clientX - rect.left;
    const ey = e.clientY - rect.top;
    selectionEl.style.left   = Math.min(sx, ex) + 'px';
    selectionEl.style.top    = Math.min(sy, ey) + 'px';
    selectionEl.style.width  = Math.abs(ex - sx) + 'px';
    selectionEl.style.height = Math.abs(ey - sy) + 'px';
  }

  function onOverlayMouseup(e) {
    if (!addMode || !dragStart) return;

    // Remove temp rect
    if (selectionEl) { selectionEl.remove(); selectionEl = null; }

    // If released outside the overlay, cancel without placing a pin
    const overlay = document.getElementById('cs-overlay');
    const rect = overlay.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top  || e.clientY > rect.bottom) {
      dragStart = null;
      return;
    }
    const frame = document.getElementById('contentFrame');
    const scrollY = (frame && frame.contentWindow) ? (frame.contentWindow.scrollY || 0) : 0;
    const docHeight = (frame && frame.contentDocument)
      ? frame.contentDocument.documentElement.scrollHeight
      : rect.height;

    const dx = Math.abs(e.clientX - dragStart.clientX);
    const dy = Math.abs(e.clientY - dragStart.clientY);
    const isArea = dx > 6 || dy > 6;

    // Corner 1
    const x1pct  = ((dragStart.clientX - rect.left) / rect.width)  * 100;
    const y1pct  = (((dragStart.clientY - rect.top) + scrollY) / docHeight) * 100;

    if (isArea) {
      // Corner 2
      const x2pct = ((e.clientX - rect.left) / rect.width)  * 100;
      const y2pct = (((e.clientY - rect.top) + scrollY) / docHeight) * 100;
      pendingPin = {
        x:  Math.min(x1pct, x2pct),
        y:  Math.min(y1pct, y2pct),
        x2: Math.max(x1pct, x2pct),
        y2: Math.max(y1pct, y2pct),
      };
    } else {
      pendingPin = { x: x1pct, y: y1pct, x2: null, y2: null };
    }

    dragStart = null;
    cancelAddMode();
    showForm(e.clientX, e.clientY);
  }

  /* ══════════════════════════════════════════════════════════════
     Floating form
     ══════════════════════════════════════════════════════════════ */
  function showForm(cx, cy) {
    const form = document.getElementById('cs-form');
    form.style.display = 'block';

    // Position near click but keep on screen
    const W = window.innerWidth;
    const H = window.innerHeight;
    const FW = 280 + 32;
    const FH = 220;

    let left = cx + 12;
    let top  = cy - 20;
    if (left + FW > W) left = cx - FW + 12;
    if (top + FH > H) top = H - FH - 12;
    if (top < 60) top = 60;

    form.style.left = left + 'px';
    form.style.top  = top  + 'px';

    setTimeout(() => {
      const nameInput = document.getElementById('cs-form-name');
      if (nameInput.value) {
        document.getElementById('cs-form-text').focus();
      } else {
        nameInput.focus();
      }
    }, 50);
  }

  function cancelForm() {
    const form = document.getElementById('cs-form');
    if (form) form.style.display = 'none';
    const textEl = document.getElementById('cs-form-text');
    if (textEl) textEl.value = '';
    pendingPin = null;
  }

  function submitForm() {
    const nameEl = document.getElementById('cs-form-name');
    const textEl = document.getElementById('cs-form-text');
    const author  = (nameEl.value || '').trim();
    const comment = (textEl.value || '').trim();

    if (!author) { nameEl.focus(); nameEl.style.borderColor = '#f5222d'; return; }
    if (!comment) { textEl.focus(); textEl.style.borderColor = '#f5222d'; return; }

    nameEl.style.borderColor = '';
    textEl.style.borderColor = '';

    // Save name
    localStorage.setItem(LS_AUTHOR_KEY, author);

    const id = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const x  = pendingPin ? pendingPin.x  : 50;
    const y  = pendingPin ? pendingPin.y  : 50;
    const x2 = (pendingPin && pendingPin.x2 != null) ? pendingPin.x2 : null;
    const y2 = (pendingPin && pendingPin.y2 != null) ? pendingPin.y2 : null;

    const obj = {
      id,
      page: currentPage,
      author,
      comment,
      x, y, x2, y2,
      timestamp: new Date().toISOString(),
      resolved: false,
    };

    // Optimistic update
    comments.push(obj);
    renderList();
    renderPins();
    cancelForm();

    // POST to Supabase
    if (hasBackend()) {
      fetch(SB_URL() + '/rest/v1/comments', {
        method: 'POST',
        headers: {
          'apikey': SB_KEY(),
          'Authorization': 'Bearer ' + SB_KEY(),
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify(obj),
      }).catch(() => {});
    }
  }

  /* ══════════════════════════════════════════════════════════════
     Resolve
     ══════════════════════════════════════════════════════════════ */
  function resolveComment(id) {
    const c = comments.find(x => x.id === id);
    if (!c || c.resolved) return;
    c.resolved = true;
    renderList();
    renderPins();

    if (hasBackend()) {
      fetch(SB_URL() + '/rest/v1/comments?id=eq.' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: {
          'apikey': SB_KEY(),
          'Authorization': 'Bearer ' + SB_KEY(),
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ resolved: true }),
      }).catch(() => {});
    }
  }

  function deleteComment(id) {
    comments = comments.filter(c => c.id !== id);
    if (selectedPinId === id) selectedPinId = null;
    renderList();
    renderPins();

    if (hasBackend()) {
      fetch(SB_URL() + '/rest/v1/comments?id=eq.' + encodeURIComponent(id), {
        method: 'DELETE',
        headers: {
          'apikey': SB_KEY(),
          'Authorization': 'Bearer ' + SB_KEY(),
          'Prefer': 'return=minimal',
        },
      }).catch(() => {});
    }
  }

  /* ══════════════════════════════════════════════════════════════
     API: fetch comments
     ══════════════════════════════════════════════════════════════ */
  function fetchComments() {
    if (!hasBackend()) { renderList(); return; }
    fetch(SB_URL() + '/rest/v1/comments?page=eq.' + encodeURIComponent(currentPage) + '&order=timestamp.asc', {
      headers: {
        'apikey': SB_KEY(),
        'Authorization': 'Bearer ' + SB_KEY(),
      },
    })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          mergeComments(data);
          renderList();
          renderPins();
          updateBadge();
        }
      })
      .catch(() => {});
  }

  // Merge server data preserving optimistic entries not yet on server
  function mergeComments(serverData) {
    const serverIds = new Set(serverData.map(c => c.id));
    // Keep optimistic ones not yet on server
    const optimistic = comments.filter(c => !serverIds.has(c.id));
    comments = [...serverData, ...optimistic];
  }

  /* ══════════════════════════════════════════════════════════════
     Polling
     ══════════════════════════════════════════════════════════════ */
  function startPolling() {
    stopPolling();
    if (!hasBackend()) return;
    pollTimer = setInterval(fetchComments, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  /* ══════════════════════════════════════════════════════════════
     Render list
     ══════════════════════════════════════════════════════════════ */
  function renderList() {
    const body = document.getElementById('cs-panel-body');
    const foot = document.getElementById('cs-panel-foot');
    if (!body) return;

    const active   = comments.filter(c => !c.resolved);
    const resolved = comments.filter(c => c.resolved);

    // Footer
    foot.innerHTML = '';
    if (!hasBackend()) {
      foot.innerHTML = `<div class="cs-no-api-warn">No backend connected.<br>Set <code>DS_SUPABASE_URL</code> and <code>DS_SUPABASE_KEY</code>.</div>`;
    }

    let html = '';

    if (active.length === 0 && resolved.length === 0) {
      html = `<div class="cs-empty">No comments yet.<br>Click <strong>+ Add</strong> to place a comment on the page.</div>`;
    } else {
      // Active comments
      active.forEach((c, i) => {
        const num = i + 1;
        html += commentItemHTML(c, num, false);
      });

      // Resolved section
      if (resolved.length > 0) {
        html += `<div class="cs-resolved-header" data-toggle="resolved">
          <span id="cs-resolved-caret">▸</span> Resolved (${resolved.length})
        </div>`;
        html += `<div id="cs-resolved-list" style="display:none;">`;
        resolved.forEach((c, i) => {
          const num = active.length + i + 1;
          html += commentItemHTML(c, num, true);
        });
        html += `</div>`;
      }
    }

    body.innerHTML = html;

    // Wire resolve buttons
    body.querySelectorAll('.cs-resolve-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        resolveComment(btn.dataset.id);
      });
    });

    // Wire delete buttons
    body.querySelectorAll('.cs-delete-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        deleteComment(btn.dataset.id);
      });
    });

    // Wire item clicks (scroll / highlight pin)
    body.querySelectorAll('.cs-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.id;
        selectPin(id);
      });
    });

    // Wire resolved toggle
    const toggle = body.querySelector('[data-toggle="resolved"]');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const list = document.getElementById('cs-resolved-list');
        const caret = document.getElementById('cs-resolved-caret');
        if (list.style.display === 'none') {
          list.style.display = 'block';
          caret.textContent = '▾';
        } else {
          list.style.display = 'none';
          caret.textContent = '▸';
        }
      });
    }

    // Highlight selected item
    if (selectedPinId) {
      const sel = body.querySelector(`.cs-item[data-id="${selectedPinId}"]`);
      if (sel) sel.classList.add('cs-selected');
    }

    updateBadge();
  }

  function commentItemHTML(c, num, isResolved) {
    const timeStr = timeAgo(c.timestamp);
    const textClass = isResolved ? 'cs-item-text cs-resolved-text' : 'cs-item-text';
    const resolveBtn = isResolved
      ? ''
      : `<button class="cs-resolve-btn" data-id="${esc(c.id)}">✓ Resolve</button>`;

    return `<div class="cs-item${isResolved ? ' cs-resolved' : ''}" data-id="${esc(c.id)}">
      <div class="cs-item-pin">${num}</div>
      <div class="cs-item-body">
        <div class="cs-item-meta">
          <span class="cs-item-author">${esc(c.author)}</span>
          <span class="cs-item-time">${timeStr}</span>
        </div>
        <div class="${textClass}">${esc(c.comment)}</div>
        <div class="cs-item-actions">
          ${resolveBtn}
          <button class="cs-delete-btn" data-id="${esc(c.id)}">✕ Delete</button>
        </div>
      </div>
    </div>`;
  }

  /* ══════════════════════════════════════════════════════════════
     Render pins on overlay
     ══════════════════════════════════════════════════════════════ */
  function renderPins() {
    clearPins();
    const overlay = document.getElementById('cs-overlay');
    if (!overlay) return;

    const frame = document.getElementById('contentFrame');
    const scrollY = (frame && frame.contentWindow) ? (frame.contentWindow.scrollY || 0) : 0;
    const overlayRect = overlay.getBoundingClientRect();
    const docHeight = (frame && frame.contentDocument)
      ? frame.contentDocument.documentElement.scrollHeight
      : overlayRect.height;

    const active   = comments.filter(c => !c.resolved);
    const resolved = comments.filter(c => c.resolved);
    const all = [...active, ...resolved];

    all.forEach((c, i) => {
      // Convert stored doc-% back to viewport-% accounting for scroll
      const docYpx = (c.y / 100) * docHeight;
      const viewportYpx = docYpx - scrollY;
      const viewportYpct = (viewportYpx / overlayRect.height) * 100;

      const isArea = c.x2 != null && c.y2 != null;

      // For area comments, also compute bottom-right corner
      let viewportY2pct = viewportYpct;
      if (isArea) {
        const docY2px = (c.y2 / 100) * docHeight;
        viewportY2pct = ((docY2px - scrollY) / overlayRect.height) * 100;
      }

      // Hide if entirely scrolled out of view
      const topVisible    = viewportYpct  > -4 && viewportYpct  < 104;
      const bottomVisible = viewportY2pct > -4 && viewportY2pct < 104;
      if (!topVisible && !bottomVisible) return;

      // ── Area highlight ──
      if (isArea) {
        const hl = document.createElement('div');
        hl.className = 'cs-highlight' + (c.id === selectedPinId ? ' cs-hl-sel' : '') + (c.resolved ? ' cs-resolved-pin' : '');
        hl.style.left   = c.x + '%';
        hl.style.top    = viewportYpct + '%';
        hl.style.width  = (c.x2 - c.x) + '%';
        hl.style.height = (viewportY2pct - viewportYpct) + '%';
        hl.dataset.id   = c.id;
        hl.addEventListener('click', ev => {
          ev.stopPropagation();
          if (!panelOpen) openPanel();
          selectPin(c.id);
        });
        overlay.appendChild(hl);
      }

      // Hide the pin itself if scrolled out of the top
      if (viewportYpct < -4 || viewportYpct > 104) return;

      const num = i + 1;
      const pin = document.createElement('div');
      pin.className = 'cs-pin' + (c.resolved ? ' cs-resolved-pin' : '') + (c.id === selectedPinId ? ' cs-pin-sel' : '');
      pin.style.left = c.x + '%';
      pin.style.top  = viewportYpct + '%';
      pin.textContent = num;
      pin.dataset.id  = c.id;
      pin.addEventListener('click', e => {
        e.stopPropagation();
        if (!panelOpen) openPanel();
        selectPin(c.id);
      });
      overlay.appendChild(pin);
    });
  }

  function clearPins() {
    const overlay = document.getElementById('cs-overlay');
    if (!overlay) return;
    overlay.querySelectorAll('.cs-pin, .cs-highlight').forEach(p => p.remove());
  }

  function selectPin(id) {
    selectedPinId = id;
    renderPins();
    // Scroll to item and highlight
    const body = document.getElementById('cs-panel-body');
    if (!body) return;
    body.querySelectorAll('.cs-item').forEach(item => {
      item.classList.toggle('cs-selected', item.dataset.id === id);
    });
    const sel = body.querySelector(`.cs-item[data-id="${id}"]`);
    if (sel) sel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* ══════════════════════════════════════════════════════════════
     FAB badge
     ══════════════════════════════════════════════════════════════ */
  function updateBadge() {
    const badge = document.getElementById('cs-fab-badge');
    if (!badge) return;
    const count = comments.filter(c => !c.resolved).length;
    if (count > 0) {
      badge.style.display = 'flex';
      badge.textContent = count > 99 ? '99+' : count;
    } else {
      badge.style.display = 'none';
    }
  }

  /* ══════════════════════════════════════════════════════════════
     Keyboard
     ══════════════════════════════════════════════════════════════ */
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      if (formEl && formEl.style.display !== 'none') {
        cancelForm();
        enterAddMode(); // go back to crosshair mode
        return;
      }
      if (addMode) { cancelAddMode(); return; }
    }
  }

  /* ══════════════════════════════════════════════════════════════
     Helpers
     ══════════════════════════════════════════════════════════════ */
  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function timeAgo(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60)  return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60)  return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24)  return h + 'h ago';
    const d = Math.floor(h / 24);
    return d + 'd ago';
  }

  /* ══════════════════════════════════════════════════════════════
     Boot — wait for DOM ready
     ══════════════════════════════════════════════════════════════ */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
