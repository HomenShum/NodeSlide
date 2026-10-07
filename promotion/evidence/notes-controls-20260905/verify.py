"""Read-only raw evidence and current normalized Git identity verifier."""
from pathlib import Path
import hashlib,json,subprocess,sys
packet=Path(__file__).resolve().parent
repo=packet.parents[2]
manifest=json.loads((packet/'manifest.json').read_text(encoding='utf-8'))
failures=[]
for entry in manifest['payloads']:
    target=(packet/entry['path']).resolve()
    if not target.is_relative_to(packet) or not target.is_file():
        failures.append({'path':entry['path'],'reason':'missing-or-outside-packet'});continue
    data=target.read_bytes()
    if hashlib.sha256(data).hexdigest()!=entry['sha256']:
        failures.append({'path':entry['path'],'reason':'raw-bytes-differ'})
    rel=target.relative_to(repo).as_posix()
    result=subprocess.run(['git','--no-optional-locks','hash-object','--path',rel,rel],cwd=repo,capture_output=True,text=True,timeout=15)
    if result.returncode or result.stdout.strip()!=entry['gitBlobSha1']:
        failures.append({'path':entry['path'],'reason':'git-blob-differs'})
for entry in manifest['source']:
    target=(repo/entry['path']).resolve()
    if not target.is_relative_to(repo) or not target.is_file():
        failures.append({'path':entry['path'],'reason':'missing-or-outside-repo'});continue
    result=subprocess.run(['git','--no-optional-locks','hash-object','--path',entry['path'],entry['path']],cwd=repo,capture_output=True,text=True,timeout=15)
    if result.returncode or result.stdout.strip()!=entry['gitBlobSha1']:
        failures.append({'path':entry['path'],'reason':'current-source-differs'})
print(json.dumps({'status':'FAIL' if failures else 'PASS','payloads':len(manifest['payloads']),'source':len(manifest['source']),'failures':failures},indent=2))
sys.exit(bool(failures))
