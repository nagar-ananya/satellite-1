#!/usr/bin/env python3
"""Static file server with live-reload (polls /__version__ endpoint)."""
import http.server, socketserver, sys, os, time, threading, json
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
WATCH_DIR = Path('.')
WATCH_EXTS = {'.html', '.js', '.css'}

_version = [int(time.time() * 1000)]
_lock    = threading.Lock()

def _mtimes():
    out = {}
    for ext in WATCH_EXTS:
        for p in WATCH_DIR.rglob(f'*{ext}'):
            try: out[str(p)] = p.stat().st_mtime
            except: pass
    return out

def _watcher():
    prev = _mtimes()
    while True:
        time.sleep(0.4)
        curr = _mtimes()
        if curr != prev:
            with _lock:
                _version[0] = int(time.time() * 1000)
            prev = curr

RELOAD_SCRIPT = b"""<script>
(function(){
  var v=null;
  function poll(){
    fetch('/__version__').then(r=>r.json()).then(function(n){
      if(v===null){v=n;}else if(n!==v){location.reload();}
      setTimeout(poll,500);
    }).catch(function(){setTimeout(poll,1500);});
  }
  poll();
})();
</script>"""

class Handler(http.server.SimpleHTTPRequestHandler):
    # Ensure the browser never serves a stale script/style during development.
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def do_GET(self):
        if self.path == '/__version__':
            with _lock:
                data = json.dumps(_version[0]).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        # For HTML responses, inject the live-reload script before </body>
        fspath = self.translate_path(self.path)
        if os.path.isdir(fspath):
            fspath = os.path.join(fspath, 'index.html')
        if fspath.endswith('.html') and os.path.isfile(fspath):
            with open(fspath, 'rb') as f:
                body = f.read()
            body = body.replace(b'</body>', RELOAD_SCRIPT + b'\n</body>')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        super().do_GET()

    def log_message(self, fmt, *args):
        path = args[0] if args else ''
        if '/__version__' not in path:
            print(f'  {args[1] if len(args)>1 else ""} {path}')

threading.Thread(target=_watcher, daemon=True).start()

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('', PORT), Handler) as httpd:
    print(f'Serving at http://localhost:{PORT}  [live-reload on]')
    httpd.serve_forever()
