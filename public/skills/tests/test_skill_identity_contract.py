"""Contract checks for built-in Skill names, directories, and discovery metadata."""

import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TARGETS = {
    "JC-GPT-Image2-Skill": "jc-gpt-image",
    "JC-GitHub指导": "jc-github-guide",
    "JC-dagang-manjuxiezuo": "jc-manjuxiezuo",
    "JC-linmoduanju": "jc-linmo-duanju",
    "JC-linmoxiaoshuo": "jc-linmo-xiaoshuo",
    "JC-分镜转分镜大图": "jc-storyboard-image",
    "JC-剧本转分镜": "jc-script-storyboard",
    "JC-反推图片提示词": "jc-reverse-image-prompt",
    "JC-反推视频提示词": "jc-reverse-video-prompt",
    "JC-口播": "jc-koubo",
    "JC-场景提示词": "jc-scene-prompt",
    "JC-对话转Wiki": "jc-chat-wiki",
    "JC-小说": "jc-novel",
    "JC-影视风格定调": "jc-film-style",
    "JC-新手指导": "jc-new-user-guide",
    "JC-海报设计": "jc-poster-design",
    "JC-电商商品图": "jc-product-image",
    "JC-瞬间创作": "jc-instant-create",
    "JC-短剧-世界模型": "jc-duanju-world",
    "JC-短故事": "jc-short-story",
    "JC-角色设计提示词": "jc-character-prompt",
    "JC-道具提示词": "jc-prop-prompt",
}


class SkillIdentityContractTests(unittest.TestCase):
    def test_target_directories_replace_old_directories(self) -> None:
        for old, new in TARGETS.items():
            self.assertFalse((ROOT / old).exists(), old)
            self.assertTrue((ROOT / new / "SKILL.md").is_file(), new)

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
