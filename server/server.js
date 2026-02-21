import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import app from './app.js'

app.use('*', serveStatic({ root: `${import.meta.dirname}/../docs` }))

serve(app, ({ port }) => console.log(`http://localhost:${port}`))
