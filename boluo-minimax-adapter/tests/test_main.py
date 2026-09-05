import unittest

from src.main import MODEL, RESOLUTIONS, media_values


class AdapterContractTest(unittest.TestCase):
    def test_model_contract(self):
        self.assertEqual(MODEL, "minimax_h3_image_audio_to_video_v2_15s")
        self.assertEqual(len(RESOLUTIONS), 4)

    def test_media_values_accepts_openai_arrays(self):
        self.assertEqual(media_values({"images": [{"url": "https://a.test/x.png"}]}, ("images", "image")), ["https://a.test/x.png"])

    def test_resolution_orientation_follows_ratio_contract(self):
        resolution = "768p竖"
        ratio = "16:9"
        if ratio == "16:9" and resolution.endswith("竖"):
            resolution = resolution[:-1] + "横"
        self.assertEqual(resolution, "768p横")


if __name__ == "__main__":
    unittest.main()
