import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from '@typescript/typescript6';
import { formatSource } from '../scripts/format-package.mjs';

/** Follow referenced schema declarations, including the compiled feature registry's required sections.
 * Unrelated legacy schemas in the same file are not part of the client plan's API. */
export function clientPlanSchemaViolations(root) {
  const visited = new Set(), modules = new Map(), failures = [];
  const text = node => node && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : '';
  function module(file) {
    if (modules.has(file)) return modules.get(file);
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const declarations = new Map(), imports = new Map(), exported = [];
    for (const statement of source.statements) {
      const names = [];
      if (ts.isExportAssignment(statement) && !statement.isExportEquals) { declarations.set('default', statement.expression); exported.push('default'); }
      if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) { declarations.set(declaration.name.text, declaration); names.push(declaration.name.text); }
      }
      else if ((ts.isFunctionDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) && statement.name) {
        declarations.set(statement.name.text, statement); names.push(statement.name.text);
      }
      if (statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) exported.push(...names);
      if (statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) { declarations.set('default', statement); exported.push('default'); }
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const name = statement.moduleSpecifier.text;
        const target = name.startsWith('.') ? resolve(dirname(file), name.endsWith('.ts') ? name : `${name}.ts`) : name.startsWith('@wildshard/format/') ? formatSource(root, `${name.slice('@wildshard/format/'.length)}.ts`) : null;
        const bindings = statement.importClause?.namedBindings;
        if (target !== null && existsSync(target) && statement.importClause?.name)
          imports.set(statement.importClause.name.text, { file: target, name: 'default' });
        if (target !== null && existsSync(target) && bindings && ts.isNamespaceImport(bindings))
          imports.set(bindings.name.text, { file: target, name: '*' });
        if (target !== null && existsSync(target) && bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements)
          imports.set(binding.name.text, { file: target, name: binding.propertyName?.text ?? binding.name.text });
      }
    }
    const value = { source, declarations, imports, exported }; modules.set(file, value); return value;
  }
  function visit(file, name) {
    const key = `${file}#${name}`;
    if (visited.has(key)) return;
    visited.add(key);
    const loaded = module(file), imported = loaded.imports.get(name);
    if (imported) { visit(imported.file, imported.name); return; }
    if (name === '*') { for (const exported of loaded.exported) visit(file, exported); return; }
    const declaration = loaded.declarations.get(name);
    if (!declaration) { failures.push(`${file}: missing plan schema declaration ${name}`); return; }
    function walk(node) {
      if (ts.isIdentifier(node)) {
        if (node.text === 'BorrowedOwnerPath') failures.push(`${file}: BorrowedOwnerPath is not a client feature schema`);
        const parent = node.parent;
        const property = (ts.isPropertyAssignment(parent) || ts.isPropertyAccessExpression(parent) || ts.isPropertySignature(parent)) && parent.name === node;
        if (!property && (loaded.declarations.has(node.text) || loaded.imports.has(node.text))) visit(file, node.text);
      }
      if (ts.isObjectLiteralExpression(node)) {
        const names = new Set(node.properties.map(property => text(property.name)));
        if (names.has('owner') && names.has('path')) failures.push(`${file}: reflected {owner,path} is not a client feature schema`);
      }
      if (ts.isInterfaceDeclaration(node) || ts.isTypeLiteralNode(node)) {
        const names = new Set(node.members.map(member => text(member.name)));
        if (names.has('owner') && names.has('path')) failures.push(`${file}: reflected owner-path type is not a client feature schema`);
      }
      ts.forEachChild(node, walk);
    }
    walk(declaration);
  }
  const plan = formatSource(root, 'clientPlan.ts');
  for (const name of module(plan).exported) visit(plan, name);
  const registry = resolve(root, 'src/client/game/shardfile/clientPlan.ts');
  if (existsSync(registry)) {
    const names = new Set();
    const required = node => {
      if (ts.isPropertyAssignment(node) && text(node.name) === 'sections') {
        if (!ts.isArrayLiteralExpression(node.initializer) || node.initializer.elements.some(name => !ts.isStringLiteral(name)))
          failures.push(`${registry}: client feature dependencies require literal section names`);
        else for (const name of node.initializer.elements) names.add(name.text);
      }
      ts.forEachChild(node, required);
    };
    required(module(registry).source);
    const platform = formatSource(root, 'platformDataSections.ts'), loaded = module(platform);
    const tables = [];
    for (const name of ['PLATFORM_DATA_SECTIONS', 'CLIENT_ENVELOPE_SECTIONS']) {
      const table = loaded.declarations.get(name)?.initializer;
      if (table === undefined && name === 'CLIENT_ENVELOPE_SECTIONS') continue;
      const rows = table && ts.isAsExpression(table) ? table.expression : table;
      if (!rows || !ts.isObjectLiteralExpression(rows)) failures.push(`${platform}: client section schema table is not static`);
      else tables.push(rows);
    }
    for (const name of names) {
      const matches = tables.flatMap(rows => rows.properties.filter(property => text(property.name) === name));
      if (matches.length > 1) { failures.push(`${platform}: duplicate client section schema ${name}`); continue; }
      const row = matches.at(0);
      const schema = row && ts.isPropertyAssignment(row) && ts.isObjectLiteralExpression(row.initializer)
        ? row.initializer.properties.find(property => text(property.name) === 'schema') : null;
      if (!schema || !ts.isPropertyAssignment(schema) || !ts.isIdentifier(schema.initializer)) failures.push(`${platform}: missing client section schema ${name}`);
      else visit(platform, schema.initializer.text);
    }
  }
  return [...new Set(failures)];
}
