
import { wx } from "./wx-polyfill";
let __capturedApp__ = null;
function App(cfg) { __capturedApp__ = cfg; if (typeof window !== "undefined") { (window).__wxApp__ = cfg; } }
function getApp() { return __capturedApp__ ?? {}; }

App({
  onLaunch() {
    console.log('Mini Program launched');
  },
  onShow() {},
  onHide() {},
  globalData: {}
});

export default function __runApp__() {
  // app.js already ran at module evaluation time
}
