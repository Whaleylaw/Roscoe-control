import { relative, resolve, sep } from 'node:path'

export interface WaypointTrustedRootDefinition {
  readonly caseRoot: string
  readonly sourceRoot: string
}

export type WaypointTrustedRootRegistry = Readonly<Record<string, WaypointTrustedRootDefinition>>

export interface WaypointPackagePinInput {
  readonly packageSource: 'forgejo' | string
  readonly coreVersion: string
  readonly folderHostVersion: string
}

export interface BindWaypointProjectMetadataInput {
  readonly trustedRoots: WaypointTrustedRootRegistry
  readonly caseRootKey: string
  readonly caseRoot: string
  readonly sourceRoot: string
  readonly sourceReadonly?: boolean
  readonly questSlug: string
  readonly questVersion?: number
  readonly packagePin: WaypointPackagePinInput
}

export interface WaypointProjectBinding {
  readonly enabled: true
  readonly packageSource: string
  readonly packagePin: string
  readonly coreVersion: string
  readonly folderHostVersion: string
  readonly caseRootKey: string
  readonly caseRoot: string
  readonly sourceRoot: string
  readonly sourceReadonly: boolean
  readonly questSlug: string
  readonly questVersion: number
}

export interface ProjectWithWaypointMetadata {
  readonly id: number
  readonly workspace_id?: number
  readonly metadata?: string | Record<string, unknown> | null
}

type JsonMap = Record<string, unknown>

const SAFE_SLUG_RE = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/

export function bindWaypointProjectMetadata(
  existingMetadata: string | JsonMap | null | undefined,
  input: BindWaypointProjectMetadataInput,
): string {
  const trustedRoot = input.trustedRoots[input.caseRootKey]
  if (!trustedRoot) throw new Error(`unknown trusted root key: ${input.caseRootKey}`)
  if (!SAFE_SLUG_RE.test(input.questSlug)) throw new Error(`unsafe quest slug: ${input.questSlug}`)

  const caseRoot = assertPathWithinTrustedRoot(input.caseRoot, trustedRoot.caseRoot, 'case')
  const sourceRoot = assertPathWithinTrustedRoot(input.sourceRoot, trustedRoot.sourceRoot, 'source')

  const metadata = parseMetadataObject(existingMetadata)
  const packagePin = `@waypoint/core@${input.packagePin.coreVersion} @waypoint/folder-host@${input.packagePin.folderHostVersion}`

  metadata.waypoint = {
    ...(isJsonMap(metadata.waypoint) ? metadata.waypoint : {}),
    host_runtime: {
      enabled: true,
      package_source: input.packagePin.packageSource,
      package_pin: packagePin,
      core_version: input.packagePin.coreVersion,
      folder_host_version: input.packagePin.folderHostVersion,
    },
    trusted_roots: {
      case_root_key: input.caseRootKey,
      case_root: caseRoot,
      source_root: sourceRoot,
      source_readonly: input.sourceReadonly ?? true,
    },
    quest: {
      slug: input.questSlug,
      version: input.questVersion ?? 1,
    },
  }

  return JSON.stringify(metadata)
}

export function getWaypointProjectBinding(project: ProjectWithWaypointMetadata): WaypointProjectBinding | null {
  const metadata = parseMetadataObject(project.metadata)
  const waypoint = isJsonMap(metadata.waypoint) ? metadata.waypoint : null
  const hostRuntime = waypoint && isJsonMap(waypoint.host_runtime) ? waypoint.host_runtime : null
  const trustedRoots = waypoint && isJsonMap(waypoint.trusted_roots) ? waypoint.trusted_roots : null
  const quest = waypoint && isJsonMap(waypoint.quest) ? waypoint.quest : null

  if (!hostRuntime || !trustedRoots || !quest || hostRuntime.enabled !== true) return null

  return {
    enabled: true,
    packageSource: requireString(hostRuntime.package_source, 'waypoint.host_runtime.package_source'),
    packagePin: requireString(hostRuntime.package_pin, 'waypoint.host_runtime.package_pin'),
    coreVersion: requireString(hostRuntime.core_version, 'waypoint.host_runtime.core_version'),
    folderHostVersion: requireString(hostRuntime.folder_host_version, 'waypoint.host_runtime.folder_host_version'),
    caseRootKey: requireString(trustedRoots.case_root_key, 'waypoint.trusted_roots.case_root_key'),
    caseRoot: requireString(trustedRoots.case_root, 'waypoint.trusted_roots.case_root'),
    sourceRoot: requireString(trustedRoots.source_root, 'waypoint.trusted_roots.source_root'),
    sourceReadonly: trustedRoots.source_readonly !== false,
    questSlug: requireString(quest.slug, 'waypoint.quest.slug'),
    questVersion: typeof quest.version === 'number' ? quest.version : 1,
  }
}

function assertPathWithinTrustedRoot(path: string, trustedRoot: string, kind: 'case' | 'source'): string {
  const normalizedPath = resolve(path)
  const normalizedRoot = resolve(trustedRoot)
  const pathRelativeToRoot = relative(normalizedRoot, normalizedPath)
  if (pathRelativeToRoot.startsWith('..') || pathRelativeToRoot === '..' || pathRelativeToRoot.startsWith(`..${sep}`)) {
    throw new Error(`${path} is outside trusted ${kind} root ${trustedRoot}`)
  }
  return normalizedPath
}

function parseMetadataObject(metadata: string | JsonMap | null | undefined): JsonMap {
  if (!metadata) return {}
  if (typeof metadata === 'string') {
    const parsed: unknown = JSON.parse(metadata)
    return isJsonMap(parsed) ? { ...parsed } : {}
  }
  return { ...metadata }
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`invalid ${path}`)
  return value
}

function isJsonMap(value: unknown): value is JsonMap {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
