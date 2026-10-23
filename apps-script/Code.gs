/**
 * 東北賞楓網站的資料後台。
 * 貼到試算表的「擴充功能 → Apps Script」，部署成網頁應用程式（執行身分：我；存取權：所有人）。
 *
 * GET  → 回傳所有「🌐」開頭分頁的內容（只讀這些分頁，其他分頁不會外流）
 * POST → 兩種用途：
 *   1. 更新「🌐清單」的勾選格：{ item: "項目名稱", person: "Jaron", checked: true }
 *   2. 家人在「建議」頁送出的建議，寫進「💬建議」分頁：
 *      { action: "suggest", name: "Angel", type: "想去的景點", text: "…", link: "https://…" }
 *      （「💬建議」不是 🌐 開頭，所以不會被 GET 公開出去，只有你看得到）
 */

const PREFIX = '🌐';
const CHECK_SHEET = '🌐清單';
const FIRST_PERSON_HEADER_AFTER = '連結'; // 「連結」欄之後的欄位都是人名勾選欄
const SUGGEST_SHEET = '💬建議';
const SUGGEST_HEADER = ['時間', '姓名', '類型', '內容', '連結', '處理狀態'];

function doGet() {
  const sheets = {};
  SpreadsheetApp.getActive().getSheets().forEach(function (sh) {
    const name = sh.getName();
    if (name.indexOf(PREFIX) !== 0) return;
    sheets[name.slice(PREFIX.length)] = sh.getDataRange().getDisplayValues();
  });
  return json({ ok: true, updated: new Date().toISOString(), sheets: sheets });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: 'bad json' });
  }

  if (body.action === 'suggest') return saveSuggestion(body);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = SpreadsheetApp.getActive().getSheetByName(CHECK_SHEET);
    const values = sh.getDataRange().getDisplayValues();
    const header = values[0];
    const firstPersonCol = header.indexOf(FIRST_PERSON_HEADER_AFTER) + 1;
    const col = header.indexOf(String(body.person));
    if (firstPersonCol <= 0 || col < firstPersonCol) return json({ ok: false, error: 'unknown person' });

    const itemCol = header.indexOf('項目');
    let row = -1;
    for (let i = 1; i < values.length; i++) {
      if (values[i][itemCol] === String(body.item)) { row = i; break; }
    }
    if (row < 0) return json({ ok: false, error: 'unknown item' });

    sh.getRange(row + 1, col + 1).setValue(body.checked === true);
    return json({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// 把家人的建議加到「💬建議」最下面一列
function saveSuggestion(body) {
  const name = clean(body.name, 20);
  const type = clean(body.type, 20);
  const text = clean(body.text, 1000);
  const link = clean(body.link, 300);
  if (!text) return json({ ok: false, error: 'empty' });
  if (!name) return json({ ok: false, error: 'no name' });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActive();
    let sh = ss.getSheetByName(SUGGEST_SHEET);
    if (!sh) {
      sh = ss.insertSheet(SUGGEST_SHEET);
      sh.appendRow(SUGGEST_HEADER);
      sh.setFrozenRows(1);
    }
    sh.appendRow([new Date(), name, type, text, link, '']);
    return json({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// 去掉前後空白、限制長度；開頭是 = + - @ 的字加上單引號，避免被當成公式執行
function clean(v, max) {
  let s = String(v == null ? '' : v).trim().slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
