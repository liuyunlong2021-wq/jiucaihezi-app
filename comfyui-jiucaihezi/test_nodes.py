import unittest
from unittest.mock import patch

from nodes import ALL_MODELS, GEMINI_RATIOS, GEMINI_RESOLUTIONS, GPT_MODELS, GPT_RATIOS, GPT_RESOLUTIONS, LLM_MODELS, NODE_CLASS_MAPPINGS, PROMPT_MAX_LENGTH, key, size_for


class JiucaiheziImageSchemaTest(unittest.TestCase):
    def test_one_node_has_all_models_and_ten_references(self):
        schema = NODE_CLASS_MAPPINGS["JiucaiheziImage"].INPUT_TYPES()
        self.assertEqual(schema["required"]["model"][0], ALL_MODELS)
        self.assertEqual(schema["required"]["resolution"][0], ["1k", "2k", "4k"])
        self.assertEqual(schema["required"]["ratio"][0], GPT_RATIOS)
        self.assertEqual(schema["required"]["prompt"][1]["max_length"], PROMPT_MAX_LENGTH)
        self.assertEqual(sum(name.startswith("image") for name in schema["optional"]), 10)
        self.assertEqual(size_for("21:9", "2k"), "4779x2048")

    def test_model_resolution_contracts(self):
        self.assertEqual(GPT_RESOLUTIONS["gpt-image-2-1k"], ["1k"])
        self.assertEqual(GPT_RESOLUTIONS["gpt-image-2-官方"], ["1k", "2k", "4k"])
        self.assertEqual(GEMINI_RESOLUTIONS, ["1k", "2k", "4k"])
        self.assertEqual(GEMINI_RATIOS, ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"])

    def test_key_is_explicit_and_does_not_read_desktop_settings(self):
        self.assertEqual(key(""), "")

    def test_prompt_limit_is_enforced_before_submission(self):
        with self.assertRaisesRegex(RuntimeError, "20000"):
            NODE_CLASS_MAPPINGS["JiucaiheziImage"]().generate("key", "gemini-3-pro-image-preview", "x" * (PROMPT_MAX_LENGTH + 1), "4k", "16:9")


class JiucaiheziLLMTest(unittest.TestCase):
    def test_schema_and_custom_model(self):
        schema = NODE_CLASS_MAPPINGS["JiucaiheziLLM"].INPUT_TYPES()["required"]
        self.assertEqual(schema["model"][0], LLM_MODELS)
        self.assertTrue(schema["api_key"][1]["password"])

    @patch("nodes.requests.post")
    def test_openai_payload_and_response(self, post):
        class Response:
            def raise_for_status(self): pass
            def json(self): return {"choices": [{"message": {"content": "ok"}}]}
        post.return_value = Response()
        result = NODE_CLASS_MAPPINGS["JiucaiheziLLM"]().generate("https://example.test/v1", "key", LLM_MODELS[0], "my-model", "sys", "hi", 0.6, 100, False)
        self.assertEqual(result[0], "ok")
        self.assertEqual(post.call_args.kwargs["json"]["model"], "my-model")
        self.assertEqual(post.call_args.args[0], "https://example.test/v1/chat/completions")


if __name__ == "__main__":
    unittest.main()
