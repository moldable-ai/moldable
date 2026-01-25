const message = {
  type: 'error',
  error: 'System audio capture is only supported on macOS 14.2+',
}

process.stdout.write(`${JSON.stringify(message)}\n`)
process.exit(1)
