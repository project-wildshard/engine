/** Shared declaration-only shard entry law; inspect syntax without running it. */
export function declarationConfigProgram(program) {
  const wrappers = new Set(program.body.filter(row => row.type === 'ImportDeclaration')
    .flatMap(row => row.specifiers.filter(spec => spec.type === 'ImportSpecifier'
      && ['parseShardfile', 'emptyShardfile'].includes(spec.imported.name ?? spec.imported.value))
      .map(spec => spec.local.name)));
  const declaration = node => {
    if (node === null || typeof node !== 'object') return true;
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ClassDeclaration', 'ClassExpression',
      'NewExpression', 'AssignmentExpression', 'UpdateExpression', 'BinaryExpression', 'LogicalExpression',
      'ConditionalExpression', 'AwaitExpression', 'TaggedTemplateExpression', 'ImportExpression'].includes(node.type)) return false;
    if (node.type === 'CallExpression' && !(node.callee.type === 'Identifier' && wrappers.has(node.callee.name))) return false;
    if (node.type === 'UnaryExpression' && !(['-', '+'].includes(node.operator) && node.argument.type === 'Literal')) return false;
    return Object.entries(node).every(([name, child]) => name === 'parent' || name === 'typeAnnotation' || name === 'typeParameters'
      || (Array.isArray(child) ? child.every(declaration) : declaration(child)));
  };
  return program.body.every(row => ['ImportDeclaration', 'ExportDefaultDeclaration', 'ExportNamedDeclaration',
    'VariableDeclaration', 'TSTypeAliasDeclaration', 'TSInterfaceDeclaration', 'EmptyStatement'].includes(row.type) && declaration(row));
}
