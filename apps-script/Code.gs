/**
 * 東北賞楓網站的資料後台。
 * 貼到試算表的「擴充功能 → Apps Script」，部署成網頁應用程式（執行身分：我；存取權：所有人）。
 *
 * GET  → 回傳所有「🌐」開頭分頁的內容（只讀這些分頁，其他分頁不會外流）
 * POST → 更新「🌐清單」的勾選格：{ item: "項目名稱", person: "Jaron", checked: true }
 */

const PREFIX = '🌐';
const CHECK_SHEET = '🌐清單';
const FIRST_PERSON_HEADER_AFTER = '連結'; // 「連結」欄之後的欄位都是人名勾選欄

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

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
