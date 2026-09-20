import hashlib
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "iso" / "overlay" / "opt" / "josh-os" / "app-store" / "catalog.json"
DIGEST = ROOT / "iso" / "overlay" / "opt" / "josh-os" / "app-store" / "catalog.sha256"


class AppStoreCatalogTests(unittest.TestCase):
    def test_catalog_digest_matches(self):
        expected = DIGEST.read_text(encoding="utf-8").split()[0]
        # Git may materialize the checked-in JSON with CRLF on Windows; the
        # catalog digest is defined over its canonical LF representation.
        actual = hashlib.sha256(CATALOG.read_bytes().replace(b"\r\n", b"\n")).hexdigest()
        self.assertEqual(expected, actual)

    def test_catalog_has_supported_runtime_entries(self):
        payload = json.loads(CATALOG.read_text(encoding="utf-8"))
        runtimes = {app["runtime"] for app in payload["apps"]}
        self.assertIn("flatpak", runtimes)
        self.assertIn("wine", runtimes)
        for app in payload["apps"]:
            self.assertTrue(app["id"])
            self.assertTrue(app["name"])
            self.assertTrue(app["summary"])
        windows_app = next(app for app in payload["apps"] if app["runtime"] == "wine")
        self.assertEqual(windows_app["installerSource"], "downloads")
        self.assertTrue(windows_app["installable"])


if __name__ == "__main__":
    unittest.main()
