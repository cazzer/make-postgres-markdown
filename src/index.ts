
import * as Debug from 'debug'
import { writeFileSync } from 'fs'
import * as json2md from 'json2md'
import * as pgStructure from 'pg-structure'
import { Client } from 'pg'

const d = new Debug('make-postgres-markdown')
const functionNameFromActionStatement = /execute procedure (.*)\s*\(/i

const VOLATILITY_TYPES = {
  i: 'immutable',
  s: 'stable',
  v: 'volatile'
}

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
SELECT
  pg_proc.*,
  pg_language.lanname as language,
  pg_type.typname as return_type
FROM pg_catalog.pg_proc
JOIN pg_language ON pg_language.oid = pg_proc.prolang
JOIN pg_type ON pg_type.oid = pg_proc.prorettype
WHERE proowner != 10
OR proname IN (${knownFunctions.join(',')})
  `)

  d('Extensions')
  const extensions = await client.query(`
SELECT *
FROM pg_available_extensions
WHERE installed_version IS NOT null;
  `)

  const roles = await client.query(`
    WITH membership AS (
      SELECT
        pg_auth_members.roleid AS role_id,
        array_agg(pg_authid.rolname) AS roles
      FROM pg_auth_members
      JOIN pg_authid ON pg_authid.oid = pg_auth_members.member
      GROUP BY role_id
    )
    SELECT
      pg_authid.*,
      setconfig,
      membership.roles
    FROM pg_authid
    LEFT OUTER JOIN pg_db_role_setting ON pg_db_role_setting.setrole = pg_authid.oid
    LEFT OUTER JOIN membership ON membership.role_id = pg_authid.oid;
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
    { h1: 'Roles' },
    { table: renderRoles(roles) }
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
        table: {
          headers: ['return type', 'volatility'],
          rows: [
            [func.return_type, func.provolatile]
          ]
        }
      })
      markdown.push({
        code: {
          // markdown doesn't know how to format languages like pgpsql
          language: ~func.language.indexOf('sql')
            ? 'sql'
            : func.language,
          content: func.prosrc
        }
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

  function renderRoles(roles) {
    return {
      headers: [
        'name',
        'super user',
        'inherits',
        'create role',
        'create database',
        'can login',
        'bypass RLS',
        'connection limit',
        'configuration',
        'roles granted'
      ],
      rows: roles.rows.map(role => ([
        role.rolname,
        role.rolsuper.toString(),
        role.rolinherit.toString(),
        role.rolcreaterole.toString(),
        role.rolcreatedb.toString(),
        role.rolcanlogin.toString(),
        role.rolbypassrls.toString(),
        role.rolconnlimit,
        role.setconfig || '',
        role.roles || ''
      ]))
    }
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
