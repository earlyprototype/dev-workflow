"""Run the copied workflow steps with local Git, Node, npm, and a shell gh fixture."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[1]
TOOLKIT = ROOT / "toolkit"
GUARDS = [
    ".claude/hooks/tests/review-gate.test.cjs",
    ".github/scripts/automerge-eligible.test.cjs",
    ".claude/hooks/tests/watch-review.test.cjs",
    ".claude/hooks/tests/watch-review-reminder.test.cjs",
]


def bash():
    if os.name == "nt":
        git_bin = Path(shutil.which("git")).resolve().parents[1] / "bin/bash.exe"
        if git_bin.exists():
            return str(git_bin)
    return "bash"


class CopiedWorkflowTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(dir=ROOT)
        self.addCleanup(temp.cleanup)
        self.target = Path(temp.name)
        for name in [".github", ".claude"]:
            shutil.copytree(TOOLKIT / name, self.target / name)
        shutil.copy(TOOLKIT / ".mcp.json", self.target)
        self.env = dict(os.environ, TMPDIR=temp.name, TEMP=temp.name, TMP=temp.name,
                        GIT_CEILING_DIRECTORIES=temp.name,
                        npm_config_offline="true", npm_config_cache=temp.name + "/npm-cache",
                        npm_config_userconfig=temp.name + "/fixture.npmrc")

    def workflow(self, name):
        path = self.target / ".github/workflows" / name
        return yaml.safe_load(path.read_text(encoding="utf8"))

    def shell(self, script, **env):
        return subprocess.run([bash(), "--noprofile", "--norc", "-e", "-o", "pipefail"],
                              input=script, encoding="utf8", cwd=self.target,
                              env={**self.env, **env}, capture_output=True, timeout=90)

    def ci(self, app_checks):
        job = self.workflow("ci.yml")["jobs"]["checks"]
        self.assertNotIn("if", job)
        self.assertFalse(job.get("continue-on-error"))
        # Run the template's commands in order. Fail on unrecognised conditions
        # so a change to how a repository opts in is visible in this fixture.
        commands = []
        for step in job["steps"]:
            self.assertFalse(step.get("continue-on-error"))
            if "if" in step:
                self.assertEqual(step["if"], "vars.RUN_NPM_CHECKS == 'true'")
                if not app_checks:
                    continue
            if "uses" in step:
                if step.get("with", {}).get("cache") == "npm":
                    self.assertTrue((self.target / "package-lock.json").exists(),
                                    "setup-node npm cache requires a lockfile")
                continue
            commands.append(step["run"])
        return self.shell("\n".join(commands))

    def test_toolkit_alone_runs_all_four_guards(self):
        result = self.ci(False)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertRegex(result.stdout, r"(?m)^[1-9]\d* passed, 0 failed$")
        for report in ["automerge-eligible (review-verdict)",
                       "watch-review classifier cases green", "watch-review-reminder cases green"]:
            self.assertIn(report, result.stdout)

    def test_npm_app_checks_are_required_when_enabled(self):
        scripts = {name: f"node fixture.cjs {name}" for name in
                   ["lint", "typecheck", "test:coverage", "build"]}
        package = dict(name="fixture", version="1.0.0", scripts=scripts)
        (self.target / "package.json").write_text(json.dumps(package))
        lock = dict(name="fixture", version="1.0.0", lockfileVersion=3, packages={"": package})
        (self.target / "package-lock.json").write_text(json.dumps(lock))
        (self.target / "fixture.cjs").write_text(
            "console.log('app-check ' + process.argv[2]);\n"
            "if (process.argv[2] === process.env.FAIL_SCRIPT) process.exit(23);\n")
        # The toolkit-only case runs the real suites. Keep their commands in
        # this fixture but substitute quick successes for the repeated app runs.
        for guard in GUARDS:
            (self.target / guard).write_text("process.exit(0);\n")
        result = self.ci(True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for script in scripts:
            self.assertIn("app-check " + script, result.stdout)
            with self.subTest(script=script):
                self.env["FAIL_SCRIPT"] = script
                failed = self.ci(True)
                self.assertNotEqual(failed.returncode, 0, failed.stdout)
                self.assertIn("app-check " + script, failed.stdout)
        self.env.pop("FAIL_SCRIPT")
        (self.target / "package-lock.json").unlink()
        failed = self.ci(True)
        self.assertNotEqual(failed.returncode, 0, "npm ci must require the lockfile")

    def test_late_reviews_leave_the_new_head_alone(self):
        workflow = self.workflow("auto-merge.yml")
        self.assertIn("github.event.workflow_run.head_sha", workflow["concurrency"]["group"])
        step, = workflow["jobs"]["evaluate-and-arm"]["steps"]
        self.assertEqual(step["env"]["HEAD_SHA"], "${{ github.event.workflow_run.head_sha }}")
        mock = (ROOT / "tests/fixtures/auto-merge-gh.sh").read_text()
        head_a, head_b = "a" * 40, "b" * 40
        for verdict, reviewed, armed, expected in [
                ("PASS", head_a, False, []), ("BLOCK", head_a, True, []),
                ("SKIP", head_a, True, []), ("FETCH_ERROR", head_a, True, []),
                ("PASS", head_b, False, ["arm"]), ("BLOCK", head_b, True, ["disarm"]),
                ("OTHER_RUN", head_b, False, []),
                ("SKIP", head_b, True, ["disarm"]), ("FETCH_ERROR", head_b, True, ["disarm"])]:
            with self.subTest(verdict=verdict, reviewed=reviewed):
                log = self.target / "mutations"
                log.write_text("")
                result = self.shell(mock + "\n" + step["run"], PR_FROM_EVENT="7",
                                    GITHUB_REPOSITORY="fixture/repo", REVIEW_RUN_ID="17",
                                    HEAD_SHA=reviewed, CURRENT_HEAD=head_b, RUNNER_TEMP=".",
                                    VERDICT=verdict, ARMED=str(armed).lower())
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(log.read_text().splitlines(), expected)

    def test_review_job_reports_a_self_skip_only_when_the_reviewer_skipped(self):
        steps = self.workflow("claude-pr-review.yml")["jobs"]["review"]["steps"]
        marker = next(step for step in steps if step.get("name") == "Report review self-skip")
        gate = next(step for step in steps if step.get("name") == "Enforce the review verdict")
        self.assertEqual(marker["if"], "steps.review.outputs.execution_file == ''")
        self.assertEqual(gate["if"], "steps.review.outputs.execution_file != ''")
        mock = (ROOT / "tests/fixtures/auto-merge-gh.sh").read_text()
        for verdict, expected in [("PASS", 0), ("BLOCK", 1), ("OTHER_RUN", 1)]:
            with self.subTest(verdict=verdict):
                result = self.shell(mock + "\n" + gate["run"], VERDICT=verdict, PR="7",
                                    RUN_ID="17", BASE_REF="main", RUNNER_TEMP=".",
                                    GITHUB_REPOSITORY="fixture/repo")
                self.assertEqual(result.returncode, expected, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
