import hashlib
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock
spec = importlib.util.spec_from_file_location('health', Path(__file__).resolve().parents[1] / 'tools/production_health.py')
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)
ORIGIN = 'https://dexladder.com'
RUM = b'\n<script async id="netlify-rum-container" src="/.netlify/scripts/rum" data-netlify-rum-site-id="7f8be369-fe1c-4277-9cad-ff33c1b9f840" data-netlify-deploy-branch="" data-netlify-deploy-context="production" data-netlify-cwv-token="abc.def-ghi"></script>\n'


def response(body, status=200, content_type='text/html', path='/'):
    return {'body': body, 'status': status, 'headers': {'content-type': content_type}, 'url': ORIGIN + path}


class ProductionHealth(unittest.TestCase):
    def setUp(self):
        self.home = b'<title>Crypto Paper Trading &amp; Free Calculators | DexLadder</title><meta name="cb:build" content="v167"><nav id="dl-resource-links"></nav><nav id="dl-resource-hubs"></nav>DLPRACTICE DLGASLAB DLFLOW DLSHORTCUTS dlExecutionLessons dlBuildHash'
        self.baseline = {'build': 'v167', 'artifact_sha256': hashlib.sha256(self.home).hexdigest(), 'worker_revision': 26}

    def test_exact_known_rum_and_multiple_insertions(self):
        self.assertEqual(health.normalize_home(self.home + RUM + RUM, ORIGIN), self.home)
        self.assertEqual(health.normalize_home(self.home + RUM, 'https://www.dexladder.com'), self.home + RUM)
        unknown = RUM.replace(b'/.netlify/scripts/rum', b'https://evil.example/script')
        self.assertEqual(health.normalize_home(self.home + unknown, ORIGIN), self.home + unknown)

    def test_home_hash_status_and_https(self):
        health.validate(ORIGIN, '/', response(self.home + RUM), self.baseline)
        for bad in [response(self.home + b'changed'), response(self.home, 503), {**response(self.home), 'url': 'http://dexladder.com/'}]:
            with self.assertRaises(ValueError):
                health.validate(ORIGIN, '/', bad, self.baseline)

    def test_worker_hash_revision_and_cache(self):
        body = b"const SW_BUILD='v167';const SW_REV=26;const PAYLOAD_SHA='" + self.baseline['artifact_sha256'].encode() + b"';// Only app entry points may fall back to the offline app shell."
        self.baseline['worker_sha256'] = hashlib.sha256(body).hexdigest()
        good = response(body, content_type='application/javascript', path='/sw.js')
        good['headers']['cache-control'] = 'no-store'
        health.validate(ORIGIN, '/sw.js', good, self.baseline)
        for bad in [{**good, 'body': body + b'changed navigation strategy'}, {**good, 'body': body.replace(b'SW_REV=26', b'SW_REV=25')}, {**good, 'body': body.replace(self.baseline['artifact_sha256'].encode(), b'0' * 64)}, {**good, 'headers': {'content-type': 'application/javascript'}}]:
            with self.assertRaises(ValueError):
                health.validate(ORIGIN, '/sw.js', bad, self.baseline)

    def test_api_contracts(self):
        health.validate(ORIGIN, '/api/news', response(b'{"ok":true,"items":[{"title":"News"}]}', content_type='application/json', path='/api/news'), self.baseline)
        health.validate(ORIGIN, '/api/news', response(b'{"ok":6,"of":7,"items":[{"title":"News"}]}', content_type='application/json', path='/api/news'), self.baseline)
        health.validate(ORIGIN, '/api/unknown', response(b'{"ok":false,"error":"not-deployed"}', 503, 'application/json', '/api/unknown'), self.baseline)
        for body in [b'{"ok":true,"items":[]}', b'[]', b'<html>app</html>', b'{"ok":false,"items":[1]}', b'{"ok":0,"items":[1]}']:
            with self.assertRaises((ValueError, TypeError)):
                health.validate(ORIGIN, '/api/news', response(body, content_type='application/json', path='/api/news'), self.baseline)

    def test_missing_route_rejects_successful_shell(self):
        with self.assertRaises(ValueError):
            health.validate(ORIGIN, '/production-health-missing-page', response(self.home), self.baseline)

    def test_retry_success_and_exhaustion(self):
        fetcher = Mock(side_effect=[TimeoutError('timeout'), response(self.home, 500), response(self.home)])
        sleeper = Mock()
        result = health.check(ORIGIN, '/', self.baseline, fetcher, sleeper)
        self.assertTrue(result['passed']); self.assertEqual(result['attempts'], 3); self.assertEqual(sleeper.call_count, 2)
        fetcher = Mock(return_value=response(self.home, 500))
        result = health.check(ORIGIN, '/', self.baseline, fetcher, Mock())
        self.assertFalse(result['passed']); self.assertEqual(fetcher.call_count, 3)


if __name__ == '__main__':
    unittest.main()
