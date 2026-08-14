const prefix = "ps_"

export function encodeStyleToken(style) {
  if (!style) return null
  let encoded = prefix
  for (let i = 0; i < style.length; i++) {
    encoded += style.charCodeAt(i).toString(16).padStart(4, "0")
  }
  return encoded
}

export function decodeStyleToken(name) {
  if (!name.startsWith(prefix) || (name.length - prefix.length) % 4) return null
  let style = ""
  for (let i = prefix.length; i < name.length; i += 4) {
    style += String.fromCharCode(parseInt(name.slice(i, i + 4), 16))
  }
  return style
}

export function isStyleToken(name) {
  return name.startsWith(prefix)
}
