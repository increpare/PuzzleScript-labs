/** The pinned parser's raw object dictionary inherits Object.prototype. Only
 * names unchanged by lowercasing can survive its scanner. These are lookup
 * compatibility cases, never actual object registrations or vocabulary names. */
const inheritedObjectNames = new Set(Object.getOwnPropertyNames(Object.prototype).filter(name => name === name.toLowerCase()));

export function isNativeInheritedObjectName(name: string): boolean { return inheritedObjectNames.has(name); }
