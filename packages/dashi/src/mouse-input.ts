export function filterWheelInput(data: string): -3 | 3 | string {
  if (!data.startsWith('\u001B[<')) return data
  const match = /^(64|65);\d+;\d+M$/u.exec(data.slice(3))
  return match?.[1] === '64' ? 3 : match?.[1] === '65' ? -3 : data
}
