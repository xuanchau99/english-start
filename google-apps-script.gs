/**
 * FluentGo secure backend for GitHub Pages.
 * Apps Script chỉ xử lý tài khoản và tiến độ Google Sheets.
 * Gemini key nằm trong app-config.js và Gemini được frontend gọi trực tiếp.
 */
const PROGRESS_SHEET = 'FluentGo Progress';
const CONFIG_SHEET = 'FluentGo Config';
const USERS_SHEET = 'FluentGo Users';
const SESSIONS_SHEET = 'FluentGo Sessions';
const SESSION_DAYS = 30;
const PROGRESS_HEADERS = [
  'userId','name','level','xp','streak','longestStreak','minutesWeek',
  'dailyGoal','completedToday','completedLessons','wordsLearned','lastActive','syncedAt','rawJson'
];
const USER_HEADERS = ['userId','email','displayName','passwordSalt','passwordHash','createdAt','lastLogin','status','username'];
const SESSION_HEADERS = ['tokenHash','userId','createdAt','expiresAt','status'];
const CONFIG_DEFAULTS = [
  ['KEY','VALUE','MÔ TẢ'],
  ['APP_SCRIPT_KEY','','Khóa nội bộ, được tạo tự động khi chạy setupFluentGo'],
  ['SYNC_REQUESTS_PER_MINUTE','10','Số lần đồng bộ tối đa mỗi user mỗi phút'],
  ['GLOBAL_REQUESTS_PER_MINUTE','180','Tổng request bridge tối đa toàn app mỗi phút']
];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('FluentGo')
    .addItem('Khởi tạo / kiểm tra cấu hình', 'setupFluentGo')
    .addToUi();
}

/** Chạy hàm này một lần trong Apps Script trước khi deploy. */
function setupFluentGo() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let configSheet = spreadsheet.getSheetByName(CONFIG_SHEET);
  if (!configSheet) configSheet = spreadsheet.insertSheet(CONFIG_SHEET);
  if (configSheet.getLastRow() === 0) configSheet.getRange(1,1,1,3).setValues([CONFIG_DEFAULTS[0]]);
  const existingKeys=configSheet.getDataRange().getValues().slice(1).map(function(row){return String(row[0]);});
  CONFIG_DEFAULTS.slice(1).forEach(function(row){ if (existingKeys.indexOf(row[0])<0) configSheet.appendRow(row); });
  configSheet.getRange('A1:C1').setFontWeight('bold').setBackground('#6454ed').setFontColor('#ffffff');
  configSheet.setFrozenRows(1);
  configSheet.setColumnWidth(1,190); configSheet.setColumnWidth(2,360); configSheet.setColumnWidth(3,340);
  const values = configSheet.getDataRange().getValues();
  for (let i=1; i<values.length; i++) {
    if (values[i][0] === 'APP_SCRIPT_KEY' && !values[i][1]) configSheet.getRange(i+1,2).setValue(Utilities.getUuid() + Utilities.getUuid());
    if (values[i][0] === 'GEMINI_API_KEY' && values[i][1]) configSheet.getRange(i+1,2).clearContent();
  }
  getProgressSheet_();
  migrateUsernames_(getUsersSheet_());
  getSessionsSheet_();
  CacheService.getScriptCache().remove('fluentgo_config_v2');
  SpreadsheetApp.getUi().alert('Đã khởi tạo FluentGo backend. Gemini key được cấu hình trong app-config.js; Apps Script chỉ lưu tài khoản và tiến độ.');
}

function doGet(e) {
  if (e && e.parameter && e.parameter.bridge === '1') return bridgePage_();
  const config = getConfig_();
  return output_({
    ok:true,
    service:'FluentGo Apps Script Backend',
    configured:true,
    geminiProxy:false
  });
}

/** Endpoint POST dự phòng. Iframe bridge dùng apiRequest() qua google.script.run. */
function doPost(e) {
  try {
    const request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    return output_(apiRequest(request));
  } catch (error) {
    return output_({ ok:false, error:String(error.message || error) });
  }
}

/** Router duy nhất cho iframe bridge. */
function apiRequest(request) {
  try {
    request = request || {};
    const config = getConfig_();
    if (!config.APP_SCRIPT_KEY || !verifyBridgeProof_(request.bridgeProof,config.APP_SCRIPT_KEY)) throw new Error('Kết nối Apps Script không hợp lệ hoặc đã hết hạn.');
    enforceActionRate_('entire-app','all-actions',Number(config.GLOBAL_REQUESTS_PER_MINUTE)||180);
    const action = String(request.action || '');
    const payload = request.payload || {};
    if (action === 'status') return { ok:true, gemini:false, sheets:true, auth:true, mode:'accounts-and-progress-only' };
    if (action === 'register') return registerUser_(payload,config);
    if (action === 'login') return loginUser_(payload,config);
    if (action === 'restore') return restoreSession_(request.sessionToken,config);
    if (action === 'logout') return logoutUser_(request.sessionToken,config);
    const account=authenticate_(request.sessionToken,config);
    if (action === 'progress') return { ok:true, user:publicUser_(account), progress:getProgress_(account.userId) };
    if (action === 'profile') { enforceActionRate_(account.userId,'profile',4); return updateProfile_(account,payload); }
    if (action === 'sync') { enforceActionRate_(account.userId,'sync',Number(config.SYNC_REQUESTS_PER_MINUTE)||10); payload.userId=account.userId; payload.name=account.displayName; return saveProgress_(payload); }
    if (action === 'gemini') throw new Error('Gemini được gọi trực tiếp từ ứng dụng, không qua Apps Script.');
    throw new Error('Action không hợp lệ.');
  } catch (error) {
    return { ok:false, error:String(error.message || error) };
  }
}

function bridgePage_() {
  const config = getConfig_();
  const proof = JSON.stringify(createBridgeProof_(String(config.APP_SCRIPT_KEY || '')));
  const html = [
    '<!doctype html><html><head><meta charset="utf-8"></head><body>',
    '<script>',
    '(function(){',
    'var bridgeProof=' + proof + ';',
    'var parentOrigin="*";',
    'function send(data){window.top.postMessage(data,parentOrigin);}',
    'window.addEventListener("message",function(event){',
    ' var data=event.data||{}; if(data.source!=="fluentgo-parent")return;',
    ' parentOrigin=(!event.origin||event.origin==="null")?"*":event.origin;',
    ' if(data.type==="ping"){send({source:"fluentgo-bridge",type:"ready"});return;}',
    ' if(data.type!=="request")return;',
    ' var request={bridgeProof:bridgeProof,sessionToken:data.sessionToken||"",action:data.action,payload:data.payload||{}};',
    ' google.script.run.withSuccessHandler(function(result){send({source:"fluentgo-bridge",type:"response",id:data.id,result:result});})',
    ' .withFailureHandler(function(error){send({source:"fluentgo-bridge",type:"response",id:data.id,result:{ok:false,error:(error&&error.message)||"Apps Script error"}});})',
    ' .apiRequest(request);',
    '});',
    'window.top.postMessage({source:"fluentgo-bridge",type:"boot"},"*");',
    '})();',
    '<\/script></body></html>'
  ].join('');
  return HtmlService.createHtmlOutput(html)
    .setTitle('FluentGo Bridge')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function createBridgeProof_(secret) {
  const nonce=Utilities.getUuid();
  const timestamp=Date.now();
  const signature=Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(nonce+'|'+timestamp,secret));
  return { nonce:nonce,timestamp:timestamp,signature:signature };
}

function verifyBridgeProof_(proof,secret) {
  if (!proof || !proof.nonce || !proof.timestamp || !proof.signature) return false;
  const age=Math.abs(Date.now()-Number(proof.timestamp));
  if (!Number.isFinite(age) || age>604800000) return false;
  const expected=Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(String(proof.nonce)+'|'+String(proof.timestamp),secret));
  return expected===String(proof.signature);
}

function getConfig_() {
  const cache=CacheService.getScriptCache();
  const cached=cache.get('fluentgo_config_v2');
  if (cached) try { return JSON.parse(cached); } catch (_) {}
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_SHEET);
  if (!sheet) return {};
  const values = sheet.getDataRange().getDisplayValues();
  const config = {};
  for (let i=1; i<values.length; i++) if (values[i][0]) config[String(values[i][0]).trim()] = String(values[i][1] || '').trim();
  cache.put('fluentgo_config_v2',JSON.stringify(config),120);
  return config;
}

function registerUser_(payload,config) {
  const name=String(payload.name||'').trim().replace(/\s+/g,' ').slice(0,60);
  const username=normalizeUsername_(payload.username);
  const email=normalizeEmail_(payload.email);
  const password=String(payload.password||'');
  if (name.length<2) throw new Error('Tên cần có ít nhất 2 ký tự.');
  validateUsername_(username);
  validateCredentials_(email,password);
  enforceAuthLimit_('register_'+email,5);
  const lock=LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    if (findUserByEmail_(email)) throw new Error('Email này đã được đăng ký. Hãy đăng nhập.');
    if (findUserByUsername_(username)) throw new Error('Username này đã được sử dụng. Hãy chọn username khác.');
    const salt=Utilities.getUuid()+Utilities.getUuid();
    const user={ userId:'usr_'+Utilities.getUuid(),email:email,username:username,displayName:name,passwordSalt:salt,passwordHash:hashPassword_(password,salt,config.APP_SCRIPT_KEY),createdAt:new Date().toISOString(),lastLogin:new Date().toISOString(),status:'active' };
    getUsersSheet_().appendRow([user.userId,user.email,user.displayName,user.passwordSalt,user.passwordHash,user.createdAt,user.lastLogin,user.status,user.username]);
    const session=createSession_(user.userId,config.APP_SCRIPT_KEY);
    return { ok:true,sessionToken:session.token,expiresAt:session.expiresAt,user:publicUser_(user),progress:null };
  } finally { try { lock.releaseLock(); } catch (_) {} }
}

function loginUser_(payload,config) {
  const identifier=String(payload.identifier||payload.email||'').trim().toLowerCase();
  const password=String(payload.password||'');
  if (!identifier) throw new Error('Vui lòng nhập username hoặc email.');
  if (password.length<8 || password.length>128) throw new Error('Email/username hoặc mật khẩu không chính xác.');
  enforceAuthLimit_('login_'+identifier,10);
  const found=identifier.indexOf('@')>=0 ? findUserByEmail_(normalizeEmail_(identifier)) : findUserByUsername_(normalizeUsername_(identifier));
  if (!found || found.user.status!=='active') throw new Error('Email hoặc mật khẩu không chính xác.');
  const actual=hashPassword_(password,found.user.passwordSalt,config.APP_SCRIPT_KEY);
  if (!constantTimeEqual_(actual,found.user.passwordHash)) throw new Error('Email hoặc mật khẩu không chính xác.');
  const now=new Date().toISOString();
  found.sheet.getRange(found.rowIndex,7).setValue(now); found.user.lastLogin=now;
  const session=createSession_(found.user.userId,config.APP_SCRIPT_KEY);
  return { ok:true,sessionToken:session.token,expiresAt:session.expiresAt,user:publicUser_(found.user),progress:getProgress_(found.user.userId) };
}

function restoreSession_(token,config) {
  const user=authenticate_(token,config);
  return { ok:true,user:publicUser_(user),progress:getProgress_(user.userId) };
}

function logoutUser_(token,config) {
  if (!token) return {ok:true};
  const hash=hashToken_(token,config.APP_SCRIPT_KEY);
  CacheService.getScriptCache().remove(sessionCacheKey_(hash));
  const sheet=getSessionsSheet_(), rows=sheet.getDataRange().getValues();
  for (let i=1;i<rows.length;i++) if (constantTimeEqual_(String(rows[i][0]),hash)) { sheet.getRange(i+1,5).setValue('revoked'); break; }
  return {ok:true};
}

function authenticate_(token,config) {
  if (!token) throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  const hash=hashToken_(String(token),config.APP_SCRIPT_KEY);
  const cache=CacheService.getScriptCache();
  let userId=cache.get(sessionCacheKey_(hash))||'';
  if (!userId) {
    const sheet=getSessionsSheet_(), rows=sheet.getDataRange().getValues();
    for (let i=1;i<rows.length;i++) {
      if (constantTimeEqual_(String(rows[i][0]),hash) && String(rows[i][4])==='active' && new Date(rows[i][3]).getTime()>Date.now()) { userId=String(rows[i][1]); break; }
    }
    if (userId) cache.put(sessionCacheKey_(hash),userId,300);
  }
  if (!userId) throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  let user=null;
  const cachedUser=cache.get(userCacheKey_(userId));
  if (cachedUser) try { user=JSON.parse(cachedUser); } catch (_) {}
  if (!user) { const found=findUserById_(userId); user=found&&found.user; if (user) cache.put(userCacheKey_(userId),JSON.stringify(user),300); }
  if (!user || user.status!=='active') throw new Error('Tài khoản không còn hoạt động.');
  return user;
}

function createSession_(userId,secret) {
  const token=Utilities.getUuid()+Utilities.getUuid()+Utilities.getUuid();
  const createdAt=new Date();
  const expiresAt=new Date(createdAt.getTime()+SESSION_DAYS*86400000);
  const tokenHash=hashToken_(token,secret);
  getSessionsSheet_().appendRow([tokenHash,userId,createdAt.toISOString(),expiresAt.toISOString(),'active']);
  CacheService.getScriptCache().put(sessionCacheKey_(tokenHash),userId,300);
  return {token:token,expiresAt:expiresAt.toISOString()};
}

function updateProfile_(account,payload) {
  const name=String(payload.name||'').trim().replace(/\s+/g,' ').slice(0,60);
  if (name.length<2) throw new Error('Tên cần có ít nhất 2 ký tự.');
  const found=findUserById_(account.userId);
  if (!found) throw new Error('Không tìm thấy tài khoản.');
  found.sheet.getRange(found.rowIndex,3).setValue(name);
  CacheService.getScriptCache().remove(userCacheKey_(account.userId));
  return {ok:true,user:{userId:account.userId,email:account.email,name:name}};
}

function normalizeEmail_(email) { return String(email||'').trim().toLowerCase(); }
function normalizeUsername_(username) { return String(username||'').trim().toLowerCase(); }
function validateUsername_(username) { if (!/^[a-z0-9._]{3,24}$/.test(username)) throw new Error('Username cần 3–24 ký tự, chỉ gồm chữ, số, dấu chấm hoặc gạch dưới.'); }
function validateCredentials_(email,password) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>150) throw new Error('Email không hợp lệ.');
  if (password.length<8 || password.length>128) throw new Error('Mật khẩu phải có từ 8 đến 128 ký tự.');
}

function hashPassword_(password,salt,secret) {
  let value=String(salt)+'|'+String(password)+'|'+String(secret);
  for (let i=0;i<1200;i++) value=Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value,Utilities.Charset.UTF_8))+'|'+salt+'|'+i;
  return value.split('|')[0];
}
function hashToken_(token,secret) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(String(token),String(secret)));
}
function sessionCacheKey_(hash) { return 'session_'+String(hash).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80); }
function userCacheKey_(userId) { return 'user_'+String(userId).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80); }
function constantTimeEqual_(a,b) {
  a=String(a||''); b=String(b||''); let diff=a.length^b.length;
  for (let i=0;i<Math.max(a.length,b.length);i++) diff|=(a.charCodeAt(i%Math.max(1,a.length))||0)^(b.charCodeAt(i%Math.max(1,b.length))||0);
  return diff===0;
}

function enforceAuthLimit_(identity,limit) {
  const cache=CacheService.getScriptCache();
  const key='auth_'+Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(identity),Utilities.Charset.UTF_8)).slice(0,40);
  const count=Number(cache.get(key)||0);
  if (count>=limit) throw new Error('Quá nhiều lần thử. Vui lòng chờ 10 phút.');
  cache.put(key,String(count+1),600);
}

function enforceActionRate_(identity,action,limit) {
  const cache=CacheService.getScriptCache();
  const minute=Utilities.formatDate(new Date(),Session.getScriptTimeZone()||'Asia/Ho_Chi_Minh','yyyyMMddHHmm');
  const raw=String(identity)+'|'+String(action)+'|'+minute;
  const digest=Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,raw,Utilities.Charset.UTF_8)).slice(0,45);
  const key='rate_'+digest, count=Number(cache.get(key)||0);
  if (count>=Math.max(1,Number(limit)||1)) throw new Error('Bạn thao tác quá nhanh. Vui lòng chờ một phút rồi thử lại.');
  cache.put(key,String(count+1),90);
}

function publicUser_(user) { return {userId:user.userId,email:user.email,username:user.username||'',name:user.displayName,createdAt:user.createdAt}; }

function findUserByEmail_(email) {
  const sheet=getUsersSheet_(), rows=sheet.getDataRange().getValues();
  for (let i=1;i<rows.length;i++) if (normalizeEmail_(rows[i][1])===email) return {sheet:sheet,rowIndex:i+1,user:userFromRow_(rows[i])};
  return null;
}
function findUserByUsername_(username) {
  const sheet=getUsersSheet_(), rows=sheet.getDataRange().getValues();
  for (let i=1;i<rows.length;i++) if (normalizeUsername_(rows[i][8])===username) return {sheet:sheet,rowIndex:i+1,user:userFromRow_(rows[i])};
  return null;
}
function findUserById_(userId) {
  const sheet=getUsersSheet_(), rows=sheet.getDataRange().getValues();
  for (let i=1;i<rows.length;i++) if (String(rows[i][0])===String(userId)) return {sheet:sheet,rowIndex:i+1,user:userFromRow_(rows[i])};
  return null;
}
function userFromRow_(row) { return {userId:String(row[0]),email:String(row[1]),displayName:String(row[2]),passwordSalt:String(row[3]),passwordHash:String(row[4]),createdAt:String(row[5]),lastLogin:String(row[6]),status:String(row[7]),username:String(row[8]||'')}; }

function getProgress_(userId) {
  const sheet=getProgressSheet_(), rows=sheet.getDataRange().getValues();
  for (let i=1;i<rows.length;i++) if (String(rows[i][0])===String(userId)) {
    try { return JSON.parse(String(rows[i][13]||'')); }
    catch (_) { return {userId:String(rows[i][0]),name:String(rows[i][1]),level:String(rows[i][2]),xp:Number(rows[i][3])||0,streak:Number(rows[i][4])||0}; }
  }
  return null;
}

function saveProgress_(data) {
  if (!data || !data.userId) throw new Error('Thiếu mã người học.');
  const cache=CacheService.getScriptCache();
  const comparable=Object.assign({},data); delete comparable.updatedAt; delete comparable.syncedAt;
  const fingerprint=Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(comparable),Utilities.Charset.UTF_8));
  const dedupeKey='progress_'+String(data.userId).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,60);
  if (cache.get(dedupeKey)===fingerprint) return {ok:true,message:'Tiến độ đã được cập nhật.',deduplicated:true};
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const sheet = getProgressSheet_();
    const rows = sheet.getDataRange().getValues();
    let rowIndex = -1;
    for (let i=1; i<rows.length; i++) if (String(rows[i][0]) === String(data.userId)) { rowIndex=i+1; break; }
    const row = [
      data.userId,data.name||'',data.level||'A1',Number(data.xp)||0,Number(data.streak)||0,
      Number(data.longestStreak)||0,Number(data.minutesWeek)||0,Number(data.dailyGoal)||15,
      JSON.stringify(data.completedToday||[]),JSON.stringify(data.completedLessons||[]),
      Number(data.wordsLearned)||0,data.lastActive||'',data.syncedAt||new Date().toISOString(),JSON.stringify(data)
    ];
    if (rowIndex>0) sheet.getRange(rowIndex,1,1,row.length).setValues([row]); else sheet.appendRow(row);
    cache.put(dedupeKey,fingerprint,21600);
    return { ok:true, message:'Đã đồng bộ tiến độ Google Sheets.' };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function getProgressSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(PROGRESS_SHEET);
  if (!sheet) sheet = spreadsheet.insertSheet(PROGRESS_SHEET);
  if (sheet.getLastRow()===0) {
    sheet.getRange(1,1,1,PROGRESS_HEADERS.length).setValues([PROGRESS_HEADERS]);
    sheet.getRange(1,1,1,PROGRESS_HEADERS.length).setFontWeight('bold').setBackground('#6454ed').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getUsersSheet_() {
  const spreadsheet=SpreadsheetApp.getActiveSpreadsheet();
  let sheet=spreadsheet.getSheetByName(USERS_SHEET);
  if (!sheet) sheet=spreadsheet.insertSheet(USERS_SHEET);
  if (sheet.getLastRow()===0) {
    sheet.getRange(1,1,1,USER_HEADERS.length).setValues([USER_HEADERS]);
    sheet.getRange(1,1,1,USER_HEADERS.length).setFontWeight('bold').setBackground('#302f4d').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  } else {
    const headers=sheet.getRange(1,1,1,Math.max(sheet.getLastColumn(),USER_HEADERS.length)).getValues()[0];
    if (headers.indexOf('username')<0) sheet.getRange(1,9).setValue('username');
  }
  return sheet;
}

function migrateUsernames_(sheet) {
  if (sheet.getLastRow()<2) return;
  const rows=sheet.getRange(2,1,sheet.getLastRow()-1,9).getValues();
  const used={};
  rows.forEach(function(row){ if (row[8]) used[normalizeUsername_(row[8])]=true; });
  rows.forEach(function(row,index){
    if (row[8]) return;
    let base=String(row[1]||'user').split('@')[0].toLowerCase().replace(/[^a-z0-9._]/g,'').slice(0,18);
    if (base.length<3) base='user'+String(index+1);
    let candidate=base, suffix=1;
    while (used[candidate]) { candidate=(base.slice(0,19)+suffix).slice(0,24); suffix++; }
    used[candidate]=true; sheet.getRange(index+2,9).setValue(candidate);
  });
}

function getSessionsSheet_() {
  const spreadsheet=SpreadsheetApp.getActiveSpreadsheet();
  let sheet=spreadsheet.getSheetByName(SESSIONS_SHEET);
  if (!sheet) sheet=spreadsheet.insertSheet(SESSIONS_SHEET);
  if (sheet.getLastRow()===0) {
    sheet.getRange(1,1,1,SESSION_HEADERS.length).setValues([SESSION_HEADERS]);
    sheet.getRange(1,1,1,SESSION_HEADERS.length).setFontWeight('bold').setBackground('#302f4d').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function output_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
