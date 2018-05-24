
import Debug from 'debug'
import fs from 'fs'
import json2md from 'json2md'
import pgStructure from 'pg-structure'

const d = new Debug('make-postgres-markdown')


export default async function makeMarkdown(options) {
  console.time('make-postgres-markdown')
  d('Parsing schema')

  const ignore = options.ignore
    ? new RegExp(options.ignore)
    : false

  const db = await pgStructure(options, [options.schema])
  d('Building JSON representation...')
  const schema = db.schemas.get('public')
  const tables = schema.tables

  const markdown = [
    { h1: 'Tables' },
    ...renderTables(tables, 'table', ignore),
    { h1: 'Views' },
    ...renderTables(tables, 'view', ignore),
  ]

  d('Converting JSON to markdown')
  const output = json2md(markdown)

  d('Writing output')
  fs.writeFileSync(options.output, `---
title: Database Documentation

search: true
---

${output}
  `)

  d('Finished')
  console.timeEnd('make-postgres-markdown')
}

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

function renderTables(tables, kind, ignore) {
  const markdown = []

  d(`rendering tables (${kind})`)
  for (let [name, table] of tables) {
    if (
      table.kind !== kind
      || (ignore && ignore.exec(name))
    ) {
      continue
    }

    markdown.push({ h2: name })
    const markdownTable = {
      headers: [
        'column',
        'comment',
        'type',
        'default',
        'constraints',
        'values'
      ],
      rows: []
    }

    for (let [name, column] of table.columns) {
      markdownTable.rows.push([
        name || '',
        column.comment || '',
        column.type || '',
        column.default || '',
        renderConstraints(column) || '',
        column.enumValues ? column.enumValues.join(', ') : ''
      ])
    }
    markdown.push({ table: markdownTable })
  }

  return markdown
}
