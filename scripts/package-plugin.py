"""Build the standalone BookStack plugin package without credentials or unrelated files."""
import json
import sys
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1] / "plugin" / "bookstack"
output = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/bookstack-plugin.zip").resolve()
if root == output or root in output.parents:
    raise SystemExit("Write the archive outside the plugin source directory")
manifest = json.loads((root / "plugin.json").read_text())
connection = json.loads((root / "mcp.json").read_text())
assert manifest["name"] == root.name
assert len(manifest["extensions"]["com.openai"]["interface"]["shortDescription"]) <= 30
assert connection["mcpServers"]["bookstack"]["extensions"]["com.openai"]["auth"]["client"]["clientId"] == "bookstack-mcp-chatgpt"
expected = {"plugin.json", "mcp.json", "assets/icon.svg", "skills/bookstack/SKILL.md", "skills/bookstack-setup/SKILL.md"}
onboarding = manifest["extensions"]["com.openai"]["onboardingSkill"]
assert onboarding == "./skills/bookstack-setup/SKILL.md"
assert (root / onboarding).is_file()
actual = {str(p.relative_to(root)) for p in root.rglob("*") if p.is_file()}
assert actual == expected, "Unexpected or missing package files"
assert not any(p.is_symlink() for p in root.rglob("*"))
with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
    for relative in sorted(expected):
        archive.write(root / relative, Path(root.name) / relative)
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    assert len(archive.namelist()) == len(expected)
print(output)
