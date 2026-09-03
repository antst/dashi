/** Count audible BEL bytes, excluding BELs used to terminate any OSC sequence. */
export function countAudibleBells(output: string): number {
  let bells = 0
  let osc = false
  for (let index = 0; index < output.length; index++) {
    const character = output[index]
    if (!osc && character === '\u001B' && output[index + 1] === ']') {
      osc = true
      index++
    } else if (osc && character === '\u0007') {
      osc = false
    } else if (osc && character === '\u001B' && output[index + 1] === '\\') {
      osc = false
      index++
    } else if (!osc && character === '\u0007') {
      bells++
    }
  }
  return bells
}
