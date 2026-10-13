"""Verify patch replay and compile/run its exact bounded gate without a production service."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('patch', Path(__file__).with_name('patch_yihong_image_response.py'))
patch_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch_module)


class YihongImagePatchTests(unittest.TestCase):
    def test_replay_is_idempotent_and_keeps_state_limit(self):
        source = '\n'.join(old for old, _ in patch_module.CHANGES) + '\nlen(pluginState) > maxTaskPluginPersistedJSONBytes\n'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / patch_module.SOURCE_FILE
            target.parent.mkdir(parents=True)
            target.write_text(source)
            patch_module.patch(root)
            updated = target.read_text()
            patch_module.patch(root)
            self.assertEqual(target.read_text(), updated)
            self.assertIn('len(pluginState) > maxTaskPluginPersistedJSONBytes', updated)
            self.assertIn('len(taskData) > responseLimit', updated)

    def test_incompatible_source_is_not_modified(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / patch_module.SOURCE_FILE
            target.parent.mkdir(parents=True)
            target.write_text('incompatible source')
            with self.assertRaises(SystemExit):
                patch_module.patch(root)
            self.assertEqual(target.read_text(), 'incompatible source')

    def test_compiled_gate_limits_large_images_without_weakening_other_requests(self):
        # Compile the actual patch branch, with only request/manifest structs stubbed.
        gate = patch_module.REPLACEMENT.split('\tresponseLimit :=', 1)[1].split('\tvar responseBody', 1)[0]
        code = '''package main
import ("io"; "net/http"; "strings"; "testing")
const maxTaskPluginPersistedJSONBytes = 1 << 20
func limitFor(key, model, path string) int {
 a := struct{ plugin struct{ Meta struct{ Key string } } }{}
 a.plugin.Meta.Key = key
 info := struct{ UpstreamModelName string }{model}
 request, _ := http.NewRequest("POST", path, nil)
 c := struct{ Request *http.Request }{request}
 responseLimit := ''' + gate + '''
 return responseLimit
}
func TestImageBoundary(t *testing.T) {
 for _, tc := range []struct{key, model, path string; limit int}{
  {"yihong", "gemini-nano-banana-2.1", "/v1/images/edits", 32 << 20},
  {"yihong", "gpt-image-2-1K-4K", "/v1/images/generations", 32 << 20},
  {"other", "gemini-nano-banana-2.1", "/v1/images/edits", 1 << 20},
  {"yihong", "seedance-2.5-pro", "/v1/videos", 1 << 20},
  {"yihong", "gemini-nano-banana-2.1", "/v1/videos", 1 << 20},
 } {
  limit := limitFor(tc.key, tc.model, tc.path)
  if limit != tc.limit {t.Fatalf("wrong limit for %+v: %d", tc, limit)}
  for _, size := range []int{1 << 20, 2 << 20, (32 << 20) + 1} {
   data, err := io.ReadAll(io.LimitReader(strings.NewReader(strings.Repeat("x", size)), int64(limit)+1))
   if err != nil {t.Fatal(err)}
   if (len(data) > limit) != (size > tc.limit) {t.Fatalf("wrong boundary: %+v size=%d", tc, size)}
  }
 }
}
'''
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'go.mod').write_text('module yihongpatch\n\ngo 1.23\n')
            (root / 'gate_test.go').write_text(code)
            subprocess.run(['go', 'test', './...'], cwd=root, check=True)


if __name__ == '__main__':
    unittest.main()
