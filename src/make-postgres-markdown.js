#!/usr/bin/env node
import program from 'commander'

import makeMarkdown from './index'

program
  .version('0.2.1')
  .option('-h, --host [host]', 'Host', 'localhost')
  .option('-p, --port [port]', 'Port', 5432)
  .option('-d, --database [database]', 'Database', 'localhost')
  .option('-s, --schema [schema]', 'Schema', 'public')
  .option('-u, --user [user]', 'User', 'postgres')
  .option('-W, --password [password]', 'Password')
  .option('-o, --output [output]', 'Output file name', 'index.html.md')
  .option('-i, --ignore <ignore>', 'Pattern of objects to ignore')
  .parse(process.argv)

makeMarkdown(program)
