import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = Path("requirements-contract/example")


class TraceabilityTests(unittest.TestCase):
    def test_mapping_identifies_an_uncovered_criterion(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as temp:
            target = Path(temp)
            shutil.copytree(ROOT / EXAMPLE, target / EXAMPLE)
            shutil.copytree(ROOT / "toolkit", target / "toolkit")
            cmd = ["node", str(EXAMPLE / "check.cjs")]
            env = dict(os.environ, TMPDIR=temp, TEMP=temp, TMP=temp, GIT_CEILING_DIRECTORIES=temp)
            result = subprocess.run(cmd, cwd=target, capture_output=True, text=True, env=env)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            doc = target / EXAMPLE / "README.md"
            source = doc.read_text(encoding="utf8")
            name = "BLOCKS when the log is stale (a new commit moved HEAD)"
            self.assertIn(name, source)
            for replacement in ["", "renamed test"]:
                with self.subTest(replacement=replacement):
                    doc.write_text(source.replace(name, replacement), encoding="utf8")
                    result = subprocess.run(cmd, cwd=target, capture_output=True, text=True, env=env)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("AC1", result.stderr)
