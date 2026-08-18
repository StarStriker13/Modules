import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const lockfilePath = path.join(projectRoot, 'package-lock.json')
const outputRoot = path.join(projectRoot, 'licenses')
const packageOutputRoot = path.join(outputRoot, 'packages')
const licenseFilenamePattern =
  /^(licen[cs]e|copying|notice|copyright)([._-].*|$)/i

const lockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'))
const packages = new Map()

for (const [relativePackagePath, lockEntry] of Object.entries(
  lockfile.packages,
)) {
  if (!relativePackagePath || !lockEntry.version) continue

  const packageRoot = path.join(projectRoot, relativePackagePath)
  const manifestPath = path.join(packageRoot, 'package.json')
  if (!fs.existsSync(manifestPath)) continue

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (!manifest.name || !manifest.version) continue

  const key = `${manifest.name}@${manifest.version}`
  const existing = packages.get(key)
  const dependencyType = lockEntry.dev ? 'development' : 'production'

  if (existing) {
    if (dependencyType === 'production') existing.dependencyType = 'production'
    existing.installPaths.add(relativePackagePath)
    continue
  }

  packages.set(key, {
    name: manifest.name,
    version: manifest.version,
    license: normalizeLicense(manifest.license ?? lockEntry.license),
    dependencyType,
    packageRoot,
    installPaths: new Set([relativePackagePath]),
  })
}

fs.rmSync(outputRoot, { recursive: true, force: true })
fs.mkdirSync(packageOutputRoot, { recursive: true })

const rows = []
const sortedPackages = [...packages.values()].sort((a, b) =>
  `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
)

for (const packageInfo of sortedPackages) {
  const sourceFiles = findLicenseFiles(packageInfo.packageRoot)
  const outputFilename = makeOutputFilename(
    packageInfo.name,
    packageInfo.version,
  )
  const relativeOutputPath = path.posix.join('packages', outputFilename)
  const outputPath = path.join(packageOutputRoot, outputFilename)
  const sourceDescription = sourceFiles.length
    ? sourceFiles.map((file) => path.basename(file)).join('; ')
    : 'No bundled license text found'

  const sections = [
    `Package: ${packageInfo.name}`,
    `Version: ${packageInfo.version}`,
    `Declared license: ${packageInfo.license}`,
    `Source files: ${sourceDescription}`,
  ]

  if (sourceFiles.length) {
    for (const sourceFile of sourceFiles) {
      sections.push(
        `${'='.repeat(80)}\n${path.basename(sourceFile)}\n${'='.repeat(80)}\n\n${fs
          .readFileSync(sourceFile, 'utf8')
          .trim()}`,
      )
    }
  } else {
    sections.push(
      'The installed package does not contain a conventionally named LICENSE, COPYING, NOTICE, or COPYRIGHT file. Review the package source before distribution.',
    )
  }

  fs.writeFileSync(outputPath, `${sections.join('\n\n')}\n`)
  rows.push([
    packageInfo.name,
    packageInfo.version,
    packageInfo.license,
    packageInfo.dependencyType,
    [...packageInfo.installPaths].sort().join('; '),
    sourceDescription,
    relativeOutputPath,
  ])
}

const csvHeader = [
  'package',
  'version',
  'license',
  'dependency_type',
  'install_paths',
  'license_sources',
  'text_file',
]
const csv = [csvHeader, ...rows]
  .map((row) => row.map(csvEscape).join(','))
  .join('\n')
fs.writeFileSync(path.join(outputRoot, 'licenses.csv'), `${csv}\n`)

const missingCount = rows.filter(
  (row) => row[5] === 'No bundled license text found',
).length
console.log(`Generated ${rows.length} package license files in ${outputRoot}`)
console.log(
  `${missingCount} packages did not include a conventionally named license file`,
)

function normalizeLicense(license) {
  if (!license) return 'UNKNOWN'
  if (typeof license === 'string') return license
  if (Array.isArray(license)) return license.map(normalizeLicense).join(' OR ')
  return license.type ?? 'UNKNOWN'
}

function findLicenseFiles(packageRoot) {
  return fs
    .readdirSync(packageRoot, { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && licenseFilenamePattern.test(entry.name),
    )
    .map((entry) => path.join(packageRoot, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)))
}

function makeOutputFilename(packageName, version) {
  const readableName = packageName.startsWith('@')
    ? packageName.replace('/', '__')
    : packageName
  return `${readableName}@${version}.txt`.replace(/[^a-zA-Z0-9@._+-]/g, '_')
}

function csvEscape(value) {
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
