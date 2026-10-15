#!/usr/bin/env python3
"""Read-only production checks against an explicitly maintained release baseline."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import time
import urllib.error
import urllib.request

TIMEOUT = 20
ATTEMPTS = 3
USER_AGENT = 'Mozilla/5.0 (compatible; DexLadderProductionHealth/1.0)'
RUM = re.compile(rb'\n<script async id="netlify-rum-container" src="/\.netlify/scripts/rum" data-netlify-rum-site-id="7f8be369-fe1c-4277-9cad-ff33c1b9f840" data-netlify-deploy-branch="[^"]*" data-netlify-deploy-context="[^"]*" data-netlify-cwv-token="[A-Za-z0-9_.-]+"></script>\n')


def normalize_home(body, origin):
    # Only the observed host-owned empty RUM script is removable; never arbitrary scripts.
    if origin != 'https://dexladder.com':
        return body
    return RUM.sub(b'', body)


def fetch(origin, path):
    request = urllib.request.Request(origin + path, headers={'User-Agent': USER_AGENT})
    try:
        response = urllib.request.urlopen(request, timeout=TIMEOUT)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return {'status': response.code, 'url': response.geturl(),
                'headers': {k.lower(): v for k, v in response.headers.items()},
                'body': response.read()}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate(origin, path, response, baseline):
    status, body, headers = response['status'], response['body'], response['headers']
    expected = 404 if path == '/production-health-missing-page' else 503 if path == '/api/unknown' else 200
    require(status == expected, f'HTTP {status}, expected {expected}')
    require(response['url'].startswith(origin + '/'), 'Unexpected host or HTTPS downgrade')
    content_type = headers.get('content-type', '').lower()
    if path.startswith('/api/'):
        require('application/json' in content_type, 'API is not JSON')
        data = json.loads(body)
        require(isinstance(data, dict), 'API body is not an object')
        if path == '/api/news':
            ok = data.get('ok')
            require((ok is True or (type(ok) is int and ok > 0)) and isinstance(data.get('items'), list) and bool(data['items']), 'News has no successful items')
        else:
            require(data.get('ok') is False and data.get('error') == 'not-deployed', 'Unavailable API contract changed')
        return {'items': len(data.get('items', []))}
    if path == '/sw.js':
        require('javascript' in content_type, 'Worker is not JavaScript')
        require(hashlib.sha256(body).hexdigest() == baseline['worker_sha256'], 'Worker bytes differ from verified release')
        require('no-store' in headers.get('cache-control', '').lower(), 'Worker lacks no-store')
        for key, value in [('SW_BUILD', baseline['build']), ('SW_REV', str(baseline['worker_revision'])), ('PAYLOAD_SHA', baseline['artifact_sha256'])]:
            match = re.search(rb'const\s+' + key.encode() + rb'\s*=\s*[\x27\x22]?([\w-]+)', body)
            require(match is not None and match.group(1).decode() == value, f'Worker {key} differs from baseline')
        require(b'// Only app entry points may fall back to the offline app shell.' in body, 'Worker missing 404 navigation guard')
        return {'sha256': hashlib.sha256(body).hexdigest()}
    if path == '/sitemap.xml':
        import xml.etree.ElementTree as ET
        root = ET.fromstring(body)
        locations = [e.text for e in root.iter('{http://www.sitemaps.org/schemas/sitemap/0.9}loc')]
        require(len(locations) >= 100 and 'https://www.dexladder.com/tools/dca-calculator/' in locations, 'Sitemap routes missing')
        return {'locations': len(locations)}
    require('text/html' in content_type, 'Page is not HTML')
    text = body.decode('utf-8')
    if path == '/':
        require('<title>Crypto Paper Trading &amp; Free Calculators | DexLadder</title>' in text, 'Homepage title changed')
        require(f'<meta name="cb:build" content="{baseline["build"]}">' in text, 'Homepage build differs')
        require('<nav id="dl-resource-links"' in text and '<nav id="dl-resource-hubs"' in text, 'Crawlable resource links missing')
        for marker in ['DLPRACTICE', 'DLGASLAB', 'DLFLOW', 'DLSHORTCUTS', 'dlExecutionLessons', 'dlBuildHash']:
            require(marker in text, f'Homepage missing {marker}')
        sha = hashlib.sha256(normalize_home(body, origin)).hexdigest()
        require(sha == baseline['artifact_sha256'], 'Homepage normalized SHA differs from baseline')
        return {'normalized_sha256': sha, 'delivered_sha256': hashlib.sha256(body).hexdigest()}
    marker = {'/tools/dca-calculator/': 'Crypto DCA Calculator', '/guides/': 'Crypto Trading Guides',
              '/privacy/': 'Privacy Policy', '/production-health-missing-page': 'Page not found'}[path]
    require(marker.lower() in text.lower() and len(body) > 200, 'Page content missing')
    require('<meta name="cb:build"' not in text, 'Content route returned app shell')
    return {'bytes': len(body)}


def check(origin, path, baseline, fetcher=fetch, sleeper=time.sleep):
    errors = []
    for attempt in range(1, ATTEMPTS + 1):
        try:
            details = validate(origin, path, fetcher(origin, path), baseline)
            return {'origin': origin, 'path': path, 'passed': True, 'attempts': attempt, **details}
        except Exception as error:
            errors.append(str(error))
            if attempt < ATTEMPTS:
                sleeper(2)
    return {'origin': origin, 'path': path, 'passed': False, 'attempts': ATTEMPTS, 'errors': errors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', type=Path, default=Path(__file__).resolve().parents[1] / 'docs/production-health-baseline.json')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    baseline = json.loads(args.baseline.read_text())
    paths = ['/', '/sw.js', '/tools/dca-calculator/', '/guides/', '/privacy/', '/sitemap.xml', '/production-health-missing-page', '/api/news', '/api/unknown']
    targets = [(origin, path) for origin in baseline['origins'] for path in paths]
    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(lambda target: check(*target, baseline), targets))
    report = {'baseline': baseline, 'checked_at_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'passed': all(r['passed'] for r in results), 'checks': results}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    for result in results:
        print(('PASS' if result['passed'] else 'FAIL'), result['origin'] + result['path'], '; '.join(result.get('errors', [])))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
