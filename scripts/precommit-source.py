"""Exact staged text inputs for the five-second commit checks; no build assets."""
import json
from contextlib import contextmanager
from collections.abc import Mapping
import os
from pathlib import Path, PurePosixPath
import runpy
import re
import subprocess
import sys
import time

TEXT = {'.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.jsonc',
        '.yaml', '.yml', '.css', '.glsl', '.frag', '.vert', '.wgsl', '.as', '.py', '.sh', '.html'}
ROOTS = {'src', 'scripts', 'test', 'lint', 'vite', 'budgets', '.github', 'admin', 'api', 'drafts'}


@contextmanager
def git_blobs(repo, entries, deadline):
    """Load only selected immutable blobs; keep the Git batch stream bounded."""
    process = subprocess.Popen(['git', 'cat-file', '--batch'], cwd=repo,
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    class Blobs(Mapping):
        def __init__(self):
            self.oids = {str(path): oid for path, oid, _ in entries}
            self.loaded = {}
        def __iter__(self):
            return iter(self.oids)
        def __len__(self):
            return len(self.oids)
        def __contains__(self, name):
            return name in self.oids
        def __getitem__(self, name):
            if name in self.loaded:
                return self.loaded[name]
            if time.time() >= deadline:
                raise TimeoutError('Staged source preparation exceeded five-second budget')
            oid = self.oids[name]
            process.stdin.write(oid + b'\n'); process.stdin.flush()
            header = process.stdout.readline().split()
            if len(header) != 3 or header[0] != oid or header[1] != b'blob':
                raise ValueError('Staged source batch returned an invalid Git blob')
            data = process.stdout.read(int(header[2]))
            if process.stdout.read(1) != b'\n':
                raise ValueError('Staged source batch truncated a Git blob')
            self.loaded[name] = data
            return data
    try:
        yield Blobs()
    finally:
        process.stdin.close()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill(); process.wait()
        process.stdout.close()


@contextmanager
def import_reader():
    # The dependency is installed once; source always comes from the exact Git
    # blobs supplied over stdin, never TypeScript's working-tree file loader.
    library = next((parent / 'node_modules/@typescript/typescript6' for parent in Path(__file__).resolve().parents
                    if (parent / 'node_modules/@typescript/typescript6').exists()), None)
    if library is None:
        raise ValueError('Staged input selection requires the installed TypeScript parser')
    program = """const ts=require(process.argv[1]);
const lines=require('node:readline').createInterface({input:process.stdin});
lines.on('line',line=>{
 const [name,text]=JSON.parse(line),source=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true),imports=[],named=[],locals=Object.create(null),exports=Object.create(null),stars=[];
 const names=node=>ts.isIdentifier(node)?[node.text]:ts.isObjectBindingPattern(node)||ts.isArrayBindingPattern(node)?node.elements.flatMap(e=>ts.isBindingElement(e)?names(e.name):[]):[];
 const module=node=>node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)?node.moduleSpecifier.text:undefined;
 const modifiers=node=>node.modifiers?.map(m=>m.kind)??[];
 for(const node of source.statements){
  if(ts.isImportDeclaration(node)&&module(node)){
   const from=module(node),clause=node.importClause;
   if(clause?.name)locals[clause.name.text]={from,name:'default'};
   const binding=clause?.namedBindings;
   if(binding&&ts.isNamespaceImport(binding))locals[binding.name.text]={from,name:'*'};
   if(binding&&ts.isNamedImports(binding))for(const item of binding.elements){
    const imported=(item.propertyName??item.name).text;locals[item.name.text]={from,name:imported};named.push({from,name:imported,typeOnly:!!(clause?.isTypeOnly||item.isTypeOnly)});
   }
  }
  if(ts.isExportDeclaration(node)){
   const from=module(node),clause=node.exportClause;
   if(!clause&&from)stars.push(from);
   else if(clause&&ts.isNamespaceExport(clause))exports[clause.name.text]={from,name:'*'};
   else if(clause&&ts.isNamedExports(clause))for(const item of clause.elements){
    const imported=(item.propertyName??item.name).text;exports[item.name.text]=from?{from,name:imported}:{local:imported};
    if(from)named.push({from,name:imported});
   }
  }
  const declared=ts.isVariableStatement(node)?node.declarationList.declarations.flatMap(d=>names(d.name)):
   (ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node)||ts.isInterfaceDeclaration(node)||ts.isTypeAliasDeclaration(node)||ts.isEnumDeclaration(node)||ts.isModuleDeclaration(node))&&node.name?[node.name.text]:[];
  for(const local of declared){locals[local]={own:local};if(modifiers(node).includes(ts.SyntaxKind.ExportKeyword)&&!modifiers(node).includes(ts.SyntaxKind.DefaultKeyword))exports[local]={local};}
  if(modifiers(node).includes(ts.SyntaxKind.DefaultKeyword))exports.default=declared.length?{local:declared[0]}:{own:'default'};
  if(ts.isExportAssignment(node)&&!node.isExportEquals)exports.default={own:'default'};
 }
 function visit(node){
  if(ts.isImportTypeNode(node)){
   if(ts.isLiteralTypeNode(node.argument)&&ts.isStringLiteral(node.argument.literal)){
    imports.push([node.argument.literal.text,true]);
    if(node.qualifier){let first=node.qualifier;while(ts.isQualifiedName(first))first=first.left;named.push({from:node.argument.literal.text,name:first.text});}
   }
   return;
  }
  if(ts.isImportEqualsDeclaration(node)&&ts.isExternalModuleReference(node.moduleReference)&&node.moduleReference.expression&&ts.isStringLiteral(node.moduleReference.expression)){
   imports.push([node.moduleReference.expression.text,node.isTypeOnly]);
  }
  if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)){
   if(node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))imports.push([node.moduleSpecifier.text,!!(node.isTypeOnly||node.importClause?.isTypeOnly)]);
  }
  if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&node.expression.text==='require')){
   const arg=node.arguments[0];if(arg&&ts.isStringLiteral(arg))imports.push([arg.text,false]);
  }
  ts.forEachChild(node,visit);
 }
 visit(source);process.stdout.write(JSON.stringify({imports,named,locals,exports,stars})+'\\n');
});"""
    process = subprocess.Popen(['node', '-e', program, str(library)], stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, text=True)
    parsed = {}
    def describe(name, text):
        if name in parsed:
            return parsed[name]
        process.stdin.write(json.dumps([name, text]) + '\n'); process.stdin.flush()
        line = process.stdout.readline()
        if not line:
            raise ValueError('Staged import parser exited without a result')
        parsed[name] = json.loads(line)
        return parsed[name]
    def read(name, text, include_types=False):
        return {value for value, type_only in describe(name, text)['imports'] if include_types or not type_only}
    read.describe = describe
    try:
        yield read
    finally:
        process.stdin.close()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill(); process.wait()
        process.stdout.close()


# Pure staged input selection; callers supply immutable Git blobs, never loose source.
def required_sources(blobs, specification, tree=None, executable=None, staged_paths=None):
    def regular(name):
        path = PurePosixPath(name)
        return not path.is_absolute() and '..' not in path.parts
    selected = set(specification.get('files', [])) & blobs.keys()
    for name in blobs:
        if '/' not in name and (name.endswith(('.json', '.jsonc', '.yaml', '.yml')) or name.startswith('vitest.config.')):
            selected.add(name)
        if name.startswith('lint/') or name == 'src/tsconfig.test.json' or re.fullmatch(r'src/[^/]+/(?:package|tsconfig(?:\.test)?)\.json', name):
            selected.add(name)
    roots = ['scripts/precommit-checks.mjs', 'scripts/precommit-source.py', 'scripts/push_input_cache.py', 'scripts/git-source-view.mjs', *specification.get('files', []), *specification.get('guards', [])]
    if specification.get('guards'):
        roots.append('scripts/vitest-push-guards.config.ts')
    if specification.get('deleted'):
        # Every active tracked reader is an input to the deleted-path grep.
        selected.update(name for name in blobs if name.split('/')[0] in ROOTS)
    if specification.get('closed'):
        for name in blobs:
            path = PurePosixPath(name)
            if len(path.parts) > 3 and path.parts[:2] == ('src', 'shards') and not path.parts[2].endswith('-legacy'):
                if path.suffix in {'.ts', '.tsx', '.glsl'} and '/generators/' not in name and not re.search(r'\.d\.ts$|\.(?:test|spec)\.tsx?$|/test/', name):
                    selected.add(name)
        selected.update(name for name in blobs if re.search(r'/(?:generators/)?bake-[^/]+\.(?:mjs|ts)$', name))
        selected.add('scripts/source-generation-outputs.json')
    if 'test/schema-reference.test.ts' in specification.get('guards', []):
        for layer in ['sdk', 'sharddev']:
            manifest = json.loads(blobs.get(f'src/{layer}/package.json', b'{}'))
            for target in manifest.get('exports', {}).values():
                if isinstance(target, str) and target.startswith('./'):
                    name = f'src/{layer}/{target[2:]}'
                    selected.add(name)
                    # The inventory reads every public source, but executes only schema modules.
                    if re.search(rb'\b\w+Schema\s*(?::[^=;]+)?=', blobs.get(name, b'')):
                        roots.append(name)
    available = set(blobs)
    if tree is not None:
        available.update(str(path.relative_to(tree)) for path in tree.rglob('*') if path.is_file())
    def exists(name):
        return name in available
    def resolve_specifier(source, value):
        if value.startswith('@wildshard/'):
            package, _, key = value[len('@wildshard/'):].partition('/')
            manifest = json.loads(blobs.get(f'src/{package}/package.json', b'{}'))
            target = manifest.get('exports', {}).get('./' + key if key else '.')
            base = f'src/{package}/{target[2:]}' if isinstance(target, str) and target.startswith('./') else ''
        elif value.startswith('.'):
            return next((name for name in relative_candidates(source, value) if exists(name)), None)
        elif value.startswith('/src/'):
            base = value[1:]
        else:
            base = value
        if not base or not regular(base):
            return None
        candidates = [base, *[base + suffix for suffix in ('.ts', '.tsx', '.mts', '.cts', '.mjs', '.js', '.json')]]
        return next((name for name in candidates if exists(name)), None)
    pending = [name for name in selected if name.startswith('lint/') and PurePosixPath(name).suffix in {'.js', '.mjs'}] + roots
    visited = set()
    with import_reader() as imports:
        if staged_paths is not None:
            check_staged_imports(blobs, specification.get('files', []), staged_paths, imports)
        while pending:
            name = pending.pop()
            if name in visited or not regular(name) or not exists(name):
                continue
            visited.add(name); selected.add(name)
            data = blobs[name] if name in blobs else (tree / name).read_bytes()
            if PurePosixPath(name).suffix not in {'.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.json'}:
                continue
            if name.endswith('.json') and name != 'lint/platform-pending-users.json':
                continue
            text = data.decode('utf8')
            imported = set() if name.endswith('.json') else imports(name, text)
            # Import edges and literal file reads of the selected checker. False
            # positives are conservative inputs; unresolved files remain absent and
            # the checker refuses rather than reading another lane's working tree.
            for value in re.findall(r'''["']([^"'\n]+)["']''', text):
                value = value.split('?', 1)[0]
                # Root-cwd child processes can spell Node's --import loader as
                # ./scripts/..., even when their launcher lives in scripts/docs.
                # Retain that executable closure as well as ordinary relative
                # imports; both must come from the immutable candidate inputs.
                if value.startswith('./scripts/') and PurePosixPath(value).suffix in {'.mjs', '.js', '.ts', '.py'}:
                    child = resolve_specifier(name, value[2:])
                    if child is not None:
                        selected.add(child)
                        if child not in visited:
                            pending.append(child)
                dependency = resolve_specifier(name, value)
                if dependency is None and value.startswith(('game/', 'engine/', 'format/', 'sdk/')):
                    dependency = resolve_specifier(name, 'src/' + value)
                if dependency is not None:
                    selected.add(dependency)
                    # Literal data/source reads do not execute that file's imports.
                    child = value.startswith('scripts/') and PurePosixPath(value).suffix in {'.mjs', '.js', '.ts', '.py'}
                    if (value in imported or child) and dependency not in visited:
                        pending.append(dependency)
    if executable is not None:
        executable.update(visited)
    return selected & available


def relative_candidates(source, value):
    value = value.split('?', 1)[0].split('#', 1)[0]
    base = os.path.normpath(str(PurePosixPath(source).parent / value))
    if PurePosixPath(base).is_absolute() or '..' in PurePosixPath(base).parts:
        return []
    suffix = PurePosixPath(base).suffix
    substitutes = {'.js': ['.ts', '.tsx', '.d.ts'], '.jsx': ['.tsx', '.ts', '.d.ts'],
                   '.mjs': ['.mts', '.d.mts'], '.cjs': ['.cts', '.d.cts']}
    if suffix in substitutes:
        return [base, *[base[:-len(suffix)] + extension for extension in substitutes[suffix]]]
    if suffix in {'.json', '.bin', '.wasm', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.glb', '.gltf', '.hdr', '.css'}:
        return [base]
    extensions = ('.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.d.ts', '.json')
    return [base, *[base + extension for extension in extensions],
            *[base + '/index' + extension for extension in extensions]]


def check_staged_imports(blobs, files, staged_paths, imports):
    """Authored imports must exist in Git's candidate, never just in loose WIP."""
    generated = None
    def declared_output(file):
        nonlocal generated
        if generated is None:
            sources = json.loads(blobs.get('scripts/source-generation-outputs.json', b'{"producers":{}}'))
            generated = {output for outputs in sources['producers'].values() for output in outputs}
            copies = json.loads(blobs.get('scripts/copied-runtime-inputs.json', b'{"copies":[]}'))
            generated.update(row['target'] for row in copies['copies'])
            generated.update(['src/client/app/shards.generated.ts',
                'src/server/game/shard/manifest-closure.generated.json',
                'lint/shard-words.generated.json', 'src/client/game/boot/bytes.generated.ts',
                'src/client/game/boot/versions.generated.ts', 'src/client/game/boot/audio.generated.ts',
                'src/client/game/boot/packs.generated.ts',
                'src/client/game/systems/viewmodel/clips.generated.ts', 'src/shared/game/weapons/starter.generated.ts',
                'src/shared/game/bag/starter.generated.ts', 'src/client/game/systems/effects/starter.generated.ts'])
            for name in staged_paths:
                if not name.startswith('src/shards/') or not name.endswith('/manifest.json'):
                    continue
                folder = str(PurePosixPath(name).parent)
                outputs = json.loads(blobs.get(folder + '/outputs.json', b'{"outputs":[]}'))['outputs']
                if outputs:
                    generated.update(folder + '/discovery.' + row['slug'] + '.generated.ts' for row in outputs)
                else:
                    generated.add(folder + '/discovery.generated.ts')
        return file in generated
    scripts = {'.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'}
    def target(source, value, type_only=False):
        candidates = relative_candidates(source, value)
        if type_only and candidates:
            base = candidates[0]
            suffix = PurePosixPath(base).suffix
            declarations = {'.js': ['.ts', '.tsx', '.d.ts'], '.mjs': ['.mts', '.d.mts'], '.cjs': ['.cts', '.d.cts']}
            if suffix in declarations:
                candidates = [base[:-len(suffix)] + extension for extension in declarations[suffix]] + candidates
        found = next((candidate for candidate in candidates if candidate in staged_paths), None)
        if found is None and not any(declared_output(candidate) for candidate in candidates):
            name = candidates[0] if candidates else value
            raise ValueError(f'MISSING STAGED MODULE {source}: {value} -> {name} is untracked or absent in the staged tree')
        return found
    def exported(file, symbol, visiting=frozenset()):
        """Resolve only export edges, not a whole TS program or a loose file.

        None means an external/generated/asset edge is outside this source
        check. Sets identify original declarations, so repeated star paths to
        one declaration pass, distinct ambiguous star exports do not.
        Type exports are names too; value/type usage diagnostics stay with tsc.
        """
        key = (file, symbol)
        if key in visiting:
            return set()
        if file not in blobs or PurePosixPath(file).suffix not in scripts:
            return None
        row = imports.describe(file, blobs[file].decode('utf8'))
        visiting = visiting | {key}
        def follow(binding):
            if 'own' in binding:
                return {(file, binding['own'])}
            if 'local' in binding:
                local = row['locals'].get(binding['local'])
                return follow(local) if local is not None else set()
            value = binding['from']
            if not value.startswith('.'):
                return None
            dependency = target(file, value)
            if dependency is None:
                return None
            return {(dependency, '*')} if binding['name'] == '*' else exported(dependency, binding['name'], visiting)
        if symbol in row['exports']:
            return follow(row['exports'][symbol])
        # `export *` never forwards a default export.
        if symbol == 'default':
            return set()
        origins = set()
        for value in row['stars']:
            result = follow({'from': value, 'name': symbol})
            if result is None:
                return None
            origins.update(result)
        return origins
    for file in files:
        if file not in blobs or PurePosixPath(file).suffix not in {'.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'}:
            continue
        for value in sorted(imports(file, blobs[file].decode('utf8'), True)):
            if not value.startswith('.'):
                continue
            target(file, value)
        for binding in imports.describe(file, blobs[file].decode('utf8'))['named']:
            value, symbol = binding['from'], binding['name']
            if not value.startswith('.') or '?' in value or '#' in value:
                continue
            dependency = target(file, value, binding.get('typeOnly', False))
            if dependency is None:
                continue
            origins = exported(dependency, symbol)
            if origins is not None and len(origins) != 1:
                reason = 'ambiguous' if origins else 'not exported'
                raise ValueError(f'MISSING STAGED EXPORT {file}: {symbol} from {value} ({dependency}) is {reason} in the staged tree')


def staged_source(repo, tree, deadline, revision=None, specification=None):
    def git(*args, **kwargs):
        return subprocess.check_output(['git', *args], cwd=repo,
                                       timeout=max(.01, deadline - time.time()), **kwargs)
    tree.mkdir(parents=True, exist_ok=True)
    listed = git('ls-files', '--stage', '-z') if revision is None else git('ls-tree', '-rz', revision)
    entries = []
    records = []
    for row in listed.split(b'\0'):
        if not row:
            continue
        header, name = row.split(b'\t', 1)
        mode, middle, last = header.split()
        oid, stage = (middle, last) if revision is None else (last, b'0')
        if stage != b'0':
            raise ValueError('Commit checks require an unconflicted index')
        path = PurePosixPath(os.fsdecode(name))
        if path.is_absolute() or '..' in path.parts:
            raise ValueError('Unsafe staged source path')
        records.append(mode + b' blob ' + oid + b'\t' + name)
        selected = len(path.parts) == 1 or path.parts[0] in ROOTS and path.suffix in TEXT or str(path) == 'docs/HOST-BAR.md'
        if selected:
            if mode == b'120000':
                raise ValueError('Commit source snapshot refuses symlinks: ' + str(path))
            entries.append((path, oid, mode))
    with git_blobs(repo, entries, deadline) as contents:
        executable = set()
        staged_paths = {os.fsdecode(row.split(b'\t', 1)[1]) for row in records} if revision is None else None
        selected = set(contents) if specification is None else required_sources(contents, specification,
            executable=executable, staged_paths=staged_paths)
        # Freshness input receipt only; it never suppresses a check.
        read_set = os.environ.get('WS_COMMIT_READ_SET')
        if read_set is not None:
            with open(read_set, 'a') as receipt:
                receipt.write(json.dumps({'root': str(repo), 'paths': sorted(selected)}) + '\n')
        for path, _, mode in entries:
            if str(path) not in selected:
                continue
            if time.time() >= deadline:
                raise TimeoutError('Staged source preparation exceeded five-second budget')
            target = tree / str(path)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(contents[str(path)])
            if mode == b'100755':
                target.chmod(0o755)
        (tree / '.push-tracked.json').write_text(json.dumps([os.fsdecode(row.split(b'\t', 1)[1]) for row in records]))
        # Tests may use the newest verified generation, never loose shared outputs.
        # This does not establish a current-source type proof.
        revision = None
        cache = Path(__file__).resolve().parent / 'push_input_cache.py'
        full_generation = specification is None or 'test/manifest-declarations.test.ts' in specification.get('guards', [])
        if cache.exists() and (repo / 'tmp/push-input-cache/entries.json').exists():
            revision = runpy.run_path(str(cache))['restore_tests'](repo, tree, records,
                time.monotonic() + max(0, min(deadline - time.time(), .75)),
                include=None if full_generation else lambda name: name == 'lint/shard-words.generated.json')
        if specification is not None and revision is not None:
            if full_generation:
                selected = required_sources(contents, specification, tree, executable)
            selected.update(str(path.relative_to(tree)) for path in (tree / 'lint').rglob('*') if path.is_file())
            for name in selected:
                if name in contents and not (tree / name).exists():
                    target = tree / name; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(contents[name])
            # Keep only the sealed inputs reached by this job's actual module graph.
            for folder in ['src', 'lint', 'public']:
                for path in (tree / folder).rglob('*'):
                    if path.is_file() and str(path.relative_to(tree)) not in selected:
                        path.unlink()
        # Guard ownership is current policy, not historical test input. Derive
        # it through the same static Git reader as the push gate, using exactly
        # the records captured above (never a later shared-index observation).
        helper = tree / 'scripts/git-source-view.mjs'
        if 'scripts/gen-shard-words.mjs' in contents and helper.exists():
            program = """import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {gitSourceView,installGitSourceView,deriveGitVocabulary}=await import(pathToFileURL(process.argv[1]).href);
const view=gitSourceView(process.argv[2],'HEAD');
view.files.clear();view.directories.clear();view.directories.add('');
for(const record of readFileSync(0,'utf8').split(String.fromCharCode(0))) {
 if(record==='')continue;
 const at=record.indexOf(String.fromCharCode(9)),[mode,,oid]=record.slice(0,at).split(' '),name=record.slice(at+1);
 if(mode!=='100644'&&mode!=='100755')continue;
 view.files.set(name,oid);
 const parts=name.split('/');parts.pop();
 while(parts.length>0){view.directories.add(parts.join('/'));parts.pop();}
}
installGitSourceView(view);await deriveGitVocabulary(view);
process.stdout.write(view.read('lint/shard-words.generated.json'));
"""
            vocabulary = subprocess.check_output(['node', '--input-type=module', '-e', program, str(helper), str(repo)],
                input=b'\0'.join(records) + b'\0', timeout=max(.01, deadline - time.time()))
            target = tree / 'lint/shard-words.generated.json'
            target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(vocabulary)
        # Imported asset URLs are part of these source guards. Read exact Git
        # objects in one batch; never take the shared working build-copy assets.
        blobs = {os.fsdecode(row.split(b'\t', 1)[1]): row.split(b'\t', 1)[0].split()[2] for row in records}
        assets = set()
        for folder in ['src', 'test']:
            for source in (tree / folder).rglob('*'):
                if specification is not None and str(source.relative_to(tree)) not in executable | set(specification.get('files', [])):
                    continue
                if source.suffix not in {'.ts', '.tsx', '.mts', '.mjs', '.js'}:
                    continue
                for value in re.findall(r"""(?:from\s+|import\s*\(\s*|import\s*)["']([^"']+\.(?:png|jpe?g|webp|svg|hdr|glb|bin|wasm|json)(?:\?[^"']*)?)["']""", source.read_text()):
                    value = value.split('?', 1)[0]
                    name = value[1:] if value.startswith('/src/') else os.path.normpath(str(source.relative_to(tree).parent / value))
                    if name in blobs and not (tree / name).exists():
                        assets.add(name)
        names = sorted(assets)
        raw = git('cat-file', '--batch', input=b''.join(blobs[name] + b'\n' for name in names))
        at = 0
        for name in names:
            end = raw.index(b'\n', at)
            size = int(raw[at:end].split()[2])
            target = tree / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw[end + 1:end + 1 + size])
            at = end + size + 2
        (tree / '.commit-inputs.json').write_text(json.dumps({'testRevision': revision}))


if __name__ == '__main__':
    try:
        staged_source(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve(), float(sys.argv[3]),
                      None if len(sys.argv) < 5 or sys.argv[4] == '-' else sys.argv[4],
                      json.loads(sys.argv[5]) if len(sys.argv) > 5 else None)
    except (TimeoutError, subprocess.TimeoutExpired) as error:
        print('pre-commit source preparation deferred: ' + str(error), file=sys.stderr)
        raise SystemExit(124)
