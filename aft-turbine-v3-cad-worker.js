/* Reads a STEP, IGES or BREP file off the page's main thread with occt-import-js
 * (OpenCascade compiled to WebAssembly). The file never leaves the browser. */
importScripts("vendor/occt-import-js/occt-import-js.js");
let ready = null;
onmessage = async ev => {
  try {
    ready = ready || occtimportjs({ locateFile: f => "vendor/occt-import-js/" + f });
    const occt = await ready;
    const r = occt.ReadFile(ev.data.format, ev.data.buffer, ev.data.params);
    postMessage({ ok: !!(r && r.success), r, err: r && r.success ? "" : "The reader couldn't make sense of this file." });
  } catch (e) {
    postMessage({ ok: false, err: String(e && e.message || e) });
  }
};
