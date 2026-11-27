import os
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]


class WatchTests(unittest.TestCase):
    def watch(self, scenario):
        env = dict(os.environ, WATCH_FIXTURE=scenario)
        env.pop("WATCH_REVIEW_MAX_WAIT_MS", None)
        env.pop("WATCH_REVIEW_INTERVAL_MS", None)
        result = subprocess.run(["node", "--require", "./tests/fixtures/watch-gh.cjs",
                                 "toolkit/.claude/hooks/lib/watch-review.cjs", "7"],
                                cwd=ROOT, text=True, encoding="utf8", env=env,
                                capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        return result.stdout

    def test_review_appears_then_runs_then_self_skips(self):
        output = self.watch("skip")
        polls = [line for line in output.splitlines() if "PR #7:" in line]
        self.assertEqual(len(polls), 3, output)
        self.assertIn("pending", polls[0])
        self.assertIn("pending", polls[1])
        self.assertIn("WATCH_REVIEW_OUTCOME: needs-human", output)

    def test_unavailable_check_times_out(self):
        output = self.watch("unavailable")
        self.assertIn("did not settle within 25 min", output)
        self.assertIn("review check", output)
        self.assertNotIn("green", output)
        self.assertIn("WATCH_REVIEW_OUTCOME: pending", output)

    def test_unconfirmed_skip_times_out(self):
        for scenario in ["unreadable", "different-run"]:
            with self.subTest(scenario=scenario):
                output = self.watch(scenario)
                self.assertIn("did not settle within 25 min", output)
                self.assertIn("verdict", output)
                self.assertIn("WATCH_REVIEW_OUTCOME: pending", output)
