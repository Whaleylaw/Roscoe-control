import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

export async function GET() {
  const specPath = join(process.cwd(), 'openapi.json')
  const spec = readFileSync(specPath, 'utf-8')

  return new NextResponse(spec, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
