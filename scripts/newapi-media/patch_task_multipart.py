#!/usr/bin/env python3
"""Replay the multipart Content-Type fix against the pinned NewAPI rc.40 host."""
from pathlib import Path
import sys
import subprocess

SOURCE_FILE = "relay/channel/task/jsplugin/adaptor.go"
OLD = '\t\tc.Request.Header.Set("Content-Type", writer.FormDataContentType())\n\t\treturn bytes.NewReader(body.Bytes()), nil'
NEW = '''\t\t// The outgoing request is new; mutating the inbound header alone is insufficient.
\t\tif descriptor.Headers == nil {
\t\t\tdescriptor.Headers = make(map[string]string)
\t\t}
\t\tfor name := range descriptor.Headers {
\t\t\tif strings.EqualFold(name, "Content-Type") {
\t\t\t\tdelete(descriptor.Headers, name)
\t\t\t}
\t\t}
\t\tdescriptor.Headers["Content-Type"] = writer.FormDataContentType()
\t\tc.Request.Header.Set("Content-Type", writer.FormDataContentType())
\t\treturn bytes.NewReader(body.Bytes()), nil'''


def patch(root: Path) -> None:
    target = root / SOURCE_FILE
    source = target.read_text()
    if (root / ".git").exists():
        original = subprocess.check_output(["git", "-C", str(root), "show", "HEAD:" + SOURCE_FILE]).decode()
        if source not in (original, original.replace(OLD, NEW, 1)):
            raise SystemExit("Unexpected tracked host changes; stop and inspect")
    if source.count(NEW) == 1:
        print("Multipart host fix already applied")
        return
    if source.count(OLD) != 1:
        raise SystemExit("Unexpected multipart host source; stop and inspect")
    target.write_text(source.replace(OLD, NEW, 1))
    print("Multipart host fix applied: outgoing header uses generated boundary")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: patch_task_multipart.py NEWAPI_SOURCE")
    patch(Path(sys.argv[1]))
