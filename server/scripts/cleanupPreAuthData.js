console.error(
  'This destructive cleanup command is permanently disabled. Use npm run migrate:assign-legacy-owner for a dry-run-first ownership migration.',
)
process.exitCode = 1
