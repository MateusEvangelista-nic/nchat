import unittest
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

spec = spec_from_file_location("runner", Path(__file__).with_name("ownership-postgres.py"))
runner = module_from_spec(spec)
spec.loader.exec_module(runner)


class EvidenceTests(unittest.TestCase):
    def test_empty_and_skip_never_pass(self):
        self.assertEqual(runner.validate_events([], 0)["result"], "FAIL")
        self.assertEqual(runner.validate_events([
            {"Action": "run", "Test": "TestOwnership"},
            {"Action": "skip", "Test": "TestOwnership"},
            {"Action": "pass"},
        ], 0)["result"], "FAIL")

    def test_incomplete_or_failed_package_never_pass(self):
        events = [{"Action": "run", "Test": "TestOwnership"},
                  {"Action": "pass", "Test": "TestOwnership"}]
        self.assertEqual(runner.validate_events(events, 0)["result"], "FAIL")
        events.append({"Action": "pass"})
        self.assertEqual(runner.validate_events(events, 1)["result"], "FAIL")
        self.assertEqual(runner.validate_events(events, 0)["result"], "PASS")


if __name__ == "__main__":
    unittest.main()
