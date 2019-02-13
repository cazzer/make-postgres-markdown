#!/usr/bin/env node
'use strict';

var _debug = require('debug');

var _debug2 = _interopRequireDefault(_debug);

var _commander = require('commander');

var _commander2 = _interopRequireDefault(_commander);

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

var _json2md = require('json2md');

var _json2md2 = _interopRequireDefault(_json2md);

var _pgStructure = require('pg-structure');

var _pgStructure2 = _interopRequireDefault(_pgStructure);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const d = new _debug2.default('make-postgres-markdown');

_commander2.default.version('0.1.0').option('-h, --host [host]', 'Host', 'localhost').option('-p, --port [port]', 'Port', 5432).option('-d, --database [database]', 'Database', 'localhost').option('-s, --schema [schema]', 'Schema', 'public').option('-u, --user [user]', 'User', 'postgres').option('-W, --password [password]', 'Password').option('-o, --output [output]', 'Output file name', 'index.html.md').option('-i, --ignore <ignore>', 'Pattern of objects to ignore').parse(process.argv);

console.time('make-postgres-markdown');
d('Parsing schema');

const ignore = _commander2.default.ignore ? new RegExp(_commander2.default.ignore) : false;

(0, _pgStructure2.default)(_commander2.default, [_commander2.default.schema]).then(db => {
  d('Building JSON representation...');
  const markdown = [];
  const schema = db.schemas.get('public');
  const tables = schema.tables;

  d('tables');
  markdown.push({ h1: 'Tables' });
  for (let [name, table] of tables) {
    if (ignore && ignore.exec(name)) {
      continue;
    }

    markdown.push({ h2: name });
    if (table.comment) {
      markdown.push({ p: table.comment });
    }

    const markdownTable = {
      headers: ['column', 'type', 'constraints', 'comment', 'values', 'default'],
      rows: []
    };

    for (let [name, column] of table.columns) {
      markdownTable.rows.push([name || '', column.type || '', renderConstraints(column) || '', column.comment || '', column.enumValues ? column.enumValues.join(', ') : '', column.default || '']);
    }
    markdown.push({ table: markdownTable });
  }

  d('Converting JSON to markdown');
  const output = (0, _json2md2.default)(markdown);

  d('Writing output');
  _fs2.default.writeFileSync(_commander2.default.output, `---
title: Database Documentation

search: true
---

${output}
    `);

  d('Finished');
  console.timeEnd('make-postgres-markdown');
});

function renderConstraints(column) {
  const constraints = [];

  if (!column.allowNull) {
    constraints.push('NOT NULL');
  }

  for (let [constraintName, constraint] of column.foreignKeyConstraints) {
    for (let [name, column] of constraint.columns) {
      constraints.push(`[${name}](#${constraint.referencedTable.name})`);
    }
  }

  return constraints.length && constraints.join(', ');
}
//# sourceMappingURL=make-postgres-markdown.js.map