'use strict';

const http=require('http');
const fs=require('fs');
const path=require('path');

const PORT=Number(process.env.PORT)||3000;
const ROOT=__dirname;
const MIME={
  '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8',
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml',
  '.ico':'image/x-icon','.webp':'image/webp'
};

function json(res,status,data) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(data));
}

function serveStatic(req,res) {
  let requestPath;
  try { requestPath=decodeURIComponent(new URL(req.url,`http://${req.headers.host||'localhost'}`).pathname); }
  catch (_) { return json(res,400,{error:'Đường dẫn không hợp lệ.'}); }
  if (requestPath==='/') requestPath='/index.html';
  const resolved=path.resolve(ROOT,'.'+requestPath);
  if (!resolved.startsWith(path.resolve(ROOT)+path.sep)||/(?:key_ai|sheet_config)\.txt$/i.test(resolved)) return json(res,403,{error:'Không có quyền truy cập.'});
  fs.stat(resolved,(error,stat)=>{
    if (error||!stat.isFile()) return json(res,404,{error:'Không tìm thấy tài nguyên.'});
    const headers={'Content-Type':MIME[path.extname(resolved).toLowerCase()]||'application/octet-stream','X-Content-Type-Options':'nosniff'};
    if (/\.(?:png|jpg|jpeg|webp|css|js)$/i.test(resolved)) headers['Cache-Control']='public, max-age=3600';
    res.writeHead(200,headers);
    if (req.method==='HEAD') return res.end();
    fs.createReadStream(resolved).pipe(res);
  });
}

const server=http.createServer((req,res)=>{
  if (req.method!=='GET'&&req.method!=='HEAD') return json(res,405,{error:'Phương thức không được hỗ trợ.'});
  serveStatic(req,res);
});

server.listen(PORT,()=>console.log(`FluentGo đang chạy tại http://localhost:${PORT}`));
