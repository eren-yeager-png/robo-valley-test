/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 338:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";
var __webpack_unused_export__;


var m = __webpack_require__(795);
if (true) {
  exports.H = m.createRoot;
  __webpack_unused_export__ = m.hydrateRoot;
} else { var i; }


/***/ }),

/***/ 521:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

var __webpack_unused_export__;
"use client"


function ___$insertStyle(css) {
    if (!css || typeof window === 'undefined') {
        return;
    }
    const style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.innerHTML = css;
    document.head.appendChild(style);
    return css;
}

__webpack_unused_export__ = ({ value: true });

var React = __webpack_require__(609);

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

var React__default = /*#__PURE__*/_interopDefaultLegacy(React);

___$insertStyle(".rfm-marquee-container {\n  overflow-x: hidden;\n  display: flex;\n  flex-direction: row;\n  position: relative;\n  width: var(--width);\n  transform: var(--transform);\n}\n.rfm-marquee-container:hover div {\n  animation-play-state: var(--pause-on-hover);\n}\n.rfm-marquee-container:active div {\n  animation-play-state: var(--pause-on-click);\n}\n\n.rfm-overlay {\n  position: absolute;\n  width: 100%;\n  height: 100%;\n}\n.rfm-overlay::before, .rfm-overlay::after {\n  background: linear-gradient(to right, var(--gradient-color), rgba(255, 255, 255, 0));\n  content: \"\";\n  height: 100%;\n  position: absolute;\n  width: var(--gradient-width);\n  z-index: 2;\n  pointer-events: none;\n  touch-action: none;\n}\n.rfm-overlay::after {\n  right: 0;\n  top: 0;\n  transform: rotateZ(180deg);\n}\n.rfm-overlay::before {\n  left: 0;\n  top: 0;\n}\n\n.rfm-marquee {\n  flex: 0 0 auto;\n  min-width: var(--min-width);\n  z-index: 1;\n  display: flex;\n  flex-direction: row;\n  align-items: center;\n  animation: scroll var(--duration) linear var(--delay) var(--iteration-count);\n  animation-play-state: var(--play);\n  animation-delay: var(--delay);\n  animation-direction: var(--direction);\n}\n@keyframes scroll {\n  0% {\n    transform: translateX(0%);\n  }\n  100% {\n    transform: translateX(-100%);\n  }\n}\n\n.rfm-initial-child-container {\n  flex: 0 0 auto;\n  display: flex;\n  min-width: auto;\n  flex-direction: row;\n  align-items: center;\n}\n\n.rfm-child {\n  transform: var(--transform);\n}");

const Marquee = React.forwardRef(function Marquee({ style = {}, className = "", autoFill = false, play = true, pauseOnHover = false, pauseOnClick = false, direction = "left", speed = 50, delay = 0, loop = 0, gradient = false, gradientColor = "white", gradientWidth = 200, onFinish, onCycleComplete, onMount, children, }, ref) {
    // React Hooks
    const [containerWidth, setContainerWidth] = React.useState(0);
    const [marqueeWidth, setMarqueeWidth] = React.useState(0);
    const [multiplier, setMultiplier] = React.useState(1);
    const [isMounted, setIsMounted] = React.useState(false);
    const rootRef = React.useRef(null);
    const containerRef = ref || rootRef;
    const marqueeRef = React.useRef(null);
    // Calculate width of container and marquee and set multiplier
    const calculateWidth = React.useCallback(() => {
        if (marqueeRef.current && containerRef.current) {
            const containerRect = containerRef.current.getBoundingClientRect();
            const marqueeRect = marqueeRef.current.getBoundingClientRect();
            let containerWidth = containerRect.width;
            let marqueeWidth = marqueeRect.width;
            // Swap width and height if direction is up or down
            if (direction === "up" || direction === "down") {
                containerWidth = containerRect.height;
                marqueeWidth = marqueeRect.height;
            }
            if (autoFill && containerWidth && marqueeWidth) {
                setMultiplier(marqueeWidth < containerWidth
                    ? Math.ceil(containerWidth / marqueeWidth)
                    : 1);
            }
            else {
                setMultiplier(1);
            }
            setContainerWidth(containerWidth);
            setMarqueeWidth(marqueeWidth);
        }
    }, [autoFill, containerRef, direction]);
    // Calculate width and multiplier on mount and on window resize
    React.useEffect(() => {
        if (!isMounted)
            return;
        calculateWidth();
        if (marqueeRef.current && containerRef.current) {
            const resizeObserver = new ResizeObserver(() => calculateWidth());
            resizeObserver.observe(containerRef.current);
            resizeObserver.observe(marqueeRef.current);
            return () => {
                if (!resizeObserver)
                    return;
                resizeObserver.disconnect();
            };
        }
    }, [calculateWidth, containerRef, isMounted]);
    // Recalculate width when children change
    React.useEffect(() => {
        calculateWidth();
    }, [calculateWidth, children]);
    React.useEffect(() => {
        setIsMounted(true);
    }, []);
    // Runs the onMount callback, if it is a function, when Marquee is mounted.
    React.useEffect(() => {
        if (typeof onMount === "function") {
            onMount();
        }
    }, []);
    // Animation duration
    const duration = React.useMemo(() => {
        if (autoFill) {
            return (marqueeWidth * multiplier) / speed;
        }
        else {
            return marqueeWidth < containerWidth
                ? containerWidth / speed
                : marqueeWidth / speed;
        }
    }, [autoFill, containerWidth, marqueeWidth, multiplier, speed]);
    const containerStyle = React.useMemo(() => (Object.assign(Object.assign({}, style), { ["--pause-on-hover"]: !play || pauseOnHover ? "paused" : "running", ["--pause-on-click"]: !play || (pauseOnHover && !pauseOnClick) || pauseOnClick
            ? "paused"
            : "running", ["--width"]: direction === "up" || direction === "down" ? `100vh` : "100%", ["--transform"]: direction === "up"
            ? "rotate(-90deg)"
            : direction === "down"
                ? "rotate(90deg)"
                : "none" })), [style, play, pauseOnHover, pauseOnClick, direction]);
    const gradientStyle = React.useMemo(() => ({
        ["--gradient-color"]: gradientColor,
        ["--gradient-width"]: typeof gradientWidth === "number"
            ? `${gradientWidth}px`
            : gradientWidth,
    }), [gradientColor, gradientWidth]);
    const marqueeStyle = React.useMemo(() => ({
        ["--play"]: play ? "running" : "paused",
        ["--direction"]: direction === "left" ? "normal" : "reverse",
        ["--duration"]: `${duration}s`,
        ["--delay"]: `${delay}s`,
        ["--iteration-count"]: !!loop ? `${loop}` : "infinite",
        ["--min-width"]: autoFill ? `auto` : "100%",
    }), [play, direction, duration, delay, loop, autoFill]);
    const childStyle = React.useMemo(() => ({
        ["--transform"]: direction === "up"
            ? "rotate(90deg)"
            : direction === "down"
                ? "rotate(-90deg)"
                : "none",
    }), [direction]);
    // Render {multiplier} number of children
    const multiplyChildren = React.useCallback((multiplier) => {
        return [
            ...Array(Number.isFinite(multiplier) && multiplier >= 0 ? multiplier : 0),
        ].map((_, i) => (React__default['default'].createElement(React.Fragment, { key: i }, React.Children.map(children, (child) => {
            return (React__default['default'].createElement("div", { style: childStyle, className: "rfm-child" }, child));
        }))));
    }, [childStyle, children]);
    return !isMounted ? null : (React__default['default'].createElement("div", { ref: containerRef, style: containerStyle, className: "rfm-marquee-container " + className },
        gradient && React__default['default'].createElement("div", { style: gradientStyle, className: "rfm-overlay" }),
        React__default['default'].createElement("div", { className: "rfm-marquee", style: marqueeStyle, onAnimationIteration: onCycleComplete, onAnimationEnd: onFinish },
            React__default['default'].createElement("div", { className: "rfm-initial-child-container", ref: marqueeRef }, React.Children.map(children, (child) => {
                return (React__default['default'].createElement("div", { style: childStyle, className: "rfm-child" }, child));
            })),
            multiplyChildren(multiplier - 1)),
        React__default['default'].createElement("div", { className: "rfm-marquee", style: marqueeStyle }, multiplyChildren(multiplier))));
});

exports.A = Marquee;
//# sourceMappingURL=index.js.map


/***/ }),

/***/ 609:
/***/ ((module) => {

"use strict";
module.exports = window["React"];

/***/ }),

/***/ 795:
/***/ ((module) => {

"use strict";
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
// This entry needs to be wrapped in an IIFE because it needs to be in strict mode.
(() => {
"use strict";

// EXTERNAL MODULE: external "React"
var external_React_ = __webpack_require__(609);
var external_React_default = /*#__PURE__*/__webpack_require__.n(external_React_);
// EXTERNAL MODULE: ./node_modules/react-dom/client.js
var client = __webpack_require__(338);
;// external ["wp","element"]
const external_wp_element_namespaceObject = window["wp"]["element"];
;// external ["wp","components"]
const external_wp_components_namespaceObject = window["wp"]["components"];
;// external ["wp","i18n"]
const external_wp_i18n_namespaceObject = window["wp"]["i18n"];
;// external ["wp","primitives"]
const external_wp_primitives_namespaceObject = window["wp"]["primitives"];
;// external "ReactJSXRuntime"
const external_ReactJSXRuntime_namespaceObject = window["ReactJSXRuntime"];
;// ./node_modules/@wordpress/icons/build-module/library/external.js
/**
 * WordPress dependencies
 */


const external = /*#__PURE__*/(0,external_ReactJSXRuntime_namespaceObject.jsx)(external_wp_primitives_namespaceObject.SVG, {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  children: /*#__PURE__*/(0,external_ReactJSXRuntime_namespaceObject.jsx)(external_wp_primitives_namespaceObject.Path, {
    d: "M19.5 4.5h-7V6h4.44l-5.97 5.97 1.06 1.06L18 7.06v4.44h1.5v-7Zm-13 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3H17v3a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h3V5.5h-3Z"
  })
});
/* harmony default export */ const library_external = (external);
//# sourceMappingURL=external.js.map
;// ./node_modules/@wordpress/icons/build-module/library/check.js
/**
 * WordPress dependencies
 */


const check = /*#__PURE__*/(0,external_ReactJSXRuntime_namespaceObject.jsx)(external_wp_primitives_namespaceObject.SVG, {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  children: /*#__PURE__*/(0,external_ReactJSXRuntime_namespaceObject.jsx)(external_wp_primitives_namespaceObject.Path, {
    d: "M16.7 7.1l-6.3 8.5-3.3-2.5-.9 1.2 4.5 3.4L17.9 8z"
  })
});
/* harmony default export */ const library_check = (check);
//# sourceMappingURL=check.js.map
;// ./node_modules/@wordpress/icons/build-module/library/download.js
/**
 * WordPress dependencies
 */


const download = /*#__PURE__*/(0,external_ReactJSXRuntime_namespaceObject.jsx)(external_wp_primitives_namespaceObject.SVG, {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  children: /*#__PURE__*/(0,external_ReactJSXRuntime_namespaceObject.jsx)(external_wp_primitives_namespaceObject.Path, {
    d: "M18 11.3l-1-1.1-4 4V3h-1.5v11.3L7 10.2l-1 1.1 6.2 5.8 5.8-5.8zm.5 3.7v3.5h-13V15H4v5h16v-5h-1.5z"
  })
});
/* harmony default export */ const library_download = (download);
//# sourceMappingURL=download.js.map
;// ./node_modules/@wordpress/icons/build-module/library/close.js
/**
 * WordPress dependencies
 */


const close_close = /*#__PURE__*/(0,external_ReactJSXRuntime_namespaceObject.jsx)(external_wp_primitives_namespaceObject.SVG, {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  children: /*#__PURE__*/(0,external_ReactJSXRuntime_namespaceObject.jsx)(external_wp_primitives_namespaceObject.Path, {
    d: "m13.06 12 6.47-6.47-1.06-1.06L12 10.94 5.53 4.47 4.47 5.53 10.94 12l-6.47 6.47 1.06 1.06L12 13.06l6.47 6.47 1.06-1.06L13.06 12Z"
  })
});
/* harmony default export */ const library_close = (close_close);
//# sourceMappingURL=close.js.map
;// ./node_modules/react-responsive-masonry/es/Masonry/index.js
function _extends() { _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }

function _inheritsLoose(subClass, superClass) { subClass.prototype = Object.create(superClass.prototype); subClass.prototype.constructor = subClass; _setPrototypeOf(subClass, superClass); }

function _setPrototypeOf(o, p) { _setPrototypeOf = Object.setPrototypeOf || function _setPrototypeOf(o, p) { o.__proto__ = p; return o; }; return _setPrototypeOf(o, p); }




var Masonry = /*#__PURE__*/function (_React$Component) {
  _inheritsLoose(Masonry, _React$Component);

  function Masonry() {
    var _this;

    _this = _React$Component.call(this) || this;
    _this.state = {
      columns: [],
      childRefs: [],
      hasDistributed: false
    };
    return _this;
  }

  var _proto = Masonry.prototype;

  _proto.componentDidUpdate = function componentDidUpdate() {
    if (!this.state.hasDistributed && !this.props.sequential) this.distributeChildren();
  };

  Masonry.getDerivedStateFromProps = function getDerivedStateFromProps(props, state) {
    var children = props.children,
        columnsCount = props.columnsCount;
    var hasColumnsChanged = columnsCount !== state.columns.length;
    if (state && children === state.children && !hasColumnsChanged) return null;
    return _extends({}, Masonry.getEqualCountColumns(children, columnsCount), {
      children: children,
      hasDistributed: false
    });
  };

  _proto.shouldComponentUpdate = function shouldComponentUpdate(nextProps) {
    return nextProps.children !== this.state.children || nextProps.columnsCount !== this.props.columnsCount;
  };

  _proto.distributeChildren = function distributeChildren() {
    var _this2 = this;

    var _this$props = this.props,
        children = _this$props.children,
        columnsCount = _this$props.columnsCount;
    var columnHeights = Array(columnsCount).fill(0);
    var isReady = this.state.childRefs.every(function (ref) {
      return ref.current.getBoundingClientRect().height;
    });
    if (!isReady) return;
    var columns = Array.from({
      length: columnsCount
    }, function () {
      return [];
    });
    var validIndex = 0;
    external_React_default().Children.forEach(children, function (child) {
      if (child && external_React_default().isValidElement(child)) {
        // .current is undefined if ref was passed to a functional component without forwardRef
        // now passing ref into a wrapper div so it should always be defined
        var childHeight = _this2.state.childRefs[validIndex].current.getBoundingClientRect().height;

        var minHeightColumnIndex = columnHeights.indexOf(Math.min.apply(Math, columnHeights));
        columnHeights[minHeightColumnIndex] += childHeight;
        columns[minHeightColumnIndex].push(child);
        validIndex++;
      }
    });
    this.setState(function (p) {
      return _extends({}, p, {
        columns: columns,
        hasDistributed: true
      });
    });
  };

  Masonry.getEqualCountColumns = function getEqualCountColumns(children, columnsCount) {
    var columns = Array.from({
      length: columnsCount
    }, function () {
      return [];
    });
    var validIndex = 0;
    var childRefs = [];
    external_React_default().Children.forEach(children, function (child) {
      if (child && external_React_default().isValidElement(child)) {
        var ref = external_React_default().createRef();
        childRefs.push(ref);
        columns[validIndex % columnsCount].push( /*#__PURE__*/external_React_default().createElement("div", {
          style: {
            display: "flex",
            justifyContent: "stretch"
          },
          key: validIndex,
          ref: ref
        }, child) // React.cloneElement(child, {ref}) // cannot attach refs to functional components without forwardRef
        );
        validIndex++;
      }
    });
    return {
      columns: columns,
      childRefs: childRefs
    };
  };

  _proto.renderColumns = function renderColumns() {
    var _this$props2 = this.props,
        gutter = _this$props2.gutter,
        itemTag = _this$props2.itemTag,
        itemStyle = _this$props2.itemStyle;
    return this.state.columns.map(function (column, i) {
      return external_React_default().createElement(itemTag, {
        key: i,
        style: _extends({
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-start",
          alignContent: "stretch",
          flex: 1,
          width: 0,
          gap: gutter
        }, itemStyle)
      }, column.map(function (item) {
        return item;
      }));
    });
  };

  _proto.render = function render() {
    var _this$props3 = this.props,
        gutter = _this$props3.gutter,
        className = _this$props3.className,
        style = _this$props3.style,
        containerTag = _this$props3.containerTag;
    return external_React_default().createElement(containerTag, {
      style: _extends({
        display: "flex",
        flexDirection: "row",
        justifyContent: "center",
        alignContent: "stretch",
        boxSizing: "border-box",
        width: "100%",
        gap: gutter
      }, style),
      className: className
    }, this.renderColumns());
  };

  return Masonry;
}((external_React_default()).Component);

Masonry.propTypes =  false ? 0 : {};
Masonry.defaultProps = {
  columnsCount: 3,
  gutter: "0",
  className: null,
  style: {},
  containerTag: "div",
  itemTag: "div",
  itemStyle: {},
  sequential: false
};
/* harmony default export */ const es_Masonry = (Masonry);
;// ./node_modules/react-responsive-masonry/es/ResponsiveMasonry/index.js


var DEFAULT_COLUMNS_COUNT = 1;
var DEFAULT_GUTTER = "10px";
var useIsomorphicLayoutEffect = typeof window !== "undefined" ? external_React_.useLayoutEffect : external_React_.useEffect;

var useHasMounted = function useHasMounted() {
  var _useState = (0,external_React_.useState)(false),
      hasMounted = _useState[0],
      setHasMounted = _useState[1];

  useIsomorphicLayoutEffect(function () {
    setHasMounted(true);
  }, []);
  return hasMounted;
};

var useWindowWidth = function useWindowWidth() {
  var hasMounted = useHasMounted();

  var _useState2 = (0,external_React_.useState)(typeof window !== "undefined" ? window.innerWidth : 0),
      width = _useState2[0],
      setWidth = _useState2[1];

  var handleResize = (0,external_React_.useCallback)(function () {
    if (!hasMounted) return;
    setWidth(window.innerWidth);
  }, [hasMounted]);
  useIsomorphicLayoutEffect(function () {
    if (hasMounted) {
      window.addEventListener("resize", handleResize);
      handleResize();
      return function () {
        return window.removeEventListener("resize", handleResize);
      };
    }
  }, [hasMounted, handleResize]);
  return width;
};

var MasonryResponsive = function MasonryResponsive(_ref) {
  var _ref$columnsCountBrea = _ref.columnsCountBreakPoints,
      columnsCountBreakPoints = _ref$columnsCountBrea === void 0 ? {
    350: 1,
    750: 2,
    900: 3
  } : _ref$columnsCountBrea,
      _ref$gutterBreakPoint = _ref.gutterBreakPoints,
      gutterBreakPoints = _ref$gutterBreakPoint === void 0 ? {} : _ref$gutterBreakPoint,
      children = _ref.children,
      _ref$className = _ref.className,
      className = _ref$className === void 0 ? null : _ref$className,
      _ref$style = _ref.style,
      style = _ref$style === void 0 ? null : _ref$style;
  var windowWidth = useWindowWidth();
  var getResponsiveValue = (0,external_React_.useCallback)(function (breakPoints, defaultValue) {
    var sortedBreakPoints = Object.keys(breakPoints).sort(function (a, b) {
      return a - b;
    });
    var value = sortedBreakPoints.length > 0 ? breakPoints[sortedBreakPoints[0]] : defaultValue;
    sortedBreakPoints.forEach(function (breakPoint) {
      if (breakPoint < windowWidth) {
        value = breakPoints[breakPoint];
      }
    });
    return value;
  }, [windowWidth]);
  var columnsCount = (0,external_React_.useMemo)(function () {
    return getResponsiveValue(columnsCountBreakPoints, DEFAULT_COLUMNS_COUNT);
  }, [getResponsiveValue, columnsCountBreakPoints]);
  var gutter = (0,external_React_.useMemo)(function () {
    return getResponsiveValue(gutterBreakPoints, DEFAULT_GUTTER);
  }, [getResponsiveValue, gutterBreakPoints]);
  return /*#__PURE__*/external_React_default().createElement("div", {
    className: className,
    style: style
  }, external_React_default().Children.map(children, function (child, index) {
    return external_React_default().cloneElement(child, {
      key: index,
      columnsCount: columnsCount,
      gutter: gutter
    });
  }));
};

MasonryResponsive.propTypes =  false ? 0 : {};
/* harmony default export */ const ResponsiveMasonry = (MasonryResponsive);
;// ./node_modules/react-responsive-masonry/es/index.js


/* harmony default export */ const es = (es_Masonry);

;// ./src/context/useSettings.js

var __settings = image_hub_settings;
var getImageHubSettings = function getImageHubSettings() {
  var imageHubSettings = (0,external_React_.useMemo)(function () {
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
  var apiKeys = (0,external_React_.useMemo)(function () {
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
;// ./src/helpers.js
/**
 * Get API key(s) from WordPress settings based on provider name
 *
 * @param {string} [providerName] - The name of the provider (unsplash, pexels, giphy, pixabay, openverse)
 * @returns {Promise<Object|string[]|false>} A promise that resolves to an object of API keys, an array of keys for a specific provider, or false if not found
 */

var PROVIDERQUERY = {
  PIXABAY: {
    searchTerm: {
      name: "q"
    },
    type: {
      name: "type",
      acc_values: ["all", "photo", "illustration", "vector"],
      "default": "all"
    },
    category: {
      name: "category",
      acc_values: ["backgrounds", "fashion", "nature", "science", "education", "feelings", "health", "people", "religion", "places", "animals", "industry", "computer", "food", "sports", "transportation", "travel", "buildings", "business", "music"]
    },
    orientation: {
      name: "orientation",
      acc_values: ["all", "horizontal", "vertical"],
      "default": "all"
    },
    color: {
      name: "colors",
      acc_values: ["grayscale", "transparent", "red", "orange", "yellow", "green", "turquoise", "blue", "lilac", "pink", "white", "gray", "black", "brown"]
    },
    min_height: {
      name: "min_height",
      "default": 0
    },
    min_width: {
      name: "min_width",
      "default": 0
    }
  },
  PEXELS: {
    searchTerm: {
      name: "query"
    },
    orientation: {
      name: "orientation",
      acc_values: ["landscape", "portrait", "square"]
    },
    color: {
      name: "color",
      acc_values: ["red", "orange", "yellow", "green", "turquoise", "blue", "violet", "pink", "brown", "black", "gray", "white"]
    },
    size: {
      name: "size",
      acc_values: ["large", "medium", "small"]
    }
  },
  GIPHY: {
    searchTerm: {
      name: "q"
    }
  },
  OPENVERSE: {
    searchTerm: {
      name: "q"
    },
    extension: {
      name: "extension",
      acc_values: ["JPG", "JPEG", "PNG", "GIF"]
    },
    orientation: {
      name: "aspect_ratio",
      acc_values: ["square", "wide", "tall"]
    },
    size: {
      name: "size",
      acc_values: ["large", "medium", "small"]
    },
    category: {
      name: "category",
      acc_values: ["digitized_artwork", "illustration", "photograph"]
    },
    license_type: {
      name: "license_type",
      acc_values: ["all", "all-cc", "commercial", "modification"],
      values_labels: ["All", "All CC", "Commercial", "Modification"]
    },
    license: {
      name: "license",
      acc_values: ["cc0", "by", "by-sa", "by-nd", "by-nc", "by-nc-sa", "by-nc-nd"],
      values_labels: ["CC0", "CC BY", "CC BY-SA", "CC BY-ND", "CC BY-NC", "CC BY-NC-SA", "CC BY-NC-ND"]
    }
  },
  UNSPLASH: {
    searchTerm: {
      name: "query"
    },
    orientation: {
      name: "orientation",
      acc_values: ["landscape", "portrait", "squarish"],
      "default": "all"
    },
    color: {
      name: "color",
      acc_values: ["black_and_white", "black", "white", "yellow", "orange", "red", "purple", "magenta", "green", "teal", "blue"]
    }
  }
};
var UnsplashIconURL = image_hub_data.unsplashLogoUrl;
var OpenverseIconURL = image_hub_data.openverseLogoUrl;
var GiphyIconURL = image_hub_data.giphyLogoUrl;
var PexelsIconURL = image_hub_data.pexelsLogoUrl;
var PixabayIconURL = image_hub_data.pixabayLogoUrl;
var TransparentBG = image_hub_data.transparentBG;
var PROVIDERS = {
  All: {
    name: "All",
    icon: null,
    enabled: false
  },
  PEXELS: {
    name: "pexels",
    icon: PexelsIconURL,
    enabled: false
  },
  UNSPLASH: {
    name: "unsplash",
    icon: UnsplashIconURL,
    enabled: false
  },
  PIXABAY: {
    name: "pixabay",
    icon: PixabayIconURL,
    enabled: false
  },
  OPENVERSE: {
    name: "openverse",
    icon: OpenverseIconURL,
    enabled: false
  },
  GIPHY: {
    name: "giphy",
    icon: GiphyIconURL,
    enabled: false
  }
};
var ucfirst = function ucfirst(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
};
;// ./src/context/ImageContext.js
function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
function _toConsumableArray(r) { return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread(); }
function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _iterableToArray(r) { if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r); }
function _arrayWithoutHoles(r) { if (Array.isArray(r)) return _arrayLikeToArray(r); }
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _slicedToArray(r, e) { return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest(); }
function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
function _iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function _arrayWithHoles(r) { if (Array.isArray(r)) return r; }



var server_url = image_hub_data.server_url;
var PER_PAGE = 30;
var defaultPagination = {
  currentPage: 1,
  totalPages: 1,
  totalResults: 0,
  hasNextPage: false,
  nextPage: false
};
var ImageContext = (0,external_wp_element_namespaceObject.createContext)();
var ImageProvider = function ImageProvider(_ref) {
  var children = _ref.children;
  var _useState = (0,external_wp_element_namespaceObject.useState)([]),
    _useState2 = _slicedToArray(_useState, 2),
    images = _useState2[0],
    setImages = _useState2[1];
  var _useState3 = (0,external_wp_element_namespaceObject.useState)(""),
    _useState4 = _slicedToArray(_useState3, 2),
    searchTerm = _useState4[0],
    setSearchTerm = _useState4[1];
  var _useState5 = (0,external_wp_element_namespaceObject.useState)(""),
    _useState6 = _slicedToArray(_useState5, 2),
    lastSearchTerm = _useState6[0],
    setLastSearchTerm = _useState6[1];
  var _useState7 = (0,external_wp_element_namespaceObject.useState)("All"),
    _useState8 = _slicedToArray(_useState7, 2),
    provider = _useState8[0],
    setProvider = _useState8[1]; // Set initial provider to "All"
  var _useState9 = (0,external_wp_element_namespaceObject.useState)("All"),
    _useState10 = _slicedToArray(_useState9, 2),
    errors = _useState10[0],
    setErrors = _useState10[1];
  var _useState11 = (0,external_wp_element_namespaceObject.useState)({}),
    _useState12 = _slicedToArray(_useState11, 2),
    additionalQueryParams = _useState12[0],
    setAdditionalQueryParams = _useState12[1];
  var _useState13 = (0,external_wp_element_namespaceObject.useState)(defaultPagination),
    _useState14 = _slicedToArray(_useState13, 2),
    pagination = _useState14[0],
    setPagination = _useState14[1];
  var _useState15 = (0,external_wp_element_namespaceObject.useState)(true),
    _useState16 = _slicedToArray(_useState15, 2),
    isLoading = _useState16[0],
    setIsLoading = _useState16[1];
  var _getImageHubSettings = getImageHubSettings(),
    imageHubSettings = _getImageHubSettings.imageHubSettings,
    apiKeys = _getImageHubSettings.apiKeys;
  var _useState17 = (0,external_wp_element_namespaceObject.useState)(false),
    _useState18 = _slicedToArray(_useState17, 2),
    refresh = _useState18[0],
    setRefresh = _useState18[1];
  (0,external_wp_element_namespaceObject.useEffect)(function () {
    if (images.length) {
      sessionStorage.setItem("image_hub_session", JSON.stringify({
        images: images,
        searchTerm: lastSearchTerm,
        pagination: pagination,
        provider: provider,
        additionalQueryParams: additionalQueryParams
      }));
    }
  }, [images, searchTerm, pagination, provider, additionalQueryParams, lastSearchTerm]);
  (0,external_wp_element_namespaceObject.useEffect)(function () {
    var saved = sessionStorage.getItem("image_hub_session");
    if (saved) {
      try {
        //dont know yet if saving all images json is correct , but keeps history consistent 
        var parsed = JSON.parse(saved);
        if (parsed.images) setImages(parsed.images);
        if (parsed.searchTerm) {
          setLastSearchTerm(parsed.searchTerm);
          setSearchTerm(parsed.searchTerm);
        }
        if (parsed.provider) setProvider(parsed.provider);
        if (parsed.additionalQueryParams) setAdditionalQueryParams(parsed.additionalQueryParams);
        if (parsed.pagination) setPagination(parsed.pagination);
        setIsLoading(false);
      } catch (e) {
        console.error("Failed to parse session storage:", e);
      }
    } else {
      fetchImages(searchTerm === null || searchTerm === void 0 ? void 0 : searchTerm.toLowerCase(), provider, 1, true);
    }
  }, []);
  var removeImage = function removeImage(id) {
    setImages(function (prevImgs) {
      return prevImgs.filter(function (x) {
        return x.id !== id;
      });
    });
    setPagination(function (prevPagination) {
      return _objectSpread(_objectSpread({}, prevPagination), {}, {
        totalResults: prevPagination.totalResults - 1
      });
    });
  };
  var updateQueryParams = function updateQueryParams(key, value) {
    setAdditionalQueryParams(function (prev) {
      var clonn = _objectSpread({}, prev);
      if (value == "All" || value == "") {
        setRefresh(true);
        delete clonn[key];
      } else {
        clonn[key] = value;
      }
      return clonn;
    });
  };

  // Function to fetch images from the API
  var fetchImages = function fetchImages() {
    var query = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : searchTerm;
    var selectedProvider = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : provider;
    var page = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : pagination.currentPage;
    var reset = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : false;
    var additional_query_params = arguments.length > 4 && arguments[4] !== undefined ? arguments[4] : additionalQueryParams;
    setIsLoading(true);
    if (reset) {
      setPagination(defaultPagination);
      setImages([]);
    }
    setLastSearchTerm(query);
    var enabledProviders = Object.keys(PROVIDERS).filter(function (key) {
      return key !== "All" && imageHubSettings["image_hub_enable_".concat(PROVIDERS[key].name)];
    });
    //due to tos
    var enabledProvidersWithoutGiphy = enabledProviders.filter(function (x) {
      return x != "GIPHY";
    });
    console.log({
      enabledProviders: enabledProviders,
      enabledProvidersWithoutGiphy: enabledProvidersWithoutGiphy
    });
    var providerParam = selectedProvider === "All" ? "&provider=".concat(enabledProvidersWithoutGiphy.map(function (p) {
      return PROVIDERS[p].name;
    }).join(",")) : "&provider=".concat(selectedProvider);
    var additionalParams = selectedProvider !== "All" ? Object.entries(additional_query_params).map(function (_ref2) {
      var _ref3 = _slicedToArray(_ref2, 2),
        key = _ref3[0],
        value = _ref3[1];
      return "&".concat(key === null || key === void 0 ? void 0 : key.toLowerCase(), "=").concat(encodeURIComponent(value === null || value === void 0 ? void 0 : value.toLowerCase()));
    }).join("") : "";
    var apiUrl = "".concat(server_url, "/?query=").concat(encodeURIComponent(query), "&page=").concat(page, "&per_page=").concat(PER_PAGE).concat(additionalParams).concat(providerParam);
    var headers = {};
    if (!apiKeys.image_hub_use_default_keys) {
      Object.entries(apiKeys || {}).forEach(function (_ref4) {
        var _ref5 = _slicedToArray(_ref4, 2),
          key = _ref5[0],
          value = _ref5[1];
        if (value) {
          var headerKey = key.replace(/_/g, "-"); // Convert underscores to hyphens
          headers[headerKey] = value;
        }
      });
    }
    return fetch(apiUrl, {
      method: "GET",
      headers: headers
    }).then(function (response) {
      return response.json();
    }).then(function (data) {
      if (reset) {
        setPagination(defaultPagination);
        setImages([]);
      }
      setImages(function (x) {
        return [].concat(_toConsumableArray(x), _toConsumableArray(data.images || []));
      });
      setPagination(data.pagination);
      setIsLoading(false);
      setErrors(data.errors);
      return data.images;
    })["catch"](function (error) {
      if (reset) {
        setPagination(defaultPagination);
        setImages([]);
      }
      setErrors({
        All: error.message
      });
      console.error("Error fetching images:", {
        error: error
      });
      setIsLoading(false);
      return [];
    });
  };

  // Function to handle the search
  var handleSearch = debounce(function (param) {
    fetchImages(param !== null && param !== void 0 ? param : searchTerm, provider, 1, true);
  }, 500);
  (0,external_wp_element_namespaceObject.useEffect)(function () {
    if (Object.keys(additionalQueryParams).length > 0 || refresh) {
      refresh = false;
      handleSearch();
    }
  }, [additionalQueryParams]);
  var value = {
    errors: errors,
    lastSearchTerm: lastSearchTerm,
    images: images,
    searchTerm: searchTerm,
    setSearchTerm: setSearchTerm,
    provider: provider,
    setProvider: setProvider,
    fetchImages: fetchImages,
    handleSearch: handleSearch,
    pagination: pagination,
    isLoading: isLoading,
    additionalQueryParams: additionalQueryParams,
    updateQueryParams: updateQueryParams,
    removeImage: removeImage,
    setAdditionalQueryParams: setAdditionalQueryParams
  };
  return /*#__PURE__*/React.createElement(ImageContext.Provider, {
    value: value
  }, children);
};
var useImageContext = function useImageContext() {
  var context = (0,external_wp_element_namespaceObject.useContext)(ImageContext);
  if (context === undefined) {
    throw new Error("useImageContext must be used within an ImageProvider");
  }
  return context;
};
var timeoutId;
var debounce = function debounce(func, delay) {
  return function () {
    for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }
    // Clear previous timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    // Set a new timeout
    timeoutId = setTimeout(function () {
      func.apply(void 0, args);
    }, delay);
  };
};
;// ./src/components/Loader.js



var DownloadProgress = function DownloadProgress(_ref) {
  var _ref$iconSize = _ref.iconSize,
    iconSize = _ref$iconSize === void 0 ? 24 : _ref$iconSize,
    _ref$fillColor = _ref.fillColor,
    fillColor = _ref$fillColor === void 0 ? 'white' : _ref$fillColor,
    _ref$text = _ref.text,
    text = _ref$text === void 0 ? 'Downloading...' : _ref$text,
    _ref$textColor = _ref.textColor,
    textColor = _ref$textColor === void 0 ? 'white' : _ref$textColor,
    _ref$progressValue = _ref.progressValue,
    progressValue = _ref$progressValue === void 0 ? 50 : _ref$progressValue,
    _ref$barBackgroundCol = _ref.barBackgroundColor,
    barBackgroundColor = _ref$barBackgroundCol === void 0 ? 'grey' : _ref$barBackgroundCol,
    _ref$barFillColor = _ref.barFillColor,
    barFillColor = _ref$barFillColor === void 0 ? 'white' : _ref$barFillColor,
    _ref$barHeight = _ref.barHeight,
    barHeight = _ref$barHeight === void 0 ? '3px' : _ref$barHeight,
    _ref$barRadius = _ref.barRadius,
    barRadius = _ref$barRadius === void 0 ? '5px' : _ref$barRadius;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(external_wp_components_namespaceObject.Icon, {
    size: iconSize,
    fill: fillColor,
    icon: library_download
  }), /*#__PURE__*/React.createElement("div", {
    key: "loader-container",
    style: {
      color: textColor,
      marginTop: '10px',
      lineHeight: '100%',
      transition: 'color 0.3s ease'
    }
  }, text), /*#__PURE__*/React.createElement("progress", {
    value: progressValue,
    max: "100",
    style: {
      marginTop: '20px',
      width: '80%',
      height: barHeight,
      borderRadius: barRadius,
      backgroundColor: barBackgroundColor,
      transition: 'background-color 0.3s ease, height 0.3s ease'
    }
  }));
};
/* harmony default export */ const Loader = (DownloadProgress);
;// ./node_modules/@wordpress/icons/build-module/library/caution-filled.js
/**
 * WordPress dependencies
 */


const cautionFilled = /*#__PURE__*/(0,external_ReactJSXRuntime_namespaceObject.jsx)(external_wp_primitives_namespaceObject.SVG, {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  children: /*#__PURE__*/(0,external_ReactJSXRuntime_namespaceObject.jsx)(external_wp_primitives_namespaceObject.Path, {
    d: "M12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4ZM12.75 8V13H11.25V8H12.75ZM12.75 14.5V16H11.25V14.5H12.75Z"
  })
});
/* harmony default export */ const caution_filled = (cautionFilled);
//# sourceMappingURL=caution-filled.js.map
// EXTERNAL MODULE: ./node_modules/react-fast-marquee/dist/index.js
var dist = __webpack_require__(521);
;// ./src/components/ImageGrid.js
function ImageGrid_typeof(o) { "@babel/helpers - typeof"; return ImageGrid_typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, ImageGrid_typeof(o); }
function ImageGrid_ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function ImageGrid_objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ImageGrid_ownKeys(Object(t), !0).forEach(function (r) { ImageGrid_defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ImageGrid_ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function ImageGrid_defineProperty(e, r, t) { return (r = ImageGrid_toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function ImageGrid_toPropertyKey(t) { var i = ImageGrid_toPrimitive(t, "string"); return "symbol" == ImageGrid_typeof(i) ? i : i + ""; }
function ImageGrid_toPrimitive(t, r) { if ("object" != ImageGrid_typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != ImageGrid_typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function ImageGrid_slicedToArray(r, e) { return ImageGrid_arrayWithHoles(r) || ImageGrid_iterableToArrayLimit(r, e) || ImageGrid_unsupportedIterableToArray(r, e) || ImageGrid_nonIterableRest(); }
function ImageGrid_nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function ImageGrid_iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function ImageGrid_arrayWithHoles(r) { if (Array.isArray(r)) return r; }
function ImageGrid_toConsumableArray(r) { return ImageGrid_arrayWithoutHoles(r) || ImageGrid_iterableToArray(r) || ImageGrid_unsupportedIterableToArray(r) || ImageGrid_nonIterableSpread(); }
function ImageGrid_nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function ImageGrid_unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return ImageGrid_arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? ImageGrid_arrayLikeToArray(r, a) : void 0; } }
function ImageGrid_iterableToArray(r) { if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r); }
function ImageGrid_arrayWithoutHoles(r) { if (Array.isArray(r)) return ImageGrid_arrayLikeToArray(r); }
function ImageGrid_arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }








var ajaxUrl = image_hub_data.ajaxurl;
var nonce = image_hub_data.nonce;
es.getEqualCountColumns = function (children, columnsCount) {
  var columns = Array.from({
    length: columnsCount
  }, function () {
    return [];
  });
  var columnHeights = Array(columnsCount).fill(0);
  var childRefs = [];
  var containerWidth = window.innerWidth;
  var gutter = 0; // You can adjust this if needed
  var totalGutter = gutter * (columnsCount - 1);
  var columnWidth = (containerWidth - totalGutter) / columnsCount;
  var validIndex = 0;
  external_React_default().Children.forEach(children, function (child, idx) {
    if (child && /*#__PURE__*/external_React_default().isValidElement(child)) {
      var ref = /*#__PURE__*/external_React_default().createRef();
      childRefs.push(ref);
      var aspectRatio = child.props.aspectRatio || 1;
      var estimatedHeight = Math.floor(columnWidth / aspectRatio);
      var targetColumnIndex = columnHeights.indexOf(Math.min.apply(Math, ImageGrid_toConsumableArray(columnHeights)));
      columnHeights[targetColumnIndex] += estimatedHeight;
      columns[targetColumnIndex].push(/*#__PURE__*/external_React_default().createElement("div", {
        key: child.key || idx,
        style: {
          display: "flex",
          justifyContent: "stretch",
          maxHeight: "".concat(estimatedHeight, "px"),
          minHeight: "".concat(estimatedHeight, "px"),
          overflow: "hidden"
        }
        // key={validIndex}
        ,
        ref: ref
      }, child));
      validIndex++;
    }
  });
  return {
    columns: columns,
    childRefs: childRefs
  };
};
var ImageGrid = function ImageGrid(_ref) {
  var setModalImageUrl = _ref.setModalImageUrl,
    media = _ref.media;
  // Added 'media' prop
  var _useImageContext = useImageContext(),
    errors = _useImageContext.errors,
    images = _useImageContext.images,
    fetchImages = _useImageContext.fetchImages,
    pagination = _useImageContext.pagination,
    searchTerm = _useImageContext.searchTerm,
    provider = _useImageContext.provider,
    isLoading = _useImageContext.isLoading,
    removeImage = _useImageContext.removeImage;
  var currentPage = pagination.currentPage,
    hasNextPage = pagination.hasNextPage;
  var observer = (0,external_React_.useRef)();
  var _useState = (0,external_React_.useState)({}),
    _useState2 = ImageGrid_slicedToArray(_useState, 2),
    downloadedImages = _useState2[0],
    setDownloadedImages = _useState2[1];
  var _useState3 = (0,external_React_.useState)({}),
    _useState4 = ImageGrid_slicedToArray(_useState3, 2),
    downloadingImages = _useState4[0],
    setDownloadingImages = _useState4[1];
  var _useState5 = (0,external_React_.useState)({}),
    _useState6 = ImageGrid_slicedToArray(_useState5, 2),
    erroredImages = _useState6[0],
    setErroredImages = _useState6[1];
  var _useState7 = (0,external_React_.useState)([]),
    _useState8 = ImageGrid_slicedToArray(_useState7, 2),
    inLibrary = _useState8[0],
    setImagesInLibrary = _useState8[1];
  (0,external_React_.useEffect)(function () {
    setDownloadedImages([]);
    setDownloadingImages([]);
  }, [provider]);
  (0,external_React_.useEffect)(function () {
    fetch(image_hub_data.adminUrl.replace("/wp-admin", "") + "wp-json/wp/v2/media?&per_page=100&_fields=source_url").then(function (response) {
      return response.json();
    }).then(function (imagezs) {
      var _ref2;
      var uniqueFilenames = new Set();
      imagezs.forEach(function (url) {
        uniqueFilenames.add(url.source_url.split("/").pop().split(".")[0]);
      });
      if (!!((_ref2 = ImageGrid_toConsumableArray(uniqueFilenames)) !== null && _ref2 !== void 0 && _ref2.length)) setImagesInLibrary(ImageGrid_toConsumableArray(uniqueFilenames));
    })["catch"](function (error) {
      return console.error("Error fetching images:", error);
    });
  }, [downloadedImages]);
  var formattedImages = (images === null || images === void 0 ? void 0 : images.map(function (img, idx) {
    var _img$user;
    return {
      preview: img.thumbnailUrl,
      fullImage: img.url,
      still: (img === null || img === void 0 ? void 0 : img.still) || undefined,
      id: img.provider + "-" + img.id,
      external: img.external,
      provider: img.provider,
      user: img.user,
      about: img.about,
      height: img.height,
      aspectRatio: img.width / img.height,
      "user-profile": (_img$user = img.user) === null || _img$user === void 0 ? void 0 : _img$user.link,
      downloadCallback: img.downloadCallback || undefined
    };
  })) || [];

  // const handleZoom = (photo) => {
  // 	setModalImageUrl?.(photo.fullImage);
  // };

  var handleOpenExternal = function handleOpenExternal(photo) {
    var path = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : "external";
    if (photo !== null && photo !== void 0 && photo[path]) {
      window.open(photo === null || photo === void 0 ? void 0 : photo[path], "_blank");
    }
  };
  var openMediaLibrary = function openMediaLibrary(attachmentId) {
    // Ensure wp.media exists
    var mediaModalEl = wp.media.frame.el;
    var mediaTab = mediaModalEl.querySelector("#menu-item-browse");
    if (mediaTab) {
      // Open the 'Media Library' tab.
      mediaTab.click();
    }

    // Delay to allow for tab switching
    setTimeout(function () {
      if (wp.media.frame.content.get() !== null) {
        // Force a refresh of the mdeia modal content.
        wp.media.frame.content.get().collection._requery(true);
      }

      // Select the attached that was just uploaded.
      var selection = wp.media.frame.state().get("selection");
      var selected = parseInt(attachmentId);
      selection.reset(selected ? [wp.media.attachment(selected)] : []);
    }, 100);
  };
  var handleDownload = function handleDownload(photo) {
    if (downloadedImages[photo.id]) return;
    setDownloadingImages(function (prev) {
      return ImageGrid_objectSpread(ImageGrid_objectSpread({}, prev), {}, ImageGrid_defineProperty({}, photo.id, 0));
    });
    var progress = 0;
    var progressInterval = setInterval(function () {
      var increment = progress < 30 ? 0.5 : progress < 70 ? 1 : 0.5;
      progress = Math.min(progress + increment, 90); // Cap at 90% until fetch completes

      setDownloadingImages(function (prev) {
        return ImageGrid_objectSpread(ImageGrid_objectSpread({}, prev), {}, ImageGrid_defineProperty({}, photo.id, progress));
      });
    }, 50);
    fetch(ajaxUrl, {
      method: "POST",
      body: new URLSearchParams({
        action: "image_hub_download_image_to_library",
        image_url: photo.fullImage,
        nonce: nonce,
        name: photo.id,
        provider: photo.provider,
        link: photo.user.link,
        username: photo.user.name,
        title: photo.about.title,
        description: photo.about.description,
        alt: photo.about.alt,
        downloadImageCallbackUrl: photo.downloadCallback || ""
      })
    }).then(function (response) {
      return response.json();
    }).then(function (data) {
      clearInterval(progressInterval);
      if (data.success) {
        setDownloadingImages(function (prev) {
          return ImageGrid_objectSpread(ImageGrid_objectSpread({}, prev), {}, ImageGrid_defineProperty({}, photo.id, 100));
        });
        setTimeout(function () {
          var _data$data$attachment2;
          setDownloadingImages(function (prev) {
            return ImageGrid_objectSpread(ImageGrid_objectSpread({}, prev), {}, ImageGrid_defineProperty({}, photo.id, false));
          });
          setDownloadedImages(function (prev) {
            var _data$data$attachment;
            return ImageGrid_objectSpread(ImageGrid_objectSpread({}, prev), {}, ImageGrid_defineProperty({}, photo.id, (_data$data$attachment = data.data.attachment) === null || _data$data$attachment === void 0 ? void 0 : _data$data$attachment.id));
          });
          if (media) openMediaLibrary((_data$data$attachment2 = data.data.attachment) === null || _data$data$attachment2 === void 0 ? void 0 : _data$data$attachment2.id);
        }, 300);
      } else {
        setErroredImages(function (prev) {
          return ImageGrid_objectSpread(ImageGrid_objectSpread({}, prev), {}, ImageGrid_defineProperty({}, photo.id, true));
        });
        setDownloadingImages(function (prev) {
          return ImageGrid_objectSpread(ImageGrid_objectSpread({}, prev), {}, ImageGrid_defineProperty({}, photo.id, false));
        });
      }
    })["catch"](function (error) {
      clearInterval(progressInterval);
      setErroredImages(function (prev) {
        return ImageGrid_objectSpread(ImageGrid_objectSpread({}, prev), {}, ImageGrid_defineProperty({}, photo.id, true));
      });
      setDownloadingImages(function (prev) {
        return ImageGrid_objectSpread(ImageGrid_objectSpread({}, prev), {}, ImageGrid_defineProperty({}, photo.id, false));
      });
      console.error("Error downloading image:", error);
    });
  };
  var lastImageRef = (0,external_React_.useCallback)(function (node) {
    if (isLoading) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting && hasNextPage) {
        fetchImages(searchTerm, provider, currentPage + 1);
      }
    });
    if (node) observer.current.observe(node);
  }, [isLoading, hasNextPage, searchTerm, provider, currentPage, fetchImages]);
  return /*#__PURE__*/external_React_default().createElement((external_React_default()).Fragment, null, formattedImages.length === 0 && !isLoading ? /*#__PURE__*/external_React_default().createElement((external_React_default()).Fragment, null, errors && errors != {} && !Object.values(errors).some(function (x) {
    return x === null || x === void 0 ? void 0 : x.toLowerCase().includes("uri too long");
  }) ? /*#__PURE__*/external_React_default().createElement(ErrorDisplay, {
    errors: errors
  }) : /*#__PURE__*/external_React_default().createElement(NoResultDisplay, null)) : /*#__PURE__*/external_React_default().createElement("div", {
    className: "image-hub-galery-container"
  }, /*#__PURE__*/external_React_default().createElement("div", null, /*#__PURE__*/external_React_default().createElement(ResponsiveMasonry, {
    columnsCountBreakPoints: {
      350: 1,
      480: 1,
      768: 2,
      1024: 3,
      1200: 4,
      1600: 6
    },
    gutterBreakpoints: {
      350: "8px",
      480: "10px",
      768: "12px",
      1024: "16px",
      1200: "20px",
      1600: "24px"
    }
  }, /*#__PURE__*/external_React_default().createElement(es, {
    columnsCount: 5,
    gutter: "5px",
    formattedImages: formattedImages
  }, formattedImages.map(function (photo, idx) {
    return /*#__PURE__*/external_React_default().createElement(PhotoItem, {
      key: photo.fullImage + photo.id,
      photo: photo,
      aspectRatio: photo.aspectRatio,
      removeImage: removeImage,
      downloadingImages: downloadingImages,
      downloadedImages: downloadedImages,
      handleOpenExternal: handleOpenExternal,
      inLibrary: inLibrary,
      media: media,
      handleDownload: handleDownload,
      erroredImages: erroredImages
    });
  })))), !isLoading && !hasNextPage && /*#__PURE__*/external_React_default().createElement("div", {
    className: "image-hub-gradient-banner"
  }, /*#__PURE__*/external_React_default().createElement("h2", null, (0,external_wp_i18n_namespaceObject.__)("These are all the images for the current search terms and filters", "image-hub"))), !isLoading && hasNextPage && /*#__PURE__*/external_React_default().createElement("div", {
    ref: lastImageRef,
    style: {
      height: "20px"
    }
  })));
};



var hasCertainKey = function hasCertainKey(provider, data) {
  return Object.entries(data).some(function (_ref3) {
    var _ref4 = ImageGrid_slicedToArray(_ref3, 2),
      key = _ref4[0],
      value = _ref4[1];
    return key.startsWith("image_hub_api_keys_" + provider) && value;
  });
};
var ErrorDisplay = function ErrorDisplay(_ref5) {
  var errors = _ref5.errors;
  var _getImageHubSettings = getImageHubSettings(),
    imageHubSettings = _getImageHubSettings.imageHubSettings;
  var _useImageContext2 = useImageContext(),
    provider = _useImageContext2.provider;
  var hasPersonalApiKey = hasCertainKey(provider == "all" ? "giphy" : provider, imageHubSettings);
  var errorMessage = "";
  var errorProvider = provider;
  if (provider === "All" && errors && ImageGrid_typeof(errors) === "object") {
    var firstErrorEntry = Object.entries(errors).find(function (_ref6) {
      var _ref7 = ImageGrid_slicedToArray(_ref6, 2),
        key = _ref7[0],
        value = _ref7[1];
      return value;
    });
    if (firstErrorEntry) {
      errorProvider = firstErrorEntry[0];
      errorMessage = firstErrorEntry[1];
    }
  } else if (errors && errors[provider]) {
    errorMessage = errors[provider];
  }
  return /*#__PURE__*/external_React_default().createElement("div", {
    className: "image-hub-error-card"
  }, /*#__PURE__*/external_React_default().createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Icon, {
    fill: "#cc1818",
    size: 36,
    icon: caution_filled
  }), /*#__PURE__*/external_React_default().createElement("div", {
    style: {
      fontSize: "16px",
      color: "#cc1818",
      fontWeight: 700
    }
  }, (0,external_wp_i18n_namespaceObject.__)("Image Library Error", "image-hub")), /*#__PURE__*/external_React_default().createElement("div", {
    style: {
      fontSize: "13px",
      marginTop: "10px",
      textWrap: "wrap",
      textAlign: "center",
      justifyContent: "center"
    }
  }, (0,external_wp_i18n_namespaceObject.__)("We couldn’t fetch images from the library right now. This may be due to a temporary issue with the external image source. Please try again later.", "image-hub")), errorMessage && /*#__PURE__*/external_React_default().createElement("div", {
    style: {
      fontSize: "16px",
      marginTop: "10px"
    }
  }, errorMessage.replace("401:Unauthorized", "Invalid ApiKey"))));
};
var NoResultDisplay = function NoResultDisplay() {
  return /*#__PURE__*/external_React_default().createElement("div", {
    className: "image-hub-error-card"
  }, /*#__PURE__*/external_React_default().createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Icon, {
    fill: "#FFB200",
    size: 36,
    icon: caution_filled
  }), /*#__PURE__*/external_React_default().createElement("div", {
    style: {
      fontSize: "16px",
      color: "#FFB200",
      fontWeight: 700
    }
  }, (0,external_wp_i18n_namespaceObject.__)("No results found", "image-hub")), /*#__PURE__*/external_React_default().createElement("div", {
    style: {
      fontSize: "13px",
      marginTop: "10px",
      textWrap: "wrap",
      textAlign: "center",
      justifyContent: "center"
    }
  }, (0,external_wp_i18n_namespaceObject.__)("We could not find any images for your search term. This may be due to a temporary issue or the search term might be too specific", "image-hub"))));
};
/* harmony default export */ const components_ImageGrid = (ImageGrid);
var PhotoItem = /*#__PURE__*/external_React_default().forwardRef(function (_ref8, ref) {
  var _photo$id, _photo$id3;
  var photo = _ref8.photo,
    removeImage = _ref8.removeImage,
    downloadingImages = _ref8.downloadingImages,
    downloadedImages = _ref8.downloadedImages,
    handleOpenExternal = _ref8.handleOpenExternal,
    inLibrary = _ref8.inLibrary,
    media = _ref8.media,
    handleDownload = _ref8.handleDownload,
    erroredImages = _ref8.erroredImages;
  var hoverTimeout;
  var _useState9 = (0,external_React_.useState)(false),
    _useState10 = ImageGrid_slicedToArray(_useState9, 2),
    hovered = _useState10[0],
    setHovered = _useState10[1];
  return /*#__PURE__*/external_React_default().createElement("div", {
    ref: ref,
    className: "image-hub-image-container image-hub-image-container-hidden " + photo.id,
    key: photo.fullImage + photo.id,
    onMouseEnter: function onMouseEnter(e) {
      var _e$target;
      setHovered(true);
      e.preventDefault();
      e.stopPropagation();
      if (photo.provider !== PROVIDERS.GIPHY.name) return;
      var className = ".image-hub-image".concat(downloadingImages[photo.id] || downloadedImages[photo.id] ? ".image-hub-downloading" : "");
      var comp = e === null || e === void 0 || (_e$target = e.target) === null || _e$target === void 0 || (_e$target = _e$target.parentElement) === null || _e$target === void 0 ? void 0 : _e$target.querySelector(className);
      if (comp) {
        comp.src = photo.preview;
        clearTimeout(hoverTimeout);
        hoverTimeout = setTimeout(function () {
          comp.src = photo.still;
        }, 1500);
      }
    },
    onMouseLeave: function onMouseLeave(e) {
      var _e$target2;
      setHovered(false);
      e.preventDefault();
      e.stopPropagation();
      if (photo.provider !== PROVIDERS.GIPHY.name) return;
      var className = ".image-hub-image".concat(downloadingImages[photo.id] || downloadedImages[photo.id] ? ".image-hub-downloading" : "");
      var comp = e === null || e === void 0 || (_e$target2 = e.target) === null || _e$target2 === void 0 || (_e$target2 = _e$target2.parentElement) === null || _e$target2 === void 0 ? void 0 : _e$target2.querySelector(className);
      if (comp) {
        clearTimeout(hoverTimeout);
        comp.src = photo.still;
      }
    }
  }, /*#__PURE__*/external_React_default().createElement("img", {
    //if needed
    // style={{ background: `url(${TransparentBG})`,backgroundSize:"cover" }}
    style: {
      aspectRatio: photo.aspectRatio
    },
    src: photo.still || photo.preview,
    alt: "",
    onLoad: function onLoad(e) {
      e.target.parentElement.classList.remove("image-hub-image-container-hidden");
      // e.target.style.padding=0
    },
    onError: function onError(e) {
      if (e.target.src == photo.fullImage) {
        e.target.remove();
        removeImage(photo.id);
      } else {
        e.target.src = photo.fullImage;
      }
    },
    className: "image-hub-image ".concat(downloadingImages[photo.id] || downloadedImages[photo.id] ? "image-hub-downloading" : "")
  }), !downloadedImages[photo.id] && !downloadingImages[photo.id] && /*#__PURE__*/external_React_default().createElement("div", {
    className: "image-hub-image-overlay"
  }, /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Tooltip, {
    delay: 0,
    text: (0,external_wp_i18n_namespaceObject.__)("View on ".concat(ucfirst(photo.provider)), "image-hub")
  }, /*#__PURE__*/external_React_default().createElement("div", {
    className: "image-hub-zoom-btn",
    onClick: function onClick() {
      return handleOpenExternal(photo);
    }
  }, /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Icon, {
    fill: "white",
    icon: library_external
  }))), /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Tooltip, {
    key: 1,
    delay: 0,
    text: (0,external_wp_i18n_namespaceObject.__)("Get to know ", "image-hub") + " " + photo.user.name
  }, /*#__PURE__*/external_React_default().createElement("div", {
    className: "image-hub-credits-avatar",
    onClick: function onClick() {
      return handleOpenExternal(photo, "user-profile");
    }
  }, photo.user.profile_image ? /*#__PURE__*/external_React_default().createElement("img", {
    className: "image-hub-credits-avatar-image",
    src: photo.user.profile_image
  }) : /*#__PURE__*/external_React_default().createElement("img", {
    className: "image-hub-credits-avatar-image",
    style: {
      objectFit: "contain"
    },
    src: PROVIDERS[photo.provider.toUpperCase()].icon
  }), hovered && /*#__PURE__*/external_React_default().createElement(dist/* default */.A, {
    delay: 0.5,
    speed: 10,
    style: {
      overflowY: "hidden"
    },
    play: (photo.user.name ? "".concat(photo.user.name, " (").concat(photo.provider, ")") : photo.provider).length > 25
  }, photo.user.name ? "".concat(photo.user.name, " (").concat(ucfirst(photo.provider), ")") : ucfirst(photo.provider), " "))), /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Tooltip, {
    key: 2,
    delay: 0,
    text: inLibrary !== null && inLibrary !== void 0 && inLibrary.includes((_photo$id = photo.id) === null || _photo$id === void 0 ? void 0 : _photo$id.toString()) ? (0,external_wp_i18n_namespaceObject.__)("Already downloaded", "image-hub") : (0,external_wp_i18n_namespaceObject.__)("Download", "image-hub")
  }, /*#__PURE__*/external_React_default().createElement("div", {
    className: "image-hub-download-btn",
    onClick: function onClick() {
      var _photo$id2;
      if (inLibrary !== null && inLibrary !== void 0 && inLibrary.includes((_photo$id2 = photo.id) === null || _photo$id2 === void 0 ? void 0 : _photo$id2.toString())) return;
      if (media) {
        handleDownload(photo);
      } else {
        handleDownload(photo);
      }
    }
  }, /*#__PURE__*/external_React_default().createElement("div", null, inLibrary !== null && inLibrary !== void 0 && inLibrary.includes((_photo$id3 = photo.id) === null || _photo$id3 === void 0 ? void 0 : _photo$id3.toString()) ? /*#__PURE__*/external_React_default().createElement("div", {
    key: "ttt1",
    className: "image-hub-circle-icon",
    style: {
      width: "16px",
      height: "16px"
    }
  }, /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Icon, {
    size: 16,
    fill: "white",
    icon: library_check
  })) : /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Icon, {
    key: "ttt1",
    fill: "white",
    icon: library_download
  }))))), downloadedImages[photo.id] && /*#__PURE__*/external_React_default().createElement("div", {
    className: "image-hub-image-download-overlay"
  }, /*#__PURE__*/external_React_default().createElement("div", {
    className: "image-hub-circle-icon"
  }, /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Icon, {
    size: 24,
    fill: "white",
    icon: library_check
  })), /*#__PURE__*/external_React_default().createElement("div", {
    style: {
      color: "white",
      marginTop: "10px",
      lineHeight: "100%"
    }
  }, (0,external_wp_i18n_namespaceObject.__)("Downloaded to Media Gallery", "image-hub")), /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Button, {
    style: {
      marginTop: "20px"
    },
    variant: "primary",
    onClick: function onClick() {
      window.location.href = image_hub_data.adminUrl + "upload.php";
    }
  }, (0,external_wp_i18n_namespaceObject.__)("View Image", "image-hub"))), /*#__PURE__*/external_React_default().createElement("div", {
    style: {
      maxHeight: "100%",
      overflow: "hidden"
    }
  }, downloadingImages[photo.id] && /*#__PURE__*/external_React_default().createElement("div", {
    className: "image-hub-image-download-overlay"
  }, /*#__PURE__*/external_React_default().createElement(Loader, {
    progressValue: downloadingImages[photo.id]
  }))), erroredImages[photo.id] && /*#__PURE__*/external_React_default().createElement("div", {
    className: "image-hub-image-download-overlay"
  }, /*#__PURE__*/external_React_default().createElement("div", {
    className: "image-hub-image-download-overlay"
  }, /*#__PURE__*/external_React_default().createElement("div", {
    className: "image-hub-circle-icon",
    style: {
      background: "red",
      width: "30px",
      height: "32px"
    }
  }, /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.Icon, {
    size: 24,
    fill: "white",
    icon: library_close
  })), /*#__PURE__*/external_React_default().createElement("div", {
    style: {
      color: "white",
      marginTop: "10px",
      lineHeight: "100%"
    }
  }, (0,external_wp_i18n_namespaceObject.__)("Image could not be downloaded!", "image-hub")))));
});
;// ./src/components/CustomToolbarButton.js
var _excluded = ["selected", "label", "icon"];
function CustomToolbarButton_extends() { return CustomToolbarButton_extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, CustomToolbarButton_extends.apply(null, arguments); }
function _objectWithoutProperties(e, t) { if (null == e) return {}; var o, r, i = _objectWithoutPropertiesLoose(e, t); if (Object.getOwnPropertySymbols) { var n = Object.getOwnPropertySymbols(e); for (r = 0; r < n.length; r++) o = n[r], -1 === t.indexOf(o) && {}.propertyIsEnumerable.call(e, o) && (i[o] = e[o]); } return i; }
function _objectWithoutPropertiesLoose(r, e) { if (null == r) return {}; var t = {}; for (var n in r) if ({}.hasOwnProperty.call(r, n)) { if (-1 !== e.indexOf(n)) continue; t[n] = r[n]; } return t; }



// Unforwarded version
var UnforwardedCustomToolbarButton = function UnforwardedCustomToolbarButton(_ref, ref) {
  var selected = _ref.selected,
    label = _ref.label,
    icon = _ref.icon,
    props = _objectWithoutProperties(_ref, _excluded);
  return /*#__PURE__*/external_React_default().createElement(external_wp_components_namespaceObject.ToolbarButton, CustomToolbarButton_extends({
    ref: ref,
    key: label,
    className: selected ? "image-hub-custom-toolbar-button-selected" : "image-hub-custom-toolbar-button",
    variant: "text"
  }, props), icon ? /*#__PURE__*/external_React_default().createElement("img", {
    height: 16,
    width: 16,
    style: {
      marginRight: ".5em"
    },
    src: icon,
    alt: ""
  }) : null, label);
};

// Export forwarded version using the unforwarded component
var CustomToolbarButton = /*#__PURE__*/(0,external_React_.forwardRef)(UnforwardedCustomToolbarButton);
;// ./src/components/CustomNumberInput.js
function CustomNumberInput_typeof(o) { "@babel/helpers - typeof"; return CustomNumberInput_typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, CustomNumberInput_typeof(o); }
var CustomNumberInput_excluded = ["value", "setValue", "label"];
function CustomNumberInput_extends() { return CustomNumberInput_extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, CustomNumberInput_extends.apply(null, arguments); }
function CustomNumberInput_ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function CustomNumberInput_objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? CustomNumberInput_ownKeys(Object(t), !0).forEach(function (r) { CustomNumberInput_defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : CustomNumberInput_ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function CustomNumberInput_defineProperty(e, r, t) { return (r = CustomNumberInput_toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function CustomNumberInput_toPropertyKey(t) { var i = CustomNumberInput_toPrimitive(t, "string"); return "symbol" == CustomNumberInput_typeof(i) ? i : i + ""; }
function CustomNumberInput_toPrimitive(t, r) { if ("object" != CustomNumberInput_typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != CustomNumberInput_typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function CustomNumberInput_objectWithoutProperties(e, t) { if (null == e) return {}; var o, r, i = CustomNumberInput_objectWithoutPropertiesLoose(e, t); if (Object.getOwnPropertySymbols) { var n = Object.getOwnPropertySymbols(e); for (r = 0; r < n.length; r++) o = n[r], -1 === t.indexOf(o) && {}.propertyIsEnumerable.call(e, o) && (i[o] = e[o]); } return i; }
function CustomNumberInput_objectWithoutPropertiesLoose(r, e) { if (null == r) return {}; var t = {}; for (var n in r) if ({}.hasOwnProperty.call(r, n)) { if (-1 !== e.indexOf(n)) continue; t[n] = r[n]; } return t; }



var ENABLE_CLEAR_BTN = false;
var CustomNumberControl = function CustomNumberControl(_ref) {
  var value = _ref.value,
    setValue = _ref.setValue,
    label = _ref.label,
    props = CustomNumberInput_objectWithoutProperties(_ref, CustomNumberInput_excluded);
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
;// ./src/components/QueryFilters.js
function QueryFilters_toConsumableArray(r) { return QueryFilters_arrayWithoutHoles(r) || QueryFilters_iterableToArray(r) || QueryFilters_unsupportedIterableToArray(r) || QueryFilters_nonIterableSpread(); }
function QueryFilters_nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function QueryFilters_iterableToArray(r) { if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r); }
function QueryFilters_arrayWithoutHoles(r) { if (Array.isArray(r)) return QueryFilters_arrayLikeToArray(r); }
function QueryFilters_slicedToArray(r, e) { return QueryFilters_arrayWithHoles(r) || QueryFilters_iterableToArrayLimit(r, e) || QueryFilters_unsupportedIterableToArray(r, e) || QueryFilters_nonIterableRest(); }
function QueryFilters_nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function QueryFilters_unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return QueryFilters_arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? QueryFilters_arrayLikeToArray(r, a) : void 0; } }
function QueryFilters_arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
function QueryFilters_iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function QueryFilters_arrayWithHoles(r) { if (Array.isArray(r)) return r; }





var QueryFilters = function QueryFilters() {
  var _useImageContext = useImageContext(),
    _provider = _useImageContext.provider,
    updateQueryParams = _useImageContext.updateQueryParams,
    additionalQueryParams = _useImageContext.additionalQueryParams;
  var provider = _provider.toUpperCase();

  // Don't show filters for 'All' provider or if provider doesn't exist in PROVIDERQUERY
  if (provider === "All" || !PROVIDERQUERY[provider]) {
    return null;
  }
  var currentProviderParams = PROVIDERQUERY[provider];

  // Filter out the searchTerm parameter as it's handled separately
  var filterParams = Object.entries(currentProviderParams).filter(function (_ref) {
    var _ref2 = QueryFilters_slicedToArray(_ref, 1),
      key = _ref2[0];
    return key !== "searchTerm";
  });
  return /*#__PURE__*/React.createElement(React.Fragment, null, !!filterParams.length && /*#__PURE__*/React.createElement("div", {
    className: "image-hub-filters"
  }, filterParams.map(function (_ref3) {
    var _ref4 = QueryFilters_slicedToArray(_ref3, 2),
      paramKey = _ref4[0],
      paramConfig = _ref4[1];
    return /*#__PURE__*/React.createElement("div", {
      key: paramKey
    }, paramConfig.acc_values ? /*#__PURE__*/React.createElement(external_wp_components_namespaceObject.SelectControl, {
      key: paramKey + "-select-control-" + _provider,
      style: {
        minWidth: "180px"
      },
      __next40pxDefaultSize: true,
      __nextHasNoMarginBottom: true,
      label: paramKey.replaceAll("_", " "),
      value: (additionalQueryParams === null || additionalQueryParams === void 0 ? void 0 : additionalQueryParams[paramConfig === null || paramConfig === void 0 ? void 0 : paramConfig.name]) || (paramConfig === null || paramConfig === void 0 ? void 0 : paramConfig["default"]),
      onChange: function onChange(value) {
        return updateQueryParams(paramKey, value);
      },
      options: [!paramConfig.acc_values.some(function (acv) {
        return acv.toLowerCase() == "all";
      }) ? {
        label: (0,external_wp_i18n_namespaceObject.__)('All', 'image-hub'),
        value: ""
      } : null].concat(QueryFilters_toConsumableArray(paramConfig.acc_values.map(function (value, idx) {
        var _paramConfig$values_l;
        return {
          label: (paramConfig === null || paramConfig === void 0 || (_paramConfig$values_l = paramConfig.values_labels) === null || _paramConfig$values_l === void 0 ? void 0 : _paramConfig$values_l[idx]) || value.charAt(0).toUpperCase() + value.slice(1),
          value: value
        };
      }))).filter(function (x) {
        return !!x;
      })
    }) : paramConfig.type === "string" ? /*#__PURE__*/React.createElement(external_wp_components_namespaceObject.TextControl, {
      key: paramKey + "-text-control",
      __next40pxDefaultSize: true,
      __nextHasNoMarginBottom: true,
      value: (additionalQueryParams === null || additionalQueryParams === void 0 ? void 0 : additionalQueryParams[paramConfig === null || paramConfig === void 0 ? void 0 : paramConfig.name]) || (paramConfig === null || paramConfig === void 0 ? void 0 : paramConfig["default"]),
      placeholder: "...",
      onChange: function onChange(value) {
        return updateQueryParams(paramConfig.name, value);
      },
      label: paramKey.replaceAll("_", " ")
    }) : /*#__PURE__*/React.createElement(CustomNumberControl, {
      key: paramKey + "-custom-number-control",
      value: (additionalQueryParams === null || additionalQueryParams === void 0 ? void 0 : additionalQueryParams[paramConfig === null || paramConfig === void 0 ? void 0 : paramConfig.name]) || (paramConfig === null || paramConfig === void 0 ? void 0 : paramConfig["default"]),
      onChange: function onChange(value) {
        return updateQueryParams(paramConfig.name, value);
      },
      label: paramKey.toUpperCase().replaceAll("_", " ")
    }));
  })));
};
/* harmony default export */ const components_QueryFilters = (QueryFilters);
;// ./src/components/SearchButton.js
function SearchButton_slicedToArray(r, e) { return SearchButton_arrayWithHoles(r) || SearchButton_iterableToArrayLimit(r, e) || SearchButton_unsupportedIterableToArray(r, e) || SearchButton_nonIterableRest(); }
function SearchButton_nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function SearchButton_unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return SearchButton_arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? SearchButton_arrayLikeToArray(r, a) : void 0; } }
function SearchButton_arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
function SearchButton_iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function SearchButton_arrayWithHoles(r) { if (Array.isArray(r)) return r; }


var CustomSearchButton = function CustomSearchButton(_ref) {
  var value = _ref.value,
    onChange = _ref.onChange,
    onSubmit = _ref.onSubmit,
    onClear = _ref.onClear,
    onBlur = _ref.onBlur;
  var _useState = (0,external_React_.useState)(value || ''),
    _useState2 = SearchButton_slicedToArray(_useState, 2),
    searchTerm = _useState2[0],
    setSearchTerm = _useState2[1];
  var _useState3 = (0,external_React_.useState)("transparent"),
    _useState4 = SearchButton_slicedToArray(_useState3, 2),
    borderColor = _useState4[0],
    setBorderColor = _useState4[1];
  var _useState5 = (0,external_React_.useState)(""),
    _useState6 = SearchButton_slicedToArray(_useState5, 2),
    inputClass = _useState6[0],
    setInputClass = _useState6[1];
  (0,external_React_.useEffect)(function () {
    setSearchTerm(value);
  }, [value]);
  var handleChange = function handleChange(e) {
    var trimmedValue = e.target.value;
    setSearchTerm(trimmedValue);
    if (onChange) {
      onChange(trimmedValue);
    }
  };
  var handleSubmit = function handleSubmit() {
    var trimmed = searchTerm.trim();
    if (trimmed.length === 0) {
      if (onChange) onChange(""); // Optional: Clear parent too
      setBorderColor("red");
      setInputClass("__error");
      setTimeout(function () {
        setBorderColor("transparent");
        setInputClass("");
      }, 300);
    } else if (onSubmit) {
      onSubmit(trimmed);
    }
  };
  var handleClear = function handleClear() {
    setSearchTerm('');
    if (onClear) {
      onClear();
    }
    if (onSubmit) {
      onSubmit('');
    }
  };
  var handleKeyPress = function handleKeyPress(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };
  var containerStyles = {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%'
  };
  var wrapperStyles = {
    position: 'relative',
    width: '100%'
  };
  var inputStyles = {
    width: '100%',
    height: '40px',
    padding: '0px 36px 0px 12px',
    border: "1px solid ".concat(borderColor),
    borderRadius: '2px',
    backgroundColor: '#f3f4f6',
    outline: 'none'
  };
  var buttonStyles = {
    position: 'absolute',
    right: '8px',
    top: '50%',
    transform: 'translateY(-50%)',
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    color: '#6b7280',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0'
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "image-hub-search-control " + inputClass,
    style: containerStyles
  }, /*#__PURE__*/React.createElement("div", {
    style: wrapperStyles
  }, /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: searchTerm,
    onChange: handleChange,
    onKeyPress: handleKeyPress,
    style: inputStyles,
    onBlur: onBlur,
    maxLength: 100,
    placeholder: "Search..."
  }), /*#__PURE__*/React.createElement("button", {
    onClick: searchTerm ? handleClear : handleSubmit,
    style: buttonStyles,
    "aria-label": searchTerm ? "Clear search" : "Search"
  }, /*#__PURE__*/React.createElement(external_wp_components_namespaceObject.Icon, {
    icon: searchTerm ? "no-alt" : "search",
    size: 20
  }))));
};
;// ./src/components/ProvidersAndFilters.js
function ProvidersAndFilters_slicedToArray(r, e) { return ProvidersAndFilters_arrayWithHoles(r) || ProvidersAndFilters_iterableToArrayLimit(r, e) || ProvidersAndFilters_unsupportedIterableToArray(r, e) || ProvidersAndFilters_nonIterableRest(); }
function ProvidersAndFilters_nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function ProvidersAndFilters_unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return ProvidersAndFilters_arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? ProvidersAndFilters_arrayLikeToArray(r, a) : void 0; } }
function ProvidersAndFilters_arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
function ProvidersAndFilters_iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function ProvidersAndFilters_arrayWithHoles(r) { if (Array.isArray(r)) return r; }









var ProvidersAndFilters = function ProvidersAndFilters(_ref) {
  var _ref$media = _ref.media,
    media = _ref$media === void 0 ? false : _ref$media;
  var _useImageContext = useImageContext(),
    lastSearchTerm = _useImageContext.lastSearchTerm,
    searchTerm = _useImageContext.searchTerm,
    setSearchTerm = _useImageContext.setSearchTerm,
    images = _useImageContext.images,
    provider = _useImageContext.provider,
    setProvider = _useImageContext.setProvider,
    fetchImages = _useImageContext.fetchImages,
    handleSearch = _useImageContext.handleSearch,
    pagination = _useImageContext.pagination,
    isLoading = _useImageContext.isLoading,
    setAdditionalQueryParams = _useImageContext.setAdditionalQueryParams;
  var _getImageHubSettings = getImageHubSettings(),
    imageHubSettings = _getImageHubSettings.imageHubSettings;
  var _useState = (0,external_React_.useState)({
      left: 20,
      width: 101
    }),
    _useState2 = ProvidersAndFilters_slicedToArray(_useState, 2),
    underlineStyle = _useState2[0],
    setUnderlineStyle = _useState2[1];
  var toolbarRef = (0,external_React_.useRef)(null);
  var buttonRefs = (0,external_React_.useRef)({});
  (0,external_React_.useLayoutEffect)(function () {
    if (!provider || !toolbarRef.current) return;
    var selectedButton = buttonRefs.current[provider.toLowerCase()];
    if (selectedButton && toolbarRef.current) {
      var buttonRect = selectedButton.getBoundingClientRect();
      var toolbarRect = toolbarRef.current.getBoundingClientRect();
      setUnderlineStyle({
        left: buttonRect.left - toolbarRect.left,
        width: buttonRect.width
      });
    }
    var resizeObserver = new ResizeObserver(function () {
      if (selectedButton && toolbarRef.current) {
        var _buttonRect = selectedButton.getBoundingClientRect();
        var _toolbarRect = toolbarRef.current.getBoundingClientRect();
        setUnderlineStyle({
          left: _buttonRect.left - _toolbarRect.left,
          width: _buttonRect.width
        });
      }
    });
    resizeObserver.observe(toolbarRef.current);
    return function () {
      resizeObserver.disconnect();
    };
  }, [provider, isLoading]);
  (0,external_React_.useEffect)(function () {
    var _Object$values$filter;
    Object.entries(imageHubSettings).forEach(function (_ref2) {
      var _ref3 = ProvidersAndFilters_slicedToArray(_ref2, 2),
        key = _ref3[0],
        value = _ref3[1];
      if (key.includes("image_hub_enable_")) {
        var providerKey = key.replace("image_hub_enable_", "").toUpperCase();
        if (PROVIDERS !== null && PROVIDERS !== void 0 && PROVIDERS[providerKey]) {
          PROVIDERS[providerKey].enabled = value;
        }
      }
    });
    PROVIDERS.All.enabled = Object.values(PROVIDERS).filter(function (x) {
      return x.name !== "All" && x.enabled;
    }).length !== 1;
    setProvider(((_Object$values$filter = Object.values(PROVIDERS).filter(function (x) {
      return x.enabled;
    })[0]) === null || _Object$values$filter === void 0 ? void 0 : _Object$values$filter.name) || "");
  }, [imageHubSettings]);
  return /*#__PURE__*/React.createElement("div", {
    className: "image-hub-toolbar-sticky"
  }, /*#__PURE__*/React.createElement(external_wp_components_namespaceObject.ToolbarGroup, {
    className: media ? "image-hub-toolbar image-hub-toolbar-white" : "image-hub-toolbar"
  }, /*#__PURE__*/React.createElement("div", {
    ref: toolbarRef
  }, Object.keys(PROVIDERS).map(function (prov) {
    var _prov$charAt, _prov$slice;
    if (!PROVIDERS[prov].enabled) return null;
    return /*#__PURE__*/React.createElement(CustomToolbarButton, {
      key: prov,
      ref: function ref(el) {
        return buttonRefs.current[PROVIDERS[prov].name.toLowerCase()] = el;
      },
      selected: (prov === null || prov === void 0 ? void 0 : prov.toLowerCase()) == (provider === null || provider === void 0 ? void 0 : provider.toLowerCase()),
      icon: PROVIDERS[prov].icon ? PROVIDERS[prov].icon : undefined,
      onClick: function onClick() {
        setProvider(PROVIDERS[prov].name);
        setAdditionalQueryParams({});
        setTimeout(function () {
          fetchImages(searchTerm === null || searchTerm === void 0 ? void 0 : searchTerm.toLowerCase(), PROVIDERS[prov].name, 1, true, {});
        }, 400);
      },
      label: prov == "All" ? "All Libraries" : ((_prov$charAt = prov.charAt(0)) === null || _prov$charAt === void 0 ? void 0 : _prov$charAt.toUpperCase()) + ((_prov$slice = prov.slice(1)) === null || _prov$slice === void 0 ? void 0 : _prov$slice.toLowerCase())
    });
  }), provider == "giphy" && /*#__PURE__*/React.createElement("a", {
    href: "https://giphy.com/",
    target: "_blank",
    className: "image-hub-giphy-attribution"
  }, /*#__PURE__*/React.createElement("img", {
    src: image_hub_data.giphyAttrUrl
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: 0,
      background: "#d3d3d3",
      width: "100%",
      height: "2px",
      bottom: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "image-hub-floating-underline",
    style: {
      left: "".concat(underlineStyle.left, "px"),
      width: "".concat(underlineStyle.width, "px")
    }
  })))), /*#__PURE__*/React.createElement(external_wp_components_namespaceObject.ToolbarGroup, {
    className: "image-hub-toolabar-query"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      justifyContent: "end",
      alignItems: "end",
      gap: "10px",
      width: "100%"
      // height: "65px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: provider == PROVIDERS.UNSPLASH.name && !lastSearchTerm || ["All", "giphy"].includes(provider) ? "100%" : "250px"
    }
  }, /*#__PURE__*/React.createElement(CustomSearchButton, {
    value: searchTerm || "",
    onSubmit: function onSubmit(val) {
      setSearchTerm(val);
      handleSearch(val);
    },
    onChange: function onChange(val) {
      setSearchTerm(val);
    },
    onBlur: function onBlur() {
      if (searchTerm.replaceAll(" ", "") != lastSearchTerm.replaceAll(" ", "")) {
        handleSearch();
      }
    },
    onClear: function onClear() {
      setAdditionalQueryParams({});
    }
  })), provider == PROVIDERS.UNSPLASH.name && !lastSearchTerm ? "" : /*#__PURE__*/React.createElement(components_QueryFilters, {
    media: media
  })), !isLoading && searchTerm && searchTerm.replace(/\s+/g, "").length > 0 && lastSearchTerm.toLowerCase() == searchTerm.toLowerCase() && /*#__PURE__*/React.createElement("p", {
    style: {
      color: "rgb(152, 151, 157)",
      margin: "0.5em 0"
    }
  }, localStorage.getItem("imageHubDevMode") == "true" && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "red"
    }
  }, images.length, "/"), /*#__PURE__*/React.createElement("strong", {
    style: {
      color: "black"
    }
  }, pagination.totalResults || (0,external_wp_i18n_namespaceObject.__)("No results", "image-hub")), (0,external_wp_i18n_namespaceObject.__)(" image(s) found for ", "image-hub"), /*#__PURE__*/React.createElement("strong", {
    style: {
      color: "black"
    }
  }, lastSearchTerm))), isLoading && /*#__PURE__*/React.createElement("div", {
    className: "image-hub-progress-bar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "image-hub-progress-bar-inner"
  })));
};
/* harmony default export */ const components_ProvidersAndFilters = (ProvidersAndFilters);
;// ./src/MediaApp.js



var App = function App() {
  return /*#__PURE__*/React.createElement("div", {
    key: "image-hub-app-container",
    className: "image-hub-app-container"
  }, /*#__PURE__*/React.createElement(components_ProvidersAndFilters, {
    media: true
  }), /*#__PURE__*/React.createElement(components_ImageGrid, {
    media: true
  }));
};
/* harmony default export */ const MediaApp = (App);
;// ./src/media-modal.js




var initMediaTab = function initMediaTab() {
  var getNewMediaTabObject = function getNewMediaTabObject(FrameSelect) {
    return {
      initialize: function initialize() {
        FrameSelect.prototype.initialize.apply(this, arguments);
        var CustomState = wp.media.controller.State.extend({
          insert: function insert() {
            this.frame.close();
          }
        });
        this.states.add([new CustomState({
          id: "image-hub-media-modal-tab",
          search: false,
          title: "Image Hub"
        })]);
        var self = this;
        this.on("content:render:ihmlt", this.renderContent, this);

        //Remove select Button and Toolbar from the image hub tab
        this.on("content:render", function () {
          // Wait for next tick so DOM is rendered
          setTimeout(function () {
            var _jQuery$, _jQuery$2;
            console.log('content:render', (_jQuery$ = jQuery('.media-frame-router>.media-router>.media-menu-item.active')[0]) === null || _jQuery$ === void 0 ? void 0 : _jQuery$.innerText);
            if (((_jQuery$2 = jQuery('.media-frame-router>.media-router>.media-menu-item.active')[0]) === null || _jQuery$2 === void 0 ? void 0 : _jQuery$2.innerText) === 'Image Hub') {
              var _jQuery;
              (_jQuery = jQuery('.media-frame-toolbar')) === null || _jQuery === void 0 || _jQuery.hide();
            } else {
              var _jQuery2;
              (_jQuery2 = jQuery('.media-frame-toolbar')) === null || _jQuery2 === void 0 || _jQuery2.show();
            }
          }, 1);
        }, this);
        var onReInsertBrowserButtonIfNeeded = function onReInsertBrowserButtonIfNeeded() {
          var _self$$el;
          var node = self === null || self === void 0 || (_self$$el = self.$el) === null || _self$$el === void 0 ? void 0 : _self$$el[0];
          if (!node) {
            return;
          }
          var browserButton = node.querySelector('button.browser');
          if (browserButton) {
            return;
          }
          browserButton = document.createElement('button');
          var buttonParent = node.querySelector('.upload-ui');
          if (!buttonParent) {
            return;
          }
          buttonParent.appendChild(browserButton);
          browserButton.outerHTML = '<button type="button" class="browser button button-hero" style="position: relative; z-index: 1;" id="__wp-uploader-id-1" aria-labelledby="__wp-uploader-id-1 post-upload-info">Select Files</button>';
        };
        this.on('ready', onReInsertBrowserButtonIfNeeded);
        this.on('router:create:browse', function (routerView) {
          imageHubInsertIconToTabTitle(routerView, self);
        });
      },
      browseRouter: function browseRouter(routerView) {
        FrameSelect.prototype.browseRouter.apply(this, arguments);
        routerView.set({
          ihmlt: {
            id: "image-hub",
            text: "Image Hub",
            priority: 120
          }
        });
      },
      renderContent: function renderContent() {
        renderTabContent.bind(this)();
      }
    };
  };
  var MediaFrameSelect = wp.media.view.MediaFrame.Select;
  wp.media.view.MediaFrame.Select = MediaFrameSelect.extend(getNewMediaTabObject(MediaFrameSelect));
  var MediaFramePost = wp.media.view.MediaFrame.Post;
  wp.media.view.MediaFrame.Post = MediaFramePost.extend(getNewMediaTabObject(MediaFramePost));
  top.imageHubMediaTabInited = true;
};
function renderTabContent() {
  var CustomView = wp.media.View.extend({
    tagName: 'div',
    className: 'demo-image-hub-media-modal-tab',
    render: function render() {
      renderHTMLContent(this.el); // Inject your custom content
      return this;
    }
  });
  var view = new CustomView();
  this.content.set(view);
}
function renderHTMLContent() {
  setTimeout(function () {
    var mediaLibraryRoot = document.querySelector('.demo-image-hub-media-modal-tab');
    if (!mediaLibraryRoot) {
      return;
    }
    var rootDiv = document.createElement('div');
    rootDiv.setAttribute('id', 'demo-image-hub-media-modal-root');
    mediaLibraryRoot.appendChild(rootDiv);
    imageHubMediaTabReactApp(rootDiv);
  }, 10);
}
function imageHubInsertIconToTabTitle(routerView, self) {
  // Wait for next tick so DOM is rendered
  setTimeout(function () {
    var _self$options, _self$options2, _self$options2$includ, _routerView$view;
    var onSelectBrowseButtonIfImageHubActive = function onSelectBrowseButtonIfImageHubActive(_ref) {
      var parentNode = _ref.parentNode,
        imageHubTabNode = _ref.imageHubTabNode;
      if (imageHubTabNode.classList.contains('active') && parentNode) {
        var browseButton = parentNode.querySelector('#menu-item-browse');
        if (browseButton) {
          browseButton.click();
        }
      }
    };
    var libraryType = (self === null || self === void 0 || (_self$options = self.options) === null || _self$options === void 0 || (_self$options = _self$options.library) === null || _self$options === void 0 || (_self$options = _self$options.type) === null || _self$options === void 0 ? void 0 : _self$options[0]) || 'image';
    var hasVideoTextInButton = self === null || self === void 0 || (_self$options2 = self.options) === null || _self$options2 === void 0 || (_self$options2 = _self$options2.button) === null || _self$options2 === void 0 || (_self$options2 = _self$options2.text) === null || _self$options2 === void 0 || (_self$options2$includ = _self$options2.includes) === null || _self$options2$includ === void 0 ? void 0 : _self$options2$includ.call(_self$options2, 'video');
    if (hasVideoTextInButton) {
      libraryType = 'video';
    }
    var isImage = libraryType === 'image';
    var node = routerView === null || routerView === void 0 || (_routerView$view = routerView.view) === null || _routerView$view === void 0 || (_routerView$view = _routerView$view.$el) === null || _routerView$view === void 0 ? void 0 : _routerView$view[0];
    if (!node) {
      return;
    }
    var imageHubTabNode = node.querySelector('#menu-item-ihmlt');
    if (!imageHubTabNode) {
      return;
    }
    imageHubTabNode.setAttribute('data-type', libraryType);
    if (!isImage) {
      onSelectBrowseButtonIfImageHubActive({
        imageHubTabNode: imageHubTabNode,
        parentNode: node
      });
      return;
    }
    var shouldOpenImageHubTab = top.kubioOpenImageHubOnNextOpenedMediaPicker;
    top.kubioOpenImageHubOnNextOpenedMediaPicker = false;
    if (shouldOpenImageHubTab) {
      imageHubTabNode.click();
    } else {
      //if the media picker is opened and the active tab is image hub but the free
      //images was not used pick the media library
      onSelectBrowseButtonIfImageHubActive({
        imageHubTabNode: imageHubTabNode,
        parentNode: node
      });
    }
    var svgParent = document.createElement('div');
    svgParent.innerHTML = "<img height=\"20px\" width=\"20px\" src=\"".concat(image_hub_data.imageUrl, "\" alt=\"Image Hub\">");
    imageHubTabNode.style.display = "flex";
    imageHubTabNode.style.gap = ".5em";
    imageHubTabNode.prepend(svgParent);
  }, 10);
}
var imageHubMediaTabReactApp = function imageHubMediaTabReactApp(rootElement) {
  if (!rootElement) {
    return;
  }
  var reactRoot = (0,client/* createRoot */.H)(rootElement);
  reactRoot.render(/*#__PURE__*/external_React_default().createElement((external_React_default()).StrictMode, null, /*#__PURE__*/external_React_default().createElement(ImageProvider, null, /*#__PURE__*/external_React_default().createElement(MediaApp, null))));
};

//if the tab is not initiated from kubio then we add the media tab logic.
//The imageHubMediaTabInited flag will be set only until the image hub plugin is installed. After that it won't
if (!top.imageHubMediaTabInited) {
  initMediaTab();
}
top.imageHubMediaTabReactApp = imageHubMediaTabReactApp;
})();

/******/ })()
;
//# sourceMappingURL=media-modal.js.map
