/**
 * Type declarations for protobufjs's descriptor extension.
 *
 * protobufjs ships `ext/descriptor/index.d.ts` containing two import lines and
 * no declarations at all, so `FileDescriptorSet` is invisible to TypeScript.
 * This declares the narrow surface the .fgmj importer uses (refs #294).
 *
 * Deliberately does NOT declare module 'protobufjs'. This file has no
 * top-level import or export, so it is a script, and `declare module` in a
 * script REPLACES a module's types rather than augmenting them — declaring
 * 'protobufjs' here silently erased the real `Root` and took `lookupEnum`
 * with it. The one member the extension adds to `Root` (`fromDescriptor`) is
 * handled by a narrow cast at the single call site instead.
 *
 * Mirrors the pattern in gdal-async.d.ts: declare what we use, not the library.
 */

declare module 'protobufjs/ext/descriptor/index.js' {
  /**
   * The compiled FileDescriptorSet message, as produced by
   * `protoc --descriptor_set_out`. We only ever decode one.
   */
  export const FileDescriptorSet: {
    decode(buffer: Uint8Array): object;
  };

  const descriptor: {
    FileDescriptorSet: typeof FileDescriptorSet;
  };
  export default descriptor;
}
