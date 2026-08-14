export interface SaveEnvelope {
  __alteruSaveEnvelope: 1
  namespaces: Record<string, unknown>
  _lastActive?: number
}

export function isSaveEnvelope(value: unknown): value is SaveEnvelope {
  return Boolean(
    value
      && typeof value === 'object'
      && (value as SaveEnvelope).__alteruSaveEnvelope === 1
      && (value as SaveEnvelope).namespaces
      && typeof (value as SaveEnvelope).namespaces === 'object',
  )
}

export function createSaveEnvelope(raw: unknown, primaryNamespace: string): SaveEnvelope {
  return isSaveEnvelope(raw)
    ? { ...raw, namespaces: { ...raw.namespaces } }
    : {
        __alteruSaveEnvelope: 1,
        namespaces: raw == null ? {} : { [primaryNamespace]: raw },
      }
}

export function readSaveNamespace<T>(envelope: SaveEnvelope, namespace: string): T | undefined {
  return envelope.namespaces[namespace] as T | undefined
}

export function writeSaveNamespace<T>(envelope: SaveEnvelope, namespace: string, value: T): SaveEnvelope {
  return {
    ...envelope,
    namespaces: { ...envelope.namespaces, [namespace]: value },
  }
}

export function removeSaveNamespace(envelope: SaveEnvelope, namespace: string): SaveEnvelope {
  const namespaces = { ...envelope.namespaces }
  delete namespaces[namespace]
  return { ...envelope, namespaces }
}
