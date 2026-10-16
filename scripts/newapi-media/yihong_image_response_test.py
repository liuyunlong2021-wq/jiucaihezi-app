"""Verify patch replay and compile/run its exact bounded gate without a production service."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('patch', Path(__file__).with_name('patch_yihong_image_response.py'))
patch_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch_module)

LEGACY_GATE = '''\tstarted := time.Now()
\t// Only Yihong's synchronous images need large inline Base64 responses.
\tresponseLimit := maxTaskPluginPersistedJSONBytes
\tif a.plugin.Meta.Key == "yihong" &&
\t\t(info.UpstreamModelName == "gemini-nano-banana-2.1" || info.UpstreamModelName == "gpt-image-2-1K-4K") &&
\t\t(c.Request.URL.Path == "/v1/images/generations" || c.Request.URL.Path == "/v1/images/edits") {
\t\tresponseLimit = 32 << 20
\t}
\tvar responseBody any'''


class YihongImagePatchTests(unittest.TestCase):
    def test_upgrade_legacy_patch_and_replay(self):
        source = '\n'.join([LEGACY_GATE, *(new for _, new in patch_module.CHANGES[1:])])
        source += '\nlen(pluginState) > maxTaskPluginPersistedJSONBytes\n'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / patch_module.SOURCE_FILE
            target.parent.mkdir(parents=True)
            target.write_text(source)
            patch_module.patch(root)
            expected = source.replace(LEGACY_GATE, patch_module.REPLACEMENT, 1)
            self.assertEqual(target.read_text(), expected)
            patch_module.patch(root)
            self.assertEqual(target.read_text(), expected)

    def test_partial_legacy_patch_is_not_modified(self):
        source = '\n'.join([LEGACY_GATE, *(old for old, _ in patch_module.CHANGES[1:])])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / patch_module.SOURCE_FILE
            target.parent.mkdir(parents=True)
            target.write_text(source)
            with self.assertRaises(SystemExit):
                patch_module.patch(root)
            self.assertEqual(target.read_text(), source)

    def test_deployment_accepts_known_baselines_and_uses_new_image_tag(self):
        script = Path(__file__).with_name('repair-yihong-images.sh').read_text()
        prefix = script.split('[ "$(docker inspect new-api --format \'{{.State.Running}}\')" = true ]', 1)[0]
        mock = 'docker() { printf "%s" "$TEST_IMAGE"; }; id() { printf 0; };\n'
        # Docker only receives the tag from this stub; no service is contacted.
        for tag in ['multipart-20261009', 'yihong-images-20261013', 'unexpected']:
            image = 'jiucaihezi/new-api:rc40-local-media-ossdirect-' + tag
            result = subprocess.run(
                ['bash', '-c', 'TEST_IMAGE=$1\n' + mock + prefix + '\nprintf "%s\\n%s\\n" "$OLD_TAG" "$IMAGE"', 'test', image],
                text=True, capture_output=True,
            )
            if tag == 'unexpected':
                self.assertNotEqual(result.returncode, 0)
            else:
                self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
                self.assertEqual(result.stdout.splitlines(), [image, 'jiucaihezi/new-api:rc40-local-media-ossdirect-yihong-images-20261016'])

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
  {"yihong", "gpt-image-2", "/v1/images/generations", 32 << 20},
  {"yihong", "gpt-image-2.5-flare", "/v1/images/generations", 32 << 20},
  {"yihong", "gpt-image-2.5-sunburst", "/v1/images/generations", 32 << 20},
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
