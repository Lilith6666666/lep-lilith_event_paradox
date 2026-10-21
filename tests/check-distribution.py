"""Dependency-free distribution integrity checks; run after tools/build-skill.py."""
from pathlib import Path
from zipfile import ZipFile
import hashlib, json, re

root = Path(__file__).resolve().parents[1]
skill = root / 'AuthorToolKit/lep-builder'
with ZipFile(root / 'AuthorToolKit/LEP_Builder_Skill.zip') as archive:
    assert archive.testzip() is None
    assert len(archive.namelist()) == 8
    for file in skill.rglob('*'):
        if file.is_file() and not file.name.startswith('.'):
            assert archive.read('lep-builder/' + file.relative_to(skill).as_posix()) == file.read_bytes()
for name in ['LEP_AI_Authoring_Spec.txt', 'LEP_Author_Toolkit_Examples.txt', 'LEP_Events_Creator.txt']:
    assert (skill / 'references' / name).resolve() == (root / 'AuthorToolKit' / name).resolve()
assert (skill / 'references/LEP_README.txt').resolve() == (root / 'docs/LEP_Technical_Reference.txt').resolve()
assert not list((root / 'AuthorToolKit').glob('EventParadox_*'))
assert not (root / 'AuthorToolKit/EP_Builder_Skill.zip').exists()
assert not (root / 'EP').exists()
for file in [root/'README.md', root/'docs/LEP_Technical_Reference.txt', *(root/'AuthorToolKit').glob('LEP_*.txt'), skill/'SKILL.md']:
    assert not re.search(r'(?<!L)EP_(?:START|CHAPTERS|EVENTS)|/ep\s+(?:help|status|set|forceEvent|testEvent)|LLEP',file.read_text()), file
for file in [skill/'SKILL.md', skill/'MANIFEST.txt']:
    for reference in re.findall(r'(?:references|templates)/[A-Za-z_]+\.txt',file.read_text()):
        assert (skill/reference).exists(), reference
upstream = json.loads((root/'vendor/inner-self/UPSTREAM.json').read_text())
license = (root/'vendor/inner-self/LICENSE').read_bytes()
assert hashlib.sha256(license).hexdigest() == upstream['licenseSha256']
for name in ['LEP/Library.js','vendor/inner-self/InnerSelf.lep.js','THIRD_PARTY_NOTICES.txt']:
    assert license in (root/name).read_bytes()
assert (root/'vendor/inner-self/InnerSelf.lep.js').read_bytes() in (root/'LEP/Library.js').read_bytes()
assert upstream['commit'] == '297a1a04c0e11b41f69e3e57a607b47eee34334b'
assert 'c8a4e4d6e1ef03b3177fa35c8c332afe1f914aa3' in (root/'THIRD_PARTY_NOTICES.txt').read_text()
print('Distribution: ZIP snapshots, canonical references, namespace scan and exact licenses/pins verified.')
