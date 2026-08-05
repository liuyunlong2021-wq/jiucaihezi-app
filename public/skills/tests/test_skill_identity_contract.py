"""Contract checks for built-in Skill names, directories, and discovery metadata."""

import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class SkillIdentityContractTests(unittest.TestCase):
    def test_retired_chat_to_wiki_skill_is_not_packaged(self) -> None:
        self.assertFalse((ROOT / "jc-chat-wiki").exists())

    def test_every_builtin_skill_has_a_valid_matching_identity_and_discovery_description(self) -> None:
        index = json.loads((ROOT / "index.json").read_text(encoding="utf-8"))
        entries = {entry["id"]: entry for entry in index}
        skill_dirs = sorted(path for path in ROOT.iterdir() if path.is_dir() and (path / "SKILL.md").is_file())

        self.assertEqual(set(entries), {path.name for path in skill_dirs})
        for directory in skill_dirs:
            name = directory.name
            text = (directory / "SKILL.md").read_text(encoding="utf-8")
            frontmatter_name = re.search(r"^name:\s*(.+)$", text, re.MULTILINE)
            description = re.search(r"^description:\s*[\"']?(.+?)[\"']?\s*$", text, re.MULTILINE)
            self.assertIsNotNone(frontmatter_name, name)
            self.assertIsNotNone(description, name)
            self.assertRegex(name, r"^[a-z0-9-]{1,64}$")
            self.assertEqual(frontmatter_name.group(1).strip(), name)
            self.assertEqual(entries[name]["name"], name)
            self.assertTrue(description.group(1).startswith("Use when"), name)
            self.assertTrue(entries[name]["description"].startswith("Use when"), name)
            for relative in entries[name]["files"]:
                self.assertTrue((directory / relative).is_file(), f"{name}/{relative}")


if __name__ == "__main__":
    unittest.main()
