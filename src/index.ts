
import Debug from 'debug'
import { writeFileSync } from 'fs'
import json2md from 'json2md'
import pgStructure from 'pg-structure'
import { Client } from 'pg'

const d = new Debug('make-postgres-markdown')
const functionNameFromActionStatement = /execute procedure (.*)\s*\(/i

export default async function makeMarkdown(options) {
  console.time('make-postgres-markdown')
  d('Parsing schema')

  const ignore = options.ignore
    ? new RegExp(options.ignore)
    : false

  const client = new Client(options)
  client.connect()

  d('Triggers')
  const triggers = await client.query(`
SELECT *
from information_schema.triggers
WHERE event_object_schema = '${options.schema}'
  `)

  // get all functions referenced by a trigger
  const knownFunctions = []
  triggers.rows.forEach(trigger => {
    const match = functionNameFromActionStatement.exec(trigger.action_statement)
    if (match.length > 1) {
      knownFunctions.push(`'${match[1]}'`)
    }
  })

  d('Building JSON from manual queries...')
  d('Functions')
  const functions = await client.query(`
SELECT *
FROM pg_catalog.pg_proc
WHERE proowner != 10
OR proname IN (${knownFunctions.join(',')})
  `)

  d('Extensions')
  const extensions = await client.query(`
SELECT *
FROM pg_available_extensions
WHERE installed_version IS NOT null;
  `)

  client.end()

  const db = await pgStructure(options, [options.schema])
  d('Building JSON representation from pg-structure...')
  const schema = db.schemas.get('public')
  const tables = schema.tables

  const markdown = [
    { h1: 'Tables' },
    ...renderTables(tables, 'table', ignore),
    { h1: 'Views' },
    ...renderTables(tables, 'view', ignore),
  ]

  if (functions.rows.length) {
    markdown.push({
      h1: 'Functions'
    })

    functions.rows.forEach(func => {
      markdown.push({
        h2: func.proname
      })
      markdown.push({
        p: func.prosrc
      })
    })
  }

  if (extensions.rows) {
    markdown.push({
      h1: 'Extensions'
    })

    markdown.push({
      table: {
        headers: [
          'name',
          'version',
          'description'
        ],
        rows: extensions.rows.map(extension => ({
          name: extension.name,
          version: extension.installed_version,
          description: extension.comment
        }))
      }
    })
  }

  d('Converting JSON to markdown')
  const output = json2md(markdown)

  d('Writing output')
  writeFileSync(options.output, `---
title: Database Documentation

search: true
---

${output}
  `)

  d('Finished')
  console.timeEnd('make-postgres-markdown')

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

      const tableTriggers = triggers.rows
        .filter(
          trigger => trigger.event_object_table === name
        )
        .map(trigger => ({
          name: trigger.trigger_name,
          timing: trigger.action_timing,
          orientation: trigger.action_orientation,
          manipulation: trigger.event_manipulation,
          statement: actionStatementToFunctionLink(trigger.action_statement)
        }))

      if (tableTriggers.length) {
        markdown.push({ h3: 'Triggers' })
        markdown.push({
          table: {
            headers: [
              'name',
              'timing',
              'orientation',
              'manipulation',
              'statement'
            ],
            rows: tableTriggers
          }
        })
      }
    }

    return markdown
  }
}

function actionStatementToFunctionLink(actionStatement) {
  const functionName = functionNameFromActionStatement.exec(actionStatement)
  if (functionName.length > 1) {
    return actionStatement.replace(
      functionName[1],
      `<a href="#${functionName[1]}">${functionName[1]}</a>`
    )
  }

  return actionStatement
}
