// The part of fetch Confu's wrappers implement (the key pool, the usage
// meter, the provider transports): a request in, a response out.
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
