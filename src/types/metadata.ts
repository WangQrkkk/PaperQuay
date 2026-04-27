export interface MetadataLookupRequest {
  doi?: string | null;
  title?: string | null;
  path?: string | null;
}

export interface MetadataLookupResult {
  source: string;
  doi: string | null;
  title: string | null;
  authors: string[];
  year: string | null;
  publication: string | null;
  url: string | null;
  abstractText: string | null;
}
