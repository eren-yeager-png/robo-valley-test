// A small stand-in for Leaflet so the Find a Service widgets can be driven in jsdom. Nothing real is loaded or contacted.
// Markers get a real DOM element (like Leaflet's), so hover, focus and click on them can be simulated.
export type Calls = {
  circle: any[]; markers: any[]; fit: any[]; views: any[]; flyTo: any[]; flyToBounds: any[]; popups: any[]; closePopup: number; zoom: number;
};
export const newCalls = (): Calls => ({ circle: [], markers: [], fit: [], views: [], flyTo: [], flyToBounds: [], popups: [], closePopup: 0, zoom: 5 });

export function fakeLeaflet(calls: Calls) {
  (window as any).L = {
    map: () => ({
      once(_e: string, fn: () => void) { (calls as any).onceMoveEnd = fn; }, // fired when the fake "flight" lands
      on() {}, fitBounds: (...a: any[]) => calls.fit.push(a), setView: (...a: any[]) => calls.views.push(a), panTo() {},
      flyTo: (...a: any[]) => { calls.flyTo.push(a); calls.zoom = a[1]; const f = (calls as any).onceMoveEnd; (calls as any).onceMoveEnd = undefined; if (f) f(); }, flyToBounds: (...a: any[]) => calls.flyToBounds.push(a),
      closePopup: () => { calls.closePopup++; }, getZoom: () => calls.zoom, scrollWheelZoom: { enable() {}, disable() {} },
    }),
    tileLayer: () => ({ on() { return this; }, addTo() { return this; } }),
    layerGroup: () => ({ addTo() { return this; }, clearLayers() { calls.markers.length = 0; calls.circle.length = 0; } }),
    circle: (c: any, o: any) => {
      const k: any = { c, o, addTo() { return this; }, getBounds: () => "bounds", setRadius(r: number) { k.o = { ...k.o, radius: r }; } };
      calls.circle.push(k);
      return k;
    },
    marker: (c: any, o: any) => {
      const el = document.createElement("div");
      el.className = "leaflet-marker-icon";
      el.tabIndex = o && o.keyboard ? 0 : -1;
      if (o && o.icon && o.icon.html instanceof Node) el.appendChild(o.icon.html);
      const m: any = { c, o, el, addTo() { document.body.appendChild(el); return this; }, on() { return this; }, getElement: () => el, getLatLng: () => c, openPopup() {} };
      if (!(o && o.icon && o.icon.className === "rv-fas-origin-wrap")) calls.markers.push(m);
      else (calls as any).origin = m;
      return m;
    },
    popup: (o: any) => {
      const p: any = { o, setLatLng(l: any) { p.ll = l; return p; }, setContent(n: any) { p.content = n; return p; }, openOn() { calls.popups.push(p); return p; } };
      return p;
    },
    DomEvent: { disableScrollPropagation() {} },
    divIcon: (o: any) => o,
  };
}
