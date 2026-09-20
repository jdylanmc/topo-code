export type DiagramValue =
  | null
  | boolean
  | number
  | string
  | DiagramValue[]
  | { readonly [key: string]: DiagramValue };

export interface RenderInput {
  readonly title: string;
  readonly document: DiagramValue;
}

export interface Artifact {
  readonly kind: "html";
  readonly mediaType: "text/html";
  readonly contents: string;
  readonly renderer: {
    readonly name: string;
    readonly pin: string;
    readonly sha256: string;
  };
}
