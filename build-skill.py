"""Build one portable LEP Builder from canonical repository references."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
source = root / 'AuthorToolKit' / 'lep-builder'
output = root / 'AuthorToolKit' / 'LEP_Builder_Skill.zip'
files = sorted(p for p in source.rglob('*') if p.is_file() and not p.name.startswith('.'))
assert len(files) == 8, [str(p) for p in files]
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for file in files:
        archive.writestr('lep-builder/' + file.relative_to(source).as_posix(), file.read_bytes())
with ZipFile(output) as archive:
    assert archive.testzip() is None
    for file in files:
        assert archive.read('lep-builder/' + file.relative_to(source).as_posix()) == file.read_bytes()
print('LEP Builder: 8/8 canonical files packaged and byte-verified; no symlinks in ZIP.')
