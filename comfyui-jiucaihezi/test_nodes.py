import unittest

from nodes import ALL_MODELS, GPT_MODELS, GPT_RATIOS, GPT_RESOLUTIONS, NODE_CLASS_MAPPINGS, key, size_for


class JiucaiheziImageSchemaTest(unittest.TestCase):
    def test_one_node_has_all_models_and_eight_references(self):
        schema = NODE_CLASS_MAPPINGS["JiucaiheziImage"].INPUT_TYPES()
        self.assertEqual(schema["required"]["model"][0], ALL_MODELS)
        self.assertEqual(schema["required"]["resolution"][0], ["1k", "2k", "4k"])
        self.assertEqual(schema["required"]["ratio"][0], GPT_RATIOS)
        self.assertEqual(sum(name.startswith("image") for name in schema["optional"]), 8)
        self.assertEqual(size_for("21:9", "2k"), "4779x2048")

    def test_model_resolution_contracts(self):
        self.assertEqual(GPT_RESOLUTIONS["gpt-image-2-1k"], ["1k"])
        self.assertEqual(GPT_RESOLUTIONS["gpt-image-2-官方"], ["1k", "2k", "4k"])

    def test_key_is_explicit_and_does_not_read_desktop_settings(self):
        self.assertEqual(key(""), "")


if __name__ == "__main__":
    unittest.main()
