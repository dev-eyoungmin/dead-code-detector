export function handleRequest(payload: string, req: unknown): string {
  return payload;
}

export function onError(err: Error, data: string): string {
  return data;
}
