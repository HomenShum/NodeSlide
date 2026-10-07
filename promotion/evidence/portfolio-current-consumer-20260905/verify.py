"""Verify the evidence bytes and normalized current Git source identities.

Run this copied verifier from any directory. It never executes historical scripts,
loads private browser state, installs packages, or changes the checkout.
"""
from pathlib import Path
import hashlib,json,subprocess,sys

packet=Path(__file__).resolve().parent
repo=packet.parents[2]
manifest=json.loads((packet/'manifest.json').read_text(encoding='utf-8'))
failures=[]
for entry in manifest['payloads']:
    target=(packet/entry['path']).resolve()
    if not target.is_relative_to(packet):
        failures.append({'path':entry['path'],'reason':'outside-packet'})
    elif not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest()!=entry['sha256']:
        failures.append({'path':entry['path'],'reason':'missing-or-byte-mismatch'})
for entry in manifest['source']:
    target=(repo/entry['path']).resolve()
    if not target.is_relative_to(repo) or not target.is_file():
        failures.append({'path':entry['path'],'reason':'missing-or-outside-repository'})
        continue
    result=subprocess.run(['git','hash-object','--path',entry['path'],entry['path']],cwd=repo,text=True,capture_output=True)
    if result.returncode or result.stdout.strip()!=entry['gitBlobSha1']:
        failures.append({'path':entry['path'],'reason':'current-source-identity-differs'})
print(json.dumps({'status':'PASS' if not failures else 'FAIL','payloads':len(manifest['payloads']),'source':len(manifest['source']),'failures':failures},indent=2))
sys.exit(bool(failures))
