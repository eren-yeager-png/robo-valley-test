/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ 338:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

var __webpack_unused_export__;


var m = __webpack_require__(795);
if (true) {
  exports.H = m.createRoot;
  __webpack_unused_export__ = m.hydrateRoot;
} else { var i; }


/***/ }),

/***/ 795:
/***/ ((module) => {

module.exports = window["ReactDOM"];

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat get default export */
/******/ 	(() => {
/******/ 		// getDefaultExport function for compatibility with non-harmony modules
/******/ 		__webpack_require__.n = (module) => {
/******/ 			var getter = module && module.__esModule ?
/******/ 				() => (module['default']) :
/******/ 				() => (module);
/******/ 			__webpack_require__.d(getter, { a: getter });
/******/ 			return getter;
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};

;// external "React"
const external_React_namespaceObject = window["React"];
var external_React_default = /*#__PURE__*/__webpack_require__.n(external_React_namespaceObject);
// EXTERNAL MODULE: ./node_modules/react-dom/client.js
var client = __webpack_require__(338);
;// external ["wp","primitives"]
const external_wp_primitives_namespaceObject = window["wp"]["primitives"];
;// external "ReactJSXRuntime"
const external_ReactJSXRuntime_namespaceObject = window["ReactJSXRuntime"];
;// ./node_modules/@wordpress/icons/build-module/library/chevron-right.js
/**
 * WordPress dependencies
 */


const chevronRight = /*#__PURE__*/(0,external_ReactJSXRuntime_namespaceObject.jsx)(external_wp_primitives_namespaceObject.SVG, {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  children: /*#__PURE__*/(0,external_ReactJSXRuntime_namespaceObject.jsx)(external_wp_primitives_namespaceObject.Path, {
    d: "M10.6 6L9.4 7l4.6 5-4.6 5 1.2 1 5.4-6z"
  })
});
/* harmony default export */ const chevron_right = (chevronRight);
//# sourceMappingURL=chevron-right.js.map
;// external ["wp","components"]
const external_wp_components_namespaceObject = window["wp"]["components"];
;// ./node_modules/@wordpress/icons/build-module/library/cog.js
/**
 * WordPress dependencies
 */


const cog = /*#__PURE__*/(0,external_ReactJSXRuntime_namespaceObject.jsx)(external_wp_primitives_namespaceObject.SVG, {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  children: /*#__PURE__*/(0,external_ReactJSXRuntime_namespaceObject.jsx)(external_wp_primitives_namespaceObject.Path, {
    fillRule: "evenodd",
    d: "M10.289 4.836A1 1 0 0111.275 4h1.306a1 1 0 01.987.836l.244 1.466c.787.26 1.503.679 2.108 1.218l1.393-.522a1 1 0 011.216.437l.653 1.13a1 1 0 01-.23 1.273l-1.148.944a6.025 6.025 0 010 2.435l1.149.946a1 1 0 01.23 1.272l-.653 1.13a1 1 0 01-1.216.437l-1.394-.522c-.605.54-1.32.958-2.108 1.218l-.244 1.466a1 1 0 01-.987.836h-1.306a1 1 0 01-.986-.836l-.244-1.466a5.995 5.995 0 01-2.108-1.218l-1.394.522a1 1 0 01-1.217-.436l-.653-1.131a1 1 0 01.23-1.272l1.149-.946a6.026 6.026 0 010-2.435l-1.148-.944a1 1 0 01-.23-1.272l.653-1.131a1 1 0 011.217-.437l1.393.522a5.994 5.994 0 012.108-1.218l.244-1.466zM14.929 12a3 3 0 11-6 0 3 3 0 016 0z",
    clipRule: "evenodd"
  })
});
/* harmony default export */ const library_cog = (cog);
//# sourceMappingURL=cog.js.map
;// ./src/components/Logo.js
var _image_hub_data, _image_hub_data2;


var logoUrl = (_image_hub_data = image_hub_data) === null || _image_hub_data === void 0 ? void 0 : _image_hub_data.imageUrl;
var version = (_image_hub_data2 = image_hub_data) === null || _image_hub_data2 === void 0 ? void 0 : _image_hub_data2.version;
var Logo = function Logo() {
  var _ref = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
    _ref$enableBrowseButt = _ref.enableBrowseButton,
    enableBrowseButton = _ref$enableBrowseButt === void 0 ? false : _ref$enableBrowseButt,
    _ref$enableSettingsBu = _ref.enableSettingsButton,
    enableSettingsButton = _ref$enableSettingsBu === void 0 ? false : _ref$enableSettingsBu;
  var handleRedirect = function handleRedirect() {
    var _image_hub_data3;
    var adminUrl = ((_image_hub_data3 = image_hub_data) === null || _image_hub_data3 === void 0 ? void 0 : _image_hub_data3.adminUrl) || "/wp-admin/";
    window.location.assign("".concat(adminUrl, "upload.php?page=image-hub-media-tab"));
  };
  var handleRedirectSettings = function handleRedirectSettings() {
    var _image_hub_data4;
    var adminUrl = ((_image_hub_data4 = image_hub_data) === null || _image_hub_data4 === void 0 ? void 0 : _image_hub_data4.adminUrl) || "/wp-admin/";
    window.location.assign("".concat(adminUrl, "options-general.php?page=image-hub-settings-page"));
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      paddingRight: "20px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "image-hub-logo-container"
  }, /*#__PURE__*/React.createElement("div", {
    className: "image-hub-logo"
  }, /*#__PURE__*/React.createElement("img", {
    src: logoUrl,
    alt: "Plugin Logo"
  })), /*#__PURE__*/React.createElement("div", {
    className: "image-hub-logo-text"
  }, /*#__PURE__*/React.createElement("h1", null, "Image Hub"))), !!enableBrowseButton && /*#__PURE__*/React.createElement(external_wp_components_namespaceObject.Button, {
    variant: "primary",
    onClick: handleRedirect
  }, "Browse Images"), !!enableSettingsButton && /*#__PURE__*/React.createElement(external_wp_components_namespaceObject.Button, {
    icon: library_cog,
    style: {
      background: "white"
    },
    variant: "secondary",
    onClick: handleRedirectSettings
  }, "Settings"));
};
/* harmony default export */ const components_Logo = (Logo);
;// external ["wp","i18n"]
const external_wp_i18n_namespaceObject = window["wp"]["i18n"];
;// ./src/components/AppHeader.js
function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }


var AppHeader = function AppHeader() {
  var _ref = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
    _ref$enableBrowseButt = _ref.enableBrowseButton,
    enableBrowseButton = _ref$enableBrowseButt === void 0 ? false : _ref$enableBrowseButt,
    _ref$enableSettingsBu = _ref.enableSettingsButton,
    enableSettingsButton = _ref$enableSettingsBu === void 0 ? false : _ref$enableSettingsBu,
    _ref$style = _ref.style,
    style = _ref$style === void 0 ? {} : _ref$style;
  return /*#__PURE__*/React.createElement("div", {
    style: _objectSpread({
      paddingTop: "20px",
      paddingLeft: "20px"
    }, style)
  }, /*#__PURE__*/React.createElement(components_Logo, {
    enableBrowseButton: enableBrowseButton,
    enableSettingsButton: enableSettingsButton
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      marginBottom: 0
    },
    className: "image-hub-text-under-logo"
  }, (0,external_wp_i18n_namespaceObject.__)("Search and insert images from", "image-hub"), " ", /*#__PURE__*/React.createElement("a", {
    href: "https://unsplash.com",
    target: "_blank",
    className: "provider"
  }, "Unsplash"), ",", " ", /*#__PURE__*/React.createElement("a", {
    href: "https://openverse.org",
    target: "_blank",
    className: "provider"
  }, "Openverse"), ",", " ", /*#__PURE__*/React.createElement("a", {
    href: "https://pixabay.com",
    target: "_blank",
    className: "provider"
  }, "Pixabay"), ",", " ", /*#__PURE__*/React.createElement("a", {
    href: "https://giphy.com",
    target: "_blank",
    className: "provider"
  }, "Giphy"), ",", " ", /*#__PURE__*/React.createElement("a", {
    href: "https://pexels.com",
    target: "_blank",
    className: "provider"
  }, "Pexels"), " ", (0,external_wp_i18n_namespaceObject.__)(" directly in WordPress. No need to visit external websites—find, preview, and")), /*#__PURE__*/React.createElement("p", {
    style: {
      marginTop: 0
    },
    className: "image-hub-text-under-logo"
  }, (0,external_wp_i18n_namespaceObject.__)("download images straight from the media library or editor.")));
};
;// ./src/context/useSettings.js

var __settings = image_hub_settings;
var getImageHubSettings = function getImageHubSettings() {
  var imageHubSettings = (0,external_React_namespaceObject.useMemo)(function () {
    return {
      image_hub_api_keys_giphy_api_key: __settings.image_hub_api_keys_giphy_api_key,
      image_hub_api_keys_openverse_client_id: __settings.image_hub_api_keys_openverse_client_id,
      image_hub_api_keys_openverse_client_secret: __settings.image_hub_api_keys_openverse_client_secret,
      image_hub_api_keys_pexels_api_key: __settings.image_hub_api_keys_pexels_api_key,
      image_hub_api_keys_pixabay_api_key: __settings.image_hub_api_keys_pixabay_api_key,
      image_hub_api_keys_unsplash_access_key: __settings.image_hub_api_keys_unsplash_access_key,
      image_hub_enable_giphy: __settings.image_hub_enable_giphy === "1",
      image_hub_enable_image_attribution: __settings.image_hub_enable_image_attribution === "1",
      image_hub_enable_media_modal: __settings.image_hub_enable_media_modal === "1",
      image_hub_enable_openverse: __settings.image_hub_enable_openverse === "1",
      image_hub_enable_pexels: __settings.image_hub_enable_pexels === "1",
      image_hub_enable_pixabay: __settings.image_hub_enable_pixabay === "1",
      image_hub_enable_unsplash: __settings.image_hub_enable_unsplash === "1",
      image_hub_use_default_keys: __settings.image_hub_use_default_keys === "1",
      image_hub_max_image_height: parseInt(__settings.image_hub_max_image_height, 10),
      image_hub_max_image_width: parseInt(__settings.image_hub_max_image_width, 10)
    };
  }, [__settings]);
  var apiKeys = (0,external_React_namespaceObject.useMemo)(function () {
    return {
      giphy_api_key: __settings.image_hub_api_keys_giphy_api_key,
      openverse_client_id: __settings.image_hub_api_keys_openverse_client_id,
      openverse_client_secret: __settings.image_hub_api_keys_openverse_client_secret,
      pexels_api_key: __settings.image_hub_api_keys_pexels_api_key,
      pixabay_api_key: __settings.image_hub_api_keys_pixabay_api_key,
      unsplash_access_key: __settings.image_hub_api_keys_unsplash_access_key,
      image_hub_use_default_keys: __settings.image_hub_use_default_keys === "1"
    };
  }, [__settings]);
  return {
    imageHubSettings: imageHubSettings,
    apiKeys: apiKeys,
    isLoading: false
  };
};
;// ./src/components/settings/General.js
function General_typeof(o) { "@babel/helpers - typeof"; return General_typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, General_typeof(o); }
function General_ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function General_objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? General_ownKeys(Object(t), !0).forEach(function (r) { General_defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : General_ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function General_defineProperty(e, r, t) { return (r = General_toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function General_toPropertyKey(t) { var i = General_toPrimitive(t, "string"); return "symbol" == General_typeof(i) ? i : i + ""; }
function General_toPrimitive(t, r) { if ("object" != General_typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != General_typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _slicedToArray(r, e) { return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest(); }
function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
function _iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function _arrayWithHoles(r) { if (Array.isArray(r)) return r; }




var ajaxUrl = image_hub_data.ajaxurl;
var nonce = image_hub_data.nonce;
var DEFAULT_STATE = {
  image_hub_enable_unsplash: true,
  image_hub_enable_openverse: true,
  image_hub_enable_pixabay: true,
  image_hub_enable_pexels: true,
  image_hub_enable_giphy: true,
  image_hub_enable_image_attribution: true,
  image_hub_enable_media_modal: true
};
var UnforwardedGeneral = function UnforwardedGeneral(props, ref) {
  // Single settings state object with all settings
  var _useState = (0,external_React_namespaceObject.useState)(DEFAULT_STATE),
    _useState2 = _slicedToArray(_useState, 2),
    settings = _useState2[0],
    setSettings = _useState2[1];
  var _useState3 = (0,external_React_namespaceObject.useState)(DEFAULT_STATE),
    _useState4 = _slicedToArray(_useState3, 2),
    originalSettings = _useState4[0],
    setOriginalSettings = _useState4[1];
  var hasSettingsChanged = function hasSettingsChanged() {
    return Object.keys(DEFAULT_STATE).some(function (key) {
      return settings[key] !== originalSettings[key];
    });
  };
  var _useState5 = (0,external_React_namespaceObject.useState)(false),
    _useState6 = _slicedToArray(_useState5, 2),
    isSaving = _useState6[0],
    setIsSaving = _useState6[1];
  var _useState7 = (0,external_React_namespaceObject.useState)(""),
    _useState8 = _slicedToArray(_useState7, 2),
    saveMessage = _useState8[0],
    setSaveMessage = _useState8[1];
  var _useState9 = (0,external_React_namespaceObject.useState)(""),
    _useState10 = _slicedToArray(_useState9, 2),
    saveStatus = _useState10[0],
    setSaveStatus = _useState10[1];
  function countTrueExcludingImageAndMedia(obj) {
    return Object.entries(obj).reduce(function (count, _ref) {
      var _ref2 = _slicedToArray(_ref, 2),
        key = _ref2[0],
        value = _ref2[1];
      if (value === true && !key.includes("attribution") && !key.includes("media")) {
        count++;
      }
      return count;
    }, 0);
  }

  // Provider metadata
  var providers = [{
    id: "image_hub_enable_unsplash",
    label: "Unsplash.com",
    description: (0,external_wp_i18n_namespaceObject.__)("High-quality stock images from professional photographers.")
  }, {
    id: "image_hub_enable_openverse",
    label: "Openverse",
    description: (0,external_wp_i18n_namespaceObject.__)("A large library of openly licensed images from various sources.")
  }, {
    id: "image_hub_enable_pixabay",
    label: "Pixabay.com",
    description: (0,external_wp_i18n_namespaceObject.__)("Free images, videos, and graphics for commercial use.")
  }, {
    id: "image_hub_enable_pexels",
    label: "Pexels.com",
    description: (0,external_wp_i18n_namespaceObject.__)("Curated free stock photos and videos from creators.")
  }, {
    id: "image_hub_enable_giphy",
    label: "Giphy",
    description: (0,external_wp_i18n_namespaceObject.__)("Search and insert GIFs directly into your media library.")
  }];
  var _getImageHubSettings = getImageHubSettings(),
    imageHubSettings = _getImageHubSettings.imageHubSettings,
    isLoading = _getImageHubSettings.isLoading;
  (0,external_React_namespaceObject.useEffect)(function () {
    var updatedSettings = General_objectSpread({}, settings);
    Object.keys(updatedSettings).forEach(function (key) {
      updatedSettings[key] = !!imageHubSettings[key];
    });
    setOriginalSettings(updatedSettings);
    setSettings(updatedSettings);
  }, [imageHubSettings]);

  // Generic handler for any setting change
  var handleSettingChange = function handleSettingChange(key, value) {
    setSettings(function (prev) {
      return General_objectSpread(General_objectSpread({}, prev), {}, General_defineProperty({}, key, value));
    });
  };

  // Save settings to WordPress
  var saveSettings = function saveSettings() {
    var activeProvidersCount = providers.filter(function (provider) {
      return settings[provider.id];
    }).length;
    var isAtLeastTwoEnabled = activeProvidersCount >= 1;
    if (!isAtLeastTwoEnabled) {
      setSaveMessage((0,external_wp_i18n_namespaceObject.__)("At least one provider must be selected!", "image-hub"));
      setSaveStatus("error");

      // Clear success message after 3 seconds
      setTimeout(function () {
        setSaveMessage("");
        setSaveStatus("");
      }, 3000);
      return;
    }
    setIsSaving(true);
    fetch(ajaxUrl, {
      method: "POST",
      body: new URLSearchParams({
        action: "image_hub_update_settings",
        nonce: nonce,
        data: JSON.stringify(settings)
      })
    }).then(function (response) {
      setIsSaving(false);
      setSaveMessage((0,external_wp_i18n_namespaceObject.__)("Settings saved successfully!", "image-hub"));
      setSaveStatus("success");
      setOriginalSettings(settings);

      // Clear success message after 3 seconds
      setTimeout(function () {
        setSaveMessage("");
        setSaveStatus("");
      }, 3000);
    })["catch"](function (error) {
      console.error("Error saving settings:", error);
      setIsSaving(false);
      setSaveMessage((0,external_wp_i18n_namespaceObject.__)("Failed to save settings.", "image-hub"));
      setSaveStatus("error");
    });
  };

  // Show loading spinner while loading
  if (isLoading) {
    return /*#__PURE__*/external_React_default().createElement("div", {
      className: "image-hub-settings-loading"
    }, /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Spinner, null), /*#__PURE__*/external_React_default().createElement("p", null, (0,external_wp_i18n_namespaceObject.__)("Loading settings...", "image-hub")));
  }
  return /*#__PURE__*/external_React_default().createElement("div", {
    ref: ref,
    className: "image-hub-settings-general-container"
  }, /*#__PURE__*/external_React_default().createElement("h1", null, (0,external_wp_i18n_namespaceObject.__)("Image Providers", "image-hub")), /*#__PURE__*/external_React_default().createElement("h4", null, (0,external_wp_i18n_namespaceObject.__)("Select one or more sources for image search and downloads.")), providers.map(function (provider) {
    return /*#__PURE__*/external_React_default().createElement("div", {
      key: provider.id,
      style: {
        marginBottom: "10px"
      }
    }, /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.CheckboxControl, {
      __nextHasNoMarginBottom: true,
      className: "image-hub-settings-general-checkbox " + (settings[provider.id] && countTrueExcludingImageAndMedia(settings) <= 1 ? "image-hub-settings-general-checkbox-disabled" : ""),
      label: provider.label,
      checked: settings[provider.id],
      disabled: settings[provider.id] && countTrueExcludingImageAndMedia(settings) <= 1,
      onChange: function onChange() {
        handleSettingChange(provider.id, !settings[provider.id]);
      }
    }), /*#__PURE__*/external_React_default().createElement("p", {
      style: {
        marginLeft: "25px",
        fontSize: "0.9em",
        color: "#555"
      }
    }, provider.description));
  }), /*#__PURE__*/external_React_default().createElement("br", null), " ", /*#__PURE__*/external_React_default().createElement("br", null), /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.ToggleControl, {
    __nextHasNoMarginBottom: true,
    label: (0,external_wp_i18n_namespaceObject.__)("Image Attribution", "image-hub"),
    help: (0,external_wp_i18n_namespaceObject.__)("Automatically add image attribution as captions.", "image-hub"),
    checked: settings.image_hub_enable_image_attribution,
    onChange: function onChange() {
      return handleSettingChange("image_hub_enable_image_attribution", !settings.image_hub_enable_image_attribution);
    }
  }), /*#__PURE__*/external_React_default().createElement("br", null), /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.ToggleControl, {
    __nextHasNoMarginBottom: true,
    label: (0,external_wp_i18n_namespaceObject.__)('Enable "Image Hub" tab in the media modal', "image-hub"),
    help: (0,external_wp_i18n_namespaceObject.__)("Adds a tab in the media uploader for quick image search and insertion."),
    checked: settings.image_hub_enable_media_modal,
    onChange: function onChange() {
      return handleSettingChange("image_hub_enable_media_modal", !settings.image_hub_enable_media_modal);
    }
  }), /*#__PURE__*/external_React_default().createElement("br", null), /*#__PURE__*/external_React_default().createElement("div", {
    style: {
      display: "flex",
      gap: "10px",
      alignItems: "baseline",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Button, {
    style: {
      marginTop: "16px"
    },
    variant: "primary",
    onClick: saveSettings,
    isBusy: isSaving,
    disabled: isSaving || !hasSettingsChanged()
  }, isSaving ? (0,external_wp_i18n_namespaceObject.__)("Saving...", "image-hub") : (0,external_wp_i18n_namespaceObject.__)("Save Settings", "image-hub")), /*#__PURE__*/external_React_default().createElement("div", {
    style: {
      width: "90%"
    }
  }, saveMessage && /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Notice, {
    status: saveStatus,
    isDismissible: false
  }, saveMessage))), /*#__PURE__*/external_React_default().createElement("br", null), " ", /*#__PURE__*/external_React_default().createElement("br", null));
};
var General = /*#__PURE__*/(0,external_React_namespaceObject.forwardRef)(UnforwardedGeneral);
;// ./src/components/settings/Updates.js


var UnforwardedUpdates = function UnforwardedUpdates(props, ref) {
  return /*#__PURE__*/external_React_default().createElement("div", {
    ref: ref,
    style: {
      minHeight: "50vh"
    },
    className: "image-hub-settings-updates-container"
  }, /*#__PURE__*/external_React_default().createElement("h1", null, (0,external_wp_i18n_namespaceObject.__)("Updates & Changelog", "image-hub")), /*#__PURE__*/external_React_default().createElement("h4", null, (0,external_wp_i18n_namespaceObject.__)("Stay up to date with the latest improvements, fixes, and new features.", "image-hub")));
};
var Updates = /*#__PURE__*/(0,external_React_namespaceObject.forwardRef)(UnforwardedUpdates);
;// external ["wp","element"]
const external_wp_element_namespaceObject = window["wp"]["element"];
;// ./src/components/ApiKeysComponent.js
function ApiKeysComponent_typeof(o) { "@babel/helpers - typeof"; return ApiKeysComponent_typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, ApiKeysComponent_typeof(o); }
function ApiKeysComponent_ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function ApiKeysComponent_objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ApiKeysComponent_ownKeys(Object(t), !0).forEach(function (r) { ApiKeysComponent_defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ApiKeysComponent_ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function ApiKeysComponent_defineProperty(e, r, t) { return (r = ApiKeysComponent_toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function ApiKeysComponent_toPropertyKey(t) { var i = ApiKeysComponent_toPrimitive(t, "string"); return "symbol" == ApiKeysComponent_typeof(i) ? i : i + ""; }
function ApiKeysComponent_toPrimitive(t, r) { if ("object" != ApiKeysComponent_typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != ApiKeysComponent_typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function ApiKeysComponent_slicedToArray(r, e) { return ApiKeysComponent_arrayWithHoles(r) || ApiKeysComponent_iterableToArrayLimit(r, e) || ApiKeysComponent_unsupportedIterableToArray(r, e) || ApiKeysComponent_nonIterableRest(); }
function ApiKeysComponent_nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function ApiKeysComponent_unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return ApiKeysComponent_arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? ApiKeysComponent_arrayLikeToArray(r, a) : void 0; } }
function ApiKeysComponent_arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
function ApiKeysComponent_iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function ApiKeysComponent_arrayWithHoles(r) { if (Array.isArray(r)) return r; }





var ApiKeysComponent_ajaxUrl = image_hub_data.ajaxurl;
var ApiKeysComponent_nonce = image_hub_data.nonce;
var ApiKeysComponent_DEFAULT_STATE = {
  unsplash_access_key: "",
  pexels_api_key: "",
  giphy_api_key: "",
  pixabay_api_key: "",
  openverse_client_id: "",
  openverse_client_secret: "",
  image_hub_use_default_keys: false
};
var ApiKeysMgr = function ApiKeysMgr() {
  // Initial state setup
  var _useState = (0,external_wp_element_namespaceObject.useState)(ApiKeysComponent_DEFAULT_STATE),
    _useState2 = ApiKeysComponent_slicedToArray(_useState, 2),
    apiKeys = _useState2[0],
    setApiKeys = _useState2[1];
  var _useState3 = (0,external_wp_element_namespaceObject.useState)(ApiKeysComponent_DEFAULT_STATE),
    _useState4 = ApiKeysComponent_slicedToArray(_useState3, 2),
    originalApikeys = _useState4[0],
    setOAK = _useState4[1];
  var _useState5 = (0,external_wp_element_namespaceObject.useState)(false),
    _useState6 = ApiKeysComponent_slicedToArray(_useState5, 2),
    initiated = _useState6[0],
    setInitiated = _useState6[1];
  var hasApiKeysChanged = function hasApiKeysChanged() {
    return Object.keys(ApiKeysComponent_DEFAULT_STATE).some(function (key) {
      return apiKeys[key] !== originalApikeys[key];
    });
  };
  var _useState7 = (0,external_wp_element_namespaceObject.useState)({
      unsplash_access_key: false,
      pexels_api_key: false,
      giphy_api_key: false,
      pixabay_api_key: false,
      openverse_client_id: false,
      openverse_client_secret: false
    }),
    _useState8 = ApiKeysComponent_slicedToArray(_useState7, 2),
    visibleFields = _useState8[0],
    setVisibleFields = _useState8[1];
  var _useState9 = (0,external_wp_element_namespaceObject.useState)(true),
    _useState10 = ApiKeysComponent_slicedToArray(_useState9, 2),
    isLoading = _useState10[0],
    setIsLoading = _useState10[1];
  var _useState11 = (0,external_wp_element_namespaceObject.useState)(false),
    _useState12 = ApiKeysComponent_slicedToArray(_useState11, 2),
    isSaving = _useState12[0],
    setIsSaving = _useState12[1];
  var _useState13 = (0,external_wp_element_namespaceObject.useState)(""),
    _useState14 = ApiKeysComponent_slicedToArray(_useState13, 2),
    saveMessage = _useState14[0],
    setSaveMessage = _useState14[1];
  var _useState15 = (0,external_wp_element_namespaceObject.useState)(""),
    _useState16 = ApiKeysComponent_slicedToArray(_useState15, 2),
    saveStatus = _useState16[0],
    setSaveStatus = _useState16[1];
  var settings = getImageHubSettings();
  window.originalApikeys = originalApikeys;
  window.apiKeys = apiKeys;
  (0,external_wp_element_namespaceObject.useEffect)(function () {
    if (!initiated) {
      setInitiated(true);
      setIsLoading(settings.isLoading);
      setOAK(settings.apiKeys);
      setApiKeys(settings.apiKeys);
    }
  }, [settings]);

  // Function to fetch existing API keys from WordPress

  // Handle input field changes
  var handleChange = function handleChange(key, value) {
    setApiKeys(function (prevState) {
      return ApiKeysComponent_objectSpread(ApiKeysComponent_objectSpread({}, prevState), {}, ApiKeysComponent_defineProperty({}, key, value));
    });
  };

  // Save API keys to WordPress
  var saveAPIKeys = function saveAPIKeys() {
    setIsSaving(true);

    // Prepare data for the WordPress REST API
    var data = {};
    Object.entries(apiKeys).forEach(function (_ref) {
      var _ref2 = ApiKeysComponent_slicedToArray(_ref, 2),
        key = _ref2[0],
        value = _ref2[1];
      if (key.includes('default')) {
        data[key] = value;
      } else {
        data["image_hub_api_keys_".concat(key)] = value;
      }
    });
    fetch(ApiKeysComponent_ajaxUrl, {
      method: "POST",
      body: new URLSearchParams({
        action: "image_hub_update_settings",
        nonce: ApiKeysComponent_nonce,
        data: JSON.stringify(data)
      })
    }).then(function (response) {
      setIsSaving(false);
      setSaveMessage((0,external_wp_i18n_namespaceObject.__)("API keys saved successfully!", "image-hub"));
      setSaveStatus("success");
      setOAK(apiKeys);
      // Clear success message after 3 seconds
      setTimeout(function () {
        setSaveMessage("");
        setSaveStatus("");
      }, 3000);
    })["catch"](function (error) {
      console.error("Error saving API keys:", error);
      setIsSaving(false);
      setSaveMessage((0,external_wp_i18n_namespaceObject.__)("Failed to save API keys.", "image-hub"));
      setSaveStatus("error");
    });
  };
  var toggleFieldVisibility = function toggleFieldVisibility(key) {
    setVisibleFields(function (prevState) {
      return ApiKeysComponent_objectSpread(ApiKeysComponent_objectSpread({}, prevState), {}, ApiKeysComponent_defineProperty({}, key, !prevState[key]));
    });
  };

  // Show loading spinner while loading
  if (isLoading) {
    return /*#__PURE__*/external_React_default().createElement("div", {
      className: "image-hub-api-keys-manager-loading"
    }, /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Spinner, null), /*#__PURE__*/external_React_default().createElement("p", null, (0,external_wp_i18n_namespaceObject.__)("Loading API keys...", "image-hub")));
  }
  return /*#__PURE__*/external_React_default().createElement("div", null, /*#__PURE__*/external_React_default().createElement("div", {
    className: "image-hub-image-hub-api-key-field-container"
  }, /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.ToggleControl, {
    __nextHasNoMarginBottom: true,
    label: (0,external_wp_i18n_namespaceObject.__)('Use default API keys provided by the plugin', "image-hub"),
    help: function help() {
      return /*#__PURE__*/external_React_default().createElement("div", null, (0,external_wp_i18n_namespaceObject.__)('The plugin includes built-in API keys, but you can replace them with your own.'), /*#__PURE__*/external_React_default().createElement("br", null), (0,external_wp_i18n_namespaceObject.__)('(Some API\'s don\'t use api key for fetching without search param)'));
    },
    checked: apiKeys.image_hub_use_default_keys,
    onChange: function onChange() {
      return handleChange('image_hub_use_default_keys', !apiKeys.image_hub_use_default_keys);
    }
  })), /*#__PURE__*/external_React_default().createElement("br", null), /*#__PURE__*/external_React_default().createElement("br", null), /*#__PURE__*/external_React_default().createElement("div", {
    className: "image-hub-image-hub-api-key-field-container"
  }, /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.TextControl, {
    __nextHasNoMarginBottom: true,
    __next40pxDefaultSize: true,
    label: (0,external_wp_i18n_namespaceObject.__)("Unsplash Access Key", "image-hub"),
    value: apiKeys.unsplash_access_key,
    onChange: function onChange(value) {
      return handleChange("unsplash_access_key", value);
    },
    autoComplete: "new-password",
    className: "image-hub-api-key-field",
    type: visibleFields.unsplash_access_key ? "text" : "password"
  }), /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Button, {
    __next40pxDefaultSize: true,
    variant: "secondary",
    onClick: function onClick() {
      return toggleFieldVisibility("unsplash_access_key");
    },
    style: {
      color: "#3858e9"
    },
    icon: visibleFields.unsplash_access_key ? "visibility" : "hidden",
    label: visibleFields.unsplash_access_key ? (0,external_wp_i18n_namespaceObject.__)("Hide", "image-hub") : (0,external_wp_i18n_namespaceObject.__)("Show", "image-hub")
  })), /*#__PURE__*/external_React_default().createElement("a", {
    target: "_blank",
    href: "https://unsplash.com/developers"
  }, "Get API Key"), /*#__PURE__*/external_React_default().createElement("div", {
    className: "image-hub-image-hub-api-key-field-container"
  }, /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.TextControl, {
    __nextHasNoMarginBottom: true,
    __next40pxDefaultSize: true,
    label: (0,external_wp_i18n_namespaceObject.__)("Pexels API Key", "image-hub"),
    value: apiKeys.pexels_api_key,
    onChange: function onChange(value) {
      return handleChange("pexels_api_key", value);
    },
    className: "image-hub-api-key-field",
    type: visibleFields.pexels_api_key ? "text" : "password",
    autoComplete: "new-password"
  }), /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Button, {
    __next40pxDefaultSize: true,
    variant: "secondary",
    style: {
      color: "#3858e9"
    },
    onClick: function onClick() {
      return toggleFieldVisibility("pexels_api_key");
    },
    icon: visibleFields.pexels_api_key ? "visibility" : "hidden",
    label: visibleFields.pexels_api_key ? (0,external_wp_i18n_namespaceObject.__)("Hide", "image-hub") : (0,external_wp_i18n_namespaceObject.__)("Show", "image-hub")
  })), /*#__PURE__*/external_React_default().createElement("a", {
    target: "_blank",
    href: "https://help.pexels.com/hc/en-us/articles/900004904026-How-do-I-get-an-API-key"
  }, "Get API Key"), /*#__PURE__*/external_React_default().createElement("div", {
    className: "image-hub-image-hub-api-key-field-container"
  }, /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.TextControl, {
    __nextHasNoMarginBottom: true,
    __next40pxDefaultSize: true,
    label: (0,external_wp_i18n_namespaceObject.__)("Giphy API Key", "image-hub"),
    value: apiKeys.giphy_api_key,
    onChange: function onChange(value) {
      return handleChange("giphy_api_key", value);
    },
    className: "image-hub-api-key-field",
    type: visibleFields.giphy_api_key ? "text" : "password",
    autoComplete: "new-password"
  }), /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Button, {
    __next40pxDefaultSize: true,
    variant: "secondary",
    style: {
      color: "#3858e9"
    },
    onClick: function onClick() {
      return toggleFieldVisibility("giphy_api_key");
    },
    icon: visibleFields.giphy_api_key ? "visibility" : "hidden",
    label: visibleFields.giphy_api_key ? (0,external_wp_i18n_namespaceObject.__)("Hide", "image-hub") : (0,external_wp_i18n_namespaceObject.__)("Show", "image-hub")
  })), /*#__PURE__*/external_React_default().createElement("a", {
    target: "_blank",
    href: "https://developers.giphy.com/docs/api/"
  }, "Get API Key"), /*#__PURE__*/external_React_default().createElement("div", {
    className: "image-hub-image-hub-api-key-field-container"
  }, /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.TextControl, {
    __nextHasNoMarginBottom: true,
    __next40pxDefaultSize: true,
    label: (0,external_wp_i18n_namespaceObject.__)("Pixabay API Key", "image-hub"),
    value: apiKeys.pixabay_api_key,
    onChange: function onChange(value) {
      return handleChange("pixabay_api_key", value);
    },
    className: "image-hub-api-key-field",
    type: visibleFields.pixabay_api_key ? "text" : "password",
    autoComplete: "new-password"
  }), /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Button, {
    __next40pxDefaultSize: true,
    variant: "secondary",
    style: {
      color: "#3858e9"
    },
    onClick: function onClick() {
      return toggleFieldVisibility("pixabay_api_key");
    },
    icon: visibleFields.pixabay_api_key ? "visibility" : "hidden",
    label: visibleFields.pixabay_api_key ? (0,external_wp_i18n_namespaceObject.__)("Hide", "image-hub") : (0,external_wp_i18n_namespaceObject.__)("Show", "image-hub")
  })), /*#__PURE__*/external_React_default().createElement("a", {
    target: "_blank",
    href: "https://pixabay.com/service/about/api/"
  }, "Get API Key"), /*#__PURE__*/external_React_default().createElement("div", {
    className: "image-hub-image-hub-api-key-field-container"
  }, /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.TextControl, {
    __nextHasNoMarginBottom: true,
    __next40pxDefaultSize: true,
    label: (0,external_wp_i18n_namespaceObject.__)("Openverse Client ID", "image-hub"),
    value: apiKeys.openverse_client_id,
    onChange: function onChange(value) {
      return handleChange("openverse_client_id", value);
    },
    className: "image-hub-api-key-field",
    type: visibleFields.openverse_client_id ? "text" : "password",
    autoComplete: "new-password"
  }), /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Button, {
    __next40pxDefaultSize: true,
    variant: "secondary",
    style: {
      color: "#3858e9"
    },
    onClick: function onClick() {
      return toggleFieldVisibility("openverse_client_id");
    },
    icon: visibleFields.openverse_client_id ? "visibility" : "hidden",
    label: visibleFields.openverse_client_id ? (0,external_wp_i18n_namespaceObject.__)("Hide", "image-hub") : (0,external_wp_i18n_namespaceObject.__)("Show", "image-hub")
  })), /*#__PURE__*/external_React_default().createElement("div", {
    className: "image-hub-image-hub-api-key-field-container"
  }, /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.TextControl, {
    __nextHasNoMarginBottom: true,
    __next40pxDefaultSize: true,
    label: (0,external_wp_i18n_namespaceObject.__)("Openverse Client Secret", "image-hub"),
    value: apiKeys.openverse_client_secret,
    onChange: function onChange(value) {
      return handleChange("openverse_client_secret", value);
    },
    className: "image-hub-api-key-field",
    type: visibleFields.openverse_client_secret ? "text" : "password",
    autoComplete: "new-password"
  }), /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Button, {
    __next40pxDefaultSize: true,
    variant: "secondary",
    style: {
      color: "#3858e9"
    },
    onClick: function onClick() {
      return toggleFieldVisibility("openverse_client_secret");
    },
    icon: visibleFields.openverse_client_secret ? "visibility" : "hidden",
    label: visibleFields.openverse_client_secret ? (0,external_wp_i18n_namespaceObject.__)("Hide", "image-hub") : (0,external_wp_i18n_namespaceObject.__)("Show", "image-hub")
  })), /*#__PURE__*/external_React_default().createElement("div", null, /*#__PURE__*/external_React_default().createElement("a", {
    target: "_blank",
    href: "https://api.openverse.org/v1/#tag/auth/operation/register"
  }, "Get API Key")), /*#__PURE__*/external_React_default().createElement("div", {
    style: {
      display: "flex",
      gap: "10px",
      alignItems: "baseline",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Button, {
    style: {
      marginTop: "16px",
      flex: "0"
    },
    variant: "primary",
    onClick: saveAPIKeys,
    isBusy: isSaving,
    disabled: isSaving || !hasApiKeysChanged()
  }, isSaving ? (0,external_wp_i18n_namespaceObject.__)("Saving...", "image-hub") : (0,external_wp_i18n_namespaceObject.__)("Save API Keys", "image-hub")), /*#__PURE__*/external_React_default().createElement("div", {
    style: {
      width: "90%"
    }
  }, saveMessage && /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Notice, {
    status: saveStatus,
    isDismissible: false
  }, saveMessage))));
};
;// ./src/components/settings/ApiKeys.js
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }



var UnforwardedApiKeys = function UnforwardedApiKeys(props, ref) {
  return /*#__PURE__*/external_React_default().createElement("div", _extends({}, props, {
    ref: ref,
    style: {
      minHeight: "50vh"
    },
    className: "image-hub-settings-apikeys-container"
  }), /*#__PURE__*/external_React_default().createElement("h1", null, (0,external_wp_i18n_namespaceObject.__)("API Keys & Authentication", "image-hub")), /*#__PURE__*/external_React_default().createElement("h4", null, (0,external_wp_i18n_namespaceObject.__)("Manage provider API keys and authentication settings.", "image-hub")), /*#__PURE__*/external_React_default().createElement(ApiKeysMgr, null), /*#__PURE__*/external_React_default().createElement("br", null), " ", /*#__PURE__*/external_React_default().createElement("br", null));
};
var ApiKeys = /*#__PURE__*/(0,external_React_namespaceObject.forwardRef)(UnforwardedApiKeys);
;// ./src/components/CustomNumberInput.js
function CustomNumberInput_typeof(o) { "@babel/helpers - typeof"; return CustomNumberInput_typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, CustomNumberInput_typeof(o); }
var _excluded = ["value", "setValue", "label"];
function CustomNumberInput_extends() { return CustomNumberInput_extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, CustomNumberInput_extends.apply(null, arguments); }
function CustomNumberInput_ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function CustomNumberInput_objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? CustomNumberInput_ownKeys(Object(t), !0).forEach(function (r) { CustomNumberInput_defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : CustomNumberInput_ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function CustomNumberInput_defineProperty(e, r, t) { return (r = CustomNumberInput_toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function CustomNumberInput_toPropertyKey(t) { var i = CustomNumberInput_toPrimitive(t, "string"); return "symbol" == CustomNumberInput_typeof(i) ? i : i + ""; }
function CustomNumberInput_toPrimitive(t, r) { if ("object" != CustomNumberInput_typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != CustomNumberInput_typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _objectWithoutProperties(e, t) { if (null == e) return {}; var o, r, i = _objectWithoutPropertiesLoose(e, t); if (Object.getOwnPropertySymbols) { var n = Object.getOwnPropertySymbols(e); for (r = 0; r < n.length; r++) o = n[r], -1 === t.indexOf(o) && {}.propertyIsEnumerable.call(e, o) && (i[o] = e[o]); } return i; }
function _objectWithoutPropertiesLoose(r, e) { if (null == r) return {}; var t = {}; for (var n in r) if ({}.hasOwnProperty.call(r, n)) { if (-1 !== e.indexOf(n)) continue; t[n] = r[n]; } return t; }



var ENABLE_CLEAR_BTN = false;
var CustomNumberControl = function CustomNumberControl(_ref) {
  var value = _ref.value,
    setValue = _ref.setValue,
    label = _ref.label,
    props = _objectWithoutProperties(_ref, _excluded);
  var handleClear = function handleClear(e) {
    e.stopPropagation();
    setValue(0);
  };
  return /*#__PURE__*/external_React_default().createElement("div", {
    style: {
      position: "relative"
    }
  }, /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.__experimentalNumberControl, CustomNumberInput_extends({
    value: value == 0 ? null : value,
    __next40pxDefaultSize: true,
    __nextHasNoMarginBottom: true,
    label: label,
    onChange: setValue,
    showArrows: false,
    adornment: /*#__PURE__*/external_React_default().createElement("span", {
      style: {
        color: "blue"
      }
    }, "PX"),
    isShiftStepEnabled: true,
    shiftStep: 10,
    style: CustomNumberInput_objectSpread({
      background: "transparent"
    }, props === null || props === void 0 ? void 0 : props.style),
    suffix: /*#__PURE__*/external_React_default().createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        position: "relative",
        width: ENABLE_CLEAR_BTN ? "43px" : "23px"
      }
    }, value > 0 && ENABLE_CLEAR_BTN && /*#__PURE__*/external_React_default().createElement("button", {
      onClick: handleClear,
      style: {
        border: "none",
        background: "transparent",
        cursor: "pointer",
        padding: "0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#757575",
        width: "16px",
        height: "16px",
        position: "absolute",
        left: "0"
      },
      "aria-label": "Clear value"
    }, /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Icon, {
      icon: "dismiss",
      size: 16
    })), /*#__PURE__*/external_React_default().createElement("div", {
      style: {
        marginRight: "10px",
        color: "#3858E9",
        fontSize: "16px!important",
        position: "absolute",
        right: "0",
        paddingBottom: ".3em"
      }
    }, "px"))
  }, props)));
};
;// ./src/components/settings/Sizes.js
function Sizes_typeof(o) { "@babel/helpers - typeof"; return Sizes_typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, Sizes_typeof(o); }
function Sizes_ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function Sizes_objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? Sizes_ownKeys(Object(t), !0).forEach(function (r) { Sizes_defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : Sizes_ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function Sizes_defineProperty(e, r, t) { return (r = Sizes_toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function Sizes_toPropertyKey(t) { var i = Sizes_toPrimitive(t, "string"); return "symbol" == Sizes_typeof(i) ? i : i + ""; }
function Sizes_toPrimitive(t, r) { if ("object" != Sizes_typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != Sizes_typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function Sizes_slicedToArray(r, e) { return Sizes_arrayWithHoles(r) || Sizes_iterableToArrayLimit(r, e) || Sizes_unsupportedIterableToArray(r, e) || Sizes_nonIterableRest(); }
function Sizes_nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function Sizes_unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return Sizes_arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? Sizes_arrayLikeToArray(r, a) : void 0; } }
function Sizes_arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
function Sizes_iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function Sizes_arrayWithHoles(r) { if (Array.isArray(r)) return r; }





var Sizes_ajaxUrl = image_hub_data.ajaxurl;
var Sizes_nonce = image_hub_data.nonce;
var UnforwardedSizes = function UnforwardedSizes(props, ref) {
  var _useState = (0,external_React_namespaceObject.useState)({
      image_hub_max_image_width: 0,
      image_hub_max_image_height: 0
    }),
    _useState2 = Sizes_slicedToArray(_useState, 2),
    settings = _useState2[0],
    setSettings = _useState2[1];
  var _useState3 = (0,external_React_namespaceObject.useState)({
      image_hub_max_image_width: 0,
      image_hub_max_image_height: 0
    }),
    _useState4 = Sizes_slicedToArray(_useState3, 2),
    originalSettings = _useState4[0],
    setOriginalSettings = _useState4[1];
  var hasSettingsChanged = function hasSettingsChanged() {
    return settings.image_hub_max_image_width !== originalSettings.image_hub_max_image_width || settings.image_hub_max_image_height !== originalSettings.image_hub_max_image_height;
  };
  var _useState5 = (0,external_React_namespaceObject.useState)(false),
    _useState6 = Sizes_slicedToArray(_useState5, 2),
    isSaving = _useState6[0],
    setIsSaving = _useState6[1];
  var _useState7 = (0,external_React_namespaceObject.useState)(""),
    _useState8 = Sizes_slicedToArray(_useState7, 2),
    saveMessage = _useState8[0],
    setSaveMessage = _useState8[1];
  var _useState9 = (0,external_React_namespaceObject.useState)(""),
    _useState10 = Sizes_slicedToArray(_useState9, 2),
    saveStatus = _useState10[0],
    setSaveStatus = _useState10[1];
  var _getImageHubSettings = getImageHubSettings(),
    imageHubSettings = _getImageHubSettings.imageHubSettings,
    isLoading = _getImageHubSettings.isLoading;
  (0,external_React_namespaceObject.useEffect)(function () {
    setSettings({
      image_hub_max_image_width: imageHubSettings.image_hub_max_image_width || 0,
      image_hub_max_image_height: imageHubSettings.image_hub_max_image_height || 0
    });
    setOriginalSettings({
      image_hub_max_image_width: imageHubSettings.image_hub_max_image_width || 0,
      image_hub_max_image_height: imageHubSettings.image_hub_max_image_height || 0
    });
  }, [imageHubSettings]);
  var handleSettingChange = function handleSettingChange(key, value) {
    setSettings(function (prev) {
      return Sizes_objectSpread(Sizes_objectSpread({}, prev), {}, Sizes_defineProperty({}, key, +value));
    });
  };
  var saveSettings = function saveSettings() {
    setIsSaving(true);
    fetch(Sizes_ajaxUrl, {
      method: "POST",
      body: new URLSearchParams({
        action: "image_hub_update_settings",
        nonce: Sizes_nonce,
        data: JSON.stringify(settings)
      })
    }).then(function () {
      setIsSaving(false);
      setSaveMessage((0,external_wp_i18n_namespaceObject.__)("Settings saved successfully!", "image-hub"));
      setSaveStatus("success");
      setOriginalSettings(settings);
      setTimeout(function () {
        setSaveMessage("");
        setSaveStatus("");
      }, 3000);
    })["catch"](function (error) {
      console.error("Error saving settings:", error);
      setIsSaving(false);
      setSaveMessage((0,external_wp_i18n_namespaceObject.__)("Failed to save settings.", "image-hub"));
      setSaveStatus("error");
    });
  };
  if (isLoading) {
    return /*#__PURE__*/external_React_default().createElement("div", {
      className: "image-hub-settings-loading"
    }, /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Spinner, null), /*#__PURE__*/external_React_default().createElement("p", null, (0,external_wp_i18n_namespaceObject.__)("Loading settings...", "image-hub")));
  }
  return /*#__PURE__*/external_React_default().createElement("div", {
    ref: ref,
    className: "image-hub-settings-sizes-container"
  }, /*#__PURE__*/external_React_default().createElement("h1", null, (0,external_wp_i18n_namespaceObject.__)("Max Upload Dimensions", "image-hub")), /*#__PURE__*/external_React_default().createElement("h4", null, (0,external_wp_i18n_namespaceObject.__)("Set a maximum width and height for downloaded images to control file size.")), /*#__PURE__*/external_React_default().createElement("div", {
    style: {
      width: "fit-content",
      gap: "1em",
      display: "flex",
      flexDirection: "column"
    }
  }, /*#__PURE__*/external_React_default().createElement(CustomNumberControl, {
    value: settings.image_hub_max_image_width,
    setValue: function setValue(value) {
      return handleSettingChange("image_hub_max_image_width", value);
    },
    label: (0,external_wp_i18n_namespaceObject.__)("Max. Width", "image-hub")
  }), /*#__PURE__*/external_React_default().createElement(CustomNumberControl, {
    value: settings.image_hub_max_image_height,
    setValue: function setValue(value) {
      return handleSettingChange("image_hub_max_image_height", value);
    },
    label: (0,external_wp_i18n_namespaceObject.__)("Max. Height", "image-hub")
  })), /*#__PURE__*/external_React_default().createElement("br", null), /*#__PURE__*/external_React_default().createElement("div", {
    style: {
      display: "flex",
      gap: "10px",
      alignItems: "baseline",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Button, {
    style: {
      marginTop: "16px"
    },
    variant: "primary",
    onClick: saveSettings,
    isBusy: isSaving,
    disabled: isSaving || !hasSettingsChanged()
  }, isSaving ? (0,external_wp_i18n_namespaceObject.__)("Saving...", "image-hub") : (0,external_wp_i18n_namespaceObject.__)("Save Settings", "image-hub")), /*#__PURE__*/external_React_default().createElement("div", {
    style: {
      width: "90%"
    }
  }, saveMessage && /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Notice, {
    status: saveStatus,
    isDismissible: false
  }, saveMessage))));
};
var Sizes = /*#__PURE__*/(0,external_React_namespaceObject.forwardRef)(UnforwardedSizes);
;// ./src/components/settings/index.js




;// ./src/components/DevComponent.js
function DevComponent_slicedToArray(r, e) { return DevComponent_arrayWithHoles(r) || DevComponent_iterableToArrayLimit(r, e) || DevComponent_unsupportedIterableToArray(r, e) || DevComponent_nonIterableRest(); }
function DevComponent_nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function DevComponent_unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return DevComponent_arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? DevComponent_arrayLikeToArray(r, a) : void 0; } }
function DevComponent_arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
function DevComponent_iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function DevComponent_arrayWithHoles(r) { if (Array.isArray(r)) return r; }

var DevToggleWrapper = function DevToggleWrapper(_ref) {
  var children = _ref.children;
  var _useState = (0,external_React_namespaceObject.useState)(function () {
      var storedMode = localStorage.getItem('imageHubDevMode');
      return storedMode === 'true';
    }),
    _useState2 = DevComponent_slicedToArray(_useState, 2),
    devMode = _useState2[0],
    setDevMode = _useState2[1];
  var clickCountRef = (0,external_React_namespaceObject.useRef)(0);
  var lastClickTimeRef = (0,external_React_namespaceObject.useRef)(Date.now());
  var handleClick = function handleClick() {
    var now = Date.now();
    var timeSinceLastClick = now - lastClickTimeRef.current;
    if (timeSinceLastClick < 500) {
      clickCountRef.current += 1;
    } else {
      clickCountRef.current = 1;
    }
    lastClickTimeRef.current = now;
    if (clickCountRef.current >= 10) {
      var newMode = !devMode;
      setDevMode(newMode);
      localStorage.setItem('imageHubDevMode', newMode);
      clickCountRef.current = 0;
    }
  };
  var badgeStyle = {
    position: 'absolute',
    top: '16px',
    right: '16px',
    backgroundColor: '#f87171',
    color: '#ffffff',
    borderRadius: '16px',
    padding: '8px 16px',
    fontWeight: 'bold',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    opacity: devMode ? 1 : 0,
    transition: 'opacity 300ms ease-in-out',
    pointerEvents: 'none'
  };
  return /*#__PURE__*/external_React_default().createElement("div", {
    onClick: handleClick,
    style: {
      position: 'relative',
      width: '100%',
      height: '100%'
    }
  }, children, devMode && /*#__PURE__*/external_React_default().createElement("div", {
    style: badgeStyle
  }, "DEV"));
};
/* harmony default export */ const DevComponent = (DevToggleWrapper);
;// ./src/SettingsApp.js
function SettingsApp_slicedToArray(r, e) { return SettingsApp_arrayWithHoles(r) || SettingsApp_iterableToArrayLimit(r, e) || SettingsApp_unsupportedIterableToArray(r, e) || SettingsApp_nonIterableRest(); }
function SettingsApp_nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function SettingsApp_unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return SettingsApp_arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? SettingsApp_arrayLikeToArray(r, a) : void 0; } }
function SettingsApp_arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
function SettingsApp_iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function SettingsApp_arrayWithHoles(r) { if (Array.isArray(r)) return r; }





var __ = wp.i18n.__;



var ScrollableMenu = function ScrollableMenu() {
  var sectionsRef = (0,external_React_namespaceObject.useRef)([]);
  var _useState = (0,external_React_namespaceObject.useState)(null),
    _useState2 = SettingsApp_slicedToArray(_useState, 2),
    visibleSection = _useState2[0],
    setVisibleSection = _useState2[1];

  // Scroll to the section when a button is clicked
  var scrollToSection = function scrollToSection(index) {
    if (sectionsRef.current[index]) {
      sectionsRef.current[index].scrollIntoView({
        behavior: "smooth",
        block: "start",
        inline: "start"
      });
    }
  };

  // Set up IntersectionObserver to detect which section is visible
  (0,external_React_namespaceObject.useEffect)(function () {
    var options = {
      threshold: 0.8,
      rootMargin: "-100px 0px 0px 0px"
    };
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var index = sectionsRef.current.findIndex(function (el) {
          return el === entry.target;
        });
        if (entry.isIntersecting) {
          setVisibleSection(index);
        }
      });
    }, options);

    // Observe each section
    sectionsRef.current.forEach(function (section) {
      if (section) {
        observer.observe(section);
      }
    });

    // Clean up observer on component unmount
    return function () {
      observer.disconnect();
    };
  }, []);
  var sectionTitles = ["General", "Image Sizes", "Api Keys", "Updates & Changelog"];
  return /*#__PURE__*/external_React_default().createElement(DevComponent, null, /*#__PURE__*/external_React_default().createElement("div", {
    className: "image-hub-scroll-container",
    style: {
      display: "flex",
      minHeight: "calc(100vh - 190.14px)",
      background: "white"
    }
  }, /*#__PURE__*/external_React_default().createElement("div", {
    style: {
      display: "flex",
      padding: "15px",
      background: "white",
      flexDirection: "column",
      boxShadow: "2px 0px 5px 0px rgba(0,0,0,0.37) !important",
      position: "sticky",
      top: "calc( 118px + 32px )",
      height: "100%"
    }
  }, sectionTitles.map(function (title, index) {
    return /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Button, {
      key: index,
      className: "image-hub-settings-swipable-menu-button ".concat(visibleSection === index ? "active" : ""),
      __next40pxDefaultSize: true,
      icon: chevron_right,
      iconPosition: "right",
      variant: "primary",
      onClick: function onClick() {
        return scrollToSection(index);
      },
      style: {
        margin: "0 15px"
      }
    }, title);
  })), /*#__PURE__*/external_React_default().createElement("div", {
    style: {
      flex: 1,
      padding: "0 20px",
      background: "white"
    }
  }, /*#__PURE__*/external_React_default().createElement(General, {
    key: 0,
    ref: function ref(el) {
      return sectionsRef.current[0] = el;
    }
  }), /*#__PURE__*/external_React_default().createElement("hr", null), /*#__PURE__*/external_React_default().createElement(Sizes, {
    key: 1,
    ref: function ref(el) {
      return sectionsRef.current[1] = el;
    }
  }), /*#__PURE__*/external_React_default().createElement("hr", null), /*#__PURE__*/external_React_default().createElement(ApiKeys, {
    key: 2,
    ref: function ref(el) {
      return sectionsRef.current[2] = el;
    }
  }), /*#__PURE__*/external_React_default().createElement("hr", null), /*#__PURE__*/external_React_default().createElement(Updates, {
    key: 3,
    ref: function ref(el) {
      return sectionsRef.current[3] = el;
    }
  }))));
};
var SettingsApp = function SettingsApp() {
  return /*#__PURE__*/external_React_default().createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column"
    }
  }, /*#__PURE__*/external_React_default().createElement(AppHeader, {
    enableBrowseButton: true,
    style: {
      position: "sticky",
      top: "32px",
      background: "#F0F0F0",
      zIndex: "999"
    }
  }), /*#__PURE__*/external_React_default().createElement(ScrollableMenu, null));
};
;// ./src/settings.js



document.addEventListener("DOMContentLoaded", function () {
  var container = document.getElementById("image-hub-settings-root");
  if (container) {
    var root = (0,client/* createRoot */.H)(container);
    root.render(/*#__PURE__*/external_React_default().createElement((external_React_default()).StrictMode, null, /*#__PURE__*/external_React_default().createElement(SettingsApp, null)));
  }
});
/******/ })()
;
//# sourceMappingURL=settings.js.map
