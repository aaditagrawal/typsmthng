/* tslint:disable */
/* eslint-disable */

export class IncrServer {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  set_attach_debug_info(attach: boolean): void;
  reset(): void;
  current(): Uint8Array | undefined;
}

export class ProxyContext {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates a new `ProxyContext` instance.
   */
  constructor(context: any);
  /**
   * A convenience function to untar a tarball and call a callback for each
   * entry.
   */
  untar(data: Uint8Array, cb: Function): void;
  /**
   * Returns the JavaScript this.
   */
  readonly context: any;
}

export class TypstCompileWorld {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  get_artifact(fmt: number, diagnostics_format: number): any;
  incr_compile(state: IncrServer, diagnostics_format: number): any;
  query(kind: number, selector: string, field?: string | null): string;
  title(kind: number): string | undefined;
  compile(kind: number, diagnostics_format: number): any;
}

export class TypstCompiler {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  add_source(path: string, content: string): boolean;
  map_shadow(path: string, content: Uint8Array): boolean;
  set_inputs(inputs: any): void;
  get_artifact(fmt: string, diagnostics_format: number): any;
  incr_compile(main_file_path: string, inputs: (Array<any>)[] | null | undefined, state: IncrServer, diagnostics_format: number): any;
  reset_shadow(): void;
  unmap_shadow(path: string): boolean;
  get_loaded_fonts(): string[];
  create_incr_server(): IncrServer;
  get_semantic_tokens(offset_encoding: string, file_path?: string | null, result_id?: string | null): object;
  get_semantic_token_legend(): any;
  query(main_file_path: string, inputs: (Array<any>)[] | null | undefined, selector: string, field?: string | null): string;
  reset(): void;
  compile(main_file_path: string | null | undefined, inputs: (Array<any>)[] | null | undefined, fmt: string, diagnostics_format: number): any;
  get_ast(main_file_path: string): string;
  snapshot(root?: string | null, main_file_path?: string | null, inputs?: (Array<any>)[] | null): TypstCompileWorld;
  set_fonts(fonts: TypstFontResolver): void;
}

export class TypstCompilerBuilder {
  free(): void;
  [Symbol.dispose](): void;
  add_raw_font(data: Uint8Array): Promise<void>;
  add_lazy_font(font: any, blob: Function): Promise<void>;
  set_access_model(context: any, mtime_fn: Function, is_file_fn: Function, real_path_fn: Function, read_all_fn: Function): Promise<void>;
  set_package_registry(context: any, real_resolve_fn: Function): Promise<void>;
  build(): Promise<TypstCompiler>;
  set_dummy_access_model(): void;
  constructor();
}

export class TypstFontResolver {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
}

export class TypstFontResolverBuilder {
  free(): void;
  [Symbol.dispose](): void;
  build(): Promise<TypstFontResolver>;
  /**
   * Adds font data to the searcher.
   */
  add_raw_font(buffer: Uint8Array): void;
  /**
   * Adds callback that loads font data lazily to the searcher.
   * `get_font_info` can be used to get the font info.
   */
  add_lazy_font(font: any, blob: Function): void;
  get_font_info(buffer: Uint8Array): any;
  constructor();
}

/**
 * @deprecated use TypstFontResolverBuilder instead
 */
export function get_font_info(buffer: Uint8Array): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_incrserver_free: (a: number, b: number) => void;
  readonly __wbg_typstcompiler_free: (a: number, b: number) => void;
  readonly __wbg_typstcompilerbuilder_free: (a: number, b: number) => void;
  readonly __wbg_typstcompileworld_free: (a: number, b: number) => void;
  readonly __wbg_typstfontresolver_free: (a: number, b: number) => void;
  readonly __wbg_typstfontresolverbuilder_free: (a: number, b: number) => void;
  readonly get_font_info: (a: number) => number;
  readonly incrserver_current: (a: number, b: number) => void;
  readonly incrserver_reset: (a: number) => void;
  readonly incrserver_set_attach_debug_info: (a: number, b: number) => void;
  readonly typstcompiler_add_source: (a: number, b: number, c: number, d: number, e: number) => number;
  readonly typstcompiler_compile: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
  readonly typstcompiler_create_incr_server: (a: number, b: number) => void;
  readonly typstcompiler_get_artifact: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly typstcompiler_get_ast: (a: number, b: number, c: number, d: number) => void;
  readonly typstcompiler_get_loaded_fonts: (a: number, b: number) => void;
  readonly typstcompiler_get_semantic_token_legend: (a: number, b: number) => void;
  readonly typstcompiler_get_semantic_tokens: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
  readonly typstcompiler_incr_compile: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
  readonly typstcompiler_map_shadow: (a: number, b: number, c: number, d: number, e: number) => number;
  readonly typstcompiler_query: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
  readonly typstcompiler_reset: (a: number, b: number) => void;
  readonly typstcompiler_reset_shadow: (a: number) => void;
  readonly typstcompiler_set_fonts: (a: number, b: number, c: number) => void;
  readonly typstcompiler_set_inputs: (a: number, b: number, c: number) => void;
  readonly typstcompiler_snapshot: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
  readonly typstcompiler_unmap_shadow: (a: number, b: number, c: number) => number;
  readonly typstcompilerbuilder_add_lazy_font: (a: number, b: number, c: number) => number;
  readonly typstcompilerbuilder_add_raw_font: (a: number, b: number) => number;
  readonly typstcompilerbuilder_build: (a: number) => number;
  readonly typstcompilerbuilder_new: (a: number) => void;
  readonly typstcompilerbuilder_set_access_model: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
  readonly typstcompilerbuilder_set_dummy_access_model: (a: number, b: number) => void;
  readonly typstcompilerbuilder_set_package_registry: (a: number, b: number, c: number) => number;
  readonly typstcompileworld_compile: (a: number, b: number, c: number, d: number) => void;
  readonly typstcompileworld_get_artifact: (a: number, b: number, c: number, d: number) => void;
  readonly typstcompileworld_incr_compile: (a: number, b: number, c: number, d: number) => void;
  readonly typstcompileworld_query: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
  readonly typstcompileworld_title: (a: number, b: number, c: number) => void;
  readonly typstfontresolverbuilder_add_lazy_font: (a: number, b: number, c: number, d: number) => void;
  readonly typstfontresolverbuilder_add_raw_font: (a: number, b: number, c: number) => void;
  readonly typstfontresolverbuilder_build: (a: number) => number;
  readonly typstfontresolverbuilder_get_font_info: (a: number, b: number, c: number) => void;
  readonly typstfontresolverbuilder_new: (a: number) => void;
  readonly __wbg_proxycontext_free: (a: number, b: number) => void;
  readonly proxycontext_context: (a: number) => number;
  readonly proxycontext_untar: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly proxycontext_new: (a: number) => number;
  readonly qcms_profile_precache_output_transform: (a: number) => void;
  readonly lut_inverse_interp16: (a: number, b: number, c: number) => number;
  readonly lut_interp_linear16: (a: number, b: number, c: number) => number;
  readonly qcms_enable_iccv4: () => void;
  readonly qcms_profile_is_bogus: (a: number) => number;
  readonly qcms_transform_data_bgra_out_lut: (a: number, b: number, c: number, d: number) => void;
  readonly qcms_transform_data_bgra_out_lut_precache: (a: number, b: number, c: number, d: number) => void;
  readonly qcms_transform_data_rgb_out_lut: (a: number, b: number, c: number, d: number) => void;
  readonly qcms_transform_data_rgb_out_lut_precache: (a: number, b: number, c: number, d: number) => void;
  readonly qcms_transform_data_rgba_out_lut: (a: number, b: number, c: number, d: number) => void;
  readonly qcms_transform_data_rgba_out_lut_precache: (a: number, b: number, c: number, d: number) => void;
  readonly qcms_transform_release: (a: number) => void;
  readonly qcms_white_point_sRGB: (a: number) => void;
  readonly __wasm_bindgen_func_elem_699: (a: number, b: number, c: number) => void;
  readonly __wasm_bindgen_func_elem_694: (a: number, b: number) => void;
  readonly __wasm_bindgen_func_elem_29462: (a: number, b: number, c: number, d: number) => void;
  readonly __wbindgen_export: (a: number, b: number) => number;
  readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_export3: (a: number) => void;
  readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
  readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
