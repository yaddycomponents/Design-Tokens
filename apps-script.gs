// ═══════════════════════════════════════════════
// Design System Comments — Google Apps Script
// ═══════════════════════════════════════════════
//
// SETUP (one time, ~3 minutes):
// 1. Open your Google Sheet → Extensions → Apps Script
// 2. Paste this entire file → Save
// 3. Click Deploy → New Deployment → Web App
//    - Execute as: Me
//    - Who has access: Anyone
// 4. Click Deploy → copy the URL
// 5. In index.html, set: window.DS_COMMENTS_API = 'PASTE_URL_HERE'
// 6. Done! Share your Vercel URL with the team.
//
// Sheet columns (row 1 = header, auto-created):
// id | page | author | comment | timestamp | resolved | x | y
// ═══════════════════════════════════════════════

const SHEET_NAME = 'Comments';

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['id', 'page', 'author', 'comment', 'timestamp', 'resolved', 'x', 'y']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 8).setFontWeight('bold');
  }
  return sheet;
}

// ── Column index constants (1-based for Sheets API) ──────────────
const COL = {
  id:        1,
  page:      2,
  author:    3,
  comment:   4,
  timestamp: 5,
  resolved:  6,
  x:         7,
  y:         8,
};

// ── Shared CORS output helper ─────────────────────────────────────
function jsonResponse(data) {
  const output = ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}

// ═══════════════════════════════════════════════════════════════════
// doGet — Returns comments for a page (or all comments if no page)
//
// Query params:
//   page  (optional) — filter by page name, URL-encoded
//
// Response: JSON array of comment objects
// ═══════════════════════════════════════════════════════════════════
function doGet(e) {
  try {
    const sheet = getOrCreateSheet();
    const pageFilter = (e && e.parameter && e.parameter.page)
      ? decodeURIComponent(e.parameter.page)
      : null;

    const lastRow = sheet.getLastRow();

    // No data rows yet (only header)
    if (lastRow <= 1) {
      return jsonResponse([]);
    }

    const data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();

    const results = data
      .filter(row => {
        // Skip completely empty rows
        if (!row[COL.id - 1]) return false;
        // Apply page filter if provided
        if (pageFilter !== null && row[COL.page - 1] !== pageFilter) return false;
        return true;
      })
      .map(row => ({
        id:        String(row[COL.id        - 1]),
        page:      String(row[COL.page      - 1]),
        author:    String(row[COL.author    - 1]),
        comment:   String(row[COL.comment   - 1]),
        timestamp: row[COL.timestamp - 1]
                     ? new Date(row[COL.timestamp - 1]).toISOString()
                     : '',
        resolved:  row[COL.resolved - 1] === true || row[COL.resolved - 1] === 'TRUE',
        x:         parseFloat(row[COL.x - 1]) || 0,
        y:         parseFloat(row[COL.y - 1]) || 0,
      }));

    return jsonResponse(results);

  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════
// doPost — Add a new comment OR resolve an existing one
//
// Body (Content-Type: text/plain, JSON string):
//
//   Add comment:
//   { id, page, author, comment, x, y, timestamp, resolved }
//
//   Resolve comment:
//   { action: 'resolve', id }
//
// Response: JSON { ok: true } or { error: '...' }
// ═══════════════════════════════════════════════════════════════════
function doPost(e) {
  try {
    const raw  = e.postData && e.postData.contents ? e.postData.contents : '{}';
    const data = JSON.parse(raw);

    const sheet = getOrCreateSheet();

    // ── Resolve action ──────────────────────────────────────────
    if (data.action === 'resolve') {
      const id = String(data.id || '').trim();
      if (!id) {
        return jsonResponse({ error: 'Missing id for resolve action' });
      }

      const lastRow = sheet.getLastRow();
      if (lastRow <= 1) {
        return jsonResponse({ error: 'Comment not found' });
      }

      const ids = sheet.getRange(2, COL.id, lastRow - 1, 1).getValues();
      let foundRow = -1;

      for (let i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === id) {
          foundRow = i + 2; // +2 because data starts at row 2 (1-indexed)
          break;
        }
      }

      if (foundRow === -1) {
        return jsonResponse({ error: 'Comment not found' });
      }

      sheet.getRange(foundRow, COL.resolved).setValue(true);
      return jsonResponse({ ok: true, action: 'resolved', id });
    }

    // ── Add new comment ─────────────────────────────────────────
    const id        = String(data.id        || '').trim();
    const page      = String(data.page      || '').trim();
    const author    = String(data.author    || '').trim();
    const comment   = String(data.comment   || '').trim();
    const timestamp = data.timestamp ? new Date(data.timestamp) : new Date();
    const resolved  = data.resolved === true || data.resolved === 'true';
    const x         = parseFloat(data.x) || 0;
    const y         = parseFloat(data.y) || 0;

    if (!id || !page || !author || !comment) {
      return jsonResponse({ error: 'Missing required fields: id, page, author, comment' });
    }

    sheet.appendRow([id, page, author, comment, timestamp, resolved, x, y]);

    return jsonResponse({ ok: true, action: 'added', id });

  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}
