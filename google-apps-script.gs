/**
 * FluentGo secure backend for GitHub Pages.
 * Apps Script xử lý tài khoản, tiến độ và proxy Gemini an toàn cho GitHub Pages.
 * Google Sheet là nguồn cấu hình; Script Properties + CacheService tránh đọc Sheet mỗi request.
 */
const PROGRESS_SHEET = 'FluentGo Progress';
const CONFIG_SHEET = 'FluentGo Config';
const USERS_SHEET = 'FluentGo Users';
const SESSIONS_SHEET = 'FluentGo Sessions';
const SESSION_DAYS = 30;
const CONFIG_CACHE_KEY = 'fluentgo_config_v3';
const CONFIG_PROPERTY_KEY = 'FLUENTGO_CONFIG_SNAPSHOT_V1';
const CONFIG_CACHE_SECONDS = 21600;
const PROGRESS_HEADERS = [
  'userId','name','level','xp','streak','longestStreak','minutesWeek',
  'dailyGoal','completedToday','completedLessons','wordsLearned','lastActive','syncedAt','rawJson',
  'visitDays','totalAccessSeconds','totalAccessHours'
];
const USER_HEADERS = ['userId','email','displayName','passwordSalt','passwordHash','createdAt','lastLogin','status','username'];
const SESSION_HEADERS = ['tokenHash','userId','createdAt','expiresAt','status'];
const CONFIG_DEFAULTS = [
  ['KEY','VALUE','MÔ TẢ'],
  ['GEMINI_API_KEY','','Dán Gemini API key vào đây; key không được gửi xuống trình duyệt'],
  ['GEMINI_MODEL','gemini-3.5-flash','Model Gemini sử dụng'],
  ['APP_SCRIPT_KEY','','Khóa nội bộ, được tạo tự động khi chạy setupFluentGo'],
  ['DAILY_AI_LIMIT','100','Số lượt AI tối đa mỗi user mỗi ngày'],
  ['AI_REQUESTS_PER_MINUTE','6','Số request AI tối đa mỗi user mỗi phút'],
  ['GLOBAL_AI_REQUESTS_PER_MINUTE','60','Tổng request AI tối đa toàn app mỗi phút'],
  ['SYNC_REQUESTS_PER_MINUTE','10','Số lần đồng bộ tối đa mỗi user mỗi phút'],
  ['GLOBAL_REQUESTS_PER_MINUTE','180','Tổng request bridge tối đa toàn app mỗi phút']
];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('FluentGo')
    .addItem('Khởi tạo / kiểm tra cấu hình', 'setupFluentGo')
    .addItem('Nạp lại cấu hình từ Sheet', 'reloadFluentGoConfig')
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
  }
  getProgressSheet_();
  migrateUsernames_(getUsersSheet_());
  getSessionsSheet_();
  refreshConfigFromSheet_();
  SpreadsheetApp.getUi().alert('Đã khởi tạo FluentGo. Hãy dán GEMINI_API_KEY vào cột VALUE rồi chạy “Nạp lại cấu hình từ Sheet”.');
}

function reloadFluentGoConfig() {
  const config=refreshConfigFromSheet_();
  SpreadsheetApp.getUi().alert(config.GEMINI_API_KEY ? 'Đã nạp cấu hình. Gemini proxy sẵn sàng.' : 'Đã nạp cấu hình nhưng GEMINI_API_KEY đang trống.');
}

function doGet(e) {
  if (e && e.parameter && e.parameter.bridge === '1') return bridgePage_();
  const config = getConfig_();
  return output_({
    ok:true,
    service:'FluentGo Apps Script Backend',
    configured:!!config.GEMINI_API_KEY,
    geminiProxy:true,
    model:config.GEMINI_MODEL || 'gemini-3.5-flash'
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
    if (action === 'status') return { ok:true, gemini:!!config.GEMINI_API_KEY, sheets:true, auth:true, mode:'secure-gemini-proxy', model:config.GEMINI_MODEL || 'gemini-3.5-flash' };
    if (action === 'register') return registerUser_(payload,config);
    if (action === 'login') return loginUser_(payload,config);
    if (action === 'restore') return restoreSession_(request.sessionToken,config);
    if (action === 'logout') return logoutUser_(request.sessionToken,config);
    const account=authenticate_(request.sessionToken,config);
    if (action === 'progress') return { ok:true, user:publicUser_(account), progress:getProgress_(account.userId) };
    if (action === 'profile') { enforceActionRate_(account.userId,'profile',4); return updateProfile_(account,payload); }
    if (action === 'sync') { enforceActionRate_(account.userId,'sync',Number(config.SYNC_REQUESTS_PER_MINUTE)||10); payload.userId=account.userId; payload.name=account.displayName; return saveProgress_(payload); }
    if (action === 'gemini') {
      if (!config.GEMINI_API_KEY) throw new Error('Quản trị viên chưa cấu hình GEMINI_API_KEY trong FluentGo Config.');
      payload.userId=account.userId;
      enforceActionRate_(account.userId,'gemini',Number(config.AI_REQUESTS_PER_MINUTE)||6);
      enforceActionRate_('all-users','gemini-global',Number(config.GLOBAL_AI_REQUESTS_PER_MINUTE)||60);
      enforceDailyLimit_(account.userId,Number(config.DAILY_AI_LIMIT)||100);
      return callGeminiWithRefresh_(payload,config);
    }
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
  const cached=cache.get(CONFIG_CACHE_KEY);
  if (cached) try { return JSON.parse(cached); } catch (_) {}
  const stored=PropertiesService.getScriptProperties().getProperty(CONFIG_PROPERTY_KEY);
  if (stored) try {
    const config=JSON.parse(stored);
    cache.put(CONFIG_CACHE_KEY,JSON.stringify(config),CONFIG_CACHE_SECONDS);
    return config;
  } catch (_) {}
  return refreshConfigFromSheet_();
}

function refreshConfigFromSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_SHEET);
  if (!sheet) return {};
  const values = sheet.getDataRange().getDisplayValues();
  const config = {};
  for (let i=1; i<values.length; i++) if (values[i][0]) config[String(values[i][0]).trim()] = String(values[i][1] || '').trim();
  const serialized=JSON.stringify(config);
  PropertiesService.getScriptProperties().setProperty(CONFIG_PROPERTY_KEY,serialized);
  CacheService.getScriptCache().put(CONFIG_CACHE_KEY,serialized,CONFIG_CACHE_SECONDS);
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
  clearAuthLimit_('login_'+identifier);
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

function clearAuthLimit_(identity) {
  const key='auth_'+Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(identity),Utilities.Charset.UTF_8)).slice(0,40);
  CacheService.getScriptCache().remove(key);
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

function promptFor_(mode,input,context,level) {
  const shared='You are Mochi, an encouraging expert English coach for a Vietnamese learner at CEFR '+(level||'A1')+
    '. Be specific, kind, concise and accurate. Never shame the learner. Return ONLY valid JSON without markdown. Every JSON field must contain its final plain-text value; never put JSON or a stringified object inside reply, text, correction, suggestions, or review. User input: '+
    JSON.stringify(String(input||'').slice(0,5000))+'. Context: '+JSON.stringify(String(context||'').slice(0,2500))+'.';
  if (mode==='speaking') return shared+' Listen to the attached audio when present and compare it word-for-word with the complete target sentence in Context. The learner must say every target word in the correct order. Return contentScore=100 only when the complete sentence was spoken without missing, added or replaced words. Return pronunciationScore for individual sounds and stress, fluencyScore for rhythm/pauses, and score as the strict overall result. If any required word is missing, added incorrectly or replaced, contentScore must be below 100 and score must not exceed 79. A pronunciationScore below 80 must not pass. Do not reward fluent speech that says a different sentence. Return {"score":0-100,"contentScore":0-100,"pronunciationScore":0-100,"fluencyScore":0-100,"missingWords":["English word"],"title":"Vietnamese","strengths":["Vietnamese"],"improvements":["Vietnamese"],"corrected":"complete target English","pronunciation":"Vietnamese tip"}.';
  if (mode==='writing') return shared+' Correct grammar, word choice, organization and naturalness while preserving meaning. Return {"score":0-100,"title":"Vietnamese","strengths":["Vietnamese"],"improvements":["Vietnamese"],"corrected":"complete corrected English","explanation":"Vietnamese"}.';
  if (mode==='explain') return shared+' Explain why the supplied answer is correct and why common alternatives are wrong. Adapt to the learner level, give one memorable rule and one new example. Return {"score":100,"title":"Hiểu sâu đáp án","strengths":["Điểm người học cần ghi nhớ bằng tiếng Việt"],"improvements":["Lỗi dễ nhầm bằng tiếng Việt"],"corrected":"One short correct English example","explanation":"Concise Vietnamese explanation"}.';
  if (mode==='exercise') return shared+' Create 6 useful, non-repetitive exercises for the supplied learning goal, topic and requested type. Use realistic situations and CEFR-appropriate English. All questions and answer options must be English, except a translation prompt may be Vietnamese. Every answer must exactly match one option. Mix comprehension and production-oriented thinking; avoid trivial distractors. Return {"title":"short English set title","exercises":[{"type":"listening|reading|cloze|grammar|translation|ordering|matching|dictation","question":"question","options":["option 1","option 2","option 3"],"answer":"exact option","explanation":"concise Vietnamese explanation","audio":"optional English audio script","passage":"optional English passage"}]}.';
  return shared+' Roleplay according to Context using simple English. If the input is an instruction to begin the roleplay, set score to null and review to null. Otherwise evaluate the learner sentence. Return {"reply":"1-2 short English sentences continuing the roleplay","correction":"short optional Vietnamese correction","suggestions":["short English reply 1","short English reply 2","short English reply 3"],"score":0-100,"review":{"grammar":"concise Vietnamese feedback","spelling":"concise Vietnamese feedback","naturalness":"concise Vietnamese feedback","pronunciation":"Vietnamese stress or sound tip","better_version":"natural corrected English sentence"}}.';
}

function callGeminiWithRefresh_(payload,config) {
  try {
    return callGemini_(payload,config);
  } catch (error) {
    if (!isGeminiCredentialError_(error)) throw error;
    const refreshed=refreshConfigFromSheet_();
    const keyChanged=String(refreshed.GEMINI_API_KEY||'')!==String(config.GEMINI_API_KEY||'');
    const modelChanged=String(refreshed.GEMINI_MODEL||'')!==String(config.GEMINI_MODEL||'');
    if (refreshed.GEMINI_API_KEY && (keyChanged||modelChanged)) return callGemini_(payload,refreshed);
    throw new Error('Gemini từ chối key hoặc quyền hiện tại. Hãy cập nhật GEMINI_API_KEY trong FluentGo Config; backend sẽ tự nạp lại ở lần gọi tiếp theo.');
  }
}

function isGeminiCredentialError_(error) {
  const status=Number(error && error.geminiStatus)||0;
  const message=String(error && error.message || '');
  return [400,401,403].indexOf(status)>=0 && /API.?key|credential|authentication|unauthenticated|permission|denied|leaked|blocked/i.test(message);
}

function callGemini_(payload,config) {
  const mode=String(payload.mode||'');
  if (['speaking','writing','chat','explain','exercise'].indexOf(mode)<0) throw new Error('Chế độ AI không hợp lệ.');
  const parts=[{text:promptFor_(mode,payload.input,payload.context,payload.level)}];
  if (mode==='speaking' && payload.audioData) {
    if (String(payload.audioData).length>7500000) throw new Error('Đoạn ghi âm quá lớn. Hãy ghi âm ngắn hơn.');
    parts.push({inlineData:{mimeType:String(payload.audioMime||'audio/webm').split(';')[0],data:String(payload.audioData)}});
  }
  const model=String(config.GEMINI_MODEL||'gemini-3.5-flash');
  const url='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent';
  const response=UrlFetchApp.fetch(url,{
    method:'post',contentType:'application/json',muteHttpExceptions:true,
    headers:{'x-goog-api-key':String(config.GEMINI_API_KEY||'')},
    payload:JSON.stringify({contents:[{role:'user',parts:parts}],generationConfig:{maxOutputTokens:2048,responseMimeType:'application/json'}})
  });
  const status=response.getResponseCode();
  let data={};
  try { data=JSON.parse(response.getContentText()); } catch (_) {}
  if (status<200||status>=300) {
    const error=new Error((data.error&&data.error.message)||('Gemini API lỗi '+status));
    error.geminiStatus=status;
    throw error;
  }
  const responseParts=data.candidates&&data.candidates[0]&&data.candidates[0].content&&data.candidates[0].content.parts||[];
  const text=responseParts.map(function(part){return part.text||'';}).join('');
  if (!text) throw new Error('Gemini không trả về nội dung.');
  return Object.assign({ok:true},normalizeGeminiPayload_(safeJson_(text)));
}

function normalizeGeminiPayload_(input) {
  let value=input&&typeof input==='object'?Object.assign({},input):{text:String(input||'')};
  const seen={};
  for (let i=0;i<8;i++) {
    const candidates=[value.reply,value.text,value.data,value.result,value.response,value.content,value.output];
    let nested=null;
    for (let j=0;j<candidates.length;j++) {
      if (candidates[j]&&typeof candidates[j]==='object') { nested=candidates[j]; break; }
      nested=safeJsonObject_(candidates[j]);
      if (nested) break;
    }
    if (!nested) break;
    let signature='';
    try { signature=JSON.stringify(nested); } catch (_) {}
    if (signature&&seen[signature]) break;
    if (signature) seen[signature]=true;
    value=Object.assign({},value,nested);
  }
  if (value.reply&&typeof value.reply==='object') value=Object.assign({},value,value.reply);
  if (typeof value.reply!=='string'&&typeof value.text==='string') value.reply=value.text;
  return value;
}

function safeJson_(text) {
  let value=String(text||'').trim();
  for (let i=0;i<4;i++) {
    if (typeof value!=='string') break;
    const clean=value.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
    try { value=JSON.parse(clean); continue; } catch (_) {
      const start=clean.indexOf('{'),end=clean.lastIndexOf('}');
      if (start>=0&&end>start) try { value=JSON.parse(clean.slice(start,end+1)); continue; } catch (__) {}
      value=clean; break;
    }
  }
  if (value&&typeof value==='object') {
    if (typeof value.reply==='string') { const nested=safeJsonObject_(value.reply); if (nested) value=Object.assign({},value,nested); }
    if (typeof value.text==='string'&&!value.reply) { const nestedText=safeJsonObject_(value.text); if (nestedText) value=Object.assign({},value,nestedText); }
    return value;
  }
  return {text:String(value||''),reply:String(value||'')};
}

function safeJsonObject_(value) {
  if (typeof value!=='string') return value&&typeof value==='object'?value:null;
  let clean=String(value).replace(/^\uFEFF/,'').replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  for (let i=0;i<8;i++) {
    try {
      const parsed=JSON.parse(clean);
      if (parsed&&typeof parsed==='object') return parsed;
      if (typeof parsed==='string') { clean=parsed.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim(); continue; }
      return null;
    } catch (_) { break; }
  }
  try { const parsed=JSON.parse(clean); return parsed&&typeof parsed==='object'?parsed:null; }
  catch (_) {
    const start=clean.indexOf('{'),end=clean.lastIndexOf('}');
    if (start>=0&&end>start) try { const parsed=JSON.parse(clean.slice(start,end+1)); return parsed&&typeof parsed==='object'?parsed:null; } catch (__) {}
    return null;
  }
}

function enforceDailyLimit_(userId,limit) {
  const date=Utilities.formatDate(new Date(),Session.getScriptTimeZone()||'Asia/Ho_Chi_Minh','yyyyMMdd');
  const digest=Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(userId),Utilities.Charset.UTF_8)).slice(0,45);
  const key='ai_daily_'+digest,properties=PropertiesService.getScriptProperties();
  let record={date:date,count:0};
  try { record=JSON.parse(properties.getProperty(key)||'null')||record; } catch (_) {}
  if (record.date!==date) record={date:date,count:0};
  if (Number(record.count)>=Math.max(1,Number(limit)||1)) throw new Error('Bạn đã dùng hết lượt AI hôm nay. Hãy quay lại vào ngày mai.');
  record.count=Number(record.count)+1;
  properties.setProperty(key,JSON.stringify(record));
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
    const visitDates=Array.isArray(data.visitDates)?data.visitDates.filter(function(value,index,values){return value&&values.indexOf(value)===index;}):[];
    const totalAccessSeconds=Math.max(0,Math.round(Number(data.totalActiveSeconds)||0));
    const row = [
      data.userId,data.name||'',data.level||'A1',Number(data.xp)||0,Number(data.streak)||0,
      Number(data.longestStreak)||0,Number(data.minutesWeek)||0,Number(data.dailyGoal)||15,
      JSON.stringify(data.completedToday||[]),JSON.stringify(data.completedLessons||[]),
      Number(data.wordsLearned)||0,data.lastActive||'',data.syncedAt||new Date().toISOString(),JSON.stringify(data),
      visitDates.length,totalAccessSeconds,Math.round(totalAccessSeconds/36)/100
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
  } else {
    const headers=sheet.getRange(1,1,1,Math.max(sheet.getLastColumn(),PROGRESS_HEADERS.length)).getValues()[0];
    PROGRESS_HEADERS.forEach(function(header,index){ if (headers.indexOf(header)<0) sheet.getRange(1,index+1).setValue(header); });
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
