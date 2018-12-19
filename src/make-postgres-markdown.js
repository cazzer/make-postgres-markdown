#!/usr/bin/env node

import Debug from 'debug'
import program from 'commander'
import fs from 'fs'
import json2md from 'json2md'
import pgStructure from 'pg-structure'

const d = new Debug('make-postgres-markdown')

program
  .version('0.1.0')
  .option('-h, --host [host]', 'Host', 'localhost')
  .option('-p, --port [port]', 'Port', 5432)
  .option('-d, --database [database]', 'Database', 'localhost')
  .option('-s, --schema [schema]', 'Schema', 'public')
  .option('-u, --user [user]', 'User', 'postgres')
  .option('-W, --password [password]', 'Password')
  .option('-o, --output [output]', 'Output file name', 'index.html.md')
  .option('-i, --ignore <ignore>', 'Pattern of objects to ignore')
  .parse(process.argv)

console.time('make-postgres-markdown')
d('Parsing schema')

const ignore = program.ignore
  ? new RegExp(program.ignore)
  : false

pgStructure(program, [program.schema])
  .then(db => {
    d('Building JSON representation...')
    const markdown = []
    const schema = db.schemas.get('public')
    const tables = schema.tables

    d('tables')
    markdown.push({ h1: 'Tables' })
    for (let [name, table] of tables) {
      if (ignore && ignore.exec(name)) {
        continue
      }

      markdown.push({ h2: name })
      if (table.comment) {
        markdown.push({ p: table.comment })
      }

      const markdownTable = {
        headers: [
          'column',
          'type',
          'constraints',
          'comment',
          'values',
          'default'
        ],
        rows: []
      }

      for (let [name, column] of table.columns) {
        markdownTable.rows.push([
          name || '',
          column.type || '',
          renderConstraints(column) || '',
          column.comment || '',
          column.enumValues ? column.enumValues.join(', ') : '',
          column.default || ''
        ])
      }
      markdown.push({ table: markdownTable })
    }

    d('Converting JSON to markdown')
    const output = json2md(markdown)

    d('Writing output')
    fs.writeFileSync(program.output, `---
title: Database Documentation

search: true
---

${output}
    `)

    d('Finished')
    console.timeEnd('make-postgres-markdown')
  })

function renderConstraints(column) {
  const constraints = []

  if (!column.allowNull) {
    constraints.push('NOT NULL')
  }

  for (let [constraintName, constraint] of column.foreignKeyConstraints) {
    for (let [name, column] of constraint.columns) {
      constraints.push(`[${name}](#${constraint.referencedTable.name})`)
    }
  }

  return constraints.length && constraints.join(', ')
}
