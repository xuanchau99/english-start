const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const MAX_BODY = 8 * 1024 * 1024;
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.webp':'image/webp' };

function readSecret(file, envName) {
  if (process.env[envName]) return process.env[envName].trim();
  try { return fs.readFileSync(path.join(ROOT, file), 'utf8').trim(); } catch (_) { return ''; }
}
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
  res.end(JSON.stringify(data));
}
function body(req) {
  return new Promise((resolve, reject) => {
    let value = '';
    req.on('data', chunk => { value += chunk; if (value.length > MAX_BODY) { reject(new Error('Dữ liệu quá lớn.')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(value || '{}')); } catch (_) { reject(new Error('JSON không hợp lệ.')); } });
    req.on('error', reject);
  });
}
function safeParse(text) {
  const clean = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/,'').trim();
  try { return JSON.parse(clean); }
  catch (_) {
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) try { return JSON.parse(match[0]); } catch (__) { /* fall through */ }
    return { text:clean, reply:clean };
  }
}
function requestText(url, options, redirects) {
  options = options || {}; redirects = redirects == null ? 4 : redirects;
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    const req = transport.request(target, { method:options.method || 'GET', headers:options.headers || {}, timeout:45000 }, res => {
      const location = res.headers.location;
      if (location && [301,302,303,307,308].includes(res.statusCode) && redirects > 0) {
        res.resume();
        const switchToGet = [301,302,303].includes(res.statusCode);
        return resolve(requestText(new URL(location,target).toString(), switchToGet ? { method:'GET' } : options, redirects - 1));
      }
      let value=''; res.setEncoding('utf8'); res.on('data',chunk => { value += chunk; });
      res.on('end',() => resolve({ ok:res.statusCode >= 200 && res.statusCode < 300, status:res.statusCode, text:value }));
    });
    req.on('timeout',() => req.destroy(new Error('Yêu cầu quá thời gian.'))); req.on('error',reject);
    if (options.body) req.write(options.body); req.end();
  });
}
function promptFor(mode, input, context, level) {
  const shared = `You are Mochi, an encouraging expert English coach for a Vietnamese learner at CEFR ${level || 'A1'}. Be specific, kind, concise, and pedagogically accurate. Never shame the learner. Return ONLY valid JSON without markdown fences. User input: ${JSON.stringify(String(input || '').slice(0,5000))}. Context: ${JSON.stringify(String(context || '').slice(0,2000))}.`;
  const prompts = {
    speaking: `${shared}\nEvaluate the learner's spoken performance. If audio is attached, listen to it and assess intelligibility, accuracy, rhythm, stress and specific sounds. The transcript may be incomplete, so prioritize the audio. If no audio is attached, clearly base feedback on the transcript. Return {"score":0-100,"title":"short Vietnamese title","strengths":["Vietnamese"],"improvements":["Vietnamese"],"corrected":"natural English sentence","pronunciation":"specific Vietnamese pronunciation tip"}.`,
    writing: `${shared}\nCorrect grammar, word choice, clarity and naturalness while preserving meaning and appropriate level. Return {"score":0-100,"title":"short Vietnamese title","strengths":["Vietnamese"],"improvements":["Vietnamese"],"corrected":"complete corrected English version","explanation":"short Vietnamese explanation"}.`,
    chat: `${shared}\nFollow the roleplay in Context. Reply mainly in simple English. Return {"reply":"1-2 short English sentences","correction":"optional short Vietnamese correction, empty if not needed","suggestions":["two possible short English replies"]}.`
  };
  return prompts[mode] || `${shared}\nReturn {"text":"concise response"}.`;
}

async function callGemini(payload) {
  const key = readSecret('key_ai.txt', 'GEMINI_API_KEY');
  if (!key) throw new Error('Không tìm thấy Gemini API key trong key_ai.txt.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  const parts = [{ text:promptFor(payload.mode, payload.input, payload.context, payload.level) }];
  if (payload.mode === 'speaking' && payload.audioData) {
    if (!/^[A-Za-z0-9+/=]+$/.test(payload.audioData) || payload.audioData.length > 7.5 * 1024 * 1024) throw new Error('Dữ liệu ghi âm không hợp lệ hoặc quá lớn.');
    parts.push({ inlineData:{ mimeType:String(payload.audioMime || 'audio/webm').split(';')[0], data:payload.audioData } });
  }
  const response = await requestText(url, {
    method:'POST', headers:{ 'Content-Type':'application/json', 'x-goog-api-key':key },
    body:JSON.stringify({
      contents:[{ role:'user', parts }],
      generationConfig:{ maxOutputTokens:2048, responseMimeType:'application/json', thinkingConfig:{ thinkingLevel:'minimal' } }
    })
  });
  let data; try { data=JSON.parse(response.text); } catch (_) { data={}; }
  if (!response.ok) throw new Error(data.error?.message || `Gemini API trả về lỗi ${response.status}.`);
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  if (!text) throw new Error('Gemini không trả về nội dung.');
  return safeParse(text);
}

async function syncSheets(payload) {
  const url = readSecret('sheet_config.txt', 'SHEETS_WEB_APP_URL');
  if (!url) throw new Error('Chưa cấu hình URL Google Sheets Web App.');
  const response = await requestText(url, { method:'POST', headers:{ 'Content-Type':'text/plain;charset=utf-8' }, body:JSON.stringify(payload) });
  const text = response.text;
  if (!response.ok) throw new Error(`Google Sheets trả về lỗi ${response.status}.`);
  let result; try { result = JSON.parse(text); } catch (_) { result = { ok:true, message:'Đã gửi dữ liệu tới Google Sheets.' }; }
  if (result.ok === false) throw new Error(result.error || 'Google Sheets không thể lưu dữ liệu.');
  return result;
}

function serveStatic(req, res) {
  let requestPath;
  try { requestPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname); }
  catch (_) { return json(res,400,{ error:'Đường dẫn không hợp lệ.' }); }
  if (requestPath === '/') requestPath = '/index.html';
  const resolved = path.resolve(ROOT, '.' + requestPath);
  if (!resolved.startsWith(path.resolve(ROOT) + path.sep) || /(?:key_ai|sheet_config)\.txt$/i.test(resolved)) return json(res,403,{ error:'Không có quyền truy cập.' });
  fs.stat(resolved, (err, stat) => {
    if (err || !stat.isFile()) return json(res,404,{ error:'Không tìm thấy tài nguyên.' });
    const headers = { 'Content-Type':MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream', 'X-Content-Type-Options':'nosniff' };
    if (/\.(?:png|jpg|jpeg|webp|css|js)$/i.test(resolved)) headers['Cache-Control']='public, max-age=3600';
    res.writeHead(200, headers); fs.createReadStream(resolved).pipe(res);
  });
}

const server = http.createServer(async (req,res) => {
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (pathname === '/api/status' && req.method === 'GET') return json(res,200,{ gemini:!!readSecret('key_ai.txt','GEMINI_API_KEY'), sheets:!!readSecret('sheet_config.txt','SHEETS_WEB_APP_URL'), model:GEMINI_MODEL });
  if (pathname === '/api/gemini' && req.method === 'POST') {
    try { const payload=await body(req); if (!['speaking','writing','chat'].includes(payload.mode)) return json(res,400,{error:'Chế độ AI không hợp lệ.'}); return json(res,200,await callGemini(payload)); }
    catch(e) { console.error('[Gemini]',e.message); return json(res,502,{error:e.message}); }
  }
  if (pathname === '/api/sync' && req.method === 'POST') {
    try { const payload=await body(req); if (!payload.userId) return json(res,400,{error:'Thiếu mã người học.'}); return json(res,200,await syncSheets(payload)); }
    catch(e) { console.error('[Sheets]',e.message); return json(res,502,{error:e.message}); }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res,405,{error:'Phương thức không được hỗ trợ.'});
  serveStatic(req,res);
});
server.listen(PORT, () => console.log(`FluentGo đang chạy tại http://localhost:${PORT}`));
