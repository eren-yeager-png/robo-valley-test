// A small stand-in for Leaflet so the Find a Service widgets can be driven in jsdom. Nothing real is loaded or contacted.
// Markers get a real DOM element (like Leaflet's), so hover, focus and click on them can be simulated.
export type Calls = {
  circle: any[]; markers: any[]; fit: any[]; views: any[]; flyTo: any[]; flyToBounds: any[]; popups: any[]; closePopup: number; zoom: number;
  me: any[]; acc: any[]; tileLayers: any[]; gl: any[]; glRemoved: number; glHandlers: Record<string, Array<(e?: any) => void>>;
};
export const newCalls = (): Calls => ({
  circle: [], markers: [], fit: [], views: [], flyTo: [], flyToBounds: [], popups: [], closePopup: 0, zoom: 5,
  me: [], acc: [], tileLayers: [], gl: [], glRemoved: 0, glHandlers: {},
});

/** `withGl` also provides the maplibre-gl-leaflet bridge (`L.maplibreGL`) and `window.maplibregl`, as if both libraries had loaded. */
export function fakeLeaflet(calls: Calls, withGl = false) {
  let groups = 0;
  const L: any = {
    map: () => ({
      once(_e: string, fn: () => void) { (calls as any).onceMoveEnd = fn; }, // fired when the fake "flight" lands
      on() {}, fitBounds: (...a: any[]) => calls.fit.push(a), setView: (...a: any[]) => calls.views.push(a), panTo() {},
      flyTo: (...a: any[]) => { calls.flyTo.push(a); calls.zoom = a[1]; const f = (calls as any).onceMoveEnd; (calls as any).onceMoveEnd = undefined; if (f) f(); }, flyToBounds: (...a: any[]) => calls.flyToBounds.push(a),
      closePopup: () => { calls.closePopup++; }, getZoom: () => calls.zoom, scrollWheelZoom: { enable() {}, disable() {} },
    }),
    tileLayer: (url: string, o: any) => { calls.tileLayers.push({ url, o }); return { on() { return this; }, addTo() { return this; } }; },
    layerGroup: () => {
      const first = groups++ === 0; // the first group holds the search results; the second one holds the visitor's own position
      return { addTo() { return this; }, clearLayers() { if (first) { calls.markers.length = 0; calls.circle.length = 0; } else { calls.me.length = 0; calls.acc.length = 0; } } };
    },
    circle: (c: any, o: any) => {
      const k: any = { c, o, addTo() { return this; }, getBounds: () => "bounds", setRadius(r: number) { k.o = { ...k.o, radius: r }; } };
      if (o && o.className === "rv-fas-acc") calls.acc.push(k);
      else calls.circle.push(k);
      return k;
    },
    marker: (c: any, o: any) => {
      const el = document.createElement("div");
      el.className = "leaflet-marker-icon";
      el.tabIndex = o && o.keyboard ? 0 : -1;
      if (o && o.icon && o.icon.html instanceof Node) el.appendChild(o.icon.html);
      const m: any = { c, o, el, addTo() { document.body.appendChild(el); return this; }, on() { return this; }, getElement: () => el, getLatLng: () => c, openPopup() {} };
      const cls = o && o.icon && o.icon.className;
      if (cls === "rv-fas-origin-wrap") (calls as any).origin = m;
      else if (cls === "rv-fas-me-wrap") calls.me.push(m);
      else calls.markers.push(m);
      return m;
    },
    popup: (o: any) => {
      const p: any = { o, setLatLng(l: any) { p.ll = l; return p; }, setContent(n: any) { p.content = n; return p; }, openOn() { calls.popups.push(p); return p; }, update() { (calls as any).popupUpdates = ((calls as any).popupUpdates || 0) + 1; } };
      return p;
    },
    DomEvent: { disableScrollPropagation() {} },
    divIcon: (o: any) => o,
  };
  if (withGl) {
    L.maplibreGL = (opts: any) => {
      const layer: any = {
        opts, addTo() { return layer; }, remove() { calls.glRemoved++; },
        getMaplibreMap: () => ({ on(ev: string, fn: (e?: any) => void) { (calls.glHandlers[ev] ||= []).push(fn); } }),
      };
      calls.gl.push(layer);
      return layer;
    };
    (window as any).maplibregl = {};
  }
  (window as any).L = L;
}
