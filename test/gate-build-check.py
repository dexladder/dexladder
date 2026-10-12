"""Verify --check is deterministic and never writes, even with DL_MINT."""
import hashlib, os, pathlib, re, subprocess
root = pathlib.Path(__file__).resolve().parents[1]
paths = [root / 'dist/index.html', root / 'dist/sw.js']
before = [(p.read_bytes(), p.stat().st_mtime_ns) for p in paths]
run = subprocess.run(['python3', str(root / 'build154.py'), '--check'], env={**os.environ, 'DL_MINT': '1'}, capture_output=True, text=True, check=True)
sha = re.search(r'sha256=([0-9a-f]{64})', run.stdout).group(1)
assert sha == hashlib.sha256(paths[0].read_bytes()).hexdigest()
assert before == [(p.read_bytes(), p.stat().st_mtime_ns) for p in paths]
print('build --check: digest matches; payload and worker bytes/mtimes unchanged')
